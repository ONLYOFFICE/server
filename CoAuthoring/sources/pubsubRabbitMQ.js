'use strict';
var configCommon = require('./../../Common/sources/config.json');
var events = require('events');
var util = require('util');
var utils = require('./../../Common/sources/utils');
var rabbitMQCore = require('./../../Common/sources/rabbitMQCore');

var cfgRabbitExchangePubSub = configCommon['rabbitmq']['exchangepubsub'];

function PubsubRabbitMQ() {
  this.channelPublish = null;
  this.exchangePublish = null;
}
util.inherits(PubsubRabbitMQ, events.EventEmitter);
PubsubRabbitMQ.prototype.init = function(callback) {
  var pubsub = this;
  utils.spawn(function* () {
    try {
      var conn = yield rabbitMQCore.connetPromise();
      pubsub.channelPublish = yield rabbitMQCore.createChannelPromise(conn);
      pubsub.exchangePublish = yield rabbitMQCore.assertExchangePromise(pubsub.channelPublish, cfgRabbitExchangePubSub,
        'fanout', {durable: true});

      var channelReceive = yield rabbitMQCore.createChannelPromise(conn);
      var queue = yield rabbitMQCore.assertQueuePromise(channelReceive, '', {autoDelete: true, exclusive: true});
      channelReceive.bindQueue(queue, cfgRabbitExchangePubSub, '');
      yield rabbitMQCore.consumePromise(channelReceive, queue, function(message) {
        if (message) {
          pubsub.emit('message', message.content.toString());
        }
        channelReceive.ack(message);
      }, {noAck: false});
      callback(null);
    } catch (err) {
      callback(err);
    }
  });
};
PubsubRabbitMQ.prototype.publish = function(data) {
  this.channelPublish.publish(this.exchangePublish, '', new Buffer(data));
};

module.exports = PubsubRabbitMQ;
