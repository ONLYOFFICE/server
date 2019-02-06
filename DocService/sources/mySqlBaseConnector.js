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

var mysql = require('mysql');
var sqlBase = require('./baseConnector');
var configSql = require('config').get('services.CoAuthoring.sql');
var pool  = mysql.createPool({
	host		: configSql.get('dbHost'),
	port		: configSql.get('dbPort'),
	user		: configSql.get('dbUser'),
	password	: configSql.get('dbPass'),
	database	: configSql.get('dbName'),
	charset		: configSql.get('charset'),
	connectionLimit	: configSql.get('connectionlimit'),
	timezone	: '+0000',
	flags : '-FOUND_ROWS'
});
var logger = require('./../../Common/sources/logger');

exports.sqlQuery = function (sqlCommand, callbackFunction) {
	pool.getConnection(function(err, connection) {
		if (err) {
			logger.error('pool.getConnection error: %s', err);
			if (callbackFunction) callbackFunction(err, null);
			return;
		}

		connection.query(sqlCommand, function (error, result) {
			connection.release();
			if (error) {
				logger.error('________________________error_____________________');
				logger.error('sqlQuery: %s sqlCommand: %s', error.code, sqlCommand);
				logger.error(error);
				logger.error('_____________________end_error_____________________');
			}
			if (callbackFunction) callbackFunction(error, result);
		});
	});
};
exports.sqlEscape = function (value) {
	return pool.escape(value);
};
exports.getDateTime = function (oDate) {
    return sqlBase.getDateTime(oDate);
}

function getUpsertString(task, opt_updateUserIndex) {
	task.completeDefaults();
	var dateNow = sqlBase.getDateTime(new Date());
	var commandArg = [task.key, task.status, task.statusInfo, dateNow, task.userIndex, task.changeId, task.callback, task.baseurl];
	var commandArgEsc = commandArg.map(function(curVal) {
		return exports.sqlEscape(curVal)
	});
	var sql = 'INSERT INTO task_result ( id, status, status_info, last_open_date,' +
		' user_index, change_id, callback, baseurl ) VALUES (' + commandArgEsc.join(', ') + ') ON DUPLICATE KEY UPDATE' +
		' last_open_date = ' + exports.sqlEscape(dateNow);
	if (opt_updateUserIndex) {
		sql += ', user_index = LAST_INSERT_ID(user_index + 1);';
	} else {
		sql += ';';
	}
	return sql;
}

exports.upsert = function(task, opt_updateUserIndex) {
	return new Promise(function(resolve, reject) {
		var sqlCommand = getUpsertString(task, opt_updateUserIndex);
		exports.sqlQuery(sqlCommand, function(error, result) {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
};

exports.getExpiredSqlString = function(expireDateStr, maxCount) {
    return 'SELECT * FROM task_result WHERE last_open_date <= ' + expireDateStr +
        ' AND NOT EXISTS(SELECT id FROM doc_changes WHERE doc_changes.id = task_result.id LIMIT 1) LIMIT ' + maxCount;
}
