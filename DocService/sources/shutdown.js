/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html).
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains
 * relevant author attributions when distributing the software. If the display of the logo in its graphic
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE"
 * in every copy of the program you distribute.
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
 */
'use strict';
var config = require('config').get('services.CoAuthoring');
var co = require('co');
var logger = require('./../../Common/sources/logger');
var pubsubService = require('./' + config.get('pubsub.name'));
var pubsubRedis = require('./pubsubRedis.js');
var commonDefines = require('./../../Common/sources/commondefines');
var constants = require('./../../Common/sources/constants');
var utils = require('./../../Common/sources/utils');

var cfgRedisPrefix = config.get('redis.prefix');
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

var WAIT_TIMEOUT = 30000;
var LOOP_TIMEOUT = 1000;

(function shutdown() {
  return co(function* () {
    try {
      logger.debug('shutdown start');

      var redisClient = pubsubRedis.getClientRedis();
      //сбрасываем на всякий случай, если предыдущий запуск не дошел до конца
      yield utils.promiseRedis(redisClient, redisClient.set, redisKeyShutdown, 0);
      var pubsub = new pubsubService();
      yield pubsub.initPromise();
      //inner ping to update presence
      logger.debug('shutdown pubsub shutdown message');
      pubsub.publish(JSON.stringify({type: commonDefines.c_oPublishType.shutdown}));
      //wait while pubsub deliver and start conversion
      logger.debug('shutdown start wait pubsub deliver');
      yield utils.sleep(WAIT_TIMEOUT);
      while (true) {
        var remainingFiles = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyShutdown);
        logger.debug('shutdown remaining files:%d', remainingFiles);
        if (remainingFiles <= 0) {
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      //clean up
      yield utils.promiseRedis(redisClient, redisClient.del, redisKeyShutdown);

      logger.debug('shutdown end');
    } catch (e) {
      logger.error('shutdown error:\r\n%s', e.stack);
    }
  });
})();
