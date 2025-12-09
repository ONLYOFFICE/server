'use strict';

const express = require('express');
const cors = require('cors');
const ms = require('ms');
const config = require('config');
const cron = require('cron');
const utils = require('../../../Common/sources/utils');
const commonDefines = require('../../../Common/sources/commondefines');
const operationContext = require('../../../Common/sources/operationContext');
const tenantManager = require('../../../Common/sources/tenantManager');
const path = require('path');
const fs = require('fs');

// Configuration values
const cfgExpDocumentsCron = config.get('services.CoAuthoring.expire.documentsCron');
const cfgEditorStatStorage =
  config.get('services.CoAuthoring.server.editorStatStorage') || config.get('services.CoAuthoring.server.editorDataStorage');

// Initialize editor stat storage
const editorStatStorage = require(`../${cfgEditorStatStorage}`);
const editorStat = new editorStatStorage.EditorStat();

// Constants
const PRECISION = [
  {name: 'hour', val: ms('1h')},
  {name: 'day', val: ms('1d')},
  {name: 'week', val: ms('7d')},
  {name: 'month', val: ms('30d')},
  {name: 'year', val: ms('365d')}
];

/**
 * Get the time step in milliseconds between cron job executions
 * @param {string} cronTime - Cron time expression
 * @returns {number} Time difference in milliseconds between consecutive executions
 */
function getCronStep(cronTime) {
  const cronJob = new cron.CronJob(cronTime, () => {});
  const dates = cronJob.nextDates(2);
  return dates[1] - dates[0];
}

const expDocumentsStep = getCronStep(cfgExpDocumentsCron);

/**
 * Get current UTC timestamp for license calculations
 * @returns {number} UTC timestamp in seconds
 */
function getLicenseNowUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()) / 1000;
}

/**
 * Send license info response
 * @param {import('express').Response} res Express response
 * @param {Object} output License info output data
 * @param {boolean} isError Whether an error occurred
 */
function sendLicenseInfoResponse(res, output, isError) {
  if (res.headersSent) {
    return;
  }
  if (!isError) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(output));
  } else {
    res.sendStatus(400);
  }
}

// ============================================================================
// FIXTURE TESTING SUPPORT
// Set USE_FIXTURES to true to return mock data from tests/fixtures/info/*.json
// Fixtures cycle per request for testing different license scenarios
// ============================================================================
const USE_FIXTURES = false;
let fixtureFiles = [];
let fixtureRequestCounter = 0;

if (USE_FIXTURES) {
  try {
    const fixturesDir = path.join(__dirname, '../../../tests/fixtures/info');
    const files = fs.readdirSync(fixturesDir);
    fixtureFiles = files.filter(file => file.endsWith('.json'));
  } catch {
    // Fixtures directory doesn't exist
  }
}

/**
 * Build license info output data
 * @param {Object} ctx Operation context
 * @param {Function} getConnections Function to get active connections
 * @returns {Promise<{output: Object, isError: boolean}>} Output data and error flag
 */
async function buildLicenseInfoOutput(ctx, getConnections = null) {
  // Return fixture data if enabled and available
  if (USE_FIXTURES && fixtureFiles.length > 0) {
    fixtureRequestCounter++;
    const fixtureIndex = (fixtureRequestCounter - 1) % fixtureFiles.length;
    const fixturePath = path.join(__dirname, '../../../tests/fixtures/info', fixtureFiles[fixtureIndex]);
    try {
      const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      ctx.logger.debug('licenseInfo: using fixture %s', fixtureFiles[fixtureIndex]);
      return {output: fixtureData, isError: false};
    } catch (e) {
      ctx.logger.warn('licenseInfo: failed to load fixture %s', e.message);
    }
  }

  let isError = false;
  const serverDate = new Date();
  // Security risk of high-precision time
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
      edit: {
        connectionsCount: 0,
        usersCount: {
          unique: 0,
          anonymous: 0
        }
      },
      view: {
        connectionsCount: 0,
        usersCount: {
          unique: 0,
          anonymous: 0
        }
      },
      byMonth: []
    }
  };

  try {
    ctx.logger.debug('licenseInfo start');

    const tenantLicense = await tenantManager.getTenantLicense(ctx);
    if (tenantLicense && Array.isArray(tenantLicense) && tenantLicense.length > 0) {
      const [licenseData] = tenantLicense;
      Object.assign(output.licenseInfo, licenseData);
    }

    const precisionSum = {};
    for (let i = 0; i < PRECISION.length; ++i) {
      precisionSum[PRECISION[i].name] = {
        edit: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0},
        liveview: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0},
        view: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0}
      };
      output.connectionsStat[PRECISION[i].name] = {
        edit: {min: 0, avr: 0, max: 0},
        liveview: {min: 0, avr: 0, max: 0},
        view: {min: 0, avr: 0, max: 0}
      };
    }

    const redisRes = await editorStat.getEditorConnections(ctx);
    const now = Date.now();
    if (redisRes.length > 0) {
      const expDocumentsStep95 = expDocumentsStep * 0.95;
      let precisionIndex = 0;
      for (let i = redisRes.length - 1; i >= 0; i--) {
        const elem = redisRes[i];
        let edit = elem.edit || 0;
        let view = elem.view || 0;
        let liveview = elem.liveview || 0;
        // For cluster
        while (i > 0 && elem.time - redisRes[i - 1].time < expDocumentsStep95) {
          edit += elem.edit || 0;
          view += elem.view || 0;
          liveview += elem.liveview || 0;
          i--;
        }
        for (let j = precisionIndex; j < PRECISION.length; ++j) {
          if (now - elem.time < PRECISION[j].val) {
            const precision = precisionSum[PRECISION[j].name];
            precision.edit.min = Math.min(precision.edit.min, edit);
            precision.edit.max = Math.max(precision.edit.max, edit);
            precision.edit.sum += edit;
            precision.edit.count++;
            precision.view.min = Math.min(precision.view.min, view);
            precision.view.max = Math.max(precision.view.max, view);
            precision.view.sum += view;
            precision.view.count++;
            precision.liveview.min = Math.min(precision.liveview.min, liveview);
            precision.liveview.max = Math.max(precision.liveview.max, liveview);
            precision.liveview.sum += liveview;
            precision.liveview.count++;
          } else {
            precisionIndex = j + 1;
          }
        }
      }
      for (const i in precisionSum) {
        const precision = precisionSum[i];
        const precisionOut = output.connectionsStat[i];
        if (precision.edit.count > 0) {
          precisionOut.edit.avr = Math.round(precision.edit.sum / precision.edit.intervalsInPresision);
          precisionOut.edit.min = precision.edit.min;
          precisionOut.edit.max = precision.edit.max;
        }
        if (precision.liveview.count > 0) {
          precisionOut.liveview.avr = Math.round(precision.liveview.sum / precision.liveview.intervalsInPresision);
          precisionOut.liveview.min = precision.liveview.min;
          precisionOut.liveview.max = precision.liveview.max;
        }
        if (precision.view.count > 0) {
          precisionOut.view.avr = Math.round(precision.view.sum / precision.view.intervalsInPresision);
          precisionOut.view.min = precision.view.min;
          precisionOut.view.max = precision.view.max;
        }
      }
    }

    const nowUTC = getLicenseNowUtc();
    let execRes;
    execRes = await editorStat.getPresenceUniqueUser(ctx, nowUTC);
    const connections = getConnections ? getConnections() : null;
    output.quota.edit.connectionsCount = await editorStat.getEditorConnectionsCount(ctx, connections);
    output.quota.edit.usersCount.unique = execRes.length;
    execRes.forEach(elem => {
      if (elem.anonym) {
        output.quota.edit.usersCount.anonymous++;
      }
    });

    execRes = await editorStat.getPresenceUniqueViewUser(ctx, nowUTC);
    output.quota.view.connectionsCount = await editorStat.getLiveViewerConnectionsCount(ctx, connections);
    output.quota.view.usersCount.unique = execRes.length;
    execRes.forEach(elem => {
      if (elem.anonym) {
        output.quota.view.usersCount.anonymous++;
      }
    });

    const byMonth = await editorStat.getPresenceUniqueUsersOfMonth(ctx);
    const byMonthView = await editorStat.getPresenceUniqueViewUsersOfMonth(ctx);
    const byMonthMerged = [];
    for (const i in byMonth) {
      if (Object.hasOwn(byMonth, i)) {
        byMonthMerged[i] = {date: i, users: byMonth[i], usersView: {}};
      }
    }
    for (const i in byMonthView) {
      if (Object.hasOwn(byMonthView, i)) {
        if (Object.hasOwn(byMonthMerged, i)) {
          byMonthMerged[i].usersView = byMonthView[i];
        } else {
          byMonthMerged[i] = {date: i, users: {}, usersView: byMonthView[i]};
        }
      }
    }
    output.quota.byMonth = Object.values(byMonthMerged);
    output.quota.byMonth.sort((a, b) => {
      return a.date.localeCompare(b.date);
    });

    ctx.logger.debug('licenseInfo end');
  } catch (err) {
    isError = true;
    ctx.logger.error('licenseInfo error %s', err.stack);
  }

  return {output, isError};
}

/**
 * License info endpoint handler
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @param {Function} getConnections Function to get active connections
 */
async function licenseInfo(req, res, getConnections = null) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);

  const requestedTenant = req.query && req.query.tenant;
  if (requestedTenant) {
    const userTenant = req.user && req.user.tenant;
    if (userTenant && requestedTenant !== userTenant) {
      const defaultTenant = tenantManager.getDefautTenant();
      if (userTenant !== defaultTenant) {
        if (!res.headersSent) {
          res.status(403).json({error: 'Forbidden'});
        }
        return;
      }
    }
    ctx.setTenant(requestedTenant);
  }
  await ctx.initTenantCache();

  const {output, isError} = await buildLicenseInfoOutput(ctx, getConnections);
  sendLicenseInfoResponse(res, output, isError);
}

/**
 * Create shared Info router
 * @param {Function} getConnections Optional function to get active connections
 * @returns {import('express').Router} Router instance
 */
function createInfoRouter(getConnections = null) {
  const router = express.Router();

  // License info endpoint with CORS and client IP check
  router.get('/info.json', cors(), utils.checkClientIp, async (req, res) => {
    await licenseInfo(req, res, getConnections);
  });

  return router;
}

module.exports = createInfoRouter;
// Export handler for reuse
module.exports.licenseInfo = licenseInfo;
