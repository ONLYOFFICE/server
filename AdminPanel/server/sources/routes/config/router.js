'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const utils = require('../../../../../Common/sources/utils');
const {getScopedConfig, validateScoped, getScopedSchema} = require('./config.service');
const {validateJWT} = require('../../middleware/auth');
const cookieParser = require('cookie-parser');

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

router.get('/schema', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('config schema start');
    const schema = getScopedSchema(ctx);
    res.json(schema);
  } catch (error) {
    ctx.logger.error('Config schema error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  } finally {
    ctx.logger.info('config schema end');
  }
});

router.patch('/', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.info('config patch start');
    const currentConfig = ctx.getFullCfg();
    const updateData = JSON.parse(req.body);
    const validationResult = validateScoped(ctx, updateData);
    if (validationResult.errors) {
      ctx.logger.error('Config save error: %j', validationResult.errors);
      return res.status(400).json({
        errors: validationResult.errors,
        errorsText: validationResult.errorsText
      });
    }
    const newConfig = utils.deepMergeObjects(currentConfig, validationResult.value);
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      await tenantManager.setTenantConfig(ctx, newConfig);
    } else {
      await runtimeConfigManager.saveConfig(ctx, newConfig);
    }

    await ctx.initTenantCache();
    const filteredConfig = getScopedConfig(ctx);
    res.status(200).json(filteredConfig);
  } catch (error) {
    ctx.logger.error('Configuration save error: %s', error.stack);
    res.status(500).json({error: 'Internal server error', details: error.message});
  } finally {
    ctx.logger.info('config patch end');
  }
});

module.exports = router;
