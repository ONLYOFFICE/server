/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';
const config = require('config');
const configCoAuthoring = config.get('services.CoAuthoring');
const pubsubService = require('./pubsubRabbitMQ');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const sqlBase = require('./databaseConnectors/baseConnector');
const taskResult = require('./taskresult');
const docsCoServer = require('./DocsCoServer');
const canvasService = require('./canvasservice');
const documentRecovery = require('./documentRecovery');
const commonDefines = require('./../../Common/sources/commondefines');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const storage = require('./../../Common/sources/storage/storage-base');

const cfgForgottenFiles = configCoAuthoring.get('server.forgottenfiles');
const cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
const redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

const WAIT_TIMEOUT = 30000;
const LOOP_TIMEOUT = 1000;
const EXEC_TIMEOUT = WAIT_TIMEOUT + utils.getConvertionTimeout(undefined);
// assemblies claimed per run; recoverable rows beyond it wait for the next run
const RECOVERY_MAX_DOCS = 1000;
// assemblies in flight at once: a batch is drained before the next starts, so a kill mid-run strands at most this many
const RECOVERY_BATCH = 100;

// a second PUT joins the run in progress instead of resetting its counters
let shutdownInProgress = null;
// counters of the latest recovery of this process, exposed through the status endpoint
let lastRecoveryReport = null;

function newRecoveryReport() {
  return {
    finished: false,
    clean: false,
    stoppedBy: null,
    enqueueFailed: 0,
    total: 0,
    claimed: 0,
    missed: 0,
    inFlight: 0,
    noCache: 0,
    status: 0,
    forgotten: 0,
    delivered: 0,
    pending: 0,
    unvisited: 0,
    unverified: 0,
    errors: 0
  };
}

// The whole run, verification included, shares one deadline counted from the start of the shutdown
function isPastDeadline(startTime) {
  return new Date().getTime() - startTime >= EXEC_TIMEOUT;
}

// A save older than the drain window has lost its task; the same age bound keeps it out of the drain counter
function isStaleSave(row) {
  const opened = row.last_open_date instanceof Date ? row.last_open_date : new Date(row.last_open_date);
  return new Date().getTime() - opened.getTime() >= EXEC_TIMEOUT;
}

// Poll the in-flight save counters; the start window always runs out, the drain phase also ends when nothing is left
async function pollSaves(ctx, editorStat, startTime, isDrain) {
  const res = {drained: false, remainingFiles: 0, inSavingStatus: 0};
  while (true) {
    res.remainingFiles = await editorStat.getShutdownCount(redisKeyShutdown);
    res.inSavingStatus = await sqlBase.getCountWithStatus(ctx, commonDefines.FileStatus.SaveVersion, EXEC_TIMEOUT);
    ctx.logger.debug('shutdown remaining files editorStat:%d, db:%d', res.remainingFiles, res.inSavingStatus);
    if (isDrain && res.remainingFiles + res.inSavingStatus <= 0) {
      res.drained = true;
      return res;
    }
    const curTime = new Date().getTime() - startTime;
    if ((!isDrain && curTime >= WAIT_TIMEOUT) || curTime >= EXEC_TIMEOUT) {
      return res;
    }
    await utils.sleep(LOOP_TIMEOUT);
  }
}

// Point the context at the row's tenant and shard the same way gc does, re-reading tenant config only on a tenant change
async function switchContext(ctx, currentTenant, doc) {
  if (currentTenant !== doc.tenant) {
    ctx.init(doc.tenant, doc.docId, ctx.userId, doc.shardKey, doc.wopiSrc);
    await ctx.initTenantCache();
  } else {
    ctx.setDocId(doc.docId);
    ctx.setShardKey(doc.shardKey);
    ctx.setWopiSrc(doc.wopiSrc);
  }
  return doc.tenant;
}

// Why a row with pending changes is not claimed; null means it is ours to assemble into forgotten
async function getSkipReason(ctx, row) {
  if (commonDefines.FileStatus.SaveVersion === row.status) {
    return isStaleSave(row) ? null : 'inFlight';
  }
  if (commonDefines.FileStatus.UpdateVersion === row.status) {
    return 'inFlight';
  }
  if (commonDefines.FileStatus.Ok !== row.status) {
    return 'status';
  }
  // presence is not asked: it outlives a killed process, and a save started by a live editor shows up as inFlight anyway
  const cache = await storage.listObjects(ctx, row.id);
  if (0 === cache.length) {
    return 'noCache';
  }
  return null;
}

// Why enumeration stops early: the flag was cleared by a resume, the deadline passed, or the per-run cap is full
function getStopReason(report, startTime) {
  if (!docsCoServer.getIsShutdown()) {
    return 'aborted';
  }
  if (isPastDeadline(startTime)) {
    return 'timeout';
  }
  if (report.claimed >= RECOVERY_MAX_DOCS) {
    return 'cap';
  }
  return null;
}

// Record why the walk ended early and how many rows it never looked at; claimed rows finish on their own
function stopRecovery(ctx, report, reason, unvisited) {
  report.stoppedBy = reason;
  report.unvisited = unvisited;
  ctx.logger.warn('shutdown recovery stopped by %s: %d rows not visited, changes stay for the next run', reason, unvisited);
}

// Claim orphan changes for forgotten assemblies in drained batches; every other row with changes is kept for verification
async function startRecovery(ctx, editorStat, queue, startTime, report) {
  const docs = [];
  const rows = await sqlBase.getDocumentsWithChanges(ctx);
  report.total = rows.length;
  // a stable walk order: finished rows drop out of the set, so repeated runs reach further into it
  rows.sort((a, b) => a.tenant.localeCompare(b.tenant) || a.id.localeCompare(b.id));
  let currentTenant = null;
  let inBatch = 0;
  for (let i = 0; i < rows.length; ++i) {
    let stopReason = getStopReason(report, startTime);
    if (!stopReason && inBatch >= RECOVERY_BATCH) {
      inBatch = 0;
      const drain = await pollSaves(ctx, editorStat, startTime, true);
      if (!drain.drained) {
        stopReason = 'timeout';
      }
    }
    if (stopReason) {
      stopRecovery(ctx, report, stopReason, rows.length - i);
      break;
    }
    const row = rows[i];
    const doc = {
      tenant: row.tenant,
      docId: row.id,
      shardKey: sqlBase.DocumentAdditional.prototype.getShardKey(row.additional),
      wopiSrc: sqlBase.DocumentAdditional.prototype.getWopiSrc(row.additional),
      claimed: false
    };
    try {
      currentTenant = await switchContext(ctx, currentTenant, doc);
      const reason = await getSkipReason(ctx, row);
      if (reason) {
        report[reason]++;
        ctx.logger.debug('shutdown recovery skip %s: %s', reason, doc.docId);
        // every row left to the regular path must still end with the changes gone, so it is verified at the end
        if ('noCache' !== reason) {
          docs.push(doc);
        }
        continue;
      }
      // a resume that landed during the awaits above must not claim one more row
      if (!docsCoServer.getIsShutdown()) {
        stopRecovery(ctx, report, 'aborted', rows.length - i);
        break;
      }
      ctx.logger.debug('shutdown recovery claim: %s status=%d statusInfo=%d', doc.docId, row.status, row.status_info);
      const claimRes = await canvasService.saveChangesToForgotten(ctx, doc.docId, row.status, row.status_info, queue);
      doc.claimed = 'claimed' === claimRes;
      docs.push(doc);
      if (doc.claimed) {
        report.claimed++;
        inBatch++;
      } else if ('enqueueFailed' === claimRes) {
        report.enqueueFailed++;
        ctx.logger.warn('shutdown recovery enqueue failed: %s', doc.docId);
      } else {
        report.missed++;
        ctx.logger.debug('shutdown recovery skip missed: %s', doc.docId);
      }
    } catch (e) {
      report.errors++;
      ctx.logger.error('shutdown recovery error: %s', e.stack);
    }
  }
  // a resume that landed inside the last row leaves no later iteration to notice it
  if (!report.stoppedBy && !docsCoServer.getIsShutdown()) {
    stopRecovery(ctx, report, 'aborted', 0);
  }
  ctx.initDefault();
  ctx.logger.info(
    'shutdown recovery claimed %d of %d docs with changes: enqueueFailed=%d missed=%d inFlight=%d noCache=%d status=%d unvisited=%d errors=%d',
    report.claimed,
    report.total,
    report.enqueueFailed,
    report.missed,
    report.inFlight,
    report.noCache,
    report.status,
    report.unvisited,
    report.errors
  );
  return docs;
}

// Classify every tracked doc after the drain: parked in forgotten, delivered by the regular path, or still holding changes
async function reportRecovery(ctx, report, docs, startTime) {
  let currentTenant = null;
  for (let i = 0; i < docs.length; ++i) {
    if (isPastDeadline(startTime)) {
      report.unverified = docs.length - i;
      ctx.logger.warn('shutdown recovery verification cut by the deadline: %d docs unverified', report.unverified);
      break;
    }
    const doc = docs[i];
    try {
      currentTenant = await switchContext(ctx, currentTenant, doc);
      const rows = await taskResult.select(ctx, doc.docId);
      if (0 === rows.length) {
        const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);
        const forgotten = await storage.listObjects(ctx, doc.docId, tenForgottenFiles);
        if (forgotten.length > 0) {
          report.forgotten++;
          ctx.logger.info('shutdown recovery parked in forgotten: %s', doc.docId);
        } else {
          report.errors++;
          ctx.logger.error('shutdown recovery row removed without forgotten copy: %s', doc.docId);
        }
      } else if (await docsCoServer.hasChanges(ctx, doc.docId)) {
        // the marker means the assembly itself failed, everything else is a save that has not finished
        const outcome = documentRecovery.isAssemblyRecovery(rows[0]) ? 'noCache' : 'pending';
        report[outcome]++;
        ctx.logger.warn(
          'shutdown recovery still %s: %s status=%d statusInfo=%d claimed=%s',
          outcome,
          doc.docId,
          rows[0].status,
          rows[0].status_info,
          doc.claimed
        );
      } else {
        report.delivered++;
      }
    } catch (e) {
      report.errors++;
      ctx.logger.error('shutdown recovery verify error: %s', e.stack);
    }
  }
  ctx.initDefault();
  report.finished = true;
  report.clean = isRecoveryClean(report);
  ctx.logger.info(
    'shutdown recovery end: clean=%s forgotten=%d delivered=%d pending=%d noCache=%d unvisited=%d unverified=%d errors=%d stoppedBy=%s',
    report.clean,
    report.forgotten,
    report.delivered,
    report.pending,
    report.noCache,
    report.unvisited,
    report.unverified,
    report.errors,
    report.stoppedBy || 'none'
  );
}

// Clean means every row was visited and verified and no changes are left that recovery could still save
function isRecoveryClean(report) {
  return (
    !report.stoppedBy && 0 === report.errors && 0 === report.enqueueFailed && 0 === report.pending && 0 === report.noCache && 0 === report.unverified
  );
}

async function shutdown(ctx, editorStat, status, opt_recoverChanges) {
  let res = true;
  let pubsub = null;
  let queue = null;
  let report = null;
  try {
    ctx.logger.debug('shutdown start:%d recoverChanges:%s', EXEC_TIMEOUT, !!opt_recoverChanges);

    //redisKeyShutdown is not a simple counter, so it doesn't get decremented by a build that started before Shutdown started
    //reset redisKeyShutdown just in case the previous run didn't finish
    await editorStat.cleanupShutdown(redisKeyShutdown);

    pubsub = new pubsubService();
    await pubsub.initPromise();
    //inner ping to update presence
    ctx.logger.debug('shutdown pubsub shutdown message');
    await pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown, ctx, status}));
    //wait while pubsub deliver and start conversion
    ctx.logger.debug('shutdown start wait pubsub deliver');
    const startTime = new Date().getTime();
    await pollSaves(ctx, editorStat, startTime, false);
    ctx.logger.debug('shutdown stop wait pubsub deliver');

    let docs = null;
    if (status && opt_recoverChanges) {
      report = newRecoveryReport();
      lastRecoveryReport = report;
      // recovery needs the local flag: a resume clears it and that is the only signal to stop claiming
      if (docsCoServer.getIsShutdown()) {
        queue = new queueService();
        await queue.initPromise(true, false, false, false, false, false);
        docs = await startRecovery(ctx, editorStat, queue, startTime, report);
      } else {
        report.stoppedBy = 'noFlag';
        report.finished = true;
        ctx.logger.warn('shutdown recovery skipped: shutdown flag not delivered to this process');
      }
    }

    const drain = await pollSaves(ctx, editorStat, startTime, true);
    res = drain.drained;
    if (!res) {
      ctx.logger.warn('shutdown timeout: remaining files editorStat:%d, db:%d', drain.remainingFiles, drain.inSavingStatus);
    }
    if (docs) {
      await reportRecovery(ctx, report, docs, startTime);
    }
    // the response reports the drain only: an incomplete recovery is safe to stop with, its state lives in the report
    //todo need to check the queues, because there may be long conversions running before Shutdown
    //clean up
    await editorStat.cleanupShutdown(redisKeyShutdown);

    ctx.logger.debug('shutdown end');
  } catch (e) {
    res = false;
    if (report && !report.finished) {
      report.stoppedBy = 'error';
      report.finished = true;
    }
    ctx.logger.error('shutdown error: %s', e.stack);
  } finally {
    try {
      if (queue) {
        await queue.close();
      }
    } catch (e) {
      ctx.logger.error('shutdown queue close error: %s', e.stack);
    }
    try {
      if (pubsub) {
        await pubsub.close();
      }
    } catch (e) {
      ctx.logger.error('shutdown pubsub close error: %s', e.stack);
    }
  }
  return res;
}

exports.shutdown = function (ctx, editorStat, status, opt_recoverChanges) {
  if (status && shutdownInProgress) {
    ctx.logger.warn('shutdown already in progress, joining it');
    return shutdownInProgress;
  }
  const promise = shutdown(ctx, editorStat, status, opt_recoverChanges);
  if (status) {
    shutdownInProgress = promise;
    const clear = () => {
      if (shutdownInProgress === promise) {
        shutdownInProgress = null;
      }
    };
    promise.then(clear, clear);
  }
  return promise;
};
exports.getLastRecoveryReport = function () {
  return lastRecoveryReport;
};
