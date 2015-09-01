var sqlDataBaseType = {
	mySql		: 'mysql',
	postgreSql	: 'postgres'
};

var config = require('config').get('services.CoAuthoring.sql');
var baseConnector = (sqlDataBaseType.mySql === config.get('type')) ? require('./mySqlBaseConnector') : require('./postgreSqlBaseConnector');

var tableChanges = config.get('tableChanges'),
	tableCallbacks = config.get('tableCallbacks'),
	tableResult = config.get('tableResult'),
	tablePucker = config.get('tablePucker');

var g_oCriticalSection = {};
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
	pucker		: 1,
	callbacks	: 2,
	changes		: 3
};
function getTableById (id) {
	var res;
	switch (id) {
		case c_oTableId.pucker:
			res = tablePucker;
			break;
		case c_oTableId.callbacks:
			res = tableCallbacks;
			break;
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
exports.upsertInTable = function (tableId, toInsert, toUpdate, callbackFunction) {
  var table = getTableById(tableId);
  var sqlCommand = "INSERT INTO " + table + " VALUES (";
  for (var i = 0, l = toInsert.length; i < l; ++i) {
    sqlCommand += baseConnector.sqlEscape(toInsert[i]);
    if (i !== l - 1)
      sqlCommand += ",";
  }
  sqlCommand += ") ON DUPLICATE KEY UPDATE ";
  for (var i = 0, l = toUpdate.length; i + 1 < l; i += 2) {
    sqlCommand += toUpdate[i] + "=" + baseConnector.sqlEscape(toUpdate[i+1]);
    if (i + 1 !== l - 1)
      sqlCommand += ",";
  }
  sqlCommand += ";";
  baseConnector.sqlQuery(sqlCommand, callbackFunction);
};
exports.upsertInTablePromise = function (tableId, toInsert, toUpdate) {
  return new Promise(function(resolve, reject) {
    exports.upsertInTable(tableId, toInsert, toUpdate, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.insertInTable = function (tableId, callbackFunction) {
	var table = getTableById(tableId);
	var sqlCommand = "INSERT INTO " + table + " VALUES (";
	for (var i = 2, l = arguments.length; i < l; ++i) {
		sqlCommand += baseConnector.sqlEscape(arguments[i]);
		if (i !== l - 1)
			sqlCommand += ",";
	}
	sqlCommand += ");";

	baseConnector.sqlQuery(sqlCommand, callbackFunction);
};
exports.insertInTablePromise = function () {
  var newArguments = Array.prototype.slice.call(arguments);
  return new Promise(function(resolve, reject) {
    newArguments[1] = function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };
    exports.insertInTable.apply(this, newArguments);
  });
};
exports.insertChanges = function (objChanges, docId, index, user) {
	lockCriticalSection(docId, function () {_insertChanges(0, objChanges, docId, index, user);});
};
exports.insertChangesPromise = function (objChanges, docId, index, user) {
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
			+ baseConnector.sqlEscape(user.name) + "," + baseConnector.sqlEscape(objChanges[i].change) + ","
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
  var sqlCommand = "DELETE FROM " + tableChanges + " WHERE dc_key='" + docId + "'";
  if (null !== deleteIndex)
    sqlCommand += " AND dc_change_id >= " + deleteIndex;
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
exports.getCallback = function(docId, callback) {
  getDataFromTable(c_oTableId.callbacks, "*", "dc_key='" + docId + "'", callback);
};
exports.getCallbackPromise = function(docId) {
  return new Promise(function(resolve, reject) {
    exports.getCallback(docId, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.deleteCallback = function (docId, callback) {
  deleteFromTable(c_oTableId.callbacks, "dc_key='" + docId + "'", callback);
};
exports.deleteCallbackPromise = function (docId) {
  return new Promise(function(resolve, reject) {
    exports.deleteCallback(docId, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.deletePucker = function (docId) {
	deleteFromTable(c_oTableId.pucker, "dp_key='" + docId + "'");
};
exports.getChangesIndex = function(docId, callback) {
  var table = getTableById(c_oTableId.changes);
  var sqlCommand = 'SELECT MAX(dc_change_id) as dc_change_id FROM ' + table + ' WHERE dc_key=' + baseConnector.sqlEscape(docId) + ';';
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
exports.getChangesPromise = function (docId, optStartIndex, optEndIndex) {
  return new Promise(function(resolve, reject) {
    var getCondition = 'dc_key='+baseConnector.sqlEscape(docId);
    if (null != optStartIndex && null != optEndIndex) {
      getCondition += ' AND dc_change_id>=' + optStartIndex + ' AND dc_change_id<' + optEndIndex;
    }
    getDataFromTable(c_oTableId.changes, "*", getCondition, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.getChanges = function (docId, callback) {
	lockCriticalSection(docId, function () {_getChanges(docId, callback);});
};
function _getChanges (docId, callback) {
	getDataFromTable(c_oTableId.changes, "*", "dc_key='" + docId + "'",
		function (error, result) {unLockCriticalSection(docId); if (callback) callback(error, result);});
}

exports.checkStatusFile = function (docId, callbackFunction) {
	var sqlCommand = "SELECT tr_status FROM " + tableResult + " WHERE tr_key='" + docId + "';";
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
	var sqlCommand = "UPDATE " + tableResult + " SET tr_status=1 WHERE tr_key='" + docId + "';";
	baseConnector.sqlQuery(sqlCommand);
};

exports.updateIndexUser = function (docId, indexUser) {
	var sqlCommand = "UPDATE " + tablePucker + " SET dp_indexUser=" + indexUser + " WHERE dp_key='" + docId + "' AND dp_indexUser<" + indexUser + ";";
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