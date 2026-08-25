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
const co = require('co');
const pubsubService = require('./pubsubRabbitMQ');
const commonDefines = require('./../../Common/sources/commondefines');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const storage = require('./../../Common/sources/storage/storage-base');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const operationContext = require('./../../Common/sources/operationContext');
const sqlBase = require('./databaseConnectors/baseConnector');
const docsCoServer = require('./DocsCoServer');
const taskResult = require('./taskresult');
const {editorStatStorage} = require('./editorDataStorage');

const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');

const cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
const redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

const WAIT_TIMEOUT = 30000;
const LOOP_TIMEOUT = 1000;
const EXEC_TIMEOUT = WAIT_TIMEOUT + utils.getConvertionTimeout(undefined);

function shutdown() {
  return co(function* () {
    let res = true;
    const ctx = new operationContext.Context();
    try {
      const editorStat = editorStatStorage.EditorStat ? new editorStatStorage.EditorStat() : new editorStatStorage();
      ctx.logger.debug('shutdown start:' + EXEC_TIMEOUT);

      //redisKeyShutdown is not a simple counter, so it doesn't get decremented by a build that started before Shutdown started
      //reset redisKeyShutdown just in case the previous run didn't finish yield editorData.cleanupShutdown(redisKeyShutdown);
      const queue = new queueService();
      yield queue.initPromise(true, false, false, false, false, false);

      const pubsub = new pubsubService();
      yield pubsub.initPromise();
      //inner ping to update presence
      ctx.logger.debug('shutdown pubsub shutdown message');
      yield pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown, ctx, status: true}));
      ctx.logger.debug('shutdown start wait pubsub deliver');
      yield utils.sleep(LOOP_TIMEOUT);

      const documentsWithChanges = yield sqlBase.getDocumentsWithChanges(ctx);
      ctx.logger.debug('shutdown docs with changes count = %s', documentsWithChanges.length);
      const docsWithEmptyForgotten = [];
      const docsWithOutOfDateForgotten = [];
      for (let i = 0; i < documentsWithChanges.length; ++i) {
        const tenant = documentsWithChanges[i].tenant;
        const docId = documentsWithChanges[i].id;
        ctx.setTenant(tenant);
        const forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
        if (forgotten.length > 0) {
          const selectRes = yield taskResult.select(ctx, docId);
          if (selectRes.length > 0) {
            const row = selectRes[0];
            if (commonDefines.FileStatus.SaveVersion !== row.status && commonDefines.FileStatus.UpdateVersion !== row.status) {
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
      const docsToConvert = docsWithEmptyForgotten.concat(docsWithOutOfDateForgotten);
      for (let i = 0; i < docsToConvert.length; ++i) {
        const tenant = docsToConvert[i][0];
        const docId = docsToConvert[i][1];
        //todo refactor. group tenants?
        ctx.setTenant(tenant);
        yield ctx.initTenantCache();

        yield taskResult.updateStatusAndClearCallback(ctx, docId, commonDefines.FileStatus.Ok);
        yield editorStat.addShutdown(redisKeyShutdown, docId);
        ctx.logger.debug('shutdown createSaveTimerPromise %s', docId);
        yield docsCoServer.createSaveTimer(ctx, docId, null, null, null, queue, true);
      }
      ctx.initDefault();
      //sleep because of bugs in createSaveTimerPromise
      yield utils.sleep(LOOP_TIMEOUT);

      const startTime = new Date().getTime();
      while (true) {
        const remainingFiles = yield editorStat.getShutdownCount(redisKeyShutdown);
        ctx.logger.debug('shutdown remaining files:%d', remainingFiles);
        const curTime = new Date().getTime() - startTime;
        if (curTime >= EXEC_TIMEOUT || remainingFiles <= 0) {
          if (curTime >= EXEC_TIMEOUT) {
            ctx.logger.debug('shutdown timeout');
          }
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      let countInForgotten = 0;
      for (let i = 0; i < docsToConvert.length; ++i) {
        const tenant = docsToConvert[i][0];
        const docId = docsToConvert[i][1];
        ctx.setTenant(tenant);
        const forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
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
}
exports.shutdown = shutdown;
shutdown();
