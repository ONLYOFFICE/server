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
var cfgRabbitExchangeConvertDead = config.get('rabbitmq.exchangeconvertdead');
var cfgRabbitQueueConvertDead = config.get('rabbitmq.queueconvertdead');

function init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback) {
  return co(function* () {
    var e = null;
    try {
      var conn = yield rabbitMQCore.connetPromise(true, function() {
        clear(taskqueue);
        if (!taskqueue.isClose) {
          init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, null);
        }
      });
      taskqueue.connection = conn;
      var bAssertTaskQueue = false;
      var optionsTaskQueue = {
        durable: true,
        maxPriority: constants.QUEUE_PRIORITY_VERY_HIGH,
        messageTtl: cfgQueueRetentionPeriod * 1000,
        deadLetterExchange: cfgRabbitExchangeConvertDead
      };
      if (isAddTask) {
        taskqueue.channelConvertDead = yield rabbitMQCore.createChannelPromise(conn);
        yield rabbitMQCore.assertExchangePromise(taskqueue.channelConvertDead, cfgRabbitExchangeConvertDead, 'fanout',
                                                 {durable: true});
        var queue = yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertDead, cfgRabbitQueueConvertDead,
                                                          {durable: true});

        taskqueue.channelConvertDead.bindQueue(queue, cfgRabbitExchangeConvertDead, '');
        yield rabbitMQCore.consumePromise(taskqueue.channelConvertDead, queue, function(message) {
          if (null != taskqueue.channelConvertDead) {
            if (message) {
              taskqueue.emit('dead', message.content.toString());
            }
            taskqueue.channelConvertDead.ack(message);
          }
        }, {noAck: false});

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
  taskqueue.channelConvertDead = null;
  taskqueue.channelConvertResponse = null;
  taskqueue.channelConvertResponseReceive = null;
}
function repeat(taskqueue) {
  //repeat addTask because they are lost after the reconnection
  //unlike unconfirmed task will come again
  //acknowledge data after reconnect raises an exception 'PRECONDITION_FAILED - unknown delivery tag'
  for (var i = 0; i < taskqueue.addTaskStore.length; ++i) {
    var elem = taskqueue.addTaskStore[i];
    addTask(taskqueue, elem.task, elem.priority, function () {}, elem.expiration, elem.headers);
  }
  taskqueue.addTaskStore.length = 0;
}
function addTask(taskqueue, content, priority, callback, opt_expiration, opt_headers) {
  var options = {persistent: true, priority: priority};
  if (undefined !== opt_expiration) {
    options.expiration = opt_expiration.toString();
  }
  if (undefined !== opt_headers) {
    options.headers = opt_headers;
  }
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
  this.isClose = false;
  this.connection = null;
  this.channelConvertTask = null;
  this.channelConvertTaskReceive = null;
  this.channelConvertDead = null;
  this.channelConvertResponse = null;
  this.channelConvertResponseReceive = null;
  this.addTaskStore = [];
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
TaskQueueRabbitMQ.prototype.addTask = function (task, priority, opt_expiration, opt_headers) {
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
      }, opt_expiration, opt_headers);
    } else {
      t.addTaskStore.push({task: content, priority: priority, expiration: opt_expiration, headers: opt_headers});
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
      resolve();
    }
  });
};
TaskQueueRabbitMQ.prototype.removeTask = function (data) {
  var t = this;
  return new Promise(function (resolve, reject) {
    if (null != t.channelConvertTaskReceive) {
      removeTask(t, data);
    }
    resolve();
  });
};
TaskQueueRabbitMQ.prototype.removeResponse = function (data) {
  var t = this;
  return new Promise(function (resolve, reject) {
    if (null != t.channelConvertResponseReceive) {
      removeResponse(t, data);
    }
    resolve();
  });
};
TaskQueueRabbitMQ.prototype.close = function () {
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

module.exports = TaskQueueRabbitMQ;
