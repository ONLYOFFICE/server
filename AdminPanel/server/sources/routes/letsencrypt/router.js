'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const tls = require('tls');
const net = require('net');
const {validateJWT} = require('../../middleware/auth');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const {findScript, runScript} = require('../../utils/scriptRunner');

const router = express.Router();
router.use(cookieParser());
router.use(express.json());

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (certbot can be slow)
const SCRIPT_NAME = 'documentserver-letsencrypt';
const SCRIPT_SEARCH_PATHS = ['/usr/bin'];

/**
 * Get certificate info via TLS connection
 */
function getCertificate(hostname) {
  return new Promise(resolve => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        rejectUnauthorized: false,
        servername: net.isIP(hostname) ? undefined : hostname,
        timeout: 2000
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.subject) return resolve(null);

        resolve({
          domain: cert.subject.CN || null,
          expiresAt: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
          issuer: cert.issuer?.O || null
        });
      }
    );

    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// GET /status
router.get('/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  ctx.logger.info("Let's Encrypt status request");

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    const scriptPath = findScript(SCRIPT_NAME, SCRIPT_SEARCH_PATHS);
    if (!scriptPath) {
      return res.json({available: false});
    }

    const hostname = req.hostname || req.headers.host?.split(':')[0];
    const certificate = hostname ? await getCertificate(hostname) : null;

    res.json({available: true, certificate});
  } catch (error) {
    ctx.logger.error('Status check error: %s', error.stack);
    res.status(500).json({error: 'Failed to check status'});
  }
});

// POST /install
router.post('/install', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  const {email, domain} = req.body;
  ctx.logger.info("Let's Encrypt install request: domain=%s email=%s", domain, email);

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    // Basic validation (script does thorough validation)
    if (!email || !email.includes('@')) {
      return res.status(400).json({error: 'Valid email address required'});
    }
    if (!domain) {
      return res.status(400).json({error: 'Domain name required'});
    }

    const scriptPath = findScript(SCRIPT_NAME, SCRIPT_SEARCH_PATHS);
    if (!scriptPath) {
      return res.status(400).json({error: 'Installation script not found'});
    }

    await runScript({
      scriptPath,
      args: [email, domain],
      timeoutMs: INSTALL_TIMEOUT_MS,
      label: 'letsencrypt',
      logger: ctx.logger
    });

    ctx.logger.info('Certificate installed successfully for %s', domain);
    res.json({success: true});
  } catch (error) {
    ctx.logger.error('Installation failed: %s', error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
