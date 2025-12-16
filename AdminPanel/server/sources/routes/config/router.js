'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const {getScopedConfig, getScopedBaseConfig, validateScoped, getDiffFromBase, getFullConfigRedacted} = require('./config.service');
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
    const configRedacted = getFullConfigRedacted(ctx);
    res.setHeader('Content-Type', 'application/json');
    res.json(configRedacted);
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

      paths.forEach(path => {
        if (path && path !== '*') {
          const pathParts = path.split('.');
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

module.exports = router;
