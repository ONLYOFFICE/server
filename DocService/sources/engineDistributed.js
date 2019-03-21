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

const config = require('config');
const co = require('co');
const pubsubRedis = require('./pubsubRedis');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const utils = require('./../../Common/sources/utils');

const cfgRedisPrefix = config.get('services.CoAuthoring.redis.prefix');
const redisKeySaveLock = cfgRedisPrefix + constants.REDIS_KEY_SAVE_LOCK;

function checkAndSetSaveLock(redisClient, docId, fencingToken, actions) {
  return co(function*() {
    let res = commonDefines.c_oAscLockStatus.Ok;
    yield utils.promiseRedis(redisClient, redisClient.watch, redisKeySaveLock + docId);
    const saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + docId);
    if (fencingToken === saveLock) {
      const multi = redisClient.multi(actions);
      let multiRes = yield utils.promiseRedis(multi, multi.exec);
      if (!multiRes) {
        res = commonDefines.c_oAscLockStatus.Fail;
      }
    } else {
      yield utils.promiseRedis(redisClient, redisClient.unwatch);
      if (null === saveLock) {
        res = commonDefines.c_oAscLockStatus.Null;
      } else {
        res = commonDefines.c_oAscLockStatus.Fail;
      }
    }
    return res;
  });
}

function EngineDistributed() {
  this.redisClient = null;
}
EngineDistributed.prototype.init = function(callback) {
  this.redisClient = pubsubRedis.getClientRedis();
  callback(null);
};
EngineDistributed.prototype.lockSave = function(docId, fencingToken, ttl) {
  let redisClient = this.redisClient;
  return co(function*() {
    let isSaveLock = yield utils.promiseRedis(redisClient, redisClient.set, redisKeySaveLock + docId, fencingToken,
                                              'nx', 'ex', ttl);
    return !!isSaveLock;
  });
};
EngineDistributed.prototype.prolongSave = function(docId, fencingToken, ttl) {
  return checkAndSetSaveLock(this.redisClient, docId, fencingToken, [['expire', redisKeySaveLock + docId, ttl]]);
};
EngineDistributed.prototype.unlockSave = function(docId, fencingToken) {
  return checkAndSetSaveLock(this.redisClient, docId, fencingToken, [['del', redisKeySaveLock + docId]]);
};

module.exports = EngineDistributed;
