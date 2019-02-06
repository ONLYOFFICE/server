/*
 * (c) Copyright Ascensio System SIA 2010-2018
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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
var config = require('config').get('services.CoAuthoring.redis');
var events = require('events');
var util = require('util');
var logger = require('./../../Common/sources/logger');
var constants = require('./../../Common/sources/constants');
var redis = require(config.get('name'));

var cfgRedisPrefix = config.get('prefix');
var cfgRedisHost = config.get('host');
var cfgRedisPort = config.get('port');

var channelName = cfgRedisPrefix + constants.REDIS_KEY_PUBSUB;

function createClientRedis() {
  var redisClient = redis.createClient(cfgRedisPort, cfgRedisHost, {});
  redisClient.on('error', function(err) {
    logger.error('redisClient error %s', err.toString());
  });
  return redisClient;
}
var g_redisClient = null;
function getClientRedis() {
  if (!g_redisClient) {
    g_redisClient = createClientRedis();
  }
  return g_redisClient;
}

function PubsubRedis() {
  this.clientPublish = null;
  this.clientSubscribe = null;
}
util.inherits(PubsubRedis, events.EventEmitter);
PubsubRedis.prototype.init = function(callback) {
  var pubsub = this;
  pubsub.clientPublish = createClientRedis();
  pubsub.clientSubscribe = createClientRedis();
  pubsub.clientSubscribe.subscribe(channelName);
  pubsub.clientSubscribe.on('message', function(channel, message) {
    pubsub.emit('message', message);
  });
  callback(null);
};
PubsubRedis.prototype.initPromise = function() {
  var t = this;
  return new Promise(function(resolve, reject) {
    t.init(function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
PubsubRedis.prototype.publish = function(data) {
  this.clientPublish.publish(channelName, data);
};
PubsubRedis.prototype.close = function() {
  var t = this;
  return new Promise(function(resolve, reject) {
    t.clientPublish.quit();
    t.clientSubscribe.quit();
    resolve();
  });
};

module.exports = PubsubRedis;
module.exports.getClientRedis = getClientRedis;
