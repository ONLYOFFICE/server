'use strict';
var events = require('events');
var util = require('util');
var sqlBase = require('./../../DocService/sources/baseConnector');
var utils = require('./utils');
var commonDefines = require('./commondefines');
var constants = require('./constants');
var config = require('config').get('queue');

var cfgVisibilityTimeout = config.get('visibilityTimeout');
var cfgRetentionPeriod = config.get('retentionPeriod');
var TABLE_NAME = 'convert_queue';
var DB_TIMEOUT = 1000;

var BusyType = {
  notBusy: 0,
  busy: 1
};

function getInsertString(task, priority) {
  var dateNow = sqlBase.getDateTime(new Date());
  var jsonTask = JSON.stringify(task);
  var commandArg = [jsonTask, priority, dateNow, dateNow, BusyType.notBusy];
  var commandArgEsc = commandArg.map(function(curVal) {
    return sqlBase.baseConnector.sqlEscape(curVal)
  });
  return 'INSERT INTO ' + TABLE_NAME + ' (cq_data, cq_priority, cq_update_time, cq_create_time, cq_isbusy)' +
    ' VALUES (' + commandArgEsc.join(', ') + ');';
}
function getSelectString(optPriority) {
  var minPosibleStartHandleTime = new Date();
  utils.addSeconds(minPosibleStartHandleTime, -cfgVisibilityTimeout);
  var dateNow = sqlBase.getDateTime(minPosibleStartHandleTime);
  var responseSign;
  if (constants.QUEUE_PRIORITY_RESPONSE == optPriority) {
    responseSign = '=';
  } else {
    responseSign = '<>';
  }
  return 'SELECT * FROM ' + TABLE_NAME + ' WHERE' +
    ' cq_priority' + responseSign + sqlBase.baseConnector.sqlEscape(constants.QUEUE_PRIORITY_RESPONSE) + ' AND' +
    ' (cq_isbusy<>' + sqlBase.baseConnector.sqlEscape(BusyType.busy) + ' OR' +
    ' cq_update_time<=' + sqlBase.baseConnector.sqlEscape(dateNow) + ') ORDER BY cq_priority DESC;';
}
function getRemoveString(cqId) {
  return 'DELETE FROM ' + TABLE_NAME + ' WHERE cq_id=' + sqlBase.baseConnector.sqlEscape(cqId) + ';';
}
function getUpdateString(cqId, taskUpdateTime) {
  var dateNow = sqlBase.getDateTime(new Date());
  var taskUpdateTimeString = sqlBase.getDateTime(taskUpdateTime);
  return 'UPDATE ' + TABLE_NAME + ' SET cq_isbusy = ' + sqlBase.baseConnector.sqlEscape(BusyType.busy) +
    ', cq_update_time = ' + sqlBase.baseConnector.sqlEscape(dateNow) +
    ' WHERE (cq_id = ' + sqlBase.baseConnector.sqlEscape(cqId) + ' AND' +
    ' cq_update_time = ' + sqlBase.baseConnector.sqlEscape(taskUpdateTimeString) + ' AND' +
    ' cq_isbusy<>' + sqlBase.baseConnector.sqlEscape(BusyType.busy) + ');';
}
function select(optPriority) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getSelectString(optPriority);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
function tryUpdateTask(cqId, taskUpdateTime) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getUpdateString(cqId, taskUpdateTime);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
function getTask(optPriority) {
  return new Promise(function(resolve, reject) {
    utils.spawn(function* () {
      try {
        var selectRes = yield select(optPriority);
        var resRow = null;
        for (var i = 0; i < selectRes.length; ++i) {
          var row = selectRes[i];
          var dateNow = new Date();
          var taskCreateTime = row.cq_create_time;
          utils.addSeconds(taskCreateTime, cfgRetentionPeriod);
          if (dateNow < taskCreateTime) {
            var updateRes = yield tryUpdateTask(row.cq_id, row.cq_update_time);
            if (1 == updateRes.affectedRows) {
              resRow = row;
              break;
            }
          } else {
            //todo все сразу
            yield removeTask(row.cq_id);
          }
        }
        resolve(resRow);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function addTask(task, priority) {
  return new Promise(function(resolve, reject) {
    task.visibilityTimeout = cfgVisibilityTimeout;
    var sqlCommand = getInsertString(task, priority);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
function removeTask(key) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getRemoveString(key);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function TaskQueueDB() {
}
util.inherits(TaskQueueDB, events.EventEmitter);
TaskQueueDB.prototype.init = function(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, callback) {
  var taskqueue = this;
  function getFromDB(name, priority) {
    setTimeout(function() {
      getTask(priority).then(function(row) {
        if (row) {
          taskqueue.emit(name, row.cq_data, row);
        }
      }).catch(function(err) {
        logger.error('createTaskQueue error:\r\n%s', err.stack);
      }).then(function() {
        getFromDB(name, priority);
      });
    }, DB_TIMEOUT);
  }
  if (isAddTaskReceive) {
    getFromDB('task');
  }
  if (isAddResponseReceive) {
    getFromDB('response', constants.QUEUE_PRIORITY_RESPONSE);
  }
  callback(null);
};
TaskQueueDB.prototype.addTask = function(task, priority) {
  return addTask(task, priority);
};
TaskQueueDB.prototype.addResponse = function(task) {
  return addTask(task, constants.QUEUE_PRIORITY_RESPONSE);
};
TaskQueueDB.prototype.removeTask = function(row) {
  return removeTask(row.cq_id);
};
TaskQueueDB.prototype.removeResponse = function(row) {
  return removeTask(row.cq_id);
};

module.exports = TaskQueueDB;
