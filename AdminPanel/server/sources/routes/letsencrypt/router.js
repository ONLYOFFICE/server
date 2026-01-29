'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const tls = require('tls');
const {spawn} = require('child_process');
const {validateJWT} = require('../../middleware/auth');
const tenantManager = require('../../../../../Common/sources/tenantManager');

const router = express.Router();
router.use(cookieParser());
router.use(express.json());

const SCRIPT_PATH = '/usr/bin/documentserver-letsencrypt.sh';
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (certbot can be slow)

/**
 * Installation error with details
 */
class InstallError extends Error {
  constructor(message, details = '') {
    super(message);
    this.details = details;
  }
}

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
        servername: hostname,
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

/**
 * Run installation script with timeout and proper cleanup
 * Uses AbortController (Node.js 15+) for clean cancellation
 */
function runInstallScript(email, domain, logger) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    let stderr = '';
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve(result);
    };

    // Use 'sh' for POSIX compatibility (works on Alpine, Debian, etc.)
    // The script has #!/bin/bash shebang, so it will use bash if available
    const proc = spawn('sh', [SCRIPT_PATH, email, domain], {
      signal: ac.signal,
      killSignal: 'SIGTERM'
    });

    // Timeout - AbortController handles the kill
    const timeout = setTimeout(() => ac.abort(), INSTALL_TIMEOUT_MS);

    proc.stdout.on('data', data => {
      logger.info('letsencrypt: %s', data.toString().trim());
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
      logger.warn('letsencrypt: %s', data.toString().trim());
    });

    proc.on('error', err => {
      const details = stderr.slice(-2048).trim();
      if (err.name === 'AbortError') {
        finish(new InstallError('Installation timed out after 5 minutes', details));
      } else {
        finish(new InstallError(`Failed to start script: ${err.message}`, details));
      }
    });

    proc.on('close', (code, signal) => {
      if (signal) {
        // Killed by external signal (not our timeout - that's handled in 'error')
        finish(new InstallError(`Process killed by ${signal}`, stderr.slice(-2048).trim()));
      } else if (code === 0) {
        finish(null);
      } else {
        finish(new InstallError(`Installation failed (exit code ${code})`, stderr.slice(-2048).trim()));
      }
    });
  });
}

// GET /status
router.get('/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    const available = fs.existsSync(SCRIPT_PATH);
    if (!available) {
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

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    const {email, domain} = req.body;

    // Basic validation (script does thorough validation)
    if (!email || !email.includes('@')) {
      return res.status(400).json({error: 'Valid email address required'});
    }
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({error: 'Valid domain name required'});
    }
    if (!fs.existsSync(SCRIPT_PATH)) {
      return res.status(400).json({error: 'Installation script not found'});
    }

    ctx.logger.info("Starting Let's Encrypt installation: domain=%s email=%s", domain, email);

    await runInstallScript(email, domain, ctx.logger);

    ctx.logger.info('Certificate installed successfully for %s', domain);
    res.json({success: true});
  } catch (error) {
    ctx.logger.error('Installation failed: %s', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      details: error.details || null // Full stderr for debugging
    });
  }
});

module.exports = router;
