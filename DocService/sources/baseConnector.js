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

var sqlDataBaseType = {
	mySql		: 'mysql',
	mariaDB		: 'mariadb',
	postgreSql	: 'postgres'
};

var config = require('config').get('services.CoAuthoring.sql');
var baseConnector = (sqlDataBaseType.mySql === config.get('type') || sqlDataBaseType.mariaDB === config.get('type')) ? require('./mySqlBaseConnector') : require('./postgreSqlBaseConnector');
var logger = require('./../../Common/sources/logger');

const tableChanges = config.get('tableChanges'),
	tableResult = config.get('tableResult');

var g_oCriticalSection = {};
let isSupportFastInsert = !!baseConnector.insertChanges;
let addSqlParam = baseConnector.addSqlParameter;
var maxPacketSize = config.get('max_allowed_packet'); // Размер по умолчанию для запроса в базу данных 1Mb - 1 (т.к. он не пишет 1048575, а пишет 1048574)

exports.baseConnector = baseConnector;
exports.insertChangesPromiseCompatibility = function (objChanges, docId, index, user) {
  return new Promise(function(resolve, reject) {
    _insertChangesCallback(0, objChanges, docId, index, user, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.insertChangesPromiseFast = function (objChanges, docId, index, user) {
  return new Promise(function(resolve, reject) {
    baseConnector.insertChanges(tableChanges, 0, objChanges, docId, index, user, function(error, result, isSupported) {
      isSupportFastInsert = isSupported;
      if (error) {
        if (!isSupportFastInsert) {
          resolve(exports.insertChangesPromiseCompatibility(objChanges, docId, index, user));
        } else {
          reject(error);
        }
      } else {
        resolve(result);
      }
    });
  });
};
exports.insertChangesPromise = function (objChanges, docId, index, user) {
  if (isSupportFastInsert) {
    return exports.insertChangesPromiseFast(objChanges, docId, index, user);
  } else {
    return exports.insertChangesPromiseCompatibility(objChanges, docId, index, user);
  }

};
function _getDateTime2(oDate) {
  return oDate.toISOString().slice(0, 19).replace('T', ' ');
}

exports.getDateTime = _getDateTime2;

function _insertChangesCallback (startIndex, objChanges, docId, index, user, callback) {
  var sqlCommand = `INSERT INTO ${tableChanges} VALUES`;
  var i = startIndex, l = objChanges.length, lengthUtf8Current = sqlCommand.length, lengthUtf8Row = 0, values = [];
  if (i === l)
    return;

  for (; i < l; ++i, ++index) {
    //44 - length of "($1001,... $1007),"
    //4 is max utf8 bytes per symbol
    lengthUtf8Row = 44 + 4 * (docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[i].change.length) + 4 + 8;
    if (lengthUtf8Row + lengthUtf8Current >= maxPacketSize && i > startIndex) {
      sqlCommand += ';';
      (function(tmpStart, tmpIndex) {
        baseConnector.sqlQuery(sqlCommand, function() {
          // lock не снимаем, а продолжаем добавлять
          _insertChangesCallback(tmpStart, objChanges, docId, tmpIndex, user, callback);
        }, undefined, undefined, values);
      })(i, index);
      return;
    }
    let p1 = addSqlParam(docId, values);
    let p2 = addSqlParam(index, values);
    let p3 = addSqlParam(user.id, values);
    let p4 = addSqlParam(user.idOriginal, values);
    let p5 = addSqlParam(user.username, values);
    let p6 = addSqlParam(objChanges[i].change, values);
    let p7 = addSqlParam(objChanges[i].time, values);
    if (i > startIndex) {
      sqlCommand += ',';
    }
    sqlCommand += `(${p1},${p2},${p3},${p4},${p5},${p6},${p7})`;
    lengthUtf8Current += lengthUtf8Row;
  }

  sqlCommand += ';';
  baseConnector.sqlQuery(sqlCommand, callback, undefined, undefined, values);
}
exports.deleteChangesCallback = function(docId, deleteIndex, callback) {
  let sqlCommand, values = [];
  let sqlParam1 = addSqlParam(docId, values);
  if (null !== deleteIndex) {
    let sqlParam2 = addSqlParam(deleteIndex, values);
    sqlCommand = `DELETE FROM ${tableChanges} WHERE id=${sqlParam1} AND change_id >= ${sqlParam2};`;
  } else {
    sqlCommand = `DELETE FROM ${tableChanges} WHERE id=${sqlParam1};`;
  }
  baseConnector.sqlQuery(sqlCommand, callback, undefined, undefined, values);
};
exports.deleteChangesPromise = function (docId, deleteIndex) {
  return new Promise(function(resolve, reject) {
    exports.deleteChangesCallback(docId, deleteIndex, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.deleteChanges = function (docId, deleteIndex) {
	lockCriticalSection(docId, function () {_deleteChanges(docId, deleteIndex);});
};
function _deleteChanges (docId, deleteIndex) {
  exports.deleteChangesCallback(docId, deleteIndex, function () {unLockCriticalSection(docId);});
}
exports.getChangesIndex = function(docId, callback) {
  let values = [];
  let sqlParam = addSqlParam(docId, values);
  var sqlCommand = `SELECT MAX(change_id) as change_id FROM ${tableChanges} WHERE id=${sqlParam};`;
  baseConnector.sqlQuery(sqlCommand, callback, undefined, undefined, values);
};
exports.getChangesIndexPromise = function(docId) {
  return new Promise(function(resolve, reject) {
    exports.getChangesIndex(docId, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.getChangesPromise = function (docId, optStartIndex, optEndIndex, opt_time) {
  return new Promise(function(resolve, reject) {
    let values = [];
    let sqlParam = addSqlParam(docId, values);
    let sqlWhere = `id=${sqlParam}`;
    if (null != optStartIndex) {
      sqlParam = addSqlParam(optStartIndex, values);
      sqlWhere += ` AND change_id>=${sqlParam}`;
    }
    if (null != optEndIndex) {
      sqlParam = addSqlParam(optEndIndex, values);
      sqlWhere += ` AND change_id<${sqlParam}`;
    }
    if (null != opt_time) {
      if (!(opt_time instanceof Date)) {
        opt_time = new Date(opt_time);
      }
      sqlParam = addSqlParam(opt_time, values);
      sqlWhere += ` AND change_date<=${sqlParam}`;
    }
    sqlWhere += ' ORDER BY change_id ASC';
    var sqlCommand = `SELECT * FROM ${tableChanges} WHERE ${sqlWhere};`;

    baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, undefined, undefined, values);
  });
};
exports.checkStatusFile = function (docId, callbackFunction) {
  let values = [];
  let sqlParam = addSqlParam(docId, values);
  var sqlCommand = `SELECT status, status_info FROM ${tableResult} WHERE id=${sqlParam};`;
  baseConnector.sqlQuery(sqlCommand, callbackFunction, undefined, undefined, values);
};
exports.checkStatusFilePromise = function (docId) {
  return new Promise(function(resolve, reject) {
    exports.checkStatusFile(docId, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};

exports.isLockCriticalSection = function (id) {
	return !!(g_oCriticalSection[id]);
};

// Критическая секция
function lockCriticalSection (id, callback) {
	if (g_oCriticalSection[id]) {
		// Ждем
		g_oCriticalSection[id].push(callback);
		return;
	}
	// Ставим lock
	g_oCriticalSection[id] = [];
	g_oCriticalSection[id].push(callback);
	callback();
}
function unLockCriticalSection (id) {
	var arrCallbacks = g_oCriticalSection[id];
	arrCallbacks.shift();
	if (0 < arrCallbacks.length)
		arrCallbacks[0]();
	else
		delete g_oCriticalSection[id];
}
exports.healthCheck = function () {
  return new Promise(function(resolve, reject) {
  	//SELECT 1; usefull for H2, MySQL, Microsoft SQL Server, PostgreSQL, SQLite
  	//http://stackoverflow.com/questions/3668506/efficient-sql-test-query-or-validation-query-that-will-work-across-all-or-most
    baseConnector.sqlQuery('SELECT 1;', function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};

exports.getEmptyCallbacks = function() {
  return new Promise(function(resolve, reject) {
    const sqlCommand = "SELECT DISTINCT t1.id FROM doc_changes t1 LEFT JOIN task_result t2 ON t2.id = t1.id WHERE t2.callback = '';";
    baseConnector.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
function UserCallback() {
  this.userIndex = undefined;
  this.callback = undefined;
}
UserCallback.prototype.fromValues = function(userIndex, callback){
  if(null !== userIndex){
    this.userIndex = userIndex;
  }
  if(null !== callback){
    this.callback = callback;
  }
};
UserCallback.prototype.delimiter = String.fromCharCode(5);
UserCallback.prototype.toSQLInsert = function(){
  return this.delimiter + JSON.stringify(this);
};
UserCallback.prototype.getCallbackByUserIndex = function(docId, callbacksStr, opt_userIndex) {
  logger.debug("getCallbackByUserIndex: docId = %s userIndex = %s callbacks = %s", docId, opt_userIndex, callbacksStr);
  if (!callbacksStr || !callbacksStr.startsWith(UserCallback.prototype.delimiter)) {
    let index = callbacksStr.indexOf(UserCallback.prototype.delimiter);
    if (-1 === index) {
      //old format
      return callbacksStr;
    } else {
      //mix of old and new format
      callbacksStr = callbacksStr.substring(index);
    }
  }
  let callbacks = callbacksStr.split(UserCallback.prototype.delimiter);
  let callbackUrl = "";
  for (let i = 1; i < callbacks.length; ++i) {
    let callback = JSON.parse(callbacks[i]);
    callbackUrl = callback.callback;
    if (callback.userIndex === opt_userIndex) {
      break;
    }
  }
  return callbackUrl;
};
exports.UserCallback = UserCallback;

function DocumentPassword() {
  this.password = undefined;
  this.userId = undefined;
  this.userIndex = undefined;
}
DocumentPassword.prototype.fromString = function(passwordStr){
  var parsed = JSON.parse(passwordStr);
  this.fromValues(parsed.password, parsed.userId, parsed.userIndex);
};
DocumentPassword.prototype.fromValues = function(password, userId, userIndex){
  if(null !== password){
    this.password = password;
  }
  if(null !== userId){
    this.userId = userId;
  }
  if(null !== userIndex){
    this.userIndex = userIndex;
  }
};
DocumentPassword.prototype.delimiter = String.fromCharCode(5);
DocumentPassword.prototype.toSQLInsert = function(){
  return this.delimiter + JSON.stringify(this);
};
DocumentPassword.prototype.isInitial = function(){
  return !this.userId;
};
DocumentPassword.prototype.getDocPassword = function(docId, docPasswordStr) {
  let res = {initial: undefined, current: undefined, userId: undefined, userIndex: undefined};
  if (docPasswordStr) {
    logger.debug("getDocPassword: docId = %s passwords = %s", docId, docPasswordStr);
    let passwords = docPasswordStr.split(UserCallback.prototype.delimiter);

    for (let i = 1; i < passwords.length; ++i) {
      let password = new DocumentPassword();
      password.fromString(passwords[i]);
      if (password.isInitial()) {
        res.initial = password.password;
      }
      res.current = password.password;
      res.userId = password.userId;
      res.userIndex = password.userIndex;
    }
  }
  return res;
};
DocumentPassword.prototype.getCurPassword = function(docId, docPasswordStr) {
  let docPassword = this.getDocPassword(docId, docPasswordStr);
  return docPassword.current;
};
DocumentPassword.prototype.hasPasswordChanges = function(docId, docPasswordStr) {
  let docPassword = this.getDocPassword(docId, docPasswordStr);
  return docPassword.initial !== docPassword.current;
};
exports.DocumentPassword = DocumentPassword;
