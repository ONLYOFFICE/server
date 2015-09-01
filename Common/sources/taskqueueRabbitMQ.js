'use strict';
var config = require('config');
var events = require('events');
var util = require('util');
var utils = require('./utils');
var constants = require('./constants');
var rabbitMQCore = require('./rabbitMQCore');

var cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
var cfgRabbitQueueConvertTask = config.get('rabbitmq.queueconverttask');
var cfgRabbitQueueConvertResponse = config.get('rabbitmq.queueconvertresponse');

function TaskQueueRabbitMQ() {
  this.channelConvertTask = null;
  this.channelConvertTaskReceive = null;
  this.channelConvertResponse = null;
  this.channelConvertResponseReceive = null;
}
util.inherits(TaskQueueRabbitMQ, events.EventEmitter);
TaskQueueRabbitMQ.prototype.init = function(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback) {
  var taskqueue = this;
  utils.spawn(function* () {
    try {
      var conn = yield rabbitMQCore.connetPromise();

      var bAssertTaskQueue = false;
      var optionsTaskQueue = {
        durable: true,
        arguments: {'x-max-priority': constants.QUEUE_PRIORITY_HIGH, 'x-message-ttl': cfgQueueRetentionPeriod * 1000}
      };
      if (isAddTask) {
        taskqueue.channelConvertTask = yield rabbitMQCore.createConfirmChannelPromise(conn);
        yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertTask, cfgRabbitQueueConvertTask,
          optionsTaskQueue);
        bAssertTaskQueue = true;
      }
      var bAssertResponseQueue = false;
      var optionsResponseQueue = {durable: true};
      if (isAddResponse) {
        taskqueue.channelConvertResponse = yield rabbitMQCore.createConfirmChannelPromise(conn);
        yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertResponse, cfgRabbitQueueConvertResponse,
          optionsResponseQueue);
        bAssertResponseQueue = true;
      }
      var optionsReceive = {noAck: false};
      if (isAddTaskReceive) {
        taskqueue.channelConvertTaskReceive = yield rabbitMQCore.createChannelPromise(conn);
        taskqueue.channelConvertTaskReceive.prefetch(1);
        if (!bAssertTaskQueue) {
          yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertTaskReceive, cfgRabbitQueueConvertTask,
            optionsTaskQueue);
        }
        yield rabbitMQCore.consumePromise(taskqueue.channelConvertTaskReceive, cfgRabbitQueueConvertTask,
          function(message) {
            if (message) {
              taskqueue.emit('task', message.content.toString(), message);
            }
          }, optionsReceive);
      }
      if (isAddResponseReceive) {
        taskqueue.channelConvertResponseReceive = yield rabbitMQCore.createChannelPromise(conn);
        if (!bAssertResponseQueue) {
          yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertResponseReceive, cfgRabbitQueueConvertResponse,
            optionsResponseQueue);
        }
        yield rabbitMQCore.consumePromise(taskqueue.channelConvertResponseReceive, cfgRabbitQueueConvertResponse,
          function(message) {
            if (message) {
              taskqueue.emit('response', message.content.toString(), message);
            }
          }, optionsReceive);
      }

      callback(null);
    } catch (err) {
      callback(err);
    }
  });
};
TaskQueueRabbitMQ.prototype.addTask = function(task, priority) {
  //todo confirmation mode
  var t = this;
  return new Promise(function(resolve, reject) {
    var content = new Buffer(JSON.stringify(task));
    var options = {persistent: true, priority: priority};
    t.channelConvertTask.sendToQueue(cfgRabbitQueueConvertTask, content, options, function(err, ok) {
      if (null != err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
TaskQueueRabbitMQ.prototype.addResponse = function(task) {
  var t = this;
  return new Promise(function(resolve, reject) {
    var content = new Buffer(JSON.stringify(task));
    var options = {persistent: true};
    t.channelConvertResponse.sendToQueue(cfgRabbitQueueConvertResponse, content, options, function(err, ok) {
      if (null != err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
TaskQueueRabbitMQ.prototype.removeTask = function(data) {
  var t = this;
  return new Promise(function(resolve, reject) {
    t.channelConvertTaskReceive.ack(data);
    resolve();
  });
};
TaskQueueRabbitMQ.prototype.removeResponse = function(data) {
  var t = this;
  return new Promise(function(resolve, reject) {
    t.channelConvertResponseReceive.ack(data);
    resolve();
  });
};

module.exports = TaskQueueRabbitMQ;
