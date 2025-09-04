'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const operationContext = require('../../../../../Common/sources/operationContext');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const utils = require('../../../../../Common/sources/utils');
const {getScopedConfig, validateScoped, getScopedSchema} = require('./config.service');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const adminPanelJwtSecret = config.get('adminPanel.jwtSecret');

const router = express.Router();
router.use(cookieParser());

const rawFileParser = bodyParser.raw({
  inflate: true,
  limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'),
  type() {
    return true;
  }
});

const validateJWT = async (req, res, next) => {
  const ctx = new operationContext.Context();
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized - No token provided'});
    }
    const decoded = jwt.verify(token, adminPanelJwtSecret);
    ctx.init(decoded.tenant);
    await ctx.initTenantCache();
    req.user = decoded;
    req.ctx = ctx;
    return next();
  } catch {
    return res.status(401).json({error: 'Unauthorized'});
  }
};

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
    res.sendStatus(200);
  } catch (error) {
    ctx.logger.error('Configuration save error: %s', error.stack);
    res.status(500).json({error: 'Internal server error', details: error.message});
  } finally {
    ctx.logger.info('config patch end');
  }
});

module.exports = router;
