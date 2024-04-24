/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
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
var activeMQCore = require('./activeMQCore');
const logger = require('./logger');
const commonDefines = require('./commondefines');
const operationContext = require('./operationContext');

const cfgMaxRedeliveredCount = config.get('FileConverter.converter.maxRedeliveredCount');
const cfgQueueType = config.get('queue.type');
var cfgVisibilityTimeout = config.get('queue.visibilityTimeout');
var cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
var cfgRabbitQueueConvertTask = config.get('rabbitmq.queueconverttask');
var cfgRabbitQueueConvertResponse = config.get('rabbitmq.queueconvertresponse');
var cfgRabbitExchangeConvertDead = config.get('rabbitmq.exchangeconvertdead');
var cfgRabbitQueueConvertDead = config.get('rabbitmq.queueconvertdead');
var cfgRabbitQueueDelayed = config.get('rabbitmq.queuedelayed');
var cfgActiveQueueConvertTask = constants.ACTIVEMQ_QUEUE_PREFIX + config.get('activemq.queueconverttask');
var cfgActiveQueueConvertResponse = constants.ACTIVEMQ_QUEUE_PREFIX + config.get('activemq.queueconvertresponse');
var cfgActiveQueueConvertDead = constants.ACTIVEMQ_QUEUE_PREFIX + config.get('activemq.queueconvertdead');
var cfgActiveQueueDelayed = constants.ACTIVEMQ_QUEUE_PREFIX + config.get('activemq.queuedelayed');

const optionsExchnangeDead = {durable: true};
function initRabbit(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, callback) {
  return co(function* () {
    var e = null;
    try {
      var conn = yield rabbitMQCore.connetPromise(function() {
        clear(taskqueue);
        if (!taskqueue.isClose) {
          setTimeout(() => {
            init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, null);
          }, rabbitMQCore.RECONNECT_TIMEOUT);
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
            co(function* () {
              let ack = function() {
                taskqueue.channelConvertTaskReceive && taskqueue.channelConvertTaskReceive.ack(message);
              };
              let redelivered = yield* pushBackRedeliveredRabbit(taskqueue, message, ack);
              if (!redelivered) {
                if (message) {
                  taskqueue.emit('task', message.content.toString(), ack);
                }
              }
            });
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
              taskqueue.emit('response', message.content.toString(), function() {
                taskqueue.channelConvertResponseReceive && taskqueue.channelConvertResponseReceive.ack(message);
              });
            }
          }, optionsReceive);
      }
      if (isAddDelayed) {
        let optionsDelayedQueue = {
          durable: true,
          deadLetterExchange: cfgRabbitExchangeConvertDead
        };
        taskqueue.channelDelayed = yield rabbitMQCore.createConfirmChannelPromise(conn);
        yield rabbitMQCore.assertQueuePromise(taskqueue.channelDelayed, cfgRabbitQueueDelayed, optionsDelayedQueue);
      }
      if (isEmitDead) {
        taskqueue.channelConvertDead = yield rabbitMQCore.createChannelPromise(conn);
        yield rabbitMQCore.assertExchangePromise(taskqueue.channelConvertDead, cfgRabbitExchangeConvertDead, 'fanout',
          optionsExchnangeDead);
        var queue = yield rabbitMQCore.assertQueuePromise(taskqueue.channelConvertDead, cfgRabbitQueueConvertDead,
                                                          {durable: true});

        taskqueue.channelConvertDead.bindQueue(queue, cfgRabbitExchangeConvertDead, '');
        yield rabbitMQCore.consumePromise(taskqueue.channelConvertDead, queue, function(message) {
          if (null != taskqueue.channelConvertDead) {
            if (message) {
              taskqueue.emit('dead', message.content.toString(), function() {
                taskqueue.channelConvertDead.ack(message);
              });
            }
          }
        }, {noAck: false});
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
function initActive(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, callback) {
  return co(function*() {
    var e = null;
    try {
      var conn = yield activeMQCore.connetPromise(function() {
        clear(taskqueue);
        if (!taskqueue.isClose) {
          setTimeout(() => {
            init(taskqueue, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, null);
          }, activeMQCore.RECONNECT_TIMEOUT);
        }
      });
      taskqueue.connection = conn;
      if (isAddTask) {
        //https://github.com/amqp/rhea/issues/251#issuecomment-535076570
        let optionsConvertTask = {
          target: {
            address: cfgActiveQueueConvertTask,
            capabilities: ['queue']
          }
        };
        taskqueue.channelConvertTask = yield activeMQCore.openSenderPromise(conn, optionsConvertTask);
        initSenderActive(taskqueue.channelConvertTask, taskqueue.channelConvertTaskData);
      }
      if (isAddResponse) {
        let optionsConvertResponse = {
          target: {
            address: cfgActiveQueueConvertResponse,
            capabilities: ['queue']
          }
        };
        taskqueue.channelConvertResponse = yield activeMQCore.openSenderPromise(conn, optionsConvertResponse);
        initSenderActive(taskqueue.channelConvertResponse, taskqueue.channelConvertResponseData);
      }
      if (isAddTaskReceive) {
        let optionsConvertTask = {
          source: {
            address: cfgActiveQueueConvertTask,
            capabilities: ['queue']
          },
          credit_window: 0,
          autoaccept: false
        };
        let receiver = yield activeMQCore.openReceiverPromise(conn, optionsConvertTask);
        //todo ?consumer.dispatchAsync=false&consumer.prefetchSize=1
        receiver.add_credit(1);
        receiver.on("message", function(context) {
          co(function*() {
            let ack = function() {
              context.delivery.accept();
              receiver.add_credit(1);
            };
            let redelivered = yield* pushBackRedeliveredActive(taskqueue, context, ack);
            if (!redelivered) {
              if (context) {
                taskqueue.emit('task', context.message.body, ack);
              }
            }
          });
        });
        taskqueue.channelConvertTaskReceive = receiver;
      }
      if (isAddResponseReceive) {
        let optionsConvertResponse = {
          source: {
            address: cfgActiveQueueConvertResponse,
            capabilities: ['queue']
          },
          credit_window: 0,
          autoaccept: false
        };
        let receiver = yield activeMQCore.openReceiverPromise(conn, optionsConvertResponse);
        //todo ?consumer.dispatchAsync=false&consumer.prefetchSize=1
        receiver.add_credit(1);
        receiver.on("message", function(context) {
          if (context) {
            taskqueue.emit('response', context.message.body, function() {
              context.delivery.accept();
              receiver.add_credit(1);
            });
          }
        });
        taskqueue.channelConvertResponseReceive = receiver;
      }
      if (isAddDelayed) {
        let optionsDelayed = {
          target: {
            address: cfgActiveQueueDelayed,
            capabilities: ['queue']
          }
        };
        taskqueue.channelDelayed = yield activeMQCore.openSenderPromise(conn, optionsDelayed);
        initSenderActive(taskqueue.channelDelayed, taskqueue.channelDelayedData);
      }
      if (isEmitDead) {
        let optionsConvertDead = {
          source: {
            address: cfgActiveQueueConvertDead,
            capabilities: ['queue']
          },
          credit_window: 0,
          autoaccept: false
        };
        let receiver = yield activeMQCore.openReceiverPromise(conn, optionsConvertDead);
        //todo ?consumer.dispatchAsync=false&consumer.prefetchSize=1
        receiver.add_credit(1);
        receiver.on("message", function(context) {
          if (context) {
            taskqueue.emit('dead', context.message.body, function(){
              context.delivery.accept();
              receiver.add_credit(1);
            });
          }
        });
        taskqueue.channelConvertDead = receiver;
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
  taskqueue.channelDelayed = null;
  //todo clear all listeners
  taskqueue.channelConvertTaskData = {};
  taskqueue.channelConvertResponseData = {};
  taskqueue.channelDelayedData = {};
}
function* pushBackRedeliveredRabbit(taskqueue, message, ack) {
  if (message?.fields?.redelivered) {
    try {
      operationContext.global.logger.warn('checkRedelivered redelivered data=%j', message);
      //remove current task and add new into tail of queue to remove redelivered flag
      let data = message.content.toString();
      let redeliveredCount = message.properties.headers['x-redelivered-count'];
      if (!redeliveredCount || redeliveredCount < cfgMaxRedeliveredCount) {
        message.properties.headers['x-redelivered-count'] = redeliveredCount ? redeliveredCount + 1 : 1;
        yield addTaskString(taskqueue, data, message.properties.priority, undefined, message.properties.headers);
      } else if (taskqueue.simulateErrorResponse) {
        yield taskqueue.addResponse(taskqueue.simulateErrorResponse(data));
      }
    } catch (err) {
      operationContext.global.logger.error('checkRedelivered error: %s', err.stack);
    } finally{
      ack();
    }
    return true;
  }
  return false;
}
function* pushBackRedeliveredActive(taskqueue, context, ack) {
  if (undefined !== context.message.delivery_count) {
    operationContext.global.logger.warn('checkRedelivered redelivered data=%j', context.message);
    if (context.message.delivery_count > cfgMaxRedeliveredCount) {
      try {
        if (taskqueue.simulateErrorResponse) {
          yield taskqueue.addResponse(taskqueue.simulateErrorResponse(context.message.body));
        }
      } catch (err) {
        operationContext.global.logger.error('checkRedelivered error: %s', err.stack);
      } finally {
        ack();
      }
      return true;
    }
  }
  return false;
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
  for (var i = 0; i < taskqueue.addDelayedStore.length; ++i) {
    var elem = taskqueue.addDelayedStore[i];
    addDelayed(taskqueue, elem.task, elem.ttl, function () {});
  }
  taskqueue.addDelayedStore.length = 0;
}
function addTaskRabbit(taskqueue, content, priority, callback, opt_expiration, opt_headers) {
  var options = {persistent: true, priority: priority};
  if (undefined !== opt_expiration) {
    options.expiration = opt_expiration.toString();
  }
  if (undefined !== opt_headers) {
    options.headers = opt_headers;
  }
  taskqueue.channelConvertTask.sendToQueue(cfgRabbitQueueConvertTask, content, options, callback);
}
function addTaskActive(taskqueue, content, priority, callback, opt_expiration, opt_headers) {
  var msg = {durable: true, priority: priority, body: content, ttl: cfgQueueRetentionPeriod * 1000};
  if (undefined !== opt_expiration) {
    msg.ttl = opt_expiration;
  }
  let delivery = taskqueue.channelConvertTask.send(msg);
  if (delivery) {
    taskqueue.channelConvertTaskData[delivery.id] = callback;
  }
}
function addTaskString(taskqueue, task, priority, opt_expiration, opt_headers) {
  //todo confirmation mode
  return new Promise(function (resolve, reject) {
    var content = Buffer.from(task);
    if (null != taskqueue.channelConvertTask) {
      addTask(taskqueue, content, priority, function (err, ok) {
        if (null != err) {
          reject(err);
        } else {
          resolve();
        }
      }, opt_expiration, opt_headers);
    } else {
      taskqueue.addTaskStore.push({task: content, priority: priority, expiration: opt_expiration, headers: opt_headers});
      resolve();
    }
  });
}
function addResponseRabbit(taskqueue, content, callback) {
  var options = {persistent: true};
  taskqueue.channelConvertResponse.sendToQueue(cfgRabbitQueueConvertResponse, content, options, callback);
}
function addResponseActive(taskqueue, content, callback) {
  var msg = {durable: true, body: content};
  let delivery = taskqueue.channelConvertResponse.send(msg);
  if (delivery) {
    taskqueue.channelConvertResponseData[delivery.id] = callback;
  }
}
function closeRabbit(conn) {
  return rabbitMQCore.closePromise(conn);
}
function closeActive(conn) {
  return activeMQCore.closePromise(conn);
}
function addDelayedRabbit(taskqueue, content, ttl, callback) {
  var options = {persistent: true, expiration: ttl.toString()};
  taskqueue.channelDelayed.sendToQueue(cfgRabbitQueueDelayed, content, options, callback);
}
function addDelayedActive(taskqueue, content, ttl, callback) {
  var msg = {durable: true, body: content, ttl: ttl};
  let delivery = taskqueue.channelDelayed.send(msg);
  if (delivery) {
    taskqueue.channelDelayedData[delivery.id] = callback;
  }
}

function healthCheckRabbit(taskqueue) {
  return co(function* () {
    if (!taskqueue.channelConvertDead) {
      return false;
    }
    const exchange = yield rabbitMQCore.assertExchangePromise(taskqueue.channelConvertDead, cfgRabbitExchangeConvertDead,
      'fanout', optionsExchnangeDead);
    return !!exchange;
  });
}
function healthCheckActive(taskqueue) {
  return co(function* () {
    //todo better check
    if (!taskqueue.connection) {
      return false;
    }
    return taskqueue.connection.is_open();
  });
}

function initSenderActive(sender, senderData) {
  let processEvent = function (context, res) {
    let id = context?.delivery?.id;
    let callback = senderData[id];
    if (callback) {
      delete senderData[id];
      callback(res);
    }
  }

  sender.on('accepted', (context) => {
    processEvent(context, null);
  });
  sender.on('rejected ', (context) => {
    const error = context.delivery?.remote_state?.error;
    processEvent(context, new Error("[AMQP] message is rejected (error=" + error + ")"));
  });
  sender.on('released', (context) => {
    const delivery_failed = context.delivery?.remote_state?.delivery_failed;
    const undeliverable_here = context.delivery?.remote_state?.undeliverable_here;
    const err = new Error("[AMQP] message is released (delivery_failed=" + delivery_failed + ", undeliverable_here=" + undeliverable_here + ")");
    processEvent(context, err);
  });
  sender.on('modified ', (context) => {
    const delivery_failed = context.delivery?.remote_state?.delivery_failed;
    const undeliverable_here = context.delivery?.remote_state?.undeliverable_here;
    const err = new Error("[AMQP] message is modified (delivery_failed=" + delivery_failed + ", undeliverable_here=" + undeliverable_here + ")");
    processEvent(context, err);
  });
}

let init;
let addTask;
let addResponse;
let close;
let addDelayed;
let healthCheck;
if (commonDefines.c_oAscQueueType.rabbitmq === cfgQueueType) {
  init = initRabbit;
  addTask = addTaskRabbit;
  addResponse = addResponseRabbit;
  close = closeRabbit;
  addDelayed = addDelayedRabbit;
  healthCheck = healthCheckRabbit;
} else {
  init = initActive;
  addTask = addTaskActive;
  addResponse = addResponseActive;
  close = closeActive;
  addDelayed = addDelayedActive;
  healthCheck = healthCheckActive;
}

function TaskQueueRabbitMQ(simulateErrorResponse) {
  this.isClose = false;
  this.connection = null;
  this.channelConvertTask = null;
  this.channelConvertTaskReceive = null;
  this.channelConvertDead = null;
  this.channelConvertResponse = null;
  this.channelConvertResponseReceive = null;
  this.channelDelayed = null;
  this.addTaskStore = [];
  this.addDelayedStore = [];
  this.channelConvertTaskData = {};
  this.channelConvertResponseData = {};
  this.channelDelayedData = {};
  this.simulateErrorResponse = simulateErrorResponse;
}
util.inherits(TaskQueueRabbitMQ, events.EventEmitter);
TaskQueueRabbitMQ.prototype.init = function (isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, callback) {
  init(this, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, callback);
};
TaskQueueRabbitMQ.prototype.initPromise = function(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed) {
  var t = this;
  return new Promise(function(resolve, reject) {
    init(t, isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
TaskQueueRabbitMQ.prototype.addTask = function (task, priority, opt_expiration, opt_headers) {
  task.setVisibilityTimeout(cfgVisibilityTimeout);
  return addTaskString(this, JSON.stringify(task), priority, opt_expiration);
};
TaskQueueRabbitMQ.prototype.addResponse = function (task) {
  var t = this;
  return new Promise(function (resolve, reject) {
    var content = Buffer.from(JSON.stringify(task));
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
TaskQueueRabbitMQ.prototype.addDelayed = function (task, ttl) {
  var t = this;
  return new Promise(function (resolve, reject) {
    var content = new Buffer(JSON.stringify(task));
    if (null != t.channelDelayed) {
      addDelayed(t, content, ttl, function (err, ok) {
        if (null != err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      t.addDelayedStore.push({task: content, ttl: ttl});
      resolve();
    }
  });
};
TaskQueueRabbitMQ.prototype.close = function () {
  let t = this;
  return co(function* () {
    t.isClose = true;
    if (t.channelConvertTask) {
      yield close(t.channelConvertTask);
    }
    if (t.channelConvertTaskReceive) {
      yield close(t.channelConvertTaskReceive);
    }
    if (t.channelConvertDead) {
      yield close(t.channelConvertDead);
    }
    if (t.channelConvertResponse) {
      yield close(t.channelConvertResponse);
    }
    if (t.channelConvertResponseReceive) {
      yield close(t.channelConvertResponseReceive);
    }
    if (t.channelDelayed) {
      yield close(t.channelDelayed);
    }
    yield close(t.connection);
  });
};
TaskQueueRabbitMQ.prototype.closeOrWait = function() {
  if (commonDefines.c_oAscQueueType.rabbitmq === cfgQueueType) {
    return this.close();
  } else {
    //todo remove sleep
    //sleep to wait acknowledge
    return this.close().then(() => {
      return utils.sleep(1000);
    });
  }
};
TaskQueueRabbitMQ.prototype.healthCheck = function() {
  return healthCheck(this);
};

module.exports = TaskQueueRabbitMQ;
