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
var config = require('config');
var events = require('events');
var util = require('util');
var co = require('co');
var utils = require('./utils');
var constants = require('./constants');
var rabbitMQCore = require('./rabbitMQCore');

var cfgVisibilityTimeout = config.get('queue.visibilityTimeout');
var cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
var cfgRabbitQueueConvertTask = config.get('rabbitmq.queueconverttask');
var cfgRabbitQueueConvertResponse = config.get('rabbitmq.queueconvertresponse');

function init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback) {
  return co(function* () {
    var e = null;
    try {
      var conn = yield rabbitMQCore.connetPromise(function () {
        clear(taskqueue);
        init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, null);
      });

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
          function (message) {
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
          function (message) {
            if (message) {
              taskqueue.emit('response', message.content.toString(), message);
            }
          }, optionsReceive);
      }
      //process messages received while reconnection time
      repeat(taskqueue);
    } catch (err) {
      e = err;
    }
    if (callback) {
      callback(e);
    }
  });
}
function clear(taskqueue) {
  taskqueue.channelConvertTask = null;
  taskqueue.channelConvertTaskReceive = null;
  taskqueue.channelConvertResponse = null;
  taskqueue.channelConvertResponseReceive = null;
}
function repeat(taskqueue) {
  var i;
  for (i = 0; i < taskqueue.addTaskStore.length; ++i) {
    var elem = taskqueue.addTaskStore[i];
    addTask(taskqueue, elem.task, elem.priority, function () {});
  }
  for (i = 0; i < taskqueue.addResponseStore.length; ++i) {
    addResponse(taskqueue, taskqueue.addResponseStore[i], function () {});
  }
  for (i = 0; i < taskqueue.removeTaskStore.length; ++i) {
    removeTask(taskqueue, taskqueue.removeTaskStore[i]);
  }
  for (i = 0; i < taskqueue.removeResponseStore.length; ++i) {
    removeResponse(taskqueue, taskqueue.removeResponseStore[i]);
  }
  taskqueue.addTaskStore.length = 0;
  taskqueue.addResponseStore.length = 0;
  taskqueue.removeTaskStore.length = 0;
  taskqueue.removeResponseStore.length = 0;
}
function addTask(taskqueue, content, priority, callback) {
  var options = {persistent: true, priority: priority};
  taskqueue.channelConvertTask.sendToQueue(cfgRabbitQueueConvertTask, content, options, callback);
}
function addResponse(taskqueue, content, callback) {
  var options = {persistent: true};
  taskqueue.channelConvertResponse.sendToQueue(cfgRabbitQueueConvertResponse, content, options, callback);
}
function removeTask(taskqueue, data) {
  taskqueue.channelConvertTaskReceive.ack(data);
}
function removeResponse(taskqueue, data) {
  taskqueue.channelConvertResponseReceive.ack(data);
}

function TaskQueueRabbitMQ() {
  this.channelConvertTask = null;
  this.channelConvertTaskReceive = null;
  this.channelConvertResponse = null;
  this.channelConvertResponseReceive = null;
  this.addTaskStore = [];
  this.addResponseStore = [];
  this.removeTaskStore = [];
  this.removeResponseStore = [];
}
util.inherits(TaskQueueRabbitMQ, events.EventEmitter);
TaskQueueRabbitMQ.prototype.init = function (isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback) {
  init(this, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback);
};
TaskQueueRabbitMQ.prototype.initPromise = function(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive) {
  var t = this;
  return new Promise(function(resolve, reject) {
    init(t, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
TaskQueueRabbitMQ.prototype.addTask = function (task, priority) {
  //todo confirmation mode
  var t = this;
  return new Promise(function (resolve, reject) {
    task.setVisibilityTimeout(cfgVisibilityTimeout);
    var content = new Buffer(JSON.stringify(task));
    if (null != t.channelConvertTask) {
      addTask(t, content, priority, function (err, ok) {
        if (null != err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      t.addTaskStore.push({task: content, priority: priority});
      resolve();
    }
  });
};
TaskQueueRabbitMQ.prototype.addResponse = function (task) {
  var t = this;
  return new Promise(function (resolve, reject) {
    var content = new Buffer(JSON.stringify(task));
    if (null != t.channelConvertResponse) {
      addResponse(t, content, function (err, ok) {
        if (null != err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      t.addResponseStore.push(content);
      resolve();
    }
  });
};
TaskQueueRabbitMQ.prototype.removeTask = function (data) {
  var t = this;
  return new Promise(function (resolve, reject) {
    if (null != t.channelConvertTaskReceive) {
      removeTask(t, data);
    } else {
      t.removeTaskStore.push(data);
    }
    resolve();
  });
};
TaskQueueRabbitMQ.prototype.removeResponse = function (data) {
  var t = this;
  return new Promise(function (resolve, reject) {
    if (null != t.channelConvertResponseReceive) {
      removeResponse(t, data);
    } else {
      t.removeResponseStore.push(data);
    }
    resolve();
  });
};

module.exports = TaskQueueRabbitMQ;
