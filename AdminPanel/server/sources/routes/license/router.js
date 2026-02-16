'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const config = require('config');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const license = require('../../../../../Common/sources/license');
const constants = require('../../../../../Common/sources/constants');
const {validateJWT} = require('../../middleware/auth');

const router = express.Router();

const cfgLicenseFile = config.get('license.license_file');
const MAX_LICENSE_SIZE = 5 * 1024 * 1024; // 5 MB

// Simple mutex for file replacement
let replaceLock = false;

router.use(cookieParser());

const rawFileParser = bodyParser.raw({
  inflate: true,
  limit: MAX_LICENSE_SIZE,
  type() {
    return true;
  }
});

function requireAdmin(ctx, res) {
  if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
    res.status(403).json({error: 'Only admin can manage license'});
    return false;
  }
  return true;
}

function getLicenseFilePath() {
  return cfgLicenseFile || '';
}

function isLicenseValid(licenseData) {
  const c_LR = constants.LICENSE_RESULT;
  return !!(licenseData && licenseData.hasLicense && (licenseData.type === c_LR.Success || licenseData.type === c_LR.SuccessLimit));
}

function buildLicenseResponse(licenseData) {
  const base = {buildPackageType: license.packageType};
  if (!licenseData) {
    return {...base, hasLicense: false};
  }
  return {...base, ...licenseData};
}

/**
 * GET /
 * Returns current license information
 */
router.get('/', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const licPath = getLicenseFilePath();
    const bakPath = licPath ? licPath + '.bak' : '';
    const hasBackup = bakPath && fs.existsSync(bakPath);

    const tenantLicense = await tenantManager.getTenantLicense(ctx);
    let licenseData = null;
    if (tenantLicense && Array.isArray(tenantLicense) && tenantLicense.length > 0) {
      licenseData = tenantLicense[0];
    }

    const info = buildLicenseResponse(licenseData);
    info.hasBackup = hasBackup;
    info.configured = !!licPath;

    if (hasBackup) {
      try {
        const [bakData] = await license.readLicense(bakPath, {silent: true});
        info.backupInfo = buildLicenseResponse(bakData);
        info.backupInfo.valid = isLicenseValid(bakData);
      } catch (_) {
        /* backup unreadable — still report hasBackup so user can try */
      }
    }

    res.json(info);
  } catch (error) {
    ctx.logger.error('License info error: %s', error.stack);
    res.status(500).json({error: 'Failed to get license info'});
  }
});

/**
 * POST /validate
 * Validate a license file without applying it.
 * Writes to a temp file, reads license data, then removes the temp file.
 */
router.post('/validate', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({error: 'No file uploaded'});
    }

    if (req.body.length > MAX_LICENSE_SIZE) {
      return res.status(400).json({error: 'File too large. Maximum size is 5 MB'});
    }

    const licPath = getLicenseFilePath();
    const tmpDir = licPath ? path.dirname(licPath) : require('os').tmpdir();
    const tmpPath = path.join(tmpDir, 'license-validate-' + Date.now() + '.lic');

    try {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, {recursive: true});
      }
      fs.writeFileSync(tmpPath, req.body);

      const [licenseData] = await license.readLicense(tmpPath, {silent: true});
      const info = buildLicenseResponse(licenseData);

      info.valid = isLicenseValid(licenseData);

      res.json(info);
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) {
        /* ignore cleanup errors */
      }
    }
  } catch (error) {
    ctx.logger.error('License validate error: %s', error.stack);
    res.status(500).json({error: 'Failed to validate license'});
  }
});

/**
 * POST /
 * Upload and apply a new license file.
 * Atomic replace with backup + auto-rollback on invalid license.
 */
router.post('/', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const licPath = getLicenseFilePath();
    if (!licPath) {
      return res.status(400).json({error: 'License file path is not configured (license.license_file)'});
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({error: 'No file uploaded'});
    }

    if (req.body.length > MAX_LICENSE_SIZE) {
      return res.status(400).json({error: 'File too large. Maximum size is 5 MB'});
    }

    if (replaceLock) {
      return res.status(409).json({error: 'License replacement already in progress'});
    }

    replaceLock = true;
    ctx.logger.info('License upload started (%d bytes)', req.body.length);

    try {
      const licDir = path.dirname(licPath);
      if (!fs.existsSync(licDir)) {
        fs.mkdirSync(licDir, {recursive: true});
      }

      // Backup current license if it exists
      if (fs.existsSync(licPath)) {
        fs.copyFileSync(licPath, licPath + '.bak');
        ctx.logger.info('License backup created: %s', licPath + '.bak');
      }

      // Write new license via tmp file + rename for atomicity
      const tmpPath = licPath + '.tmp';
      fs.writeFileSync(tmpPath, req.body);
      fs.renameSync(tmpPath, licPath);
      ctx.logger.info('License file replaced: %s', licPath);

      // Wait for fs.watchFile to pick up the change
      await new Promise(resolve => setTimeout(resolve, 500));

      // Re-read and validate the new license
      const [newLicenseData, newLicenseOriginal] = await license.readLicense(licPath);

      if (!isLicenseValid(newLicenseData)) {
        // Rollback: restore backup
        ctx.logger.warn('New license is invalid (type=%s), rolling back', newLicenseData?.type);
        if (fs.existsSync(licPath + '.bak')) {
          fs.copyFileSync(licPath + '.bak', licPath);
          ctx.logger.info('License rolled back to backup');
        }

        // Wait for watchFile again
        await new Promise(resolve => setTimeout(resolve, 500));

        return res.status(400).json({
          error: 'License file is invalid or expired. Previous license has been restored.',
          type: newLicenseData?.type
        });
      }

      // Update in-memory license for AdminPanel
      tenantManager.setDefLicense(newLicenseData, newLicenseOriginal);
      ctx.logger.info('License updated successfully');

      const bakPath = licPath + '.bak';
      const info = buildLicenseResponse(newLicenseData);
      info.hasBackup = fs.existsSync(bakPath);
      info.configured = true;

      if (info.hasBackup) {
        try {
          const [bakData] = await license.readLicense(bakPath, {silent: true});
          info.backupInfo = buildLicenseResponse(bakData);
          info.backupInfo.valid = isLicenseValid(bakData);
        } catch (_) {
          /* ignore */
        }
      }

      res.json(info);
    } finally {
      replaceLock = false;
    }
  } catch (error) {
    replaceLock = false;
    ctx.logger.error('License upload error: %s', error.stack);
    res.status(500).json({error: 'Failed to upload license'});
  }
});

/**
 * POST /revert
 * Revert to the previous (backup) license file
 */
router.post('/revert', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const licPath = getLicenseFilePath();
    if (!licPath) {
      return res.status(400).json({error: 'License file path is not configured'});
    }

    const bakPath = licPath + '.bak';
    if (!fs.existsSync(bakPath)) {
      return res.status(409).json({error: 'No backup license file available'});
    }

    if (replaceLock) {
      return res.status(409).json({error: 'License replacement in progress, try again later'});
    }

    // Pre-validate backup before applying
    const [bakData] = await license.readLicense(bakPath, {silent: true});
    if (!isLicenseValid(bakData)) {
      ctx.logger.warn('Backup license is invalid (type=%s), revert refused', bakData?.type);
      return res.status(400).json({error: 'Backup license is invalid or expired. Revert is not allowed.'});
    }

    replaceLock = true;
    ctx.logger.info('License revert started');

    try {
      fs.copyFileSync(bakPath, licPath);
      ctx.logger.info('License reverted from backup: %s', bakPath);

      // Remove backup — revert is a one-shot undo
      fs.unlinkSync(bakPath);
      ctx.logger.info('Backup removed after revert: %s', bakPath);

      // Wait for fs.watchFile
      await new Promise(resolve => setTimeout(resolve, 500));

      const [revertedData, revertedOriginal] = await license.readLicense(licPath);
      tenantManager.setDefLicense(revertedData, revertedOriginal);
      ctx.logger.info('License revert completed');

      const info = buildLicenseResponse(revertedData);
      info.hasBackup = false;
      info.configured = true;

      res.json(info);
    } finally {
      replaceLock = false;
    }
  } catch (error) {
    replaceLock = false;
    ctx.logger.error('License revert error: %s', error.stack);
    res.status(500).json({error: 'Failed to revert license'});
  }
});

module.exports = router;
