/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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

const crypto = require('crypto');
var sqlBase = require('./baseConnector');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');

let addSqlParam = sqlBase.baseConnector.addSqlParameter;
let concatParams = sqlBase.baseConnector.concatParams;

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
  this.creationDate = null;
  this.userIndex = null;
  this.changeId = null;
  this.callback = null;
  this.baseurl = null;
  this.password = null;

  this.innerUserId = null;//not a DB field
  this.innerUserIndex = null;//not a DB field
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
  if (!this.creationDate) {
    this.creationDate = new Date();
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

function select(docId) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let sqlParam = addSqlParam(docId, values);
    let sqlCommand = `SELECT * FROM task_result WHERE id=${sqlParam};`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
}
function toUpdateArray(task, updateTime, isMask, values) {
  var res = [];
  if (null != task.status) {
    let sqlParam = addSqlParam(task.status, values);
    res.push(`status=${sqlParam}`);
  }
  if (null != task.statusInfo) {
    let sqlParam = addSqlParam(task.statusInfo, values);
    res.push(`status_info=${sqlParam}` );

  }
  if (updateTime) {
    let sqlParam = addSqlParam(new Date(), values);
    res.push(`last_open_date=${sqlParam}`);

  }
  if (null != task.indexUser) {
    let sqlParam = addSqlParam(task.indexUser, values);
    res.push(`user_index=${sqlParam}`);

  }
  if (null != task.changeId) {
    let sqlParam = addSqlParam(task.changeId, values);
    res.push(`change_id=${sqlParam}`);

  }
  if (null != task.callback && !isMask) {
    var userCallback = new sqlBase.UserCallback();
    userCallback.fromValues(task.indexUser, task.callback);
    let sqlParam = addSqlParam(userCallback.toSQLInsert(), values);
    res.push(`callback=${concatParams('callback', sqlParam)}`);
  }
  if (null != task.baseurl) {
    let sqlParam = addSqlParam(task.baseurl, values);
    res.push(`baseurl=${sqlParam}`);
  }
  if (null != task.password) {
    var documentPassword = new sqlBase.DocumentPassword();
    documentPassword.fromValues(task.password, task.innerUserId, task.innerUserIndex);
    let sqlParam = addSqlParam(documentPassword.toSQLInsert(), values);
    res.push(`password=${concatParams('password', sqlParam)}`);
  }
  return res;
}

function update(task) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let updateElems = toUpdateArray(task, true, false, values);
    let sqlSet = updateElems.join(', ');
    let sqlParam = addSqlParam(task.key, values);
    let sqlCommand = `UPDATE task_result SET ${sqlSet} WHERE id=${sqlParam};`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
}

function updateIf(task, mask) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let commandArg = toUpdateArray(task, true, false, values);
    let commandArgMask = toUpdateArray(mask, false, true, values);
    commandArgMask.push('id=' + addSqlParam(mask.key, values));
    let sqlSet = commandArg.join(', ');
    let sqlWhere = commandArgMask.join(' AND ');
    let sqlCommand = `UPDATE task_result SET ${sqlSet} WHERE ${sqlWhere};`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
}

function addRandomKey(task, opt_prefix, opt_size) {
  return new Promise(function(resolve, reject) {
    if (undefined !== opt_prefix && undefined !== opt_size) {
      task.key = opt_prefix + crypto.randomBytes(opt_size).toString("hex");
    } else {
      task.key = task.key + '_' + Math.round(Math.random() * RANDOM_KEY_MAX);
    }
    task.completeDefaults();
    let values = [];
    let p1 = addSqlParam(task.key, values);
    let p2 = addSqlParam(task.status, values);
    let p3 = addSqlParam(task.statusInfo, values);
    let p4 = addSqlParam(new Date(), values);
    let p5 = addSqlParam(task.userIndex, values);
    let p6 = addSqlParam(task.changeId, values);
    let p7 = addSqlParam(task.callback, values);
    let p8 = addSqlParam(task.baseurl, values);
    let sqlCommand = 'INSERT INTO task_result (id, status, status_info, last_open_date, user_index, change_id, callback, baseurl)' +
      ` VALUES (${p1}, ${p2}, ${p3}, ${p4}, ${p5}, ${p6}, ${p7}, ${p8});`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
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

function remove(docId) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let sqlParam = addSqlParam(docId, values);
    const sqlCommand = `DELETE FROM task_result WHERE id=${sqlParam};`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
}
function getExpired(maxCount, expireSeconds) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let expireDate = new Date();
    utils.addSeconds(expireDate, -expireSeconds);
    let sqlParam1 = addSqlParam(expireDate, values);
    let sqlParam2 = addSqlParam(maxCount, values);
    let sqlCommand = `SELECT * FROM task_result WHERE last_open_date <= ${sqlParam1}` +
      ` AND NOT EXISTS(SELECT id FROM doc_changes WHERE doc_changes.id = task_result.id LIMIT 1) LIMIT ${sqlParam2};`;
    sqlBase.baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
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
