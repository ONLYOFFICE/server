'use strict';
const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const operationContext = require('../../../../../Common/sources/operationContext');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const utils = require('../../../../../Common/sources/utils');
const {getFilteredConfig, validate} = require('./config.service');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
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

const validateJWT = async (req, res, next) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized - No token provided'});
    }
    const defaultTenantSecret = config.get('services.CoAuthoring.secret.browser.string');
    const tenantBaseDir = config.get('tenants.baseDir');
    const filenameSecret = config.get('tenants.filenameSecret');
    try {
      const decoded = jwt.verify(token, defaultTenantSecret);
      if (ctx.tenant !== decoded.tenant) {
        return res.status(401).json({error: 'Unauthorized - Invalid tenant'});
      }
      req.user = decoded;
      req.ctx = ctx;
      return next();
    } catch {
      if (tenantBaseDir && fs.existsSync(tenantBaseDir)) {
        const tenantList = fs.readdirSync(tenantBaseDir);
        for (const tenant of tenantList) {
          try {
            const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
            const decoded = jwt.verify(token, tenantSecret);
            if (ctx.tenant !== decoded.tenant) {
              return res.status(401).json({error: 'Unauthorized - Invalid tenant'});
            }
            req.user = decoded;
            req.ctx = ctx;
            return next();
          } catch {
            continue;
          }
        }
      }
      return res.status(401).json({error: 'Unauthorized - Invalid token'});
    }
  } catch {
    return res.status(401).json({error: 'Unauthorized'});
  }
};

router.get('/', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.logger.debug('config get start');
    const filteredConfig = getFilteredConfig(ctx);
    res.setHeader('Content-Type', 'application/json');
    res.json(filteredConfig);
    ctx.logger.debug('Config get success');
  } catch (error) {
    ctx.logger.error('Config get error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

router.patch('/', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    const currentConfig = ctx.getFullCfg();
    const updateData = JSON.parse(req.body);
    const validationResult = validate(updateData, ctx);
    if (validationResult.error) {
      ctx.logger.error('Config save error: %s', validationResult.error);
      return res.status(400).json({
        error: validationResult.error
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
  }
});

module.exports = router;
