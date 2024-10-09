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
var logger = require('./../../Common/sources/logger');
var pubsubService = require('./pubsubRabbitMQ');
const sqlBase = require('./databaseConnectors/baseConnector');
var commonDefines = require('./../../Common/sources/commondefines');
var constants = require('./../../Common/sources/constants');
var utils = require('./../../Common/sources/utils');

var cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

var WAIT_TIMEOUT = 30000;
var LOOP_TIMEOUT = 1000;
var EXEC_TIMEOUT = WAIT_TIMEOUT + utils.getConvertionTimeout(undefined);

exports.shutdown = function(ctx, editorStat, status) {
  return co(function*() {
    var res = true;
    try {
      ctx.logger.debug('shutdown start:' + EXEC_TIMEOUT);

      //redisKeyShutdown is not a simple counter, so it doesn't get decremented by a build that started before Shutdown started
      //reset redisKeyShutdown just in case the previous run didn't finish
      yield editorStat.cleanupShutdown(redisKeyShutdown);

      var pubsub = new pubsubService();
      yield pubsub.initPromise();
      //inner ping to update presence
      ctx.logger.debug('shutdown pubsub shutdown message');
      yield pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown, ctx: ctx, status: status}));
      //wait while pubsub deliver and start conversion
      ctx.logger.debug('shutdown start wait pubsub deliver');
      var startTime = new Date().getTime();
      var isStartWait = true;
      while (true) {
        var curTime = new Date().getTime() - startTime;
        if (isStartWait && curTime >= WAIT_TIMEOUT) {
          isStartWait = false;
          ctx.logger.debug('shutdown stop wait pubsub deliver');
        } else if (curTime >= EXEC_TIMEOUT) {
          res = false;
          ctx.logger.debug('shutdown timeout');
          break;
        }
        var remainingFiles = yield editorStat.getShutdownCount(redisKeyShutdown);
        let inSavingStatus = yield sqlBase.getCountWithStatus(ctx, commonDefines.FileStatus.SaveVersion, EXEC_TIMEOUT);
        ctx.logger.debug('shutdown remaining files editorStat:%d, db:%d', remainingFiles, inSavingStatus);
        if (!isStartWait && (remainingFiles + inSavingStatus) <= 0) {
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      //todo need to check the queues, because there may be long conversions running before Shutdown
      //clean up
      yield editorStat.cleanupShutdown(redisKeyShutdown);
      yield pubsub.close();

      ctx.logger.debug('shutdown end');
    } catch (e) {
      res = false;
      ctx.logger.error('shutdown error: %s', e.stack);
    }
    return res;
  });
};
