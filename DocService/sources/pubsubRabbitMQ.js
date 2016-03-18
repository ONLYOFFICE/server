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
var events = require('events');
var util = require('util');
var co = require('co');
var utils = require('./../../Common/sources/utils');
var rabbitMQCore = require('./../../Common/sources/rabbitMQCore');

var cfgRabbitExchangePubSub = require('config').get('rabbitmq.exchangepubsub');

function init(pubsub, callback) {
  return co(function* () {
    var e = null;
    try {
      var conn = yield rabbitMQCore.connetPromise(function() {
        clear(pubsub);
        if (!pubsub.isClose) {
          init(pubsub, null);
        }
      });
      pubsub.connection = conn;
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
  this.isClose = false;
  this.connection = null;
  this.channelPublish = null;
  this.exchangePublish = null;
  this.publishStore = [];
}
util.inherits(PubsubRabbitMQ, events.EventEmitter);
PubsubRabbitMQ.prototype.init = function (callback) {
  init(this, callback);
};
PubsubRabbitMQ.prototype.initPromise = function() {
  var t = this;
  return new Promise(function(resolve, reject) {
    init(t, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
PubsubRabbitMQ.prototype.publish = function (message) {
  var data = new Buffer(message);
  if (null != this.channelPublish) {
    publish(this, data);
  } else {
    this.publishStore.push(data);
  }
};
PubsubRabbitMQ.prototype.close = function() {
  var t = this;
  this.isClose = true;
  return new Promise(function(resolve, reject) {
    t.connection.close(function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

module.exports = PubsubRabbitMQ;
