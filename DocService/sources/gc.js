/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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

const configCommon = require('config');
var config = configCommon.get('services.CoAuthoring');
var co = require('co');
var cron = require('cron');
var ms = require('ms');
var taskResult = require('./taskresult');
var docsCoServer = require('./DocsCoServer');
var canvasService = require('./canvasservice');
var storage = require('./../../Common/sources/storage-base');
var utils = require('./../../Common/sources/utils');
var logger = require('./../../Common/sources/logger');
var constants = require('./../../Common/sources/constants');
var commondefines = require('./../../Common/sources/commondefines');
var queueService = require('./../../Common/sources/taskqueueRabbitMQ');
var operationContext = require('./../../Common/sources/operationContext');
var pubsubService = require('./pubsubRabbitMQ');

var cfgExpFilesCron = config.get('expire.filesCron');
var cfgExpDocumentsCron = config.get('expire.documentsCron');
var cfgExpFiles = config.get('expire.files');
var cfgExpFilesRemovedAtOnce = config.get('expire.filesremovedatonce');
var cfgForceSaveEnable = config.get('autoAssembly.enable');
var cfgForceSaveStep = ms(config.get('autoAssembly.step'));

function getCronStep(cronTime){
  let cronJob = new cron.CronJob(cronTime, function(){});
  let dates = cronJob.nextDates(2);
  return dates[1] - dates[0];
}
let expFilesStep = getCronStep(cfgExpFilesCron);
let expDocumentsStep = getCronStep(cfgExpDocumentsCron);

var checkFileExpire = function() {
  return co(function* () {
    let ctx = new operationContext.OperationContext();
    try {
      ctx.logger.info('checkFileExpire start');
      let removedCount = 0;
      var expired;
      var currentRemovedCount;
      do {
        currentRemovedCount = 0;
        expired = yield taskResult.getExpired(cfgExpFilesRemovedAtOnce, cfgExpFiles);
        for (var i = 0; i < expired.length; ++i) {
          var docId = expired[i].id;
          ctx.setDocId(docId);
          //todo tenant
          //проверяем что никто не сидит в документе
          let editorsCount = yield docsCoServer.getEditorsCountPromise(ctx, docId);
          if(0 === editorsCount){
            if (yield canvasService.cleanupCache(ctx)) {
              currentRemovedCount++;
            }
          } else {
            ctx.logger.debug('checkFileExpire expire but presence: editorsCount = %d', editorsCount);
          }
        }
        removedCount += currentRemovedCount;
      } while (currentRemovedCount > 0);
      ctx.logger.info('checkFileExpire end: removedCount = %d', removedCount);
    } catch (e) {
      ctx.logger.error('checkFileExpire error: %s', e.stack);
    } finally {
      setTimeout(checkFileExpire, expFilesStep);
    }
  });
};
var checkDocumentExpire = function() {
  return co(function* () {
    var queue = null;
    var removedCount = 0;
    var startSaveCount = 0;
    let ctx = new operationContext.OperationContext();
    try {
      ctx.logger.info('checkDocumentExpire start');
      var now = (new Date()).getTime();
      let expiredKeys = yield docsCoServer.editorData.getDocumentPresenceExpired(now);
      if (expiredKeys.length > 0) {
        queue = new queueService();
        yield queue.initPromise(true, false, false, false, false, false);

        for (var i = 0; i < expiredKeys.length; ++i) {
          var docId = expiredKeys[i];
          if (docId) {
            ctx.setDocId(docId);
            var hasChanges = yield docsCoServer.hasChanges(ctx, docId);
            if (hasChanges) {
              yield docsCoServer.createSaveTimer(ctx, docId, null, null, queue, true);
              startSaveCount++;
            } else {
              yield docsCoServer.cleanDocumentOnExitNoChangesPromise(ctx, docId);
              removedCount++;
            }
          }
        }
      }
    } catch (e) {
      ctx.logger.error('checkDocumentExpire error: %s', e.stack);
    } finally {
      try {
        if (queue) {
          yield queue.close();
        }
      } catch (e) {
        ctx.logger.error('checkDocumentExpire error: %s', e.stack);
      }
      ctx.logger.info('checkDocumentExpire end: startSaveCount = %d, removedCount = %d', startSaveCount, removedCount);
      setTimeout(checkDocumentExpire, expDocumentsStep);
    }
  });
};
let forceSaveTimeout = function() {
  return co(function* () {
    let queue = null;
    let pubsub = null;
    let ctx = new operationContext.OperationContext();
    try {
      ctx.logger.info('forceSaveTimeout start');
      let now = (new Date()).getTime();
      let expiredKeys = yield docsCoServer.editorData.getForceSaveTimer(now);
      if (expiredKeys.length > 0) {
        queue = new queueService();
        yield queue.initPromise(true, false, false, false, false, false);

        pubsub = new pubsubService();
        yield pubsub.initPromise();

        let actions = [];
        for (let i = 0; i < expiredKeys.length; ++i) {
          let docId = expiredKeys[i];
          if (docId) {
            ctx.setDocId(docId);
            actions.push(docsCoServer.startForceSave(ctx, docId, commondefines.c_oAscForceSaveTypes.Timeout,
                                                            undefined, undefined, undefined, undefined, undefined, undefined, queue, pubsub));
          }
        }
        yield Promise.all(actions);
        ctx.logger.debug('forceSaveTimeout actions.length %d', actions.length);
      }
    } catch (e) {
      ctx.logger.error('forceSaveTimeout error: %s', e.stack);
    } finally {
      try {
        if (queue) {
          yield queue.close();
        }
        if (pubsub) {
          yield pubsub.close();
        }
      } catch (e) {
        ctx.logger.error('checkDocumentExpire error: %s', e.stack);
      }
      ctx.logger.info('forceSaveTimeout end');
      setTimeout(forceSaveTimeout, cfgForceSaveStep);
    }
  });
};

exports.startGC = function() {
  setTimeout(checkDocumentExpire, expDocumentsStep);
  setTimeout(checkFileExpire, expFilesStep);
  if (cfgForceSaveEnable) {
    setTimeout(forceSaveTimeout, cfgForceSaveStep);
  }
};
exports.getCronStep = getCronStep;
