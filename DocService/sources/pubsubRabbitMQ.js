'use strict';
var events = require('events');
var util = require('util');
var utils = require('./../../Common/sources/utils');
var rabbitMQCore = require('./../../Common/sources/rabbitMQCore');

var cfgRabbitExchangePubSub = require('config').get('rabbitmq.exchangepubsub');

function init(pubsub, callback) {
  utils.spawn(function* () {
    var e = null;
    try {
      var conn = yield rabbitMQCore.connetPromise(function () {
        clear(pubsub);
        init(pubsub, null);
      });
      pubsub.channelPublish = yield rabbitMQCore.createChannelPromise(conn);
      pubsub.exchangePublish = yield rabbitMQCore.assertExchangePromise(pubsub.channelPublish, cfgRabbitExchangePubSub,
        'fanout', {durable: true});

      var channelReceive = yield rabbitMQCore.createChannelPromise(conn);
      var queue = yield rabbitMQCore.assertQueuePromise(channelReceive, '', {autoDelete: true, exclusive: true});
      channelReceive.bindQueue(queue, cfgRabbitExchangePubSub, '');
      yield rabbitMQCore.consumePromise(channelReceive, queue, function (message) {
        if (message) {
          pubsub.emit('message', message.content.toString());
        }
        channelReceive.ack(message);
      }, {noAck: false});
      //process messages received while reconnection time
      repeat(pubsub);
    } catch (err) {
      e = err;
    }
    if (callback) {
      callback(e);
    }
  });
}
function clear(pubsub) {
  pubsub.channelPublish = null;
  pubsub.exchangePublish = null;
}
function repeat(pubsub) {
  for (var i = 0; i < pubsub.publishStore.length; ++i) {
    publish(pubsub, pubsub.publishStore[i]);
  }
  pubsub.publishStore.length = 0;
}
function publish(pubsub, data) {
  pubsub.channelPublish.publish(pubsub.exchangePublish, '', data);
}

function PubsubRabbitMQ() {
  this.channelPublish = null;
  this.exchangePublish = null;
  this.publishStore = [];
}
util.inherits(PubsubRabbitMQ, events.EventEmitter);
PubsubRabbitMQ.prototype.init = function (callback) {
  init(this, callback);
};
PubsubRabbitMQ.prototype.publish = function (message) {
  var data = new Buffer(message);
  if (null != this.channelPublish) {
    publish(this, data);
  } else {
    this.publishStore.push(data);
  }
};

module.exports = PubsubRabbitMQ;
