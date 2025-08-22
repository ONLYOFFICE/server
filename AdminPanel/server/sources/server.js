'use strict';

const path = require('path');
const moduleReloader = require('../../../Common/sources/moduleReloader');
const logProfile = (process.env.NODE_ENV && process.env.NODE_ENV.startsWith('production')) ? 'production' : 'development';
const absLogCfgPath = path.resolve(__dirname, '../../../Common/config/log4js', `${logProfile}.json`);
try {
  const existingOverlay = process.env.NODE_CONFIG ? JSON.parse(process.env.NODE_CONFIG) : {};
  existingOverlay.log = Object.assign({}, existingOverlay.log, { filePath: absLogCfgPath });
  process.env.NODE_CONFIG = JSON.stringify(existingOverlay);
} catch (_) {
  process.env.NODE_CONFIG = JSON.stringify({ log: { filePath: absLogCfgPath } });
}
const config = moduleReloader.requireConfigWithRuntime();
const logger = require('../../../Common/sources/logger');
const operationContext = require('../../../Common/sources/operationContext');
const tenantManager = require('../../../Common/sources/tenantManager');
const utils = require('../../../Common/sources/utils');
const commonDefines = require('../../../Common/sources/commondefines');

const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const cors = require('cors');

const configRouter = require('./routes/config/router');
const adminpanelRouter = require('./routes/adminpanel/router');

const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);

const corsWithCredentials = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

operationContext.global.logger.warn('AdminPanel server starting...');

const rawFileParser = bodyParser.raw(
  { inflate: true, limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'), type: function () { return true; } }
);

app.get('/info/info.json', cors(), utils.checkClientIp, async (req, res) => {
  const serverDate = new Date();
  serverDate.setMilliseconds(0);
  let output = {
    connectionsStat: {},
    licenseInfo: {},
    serverInfo: {
      buildVersion: commonDefines.buildVersion,
      buildNumber: commonDefines.buildNumber,
      date: serverDate.toISOString()
    },
    quota: {
      edit: { connectionsCount: 0, usersCount: { unique: 0, anonymous: 0 } },
      view: { connectionsCount: 0, usersCount: { unique: 0, anonymous: 0 } },
      byMonth: []
    }
  };
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    const [licenseInfo] = await tenantManager.getTenantLicense(ctx);
    output.licenseInfo = licenseInfo || {};
  } catch (e) {
    ctx.logger && ctx.logger.warn('info.json error: %s', e.stack);
  } finally {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(output));
  }
});

app.use('/info/config', corsWithCredentials, utils.checkClientIp, configRouter);
app.use('/info/adminpanel', corsWithCredentials, utils.checkClientIp, adminpanelRouter);

app.use((err, req, res, next) => {
  let ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  ctx.logger.error('default error handler:%s', err.stack);
  res.sendStatus(500);
});

const port = 9000;
server.listen(port, () => {
  operationContext.global.logger.warn('AdminPanel server listening on port %d', port);
});


