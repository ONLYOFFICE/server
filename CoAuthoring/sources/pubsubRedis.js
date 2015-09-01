'use strict';
var config = require('./config.json');
var events = require('events');
var util = require('util');
var logger = require('./../../Common/sources/logger');
var redis = require(config['redis']['name']);

var cfgRedisPrefix = config['redis']['prefix'];
var cfgRedisHost = config['redis']['host'];
var cfgRedisPort = config['redis']['port'];

var channelName = cfgRedisPrefix + 'pubsub';

function createClientRedis() {
  var redisClient = redis.createClient(cfgRedisPort, cfgRedisHost, {});
  redisClient.on('error', function(err) {
    logger.error('redisClient error %s', err.toString());
  });
  return redisClient;
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
PubsubRedis.prototype.publish = function(data) {
  this.clientPublish.publish(channelName, data);
};

module.exports = PubsubRedis;
