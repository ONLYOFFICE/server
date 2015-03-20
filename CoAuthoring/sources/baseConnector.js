var sqlDataBaseType = {
	mySql		: "mysql",
	postgreSql	: "postgres"
};

var config = require('./config.json');
var configSql = config["sql"];
var baseConnector = (sqlDataBaseType.mySql === configSql["type"]) ? require('./mySqlBaseConnector') : require('./postgreSqlBaseConnector');

var tableChanges = configSql["tableChanges"],
	tableCallbacks = configSql["tableCallbacks"],
	tableResult = configSql["tableResult"],
	tablePucker = configSql["tablePucker"];

var g_oCriticalSection = {}, lockTimeOut = 200;
var maxPacketSize = 1024 * 1024 - 400; // Размер по умолчанию для запроса в базу данных (вычли 400 на поля)

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
exports.insertChanges = function (objChanges, docId, index, userId, userIdOriginal) {
	lockCriticalSection(docId, function () {_insertChanges(0, objChanges, docId, index, userId, userIdOriginal);});
};
function _getDateTime(nTime) {
	var oDate = new Date(nTime);
	return oDate.getUTCFullYear() + '-' + ('0' + (oDate.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + oDate.getUTCDate()).slice(-2)
		+ ' ' + ('0' + oDate.getUTCHours()).slice(-2) + ':' + ('0' + oDate.getUTCMinutes()).slice(-2) + ':'
		+ ('0' + oDate.getUTCSeconds()).slice(-2);
}
function _insertChanges (startIndex, objChanges, docId, index, user) {
	var sqlCommand = "INSERT INTO " + tableChanges + " VALUES";
	for (var i = startIndex, l = objChanges.length; i < l; ++i, ++index) {
		sqlCommand += "('" + docId + "','" + index + "','" + user.id + "','" + user.idOriginal + "','"
			+ user.name + "','" + objChanges[i].change + "','" + _getDateTime(objChanges[i].time) + "')";
		if (i === l - 1)
			sqlCommand += ';';
		else if (sqlCommand.length + objChanges[i + 1].change.length >= maxPacketSize) {
			sqlCommand += ';';
			(function (tmpStart, tmpIndex) {
				baseConnector.sqlQuery(sqlCommand, function () {
					// lock не снимаем, а продолжаем добавлять
					_insertChanges(tmpStart, objChanges, docId, tmpIndex, user);
				});
			})(i + 1, index + 1);
			return;
		} else
			sqlCommand += ',';
	}
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

// Критическая секция
function lockCriticalSection (id, callback) {
	if (g_oCriticalSection[id]) {
		// Ждем
		setTimeout(function () {lockCriticalSection(id, callback);}, lockTimeOut);
		return;
	}
	// Ставим lock
	g_oCriticalSection[id] = true;
	callback();
}
function unLockCriticalSection (id) {
	delete g_oCriticalSection[id];
}