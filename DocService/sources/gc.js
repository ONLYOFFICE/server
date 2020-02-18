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
var pubsubService = require('./pubsubRabbitMQ');
const editorDataStorage = require('./' + configCommon.get('services.CoAuthoring.server.editorDataStorage'));

var cfgExpFilesCron = config.get('expire.filesCron');
var cfgExpDocumentsCron = config.get('expire.documentsCron');
var cfgExpFiles = config.get('expire.files');
var cfgExpFilesRemovedAtOnce = config.get('expire.filesremovedatonce');
var cfgForceSaveEnable = config.get('autoAssembly.enable');
var cfgForceSaveStep = ms(config.get('autoAssembly.step'));

var checkFileExpire = function() {
  return co(function* () {
    try {
      logger.debug('checkFileExpire start');
      var expired;
      var removedCount = 0;
      var currentRemovedCount;
      do {
        currentRemovedCount = 0;
        expired = yield taskResult.getExpired(cfgExpFilesRemovedAtOnce, cfgExpFiles);
        for (var i = 0; i < expired.length; ++i) {
          var docId = expired[i].id;
          //проверяем что никто не сидит в документе
          let editorsCount = yield docsCoServer.getEditorsCountPromise(docId);
          if(0 === editorsCount){
            if (yield canvasService.cleanupCache(docId)) {
              currentRemovedCount++;
            }
          } else {
            logger.debug('checkFileExpire expire but presence: editorsCount = %d; docId = %s', editorsCount, docId);
          }
        }
        removedCount += currentRemovedCount;
      } while (currentRemovedCount > 0);
      logger.debug('checkFileExpire end: removedCount = %d', removedCount);
    } catch (e) {
      logger.error('checkFileExpire error:\r\n%s', e.stack);
    }
  });
};
var checkDocumentExpire = function() {
  return co(function* () {
    var queue = null;
    var removedCount = 0;
    var startSaveCount = 0;
    try {
      logger.debug('checkDocumentExpire start');
      var now = (new Date()).getTime();
      let expiredKeys = yield docsCoServer.editorData.getDocumentPresenceExpired(now);
      if (expiredKeys.length > 0) {
        queue = new queueService();
        yield queue.initPromise(true, false, false, false, false, false);

        for (var i = 0; i < expiredKeys.length; ++i) {
          var docId = expiredKeys[i];
          if (docId) {
            var puckerIndex = yield docsCoServer.getChangesIndexPromise(docId);
            if (puckerIndex > 0) {
              yield docsCoServer.createSaveTimerPromise(docId, null, null, queue, true);
              startSaveCount++;
            } else {
              yield docsCoServer.cleanDocumentOnExitNoChangesPromise(docId);
              removedCount++;
            }
          }
        }
      }
    } catch (e) {
      logger.error('checkDocumentExpire error:\r\n%s', e.stack);
    } finally {
      try {
        if (queue) {
          yield queue.close();
        }
      } catch (e) {
        logger.error('checkDocumentExpire error:\r\n%s', e.stack);
      }
      logger.debug('checkDocumentExpire end: startSaveCount = %d, removedCount = %d', startSaveCount, removedCount);
    }
  });
};
let forceSaveTimeout = function() {
  return co(function* () {
    let queue = null;
    let pubsub = null;
    try {
      logger.debug('forceSaveTimeout start');
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
            actions.push(docsCoServer.editorData.unlockForceSaveTimer(docId));
            actions.push(docsCoServer.startForceSavePromise(docId, commondefines.c_oAscForceSaveTypes.Timeout,
                                                            undefined, undefined, undefined, queue, pubsub));
          }
        }
        yield Promise.all(actions);
        logger.debug('forceSaveTimeout actions.length %d', actions.length);
      }
      logger.debug('forceSaveTimeout end');
    } catch (e) {
      logger.error('forceSaveTimeout error:\r\n%s', e.stack);
    } finally {
      try {
        if (queue) {
          yield queue.close();
        }
        if (pubsub) {
          yield pubsub.close();
        }
      } catch (e) {
        logger.error('checkDocumentExpire error:\r\n%s', e.stack);
      }
      setTimeout(forceSaveTimeout, cfgForceSaveStep);
    }
  });
};

var documentExpireJob = function(opt_isStart) {
  if (!opt_isStart) {
    logger.warn('checkDocumentExpire restart');
  }
  new cron.CronJob(cfgExpDocumentsCron, checkDocumentExpire, documentExpireJob, true);
};

var fileExpireJob = function(opt_isStart) {
  if (!opt_isStart) {
    logger.warn('checkFileExpire restart');
  }
  new cron.CronJob(cfgExpFilesCron, checkFileExpire, fileExpireJob, true);
};

exports.startGC = function() {
  documentExpireJob(true);
  fileExpireJob(true);
  if (cfgForceSaveEnable) {
    setTimeout(forceSaveTimeout, cfgForceSaveStep);
  }
};
