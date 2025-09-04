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
const utils = require('../../../Common/sources/utils');
const commonDefines = require('../../../Common/sources/commondefines');

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const configRouter = require('./routes/config/router');
const adminpanelRouter = require('./routes/adminpanel/router');

const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);

// Initialize license on startup
(async () => {
  try {
    let licenseFile;
    try {
      licenseFile = config.get('license.license_file');
    } catch (_) {
      licenseFile = null;
    }
    const [info, original] = await license.readLicense(licenseFile);
    tenantManager.setDefLicense(info, original);
  } catch (e) {
    operationContext.global.logger.warn('License init error: %s', e.message);
  }
})();

const corsWithCredentials = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

operationContext.global.logger.warn('AdminPanel server starting...');

app.get('/info/info.json', cors(), utils.checkClientIp, async (req, res) => {
  const serverDate = new Date();
  serverDate.setMilliseconds(0);
  const output = {
    connectionsStat: {},
    licenseInfo: {},
    serverInfo: {
      buildVersion: commonDefines.buildVersion,
      buildNumber: commonDefines.buildNumber,
      date: serverDate.toISOString()
    },
    quota: {
      edit: {connectionsCount: 0, usersCount: {unique: 0, anonymous: 0}},
      view: {connectionsCount: 0, usersCount: {unique: 0, anonymous: 0}},
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
    res.json(output);
  }
});

app.use('/info/config', corsWithCredentials, utils.checkClientIp, configRouter);
app.use('/info/adminpanel', corsWithCredentials, utils.checkClientIp, adminpanelRouter);

// todo config or _dirname. Serve AdminPanel client build as static assets
const clientBuildPath = path.resolve('client/build');
app.use(express.static(clientBuildPath));

function serveSpaIndex(req, res, next) {
  if (req.path.startsWith('/info/')) return next();
  res.sendFile(path.join(clientBuildPath, 'index.html'));
}

// client SPA routes
app.get('*', serveSpaIndex);

app.use((err, req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  ctx.logger.error('default error handler:%s', err.stack);
  res.sendStatus(500);
});

const port = 9000;
server.listen(port, () => {
  operationContext.global.logger.warn('AdminPanel server listening on port %d', port);
});
