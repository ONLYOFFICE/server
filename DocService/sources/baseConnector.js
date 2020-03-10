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
	postgreSql	: 'postgres'
};

var config = require('config').get('services.CoAuthoring.sql');
var baseConnector = (sqlDataBaseType.mySql === config.get('type')) ? require('./mySqlBaseConnector') : require('./postgreSqlBaseConnector');
var logger = require('./../../Common/sources/logger');

var tableChanges = config.get('tableChanges'),
	tableResult = config.get('tableResult');

var g_oCriticalSection = {};
let isSupportFastInsert = !!baseConnector.insertChanges;
var maxPacketSize = config.get('max_allowed_packet'); // Размер по умолчанию для запроса в базу данных 1Mb - 1 (т.к. он не пишет 1048575, а пишет 1048574)

function getDataFromTable (tableId, data, getCondition, callback) {
	var table = getTableById(tableId);
	var sqlCommand = "SELECT " + data + " FROM " + table + " WHERE " + getCondition + ";";

	baseConnector.sqlQuery(sqlCommand, callback);
}
function deleteFromTable (tableId, deleteCondition, callback) {
	var table = getTableById(tableId);
	var sqlCommand = "DELETE FROM " + table + " WHERE " + deleteCondition + ";";

	baseConnector.sqlQuery(sqlCommand, callback);
}
var c_oTableId = {
	callbacks	: 2,
	changes		: 3
};
function getTableById (id) {
	var res;
	switch (id) {
		case c_oTableId.changes:
			res = tableChanges;
			break;
	}
	return res;
}

exports.baseConnector = baseConnector;
exports.tableId = c_oTableId;
exports.loadTable = function (tableId, callbackFunction) {
	var table = getTableById(tableId);
	var sqlCommand = "SELECT * FROM " + table + ";";
	baseConnector.sqlQuery(sqlCommand, callbackFunction);
};
exports.insertChanges = function (objChanges, docId, index, user) {
	lockCriticalSection(docId, function () {_insertChanges(0, objChanges, docId, index, user);});
};
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
function _lengthInUtf8Bytes (s) {
	return ~-encodeURI(s).split(/%..|./).length;
}
function _getDateTime2(oDate) {
  return oDate.toISOString().slice(0, 19).replace('T', ' ');
}
function _getDateTime(nTime) {
	var oDate = new Date(nTime);
  return _getDateTime2(oDate);
}

exports.getDateTime = _getDateTime2;
function _insertChanges (startIndex, objChanges, docId, index, user) {
  _insertChangesCallback(startIndex, objChanges, docId, index, user, function () {unLockCriticalSection(docId);});
}

function _insertChangesCallback (startIndex, objChanges, docId, index, user, callback) {
	var sqlCommand = "INSERT INTO " + tableChanges + " VALUES";
	var i = startIndex, l = objChanges.length, sqlNextRow = "", lengthUtf8Current = 0, lengthUtf8Row = 0;
	if (i === l)
		return;

	for (; i < l; ++i, ++index) {
		sqlNextRow = "(" + baseConnector.sqlEscape(docId) + "," + baseConnector.sqlEscape(index) + ","
			+ baseConnector.sqlEscape(user.id) + "," + baseConnector.sqlEscape(user.idOriginal) + ","
			+ baseConnector.sqlEscape(user.username) + "," + baseConnector.sqlEscape(objChanges[i].change) + ","
			+ baseConnector.sqlEscape(_getDateTime(objChanges[i].time)) + ")";
		lengthUtf8Row = _lengthInUtf8Bytes(sqlNextRow) + 1; // 1 - это на символ ',' или ';' в конце команды
		if (i === startIndex) {
			lengthUtf8Current = _lengthInUtf8Bytes(sqlCommand);
			sqlCommand += sqlNextRow;
		} else {
			if (lengthUtf8Row + lengthUtf8Current >= maxPacketSize) {
				sqlCommand += ';';
				(function (tmpStart, tmpIndex) {
					baseConnector.sqlQuery(sqlCommand, function () {
						// lock не снимаем, а продолжаем добавлять
						_insertChangesCallback(tmpStart, objChanges, docId, tmpIndex, user, callback);
					});
				})(i, index);
				return;
			} else {
				sqlCommand += ',';
				sqlCommand += sqlNextRow;
			}
		}

		lengthUtf8Current += lengthUtf8Row;
	}

	sqlCommand += ';';
	baseConnector.sqlQuery(sqlCommand, callback);
}
exports.deleteChangesCallback = function (docId, deleteIndex, callback) {
  var sqlCommand = "DELETE FROM " + tableChanges + " WHERE id='" + docId + "'";
  if (null !== deleteIndex)
    sqlCommand += " AND change_id >= " + deleteIndex;
  sqlCommand += ";";
  baseConnector.sqlQuery(sqlCommand, callback);
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
  var table = getTableById(c_oTableId.changes);
  var sqlCommand = 'SELECT MAX(change_id) as change_id FROM ' + table + ' WHERE id=' + baseConnector.sqlEscape(docId) + ';';
  baseConnector.sqlQuery(sqlCommand, callback);
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
    var getCondition = 'id='+baseConnector.sqlEscape(docId);
    if (null != optStartIndex) {
      getCondition += ' AND change_id>=' + optStartIndex;
    }
    if (null != optEndIndex) {
      getCondition += ' AND change_id<' + optEndIndex;
    }
    if (null != opt_time) {
      getCondition += ' AND change_date<=' + baseConnector.sqlEscape(_getDateTime(opt_time));
    }
    getCondition += ' ORDER BY change_id ASC';
    getDataFromTable(c_oTableId.changes, "*", getCondition, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.checkStatusFile = function (docId, callbackFunction) {
	var sqlCommand = "SELECT status, status_info FROM " + tableResult + " WHERE id='" + docId + "';";
	baseConnector.sqlQuery(sqlCommand, callbackFunction);
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
exports.updateStatusFile = function (docId) {
	// Статус OK = 1
	var sqlCommand = "UPDATE " + tableResult + " SET status=1 WHERE id='" + docId + "';";
	baseConnector.sqlQuery(sqlCommand);
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
UserCallback.prototype.toSQLUpdate = function(){
  return 'callback || ' + baseConnector.sqlEscape(this.toSQLInsert());
};
UserCallback.prototype.getCallbackByUserIndex = function(docId, callbacksStr, opt_userIndex) {
  logger.debug("getCallbackByUserIndex: docId = %s userIndex = %s callbacks = %s", docId, opt_userIndex, callbacksStr);
  if (!callbacksStr || !callbacksStr.startsWith(UserCallback.prototype.delimiter)) {
    return callbacksStr;
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
