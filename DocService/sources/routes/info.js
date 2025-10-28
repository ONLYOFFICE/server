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
 * License info endpoint handler
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @param {Function} getConnections Function to get active connections
 */
async function licenseInfo(req, res, getConnections = null) {
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

  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    ctx.logger.debug('licenseInfo start');

    const tenantLicense = await tenantManager.getTenantLicense(ctx);
    if (tenantLicense && Array.isArray(tenantLicense) && tenantLicense.length > 0) {
      const [licenseInfo] = tenantLicense;
      Object.assign(output.licenseInfo, licenseInfo);
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
  } finally {
    if (!res.headersSent) {
      if (!isError) {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(output));
      } else {
        res.sendStatus(400);
      }
    }
  }
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
