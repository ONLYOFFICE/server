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
var sqlBase = require('./baseConnector');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');

var RANDOM_KEY_MAX = 10000;

var FileStatus = {
  None: 0,
  Ok: 1,
  WaitQueue: 2,
  NeedParams: 3,
  Convert: 4,
  Err: 5,
  ErrToReload: 6,
  SaveVersion: 7,
  UpdateVersion: 8
};

function TaskResultData() {
  this.key = null;
  this.format = null;
  this.status = null;
  this.statusInfo = null;
  this.lastOpenDate = null;
  this.title = null;
  this.userIndex = null;
  this.changeId = null;
}
TaskResultData.prototype.completeDefaults = function() {
  if (!this.key) {
    this.key = '';
  }
  if (!this.format) {
    this.format = '';
  }
  if (!this.status) {
    this.status = FileStatus.None;
  }
  if (!this.statusInfo) {
    this.statusInfo = constants.NO_ERROR;
  }
  if (!this.lastOpenDate) {
    this.lastOpenDate = new Date();
  }
  if (!this.title) {
    this.title = '';
  }
  if (!this.userIndex) {
    this.userIndex = 1;
  }
  if (!this.changeId) {
    this.changeId = 0;
  }
};

function getUpsertString(task, opt_updateUserIndex) {
  task.completeDefaults();
  var dateNow = sqlBase.getDateTime(new Date());
  var commandArg = [task.key, task.format, task.status, task.statusInfo, dateNow, task.title, task.userIndex, task.changeId];
  var commandArgEsc = commandArg.map(function(curVal) {
    return sqlBase.baseConnector.sqlEscape(curVal)
  });
  var sql = 'INSERT INTO task_result ( tr_key, tr_format, tr_status, tr_status_info, tr_last_open_date, tr_title,' +
    ' tr_user_index, tr_change_id  ) VALUES (' + commandArgEsc.join(', ') + ') ON DUPLICATE KEY UPDATE' +
    ' tr_last_open_date = ' + sqlBase.baseConnector.sqlEscape(dateNow);
  if (opt_updateUserIndex) {
    //todo LAST_INSERT_ID in posgresql - RETURNING
    sql += ', tr_user_index = LAST_INSERT_ID(tr_user_index + 1);';
  } else {
    sql += ';';
  }
  return sql;
}

function upsert(task, opt_updateUserIndex) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getUpsertString(task, opt_updateUserIndex);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function getSelectString(docId) {
  return 'SELECT * FROM task_result WHERE tr_key=' + sqlBase.baseConnector.sqlEscape(docId) + ';';
}

function select(docId) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getSelectString(docId);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function toUpdateArray(task, updateTime) {
  var res = [];
  if (null != task.format) {
    res.push('tr_format=' + sqlBase.baseConnector.sqlEscape(task.format));
  }
  if (null != task.status) {
    res.push('tr_status=' + sqlBase.baseConnector.sqlEscape(task.status));
  }
  if (null != task.statusInfo) {
    res.push('tr_status_info=' + sqlBase.baseConnector.sqlEscape(task.statusInfo));
  }
  if (updateTime) {
    res.push('tr_last_open_date=' + sqlBase.baseConnector.sqlEscape(sqlBase.getDateTime(new Date())));
  }
  if (null != task.title) {
    res.push('tr_title=' + sqlBase.baseConnector.sqlEscape(task.title));
  }
  if (null != task.indexUser) {
    res.push('tr_index_user=' + sqlBase.baseConnector.sqlEscape(task.indexUser));
  }
  if (null != task.changeId) {
    res.push('tr_change_id=' + sqlBase.baseConnector.sqlEscape(task.changeId));
  }
  return res;
}
function getUpdateString(task) {
  var commandArgEsc = toUpdateArray(task, true);
  return 'UPDATE task_result SET ' + commandArgEsc.join(', ') +
    ' WHERE tr_key=' + sqlBase.baseConnector.sqlEscape(task.key) + ';';
}

function update(task) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getUpdateString(task);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function getUpdateIfString(task, mask) {
  var commandArgEsc = toUpdateArray(task, true);
  var commandArgEscMask = toUpdateArray(mask);
  commandArgEscMask.push('tr_key=' + sqlBase.baseConnector.sqlEscape(mask.key));
  return 'UPDATE task_result SET ' + commandArgEsc.join(', ') +
    ' WHERE ' + commandArgEscMask.join(' AND ') + ';';
}

function updateIf(task, mask) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getUpdateIfString(task, mask);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function getInsertString(task) {
  var dateNow = sqlBase.getDateTime(new Date());
  task.completeDefaults();
  var commandArg = [task.key, task.format, task.status, task.statusInfo, dateNow, task.title, task.userIndex, task.changeId];
  var commandArgEsc = commandArg.map(function(curVal) {
    return sqlBase.baseConnector.sqlEscape(curVal)
  });
  return 'INSERT INTO task_result ( tr_key, tr_format, tr_status, tr_status_info, tr_last_open_date, tr_title,'+
    ' tr_user_index, tr_change_id) VALUES (' + commandArgEsc.join(', ') + ');';
}
function addRandomKey(task) {
  return new Promise(function(resolve, reject) {
    task.key = task.key + '_' + Math.round(Math.random() * RANDOM_KEY_MAX);
    var sqlCommand = getInsertString(task);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function* addRandomKeyTask(key) {
  var task = new TaskResultData();
  task.key = key;
  task.status = FileStatus.WaitQueue;
  //nTryCount чтобы не зависнуть если реально будут проблемы с DB
  var nTryCount = RANDOM_KEY_MAX;
  var addRes = null;
  while (nTryCount-- > 0) {
    try {
      addRes = yield addRandomKey(task);
    } catch (e) {
      addRes = null;
      //key exist, try again
    }
    if (addRes && addRes.affectedRows > 0) {
      break;
    }
  }
  if (addRes && addRes.affectedRows > 0) {
    return task;
  } else {
    throw new Error('addRandomKeyTask Error');
  }
}

function getRemoveString(docId) {
  return 'DELETE FROM task_result WHERE tr_key=' + sqlBase.baseConnector.sqlEscape(docId) + ';';
}
function remove(docId) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getRemoveString(docId);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function getExpiredString(maxCount, expireSeconds) {
  var expireDate = new Date();
  utils.addSeconds(expireDate, -expireSeconds);
  var expireDateStr = sqlBase.baseConnector.sqlEscape(sqlBase.getDateTime(expireDate));
  return 'SELECT * FROM task_result WHERE tr_last_open_date <= ' + expireDateStr +
    ' AND NOT EXISTS(SELECT dc_key FROM doc_changes WHERE dc_key = tr_key LIMIT 1) LIMIT ' + maxCount + ';';
}
function getExpired(maxCount, expireSeconds) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getExpiredString(maxCount, expireSeconds);
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

exports.FileStatus = FileStatus;
exports.TaskResultData = TaskResultData;
exports.upsert = upsert;
exports.select = select;
exports.update = update;
exports.updateIf = updateIf;
exports.addRandomKey = addRandomKey;
exports.addRandomKeyTask = addRandomKeyTask;
exports.remove = remove;
exports.getExpired = getExpired;
