/*
 * (c) Copyright Ascensio System SIA 2010-2017
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

const crypto = require('crypto');
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
  Err: 5,
  ErrToReload: 6,
  SaveVersion: 7,
  UpdateVersion: 8,
  NeedPassword: 9
};

function TaskResultData() {
  this.key = null;
  this.status = null;
  this.statusInfo = null;
  this.lastOpenDate = null;
  this.userIndex = null;
  this.changeId = null;
  this.callback = null;
  this.baseurl = null;
}
TaskResultData.prototype.completeDefaults = function() {
  if (!this.key) {
    this.key = '';
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
  if (!this.userIndex) {
    this.userIndex = 1;
  }
  if (!this.changeId) {
    this.changeId = 0;
  }
  if (!this.callback) {
    this.callback = '';
  }
  if (!this.baseurl) {
    this.baseurl = '';
  }
};

function upsert(task, opt_updateUserIndex) {
  return sqlBase.baseConnector.upsert(task, opt_updateUserIndex);
}

function getSelectString(docId) {
  return 'SELECT * FROM task_result WHERE id=' + sqlBase.baseConnector.sqlEscape(docId);
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
  if (null != task.status) {
    res.push('status=' + sqlBase.baseConnector.sqlEscape(task.status));
  }
  if (null != task.statusInfo) {
    res.push('status_info=' + sqlBase.baseConnector.sqlEscape(task.statusInfo));
  }
  if (updateTime) {
    res.push('last_open_date=' + sqlBase.baseConnector.sqlEscape(sqlBase.baseConnector.getDateTime(new Date())));
  }
  if (null != task.indexUser) {
    res.push('user_index=' + sqlBase.baseConnector.sqlEscape(task.indexUser));
  }
  if (null != task.changeId) {
    res.push('change_id=' + sqlBase.baseConnector.sqlEscape(task.changeId));
  }
  if (null != task.callback) {
    res.push('callback=' + sqlBase.baseConnector.sqlEscape(task.callback));
  }
  if (null != task.baseurl) {
    res.push('baseurl=' + sqlBase.baseConnector.sqlEscape(task.baseurl));
  }
  return res;
}
function getUpdateString(task) {
  var commandArgEsc = toUpdateArray(task, true);
  return 'UPDATE task_result SET ' + commandArgEsc.join(', ') +
    ' WHERE id=' + sqlBase.baseConnector.sqlEscape(task.key);
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
  commandArgEscMask.push('id=' + sqlBase.baseConnector.sqlEscape(mask.key));
  return 'UPDATE task_result SET ' + commandArgEsc.join(', ') +
    ' WHERE ' + commandArgEscMask.join(' AND ');
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
  var dateNow = sqlBase.baseConnector.getDateTime(new Date());
  task.completeDefaults();
  var commandArg = [task.key, task.status, task.statusInfo, dateNow, task.userIndex, task.changeId, task.callback, task.baseurl];
  var commandArgEsc = commandArg.map(function(curVal) {
    return sqlBase.baseConnector.sqlEscape(curVal)
  });
  return 'INSERT INTO task_result ( id, status, status_info, last_open_date, user_index, change_id, callback,' +
    ' baseurl) VALUES (' + commandArgEsc.join(', ') + ')';
}
function addRandomKey(task, opt_prefix, opt_size) {
  return new Promise(function(resolve, reject) {
    if (undefined !== opt_prefix && undefined !== opt_size) {
      task.key = opt_prefix + crypto.randomBytes(opt_size).toString("hex");
    } else {
      task.key = task.key + '_' + Math.round(Math.random() * RANDOM_KEY_MAX);
    }
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
function* addRandomKeyTask(key, opt_prefix, opt_size) {
  var task = new TaskResultData();
  task.key = key;
  task.status = FileStatus.WaitQueue;
  //nTryCount чтобы не зависнуть если реально будут проблемы с DB
  var nTryCount = RANDOM_KEY_MAX;
  var addRes = null;
  while (nTryCount-- > 0) {
    try {
      addRes = yield addRandomKey(task, opt_prefix, opt_size);
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
  return 'DELETE FROM task_result WHERE id=' + sqlBase.baseConnector.sqlEscape(docId);
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
  var expireDateStr = sqlBase.baseConnector.sqlEscape(sqlBase.baseConnector.getDateTime(expireDate));
  return sqlBase.baseConnector.getExpiredSqlString(expireDateStr, maxCount);
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
exports.addRandomKeyTask = addRandomKeyTask;
exports.remove = remove;
exports.getExpired = getExpired;
