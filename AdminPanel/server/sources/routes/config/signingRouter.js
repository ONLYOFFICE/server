'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const tls = require('tls');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const {validateJWT} = require('../../middleware/auth');

const router = express.Router();

const rawFileParser = bodyParser.raw({
  inflate: true,
  limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'),
  type() {
    return true;
  }
});

/**
 * @returns {string} signing certificate path (new path with legacy fallback)
 */
function getSigningCertPath() {
  return config.get('FileConverter.converter.signing.keyStorePath') || config.get('FileConverter.converter.signingKeyStorePath') || '';
}

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isPemCertificate(buf) {
  const str = buf.toString('utf8', 0, Math.min(buf.length, 100));
  return str.includes('-----BEGIN CERTIFICATE-----');
}

/**
 * @param {Buffer} certBuffer
 * @param {string} passphrase
 * @returns {{ valid: boolean, error?: string, type: string, certCount?: number }}
 */
function validateCertificate(certBuffer, passphrase) {
  if (isPemCertificate(certBuffer)) {
    const certs = certBuffer.toString('utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certs || certs.length === 0) return {valid: false, error: 'No PEM certificates found', type: 'pem'};
    return {valid: true, type: 'pem', certCount: certs.length};
  }
  try {
    tls.createSecureContext({pfx: certBuffer, passphrase: passphrase || ''});
    return {valid: true, type: 'p12'};
  } catch (error) {
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('mac verify') || errorMsg.includes('bad decrypt')) {
      return {valid: false, error: passphrase ? 'Invalid certificate passphrase' : 'Certificate passphrase is required', type: 'p12'};
    }
    return {valid: false, error: 'Invalid certificate file. Expected P12/PFX or PEM.', type: 'unknown'};
  }
}

/**
 * @param {Object} ctx
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function requireAdmin(ctx, res) {
  if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
    res.status(403).json({error: 'Only admin can manage signing certificates'});
    return false;
  }
  return true;
}

// GET /status
router.get('/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;
    const certPath = getSigningCertPath();
    if (!certPath) return res.status(200).json({exists: false, configured: false});
    if (!fs.existsSync(certPath)) return res.status(200).json({exists: false, configured: true});

    let type = null;
    let certCount = null;
    try {
      const content = fs.readFileSync(certPath);
      if (isPemCertificate(content)) {
        type = 'pem';
        const certs = content.toString('utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
        certCount = certs ? certs.length : 0;
      } else {
        type = 'p12';
      }
    } catch (_) {
      /* ignore read errors */
    }
    res.status(200).json({exists: true, configured: true, type, certCount});
  } catch (error) {
    ctx.logger.error('Signing certificate status check error: %s', error.stack);
    res.status(500).json({error: 'Failed to check certificate status'});
  }
});

// POST / — upload signing certificate (P12/PFX or PEM chain)
router.post('/', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('signing certificate upload start');
    if (!requireAdmin(ctx, res)) return;
    if (!req.body || req.body.length === 0) return res.status(400).json({error: 'No file uploaded'});
    if (req.body.length > 1024 * 1024) return res.status(400).json({error: 'File too large (max 1MB)'});

    let passphrase = req.headers['x-certificate-passphrase'];
    if (passphrase) passphrase = Buffer.from(passphrase, 'base64').toString('utf8');

    const validation = validateCertificate(req.body, passphrase);
    if (!validation.valid) return res.status(400).json({error: validation.error});

    const certPath = getSigningCertPath();
    if (!certPath) return res.status(400).json({error: 'signingKeyStorePath is not configured'});

    const certDir = path.dirname(certPath);
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, {recursive: true});
    fs.writeFileSync(certPath, req.body);

    ctx.logger.info('Certificate uploaded (%s): %s', validation.type, certPath);
    res.status(200).json({success: true, type: validation.type, certCount: validation.certCount});
  } catch (error) {
    ctx.logger.error('Signing certificate upload error: %s', error.stack);
    res.status(500).json({error: 'Failed to upload certificate'});
  } finally {
    ctx.logger.info('signing certificate upload end');
  }
});

// POST /validate — minimal CSC config check (OAuth token request) before save
router.post('/validate', validateJWT, express.json(), async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;
    const {provider, config: cfg} = req.body || {};
    if (!provider || !cfg) return res.status(400).json({valid: false, error: 'Missing provider or config'});

    if (provider !== 'csc') return res.status(400).json({valid: false, error: `Validation not supported for: ${provider}`});

    if (!cfg.baseUrl) return res.json({valid: false, error: 'Base URL is required'});
    if (!cfg.tokenUrl) return res.json({valid: false, error: 'Token URL is required'});
    if (!cfg.clientId) return res.json({valid: false, error: 'Client ID is required'});
    if (!cfg.clientSecret) return res.json({valid: false, error: 'Client Secret is required'});

    const {fetchOAuthToken} = require('../../../../../Common/sources/signing/cscOAuth');
    const data = await fetchOAuthToken(cfg);
    if (data?.access_token) {
      return res.json({valid: true, message: 'OAuth token obtained successfully'});
    }
    return res.json({valid: false, error: 'Token endpoint returned no access_token'});
  } catch (error) {
    ctx.logger.error('CSC config validation error: %s', error.message);
    const status = error?.response?.status;
    const data = error?.response?.data;
    const msg = data?.error_description || data?.error || data?.message || error.message;
    res.json({valid: false, error: `Token request failed (HTTP ${status || 'N/A'}): ${msg}`});
  }
});

// DELETE / — delete signing certificate
router.delete('/', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;
    const certPath = getSigningCertPath();
    if (!certPath) return res.status(404).json({error: 'signingKeyStorePath is not configured'});
    if (fs.existsSync(certPath)) {
      fs.unlinkSync(certPath);
      ctx.logger.info('Signing certificate deleted: %s', certPath);
    }
    res.status(200).json({success: true});
  } catch (error) {
    ctx.logger.error('Signing certificate delete error: %s', error.stack);
    res.status(500).json({error: 'Failed to delete certificate'});
  }
});

module.exports = router;
