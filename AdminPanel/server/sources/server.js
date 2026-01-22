/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const moduleReloader = require('../../../Common/sources/moduleReloader');
const config = moduleReloader.requireConfigWithRuntime();
const operationContext = require('../../../Common/sources/operationContext');
const tenantManager = require('../../../Common/sources/tenantManager');
const license = require('../../../Common/sources/license');
const runtimeConfigManager = require('../../../Common/sources/runtimeConfigManager');
const {validateJWT} = require('./middleware/auth');

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const infoRouter = require('../../../DocService/sources/routes/info');

const configRouter = require('./routes/config/router');
const adminpanelRouter = require('./routes/adminpanel/router');
const wopiRouter = require('./routes/wopi/router');
const docserviceRouter = require('./routes/docservice/router');
const passwordManager = require('./passwordManager');
const bootstrap = require('./bootstrap');
const devProxy = require('./devProxy');

const port = config.get('adminPanel.port');
const cfgLicenseFile = config.get('license.license_file');
const cfgCoAuthoringPort = config.get('services.CoAuthoring.server.port');

const app = express();
app.disable('x-powered-by');

// Trust first proxy for X-Forwarded-* headers (nginx, load balancer)
app.set('trust proxy', 1);

const server = http.createServer(app);

let licenseInfo, licenseOriginal;

const readLicense = async function () {
  [licenseInfo, licenseOriginal] = await license.readLicense(cfgLicenseFile);
};

const updateLicense = async () => {
  try {
    await readLicense();
    tenantManager.setDefLicense(licenseInfo, licenseOriginal);
    operationContext.global.logger.info('End updateLicense');
  } catch (err) {
    operationContext.global.logger.error('updateLicense error: %s', err.stack);
  }
};

updateLicense();
fs.watchFile(cfgLicenseFile, updateLicense);
setInterval(updateLicense, 86400000);

// Generate and display bootstrap token if setup is required
(async () => {
  try {
    const ctx = operationContext.global;
    const setupRequired = await passwordManager.isSetupRequired(ctx);

    if (setupRequired) {
      // Check if token already exists and valid
      const hasToken = bootstrap.hasValidBootstrapToken();

      if (!hasToken) {
        // Generate new bootstrap code
        const {code, expiresAt} = await bootstrap.generateBootstrapToken(ctx);

        // Log code as single line for log aggregation systems
        ctx.logger.warn(
          'AdminPanel SETUP REQUIRED | Bootstrap code: ' + code + ' | Expires: ' + expiresAt.toISOString() + ' | Open: http://host/admin'
        );
      } else {
        ctx.logger.warn('AdminPanel SETUP REQUIRED | Bootstrap code already exists in memory');
      }
    }
  } catch (e) {
    operationContext.global.logger.error('Bootstrap token generation error: %s', e.stack);
  }
})();

// Development mode setup: CORS + DocService proxy
if (process.env.NODE_ENV.startsWith('development-')) {
  app.use(devProxy.getDevCors());
}

operationContext.global.logger.warn('AdminPanel server starting...');

function disableCache(req, res, next) {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });
  next();
}

// API routes under /admin prefix
app.use('/admin/api/v1/config', disableCache, configRouter);
app.use('/admin/api/v1/wopi', disableCache, wopiRouter);
app.use('/admin/api/v1/docservice', disableCache, docserviceRouter);
app.use('/admin/api/v1', disableCache, adminpanelRouter);
app.get('/admin/api/v1/stat', disableCache, async (req, res) => {
  await infoRouter.licenseInfo(req, res);
});
app.get('/admin/api/v1/tenants', disableCache, validateJWT, async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    const tenants = await tenantManager.getAllTenants(ctx);
    const baseTenant = tenantManager.getDefautTenant();
    res.json({baseTenant, tenants});
  } catch (e) {
    ctx.logger.error('tenants list error: %s', e.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

// Serve AdminPanel client build as static assets under /admin
const clientBuildPath = path.resolve('client/build');

/**
 * Custom middleware to handle /admin redirect with relative path
 * Prevents express.static from doing absolute 302 redirect
 */
app.use('/admin', (req, res, next) => {
  // If path is exactly /admin (no trailing slash), redirect relatively
  if ((req.path === '' || req.path === '/') && !req.originalUrl.endsWith('/')) {
    // Relative redirect preserves virtual path prefix
    return res.redirect(302, 'admin/');
  }
  next();
});

app.use('/admin', express.static(clientBuildPath));

/**
 * Serves SPA index.html for client-side routing
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {Function} next - Express next middleware
 */
function serveSpaIndex(req, res, next) {
  if (req.path.startsWith('/admin/api')) return next();

  // Disable caching for SPA index.html to ensure updates work
  disableCache(req, res, () => {});

  res.sendFile(path.join(clientBuildPath, 'index.html'));
}

// Client SPA routes fallback for /admin/*
app.get('/admin/*', serveSpaIndex);

// Development mode: proxy non-/admin requests to DocService (must be last)
if (process.env.NODE_ENV.startsWith('development-')) {
  devProxy.setupDevProxy(app, server, cfgCoAuthoringPort);
}

app.use((err, req, res, _next) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  ctx.logger.error('default error handler:%s', err.stack);
  res.sendStatus(500);
});

server.listen(port, () => {
  operationContext.global.logger.warn('AdminPanel server listening on port %d', port);
});

server.on('clientError', (err, socket) => {
  // Silently ignore client-side connection errors
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
    socket.destroy();
    return;
  }
  operationContext.global.logger.debug('clientError: %s', err.code || err.message);
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
  socket.destroy();
});

//Initialize watch here to avoid circular import with operationContext
runtimeConfigManager.initRuntimeConfigWatcher(operationContext.global).catch(err => {
  operationContext.global.logger.warn('initRuntimeConfigWatcher error: %s', err.stack);
});
//after all required modules in all files
moduleReloader.finalizeConfigWithRuntime();
