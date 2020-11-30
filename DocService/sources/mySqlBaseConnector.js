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

exports.sqlQuery = function (sqlCommand, callbackFunction, opt_noModifyRes, opt_noLog, opt_values) {
	pool.getConnection(function(err, connection) {
		if (err) {
			logger.error('pool.getConnection error: %s', err);
			if (callbackFunction) callbackFunction(err, null);
			return;
		}
		let queryCallback = function (error, result) {
			connection.release();
			if (error) {
				logger.error('________________________error_____________________');
				logger.error('sqlQuery: %s sqlCommand: %s', error.code, sqlCommand);
				logger.error(error);
				logger.error('_____________________end_error_____________________');
			}
			if (callbackFunction) callbackFunction(error, result);
		};
		if(opt_values){
			connection.query(sqlCommand, opt_values, queryCallback);
		} else {
			connection.query(sqlCommand, queryCallback);
		}
	});
};
let addSqlParam = function (val, values) {
	values.push(val);
	return '?';
};
exports.addSqlParameter = addSqlParam;
let concatParams = function (val1, val2) {
  return `CONCAT(${val1}, ${val2})`;
};
exports.concatParams = concatParams;

exports.upsert = function(task, opt_updateUserIndex) {
	return new Promise(function(resolve, reject) {
		task.completeDefaults();
		let dateNow = new Date();
		let values = [];
		let cbInsert = task.callback;
		if (task.callback) {
			let userCallback = new sqlBase.UserCallback();
			userCallback.fromValues(task.userIndex, task.callback);
			cbInsert = userCallback.toSQLInsert();
		}
		let p1 = addSqlParam(task.key, values);
		let p2 = addSqlParam(task.status, values);
		let p3 = addSqlParam(task.statusInfo, values);
		let p4 = addSqlParam(dateNow, values);
		let p5 = addSqlParam(task.userIndex, values);
		let p6 = addSqlParam(task.changeId, values);
		let p7 = addSqlParam(cbInsert, values);
		let p8 = addSqlParam(task.baseurl, values);
		let p9 = addSqlParam(task.password, values);
		let pDate = addSqlParam(dateNow, values);
		var sqlCommand = 'INSERT INTO task_result (id, status, status_info, last_open_date, user_index, change_id, callback, baseurl, password)'+
			` VALUES (${p1}, ${p2}, ${p3}, ${p4}, ${p5}, ${p6}, ${p7}, ${p8}, ${p9}) ON DUPLICATE KEY UPDATE` +
			` last_open_date = ${pDate}`;
		if (task.callback) {
			let pCallback = addSqlParam(JSON.stringify(task.callback), values);
			sqlCommand += `, callback = CONCAT(callback , '${sqlBase.UserCallback.prototype.delimiter}{"userIndex":' , (user_index + 1) , ',"callback":', ${pCallback}, '}')`;
		}
		if (task.baseurl) {
			let pBaseurl = addSqlParam(task.baseurl, values);
			sqlCommand += `, baseurl = ${pBaseurl}`;
		}
		if (opt_updateUserIndex) {
			sqlCommand += ', user_index = LAST_INSERT_ID(user_index + 1)';
		}
		sqlCommand += ';';

		exports.sqlQuery(sqlCommand, function(error, result) {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		}, undefined, undefined, values);
	});
};
