var sqlDataBaseType = {
	mySql		: 'mysql',
	postgreSql	: 'postgres'
};

var config = require('./config.json');
var configSql = config['sql'];
var baseConnector = (sqlDataBaseType.mySql === configSql['type']) ? require('./mySqlBaseConnector') : require('./postgreSqlBaseConnector');

var tableChanges = configSql['tableChanges'],
	tableCallbacks = configSql['tableCallbacks'],
	tableResult = configSql['tableResult'],
	tablePucker = configSql['tablePucker'];

var g_oCriticalSection = {}, lockTimeOut = 200;
var maxPacketSize = configSql['max_allowed_packet']; // Размер по умолчанию для запроса в базу данных 1Mb

function getDataFromTable (tableId, data, getCondition, callback) {
	var table = getTableById(tableId);
	var sqlCommand = "SELECT " + data + " FROM " + table + " WHERE " + getCondition + ";";

	baseConnector.sqlQuery(sqlCommand, callback);
}
function deleteFromTable (tableId, deleteCondition) {
	var table = getTableById(tableId);
	var sqlCommand = "DELETE FROM " + table + " WHERE " + deleteCondition + ";";

	baseConnector.sqlQuery(sqlCommand);
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

exports.tableId = c_oTableId;
exports.loadTable = function (tableId, callbackFunction) {
	var table = getTableById(tableId);
	var sqlCommand = "SELECT * FROM " + table + ";";
	baseConnector.sqlQuery(sqlCommand, callbackFunction);
};
exports.insertInTable = function (tableId) {
	var table = getTableById(tableId);
	var sqlCommand = "INSERT INTO " + table + " VALUES (";
	for (var i = 1, l = arguments.length; i < l; ++i) {
		sqlCommand += "'" + arguments[i] + "'";
		if (i !== l - 1)
			sqlCommand += ",";
	}
	sqlCommand += ");";

	baseConnector.sqlQuery(sqlCommand);
};
exports.insertChanges = function (objChanges, docId, index, user) {
	lockCriticalSection(docId, function () {_insertChanges(0, objChanges, docId, index, user);});
};
function _lengthInUtf8Bytes (s) {
	return ~-encodeURI(s).split(/%..|./).length;
}
function _getDateTime(nTime) {
	var oDate = new Date(nTime);
	return oDate.getUTCFullYear() + '-' + ('0' + (oDate.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + oDate.getUTCDate()).slice(-2)
		+ ' ' + ('0' + oDate.getUTCHours()).slice(-2) + ':' + ('0' + oDate.getUTCMinutes()).slice(-2) + ':'
		+ ('0' + oDate.getUTCSeconds()).slice(-2);
}
function _insertChanges (startIndex, objChanges, docId, index, user) {
	var sqlCommand = "INSERT INTO " + tableChanges + " VALUES";
	var i = startIndex, l = objChanges.length, sqlNextRow = "", lengthUtf8Current = 0, lengthUtf8Row = 0;
	if (i === l)
		return;

	for (; i < l; ++i, ++index) {
		sqlNextRow = "('" + docId + "','" + index + "','" + user.id + "','" + user.idOriginal + "','"
			+ user.name + "','" + objChanges[i].change + "','" + _getDateTime(objChanges[i].time) + "')";
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
						_insertChanges(tmpStart, objChanges, docId, tmpIndex, user);
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
	baseConnector.sqlQuery(sqlCommand, function () {unLockCriticalSection(docId);});
}

exports.deleteChanges = function (docId, deleteIndex) {
	lockCriticalSection(docId, function () {_deleteChanges(docId, deleteIndex);});
};
function _deleteChanges (docId, deleteIndex) {
	var sqlCommand = "DELETE FROM " + tableChanges + " WHERE dc_key='" + docId + "'";
	if (null !== deleteIndex)
		sqlCommand += " AND dc_change_id >= " + deleteIndex;
	sqlCommand += ";";
	baseConnector.sqlQuery(sqlCommand, function () {unLockCriticalSection(docId);});
}
exports.deleteCallback = function (docId) {
	deleteFromTable(c_oTableId.callbacks, "dc_key='" + docId + "'");
};
exports.deletePucker = function (docId) {
	deleteFromTable(c_oTableId.pucker, "dp_key='" + docId + "'");
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
exports.updateStatusFile = function (docId) {
	// Статус OK = 1
	var sqlCommand = "UPDATE " + tableResult + " SET tr_status=1 WHERE tr_key='" + docId + "';";
	baseConnector.sqlQuery(sqlCommand);
};

exports.updateIndexUser = function (docId, indexUser) {
	var sqlCommand = "UPDATE " + tablePucker + " SET dp_indexUser=" + indexUser + " WHERE dp_key='" + docId + "' AND dp_indexUser<" + indexUser + ";";
	baseConnector.sqlQuery(sqlCommand);
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