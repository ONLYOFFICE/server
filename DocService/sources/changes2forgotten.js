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
var config = require('config');
var configCoAuthoring = config.get('services.CoAuthoring');
var co = require('co');
var pubsubService = require('./pubsubRabbitMQ');
var commonDefines = require('./../../Common/sources/commondefines');
var constants = require('./../../Common/sources/constants');
var utils = require('./../../Common/sources/utils');
const storage = require('./../../Common/sources/storage-base');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const operationContext = require('./../../Common/sources/operationContext');
const sqlBase = require('./databaseConnectors/baseConnector');
const docsCoServer = require('./DocsCoServer');
const taskResult = require('./taskresult');
const cfgEditorDataStorage = config.get('services.CoAuthoring.server.editorDataStorage');
const cfgEditorStatStorage = config.get('services.CoAuthoring.server.editorStatStorage');
const editorStatStorage = require('./' + (cfgEditorStatStorage || cfgEditorDataStorage));

const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');

var cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

var WAIT_TIMEOUT = 30000;
var LOOP_TIMEOUT = 1000;
var EXEC_TIMEOUT = WAIT_TIMEOUT + utils.getConvertionTimeout(undefined);

let addSqlParam = sqlBase.addSqlParameter;

function updateDoc(ctx, docId, status, callback) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let p1 = addSqlParam(status, values);
    let p2 = addSqlParam(callback, values);
    let p3 = addSqlParam(ctx.tenant, values);
    let p4 = addSqlParam(docId, values);
    let sqlCommand = `UPDATE ${cfgTableResult} SET status=${p1},callback=${p2} WHERE tenant=${p3} AND id=${p4};`;
    sqlBase.sqlQuery(ctx, sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
}

function shutdown() {
  return co(function*() {
    var res = true;
    let ctx = new operationContext.Context();
    try {
      let editorStat = editorStatStorage.EditorStat ? new editorStatStorage.EditorStat() : new editorStatStorage();
      ctx.logger.debug('shutdown start:' + EXEC_TIMEOUT);

      //redisKeyShutdown is not a simple counter, so it doesn't get decremented by a build that started before Shutdown started
      //reset redisKeyShutdown just in case the previous run didn't finish yield editorData.cleanupShutdown(redisKeyShutdown);
      let queue = new queueService();
      yield queue.initPromise(true, false, false, false, false, false);

      let pubsub = new pubsubService();
      yield pubsub.initPromise();
      //inner ping to update presence
      ctx.logger.debug('shutdown pubsub shutdown message');
      yield pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown, ctx: ctx, status: true}));
      ctx.logger.debug('shutdown start wait pubsub deliver');
      yield utils.sleep(LOOP_TIMEOUT);

      let documentsWithChanges = yield sqlBase.getDocumentsWithChanges(ctx);
      ctx.logger.debug('shutdown docs with changes count = %s', documentsWithChanges.length);
      let docsWithEmptyForgotten = [];
      let docsWithOutOfDateForgotten = [];
      for (let i = 0; i < documentsWithChanges.length; ++i) {
        let tenant = documentsWithChanges[i].tenant;
        let docId = documentsWithChanges[i].id;
        ctx.setTenant(tenant);
        let forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
        if (forgotten.length > 0) {
          let selectRes = yield taskResult.select(ctx, docId);
          if (selectRes.length > 0) {
            let row = selectRes[0];
            if (commonDefines.FileStatus.SaveVersion !== row.status && commonDefines.FileStatus.UpdateVersion !== row.status){
              docsWithOutOfDateForgotten.push([tenant, docId]);
            }
          }
        } else {
          docsWithEmptyForgotten.push([tenant, docId]);
        }
      }
      ctx.initDefault();
      ctx.logger.debug('shutdown docs with changes and empty forgotten count = %s', docsWithEmptyForgotten.length);
      ctx.logger.debug('shutdown docs with changes and out of date forgotten count = %s', docsWithOutOfDateForgotten.length);
      let docsToConvert = docsWithEmptyForgotten.concat(docsWithOutOfDateForgotten);
      for (let i = 0; i < docsToConvert.length; ++i) {
        let tenant = docsToConvert[i][0];
        let docId = docsToConvert[i][1];
        //todo refactor. group tenants?
        ctx.setTenant(tenant);
        yield ctx.initTenantCache();

        yield updateDoc(ctx, docId, commonDefines.FileStatus.Ok, "");
        yield editorStat.addShutdown(redisKeyShutdown, docId);
        ctx.logger.debug('shutdown createSaveTimerPromise %s', docId);
        yield docsCoServer.createSaveTimer(ctx, docId, null, null, null, queue, true);
      }
      ctx.initDefault();
      //sleep because of bugs in createSaveTimerPromise
      yield utils.sleep(LOOP_TIMEOUT);

      let startTime = new Date().getTime();
      while (true) {
        let remainingFiles = yield editorStat.getShutdownCount(redisKeyShutdown);
        ctx.logger.debug('shutdown remaining files:%d', remainingFiles);
        let curTime = new Date().getTime() - startTime;
        if (curTime >= EXEC_TIMEOUT || remainingFiles <= 0) {
          if(curTime >= EXEC_TIMEOUT) {
            ctx.logger.debug('shutdown timeout');
          }
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      let countInForgotten = 0;
      for (let i = 0; i < docsToConvert.length; ++i) {
        let tenant = docsToConvert[i][0];
        let docId = docsToConvert[i][1];
        ctx.setTenant(tenant);
        let forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
        if (forgotten.length > 0) {
          countInForgotten++;
        } else {
          ctx.logger.warn('shutdown missing in forgotten:%s', docId);
        }
      }
      ctx.initDefault();
      ctx.logger.debug('shutdown docs placed in forgotten:%d', countInForgotten);
      ctx.logger.debug('shutdown docs with unknown status:%d', docsToConvert.length - countInForgotten);

      //todo needs to check queues, because there may be long conversions running before Shutdown
      //clean up
      yield editorStat.cleanupShutdown(redisKeyShutdown);
      yield pubsub.close();
      yield queue.close();

      ctx.logger.debug('shutdown end');
    } catch (e) {
      res = false;
      ctx.logger.error('shutdown error:\r\n%s', e.stack);
    }
    process.exit(0);
    return res;
  });
};
exports.shutdown = shutdown;
shutdown();
