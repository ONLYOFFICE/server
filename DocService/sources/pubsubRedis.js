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

module.exports = PubsubRedis;
module.exports.getClientRedis = getClientRedis;
