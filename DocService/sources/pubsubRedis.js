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
