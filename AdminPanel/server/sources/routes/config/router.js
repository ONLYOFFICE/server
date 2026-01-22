'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const {getScopedConfig, getScopedBaseConfig, validateScoped, getDiffFromBase} = require('./config.service');
const {validateJWT} = require('../../middleware/auth');
const cookieParser = require('cookie-parser');
const utils = require('../../../../../Common/sources/utils');
const supersetSchema = require('../../../../../Common/config/schemas/config.schema.json');

const router = express.Router();
router.use(cookieParser());

const rawFileParser = bodyParser.raw({
  inflate: true,
  limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'),
  type() {
    return true;
  }
});

router.get('/', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('config get start');
    const filteredConfig = getScopedConfig(ctx);
    res.setHeader('Content-Type', 'application/json');
    res.json(filteredConfig);
  } catch (error) {
    ctx.logger.error('Config get error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  } finally {
    ctx.logger.info('config get end');
  }
});

router.get('/schema', validateJWT, async (_req, res) => {
  res.json(supersetSchema);
});

router.get('/baseconfig', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('baseconfig get start');
    const scopedBaseConfig = getScopedBaseConfig(ctx);
    res.setHeader('Content-Type', 'application/json');
    res.json(scopedBaseConfig);
  } catch (error) {
    ctx.logger.error('Baseconfig get error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  } finally {
    ctx.logger.info('baseconfig get end');
  }
});

router.patch('/', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('config patch start');
    const updateData = JSON.parse(req.body);
    const validationResult = validateScoped(ctx, updateData);
    if (validationResult.errors) {
      ctx.logger.error('Config save error: %j', validationResult.errors);
      return res.status(400).json({
        errors: validationResult.errors,
        errorsText: validationResult.errorsText
      });
    }

    let currentConfig;
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      currentConfig = await tenantManager.getTenantConfig(ctx);
    } else {
      currentConfig = await runtimeConfigManager.getConfig(ctx);
    }
    const diffConfig = getDiffFromBase(ctx, currentConfig, validationResult.value);

    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      await tenantManager.setTenantConfig(ctx, diffConfig);
    } else {
      await runtimeConfigManager.replaceConfig(ctx, diffConfig);
    }
    const filteredConfig = getScopedConfig(ctx);

    res.status(200).json(utils.deepMergeObjects(filteredConfig, validationResult.value));
  } catch (error) {
    ctx.logger.error('Configuration save error: %s', error.stack);
    res.status(500).json({error: 'Internal server error', details: error.message});
  } finally {
    ctx.logger.info('config patch end');
  }
});

router.post('/reset', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('config reset start');

    const currentConfig = await runtimeConfigManager.getConfig(ctx);
    const passwordHash = currentConfig?.adminPanel?.passwordHash;

    const {paths} = JSON.parse(req.body);
    let resetConfig = {};

    if (paths.includes('*')) {
      if (passwordHash) {
        resetConfig.adminPanel = {
          passwordHash
        };
      }
    } else {
      resetConfig = JSON.parse(JSON.stringify(currentConfig));

      paths.forEach(pathItem => {
        if (pathItem && pathItem !== '*') {
          const pathParts = pathItem.split('.');
          let current = resetConfig;

          for (let i = 0; i < pathParts.length - 1; i++) {
            if (current && typeof current === 'object') {
              current = current[pathParts[i]];
            } else {
              current = undefined;
              break;
            }
          }

          if (current && typeof current === 'object') {
            delete current[pathParts[pathParts.length - 1]];
          }
        }
      });

      if (passwordHash) {
        resetConfig.adminPanel = {
          ...resetConfig.adminPanel,
          passwordHash
        };
      }
    }

    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      await tenantManager.replaceTenantConfig(ctx, resetConfig);
    } else {
      await runtimeConfigManager.replaceConfig(ctx, resetConfig);
    }

    delete resetConfig.adminPanel;
    ctx.logger.info('Configuration reset successfully for paths: %j', paths);
    const filteredMergedConfig = getScopedBaseConfig(ctx);

    res.status(200).json(utils.deepMergeObjects({}, filteredMergedConfig, resetConfig));
  } catch (error) {
    ctx.logger.error('Configuration reset error: %s', error.stack);
    res.status(500).json({error: 'Internal server error', details: error.message});
  } finally {
    ctx.logger.info('config reset end');
  }
});

// Get the fixed signing certificate path from config
function getSigningCertPath() {
  return config.get('FileConverter.converter.signingKeyStorePath') || '';
}

// Check signing certificate status (does file exist on disk)
router.get('/signing-certificate/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    // Only admin can check certificate status
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Only admin can check signing certificate status'});
    }

    const certPath = getSigningCertPath();

    if (!certPath) {
      return res.status(200).json({exists: false, configured: false});
    }

    const fileExists = fs.existsSync(certPath);
    // Don't expose full path - only return existence status
    res.status(200).json({exists: fileExists, configured: true});
  } catch (error) {
    ctx.logger.error('Signing certificate status check error: %s', error.stack);
    res.status(500).json({error: 'Failed to check certificate status'});
  }
});

// Upload signing certificate (.p12/.pfx file) - replaces file at fixed path from config
router.post('/signing-certificate', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('signing certificate upload start');

    // Only admin can upload certificates
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Only admin can upload signing certificates'});
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({error: 'No file uploaded'});
    }

    // Basic validation: P12/PFX files should have reasonable size (1KB - 100KB typically)
    const MAX_CERT_SIZE = 1024 * 1024; // 1MB max
    if (req.body.length > MAX_CERT_SIZE) {
      return res.status(400).json({error: 'File too large. Certificate files should be less than 1MB'});
    }

    const certPath = getSigningCertPath();
    if (!certPath) {
      return res.status(400).json({error: 'signingKeyStorePath is not configured'});
    }

    // Ensure directory exists
    const certDir = path.dirname(certPath);
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, {recursive: true});
    }

    // Write the file (overwrites existing)
    fs.writeFileSync(certPath, req.body);

    ctx.logger.info('Signing certificate uploaded successfully: %s', certPath);

    // Don't expose path in response
    res.status(200).json({success: true});
  } catch (error) {
    ctx.logger.error('Signing certificate upload error: %s', error.stack);
    res.status(500).json({error: 'Failed to upload certificate'});
  } finally {
    ctx.logger.info('signing certificate upload end');
  }
});

// Delete signing certificate - removes file at fixed path from config
router.delete('/signing-certificate', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('signing certificate delete start');

    // Only admin can delete certificates
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Only admin can delete signing certificates'});
    }

    const certPath = getSigningCertPath();

    if (!certPath) {
      return res.status(404).json({error: 'signingKeyStorePath is not configured'});
    }

    // Delete the file if it exists
    if (fs.existsSync(certPath)) {
      fs.unlinkSync(certPath);
      ctx.logger.info('Signing certificate deleted: %s', certPath);
    }

    res.status(200).json({success: true});
  } catch (error) {
    ctx.logger.error('Signing certificate delete error: %s', error.stack);
    res.status(500).json({error: 'Failed to delete certificate'});
  } finally {
    ctx.logger.info('signing certificate delete end');
  }
});

module.exports = router;
