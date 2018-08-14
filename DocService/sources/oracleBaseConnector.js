/*
 * (c) Copyright Short Consulting AG 2018
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

var oracledb = require('oracledb');
var sqlBase = require('./baseConnector');
var sqlString = require('./oracleSqlString');
var configSql = require('config').get('services.CoAuthoring.sql');
// Node-oracledb has an internal connection pool cache which can be used to facilitate sharing pools across modules. No need to have a local variable
oracledb.createPool({
	connectString	: configSql.get('dbHost'),
	user			: configSql.get('dbUser'),
	password		: configSql.get('dbPass'),
	poolMax			: configSql.get('connectionlimit')
});
var logger = require('./../../Common/sources/logger');

function objToLowerCase(src){
	if (!src) return src;
	var res = Object.keys(src).reduce(function(res, key){
		res[key.toLowerCase()] = src[key];
		return res;
	}, {});
	return res;
}

exports.sqlQuery = function (sqlCommand, callbackFunction) {
    oracledb.getConnection(function(err, connection) {
		if (err) {
			logger.error('pool.getConnection error: %s', err);
			if (callbackFunction) callbackFunction(err, null);
			return;
		}

		logger.debug("Executed query on Oracle: " + sqlCommand);

		// outFormat: oracledb.OBJECT used to get JSON objects in select result otherwise it is simple Array[of Arrays] without column names
		// oracledb.fetchAsBuffer = [ oracledb.BLOB ] - to load BLOB as bytes but not as object
		connection.execute(sqlCommand, [], {outFormat: oracledb.OBJECT,
											fetchInfo: {
												'CHANGE_DATA': {
                                                    type: oracledb.STRING
                                                }
                                            }
                                            },
											function (error, result) {
			if (error) {
				logger.error('________________________error_____________________');
				logger.error('sqlQuery: %s sqlCommand: %s', error.code, sqlCommand);
				logger.error(error);
				logger.error('_____________________end_error_____________________');
			} else {
                connection.commit();
			}

			if (callbackFunction) {
                var output = result;
                if (result) {
                    if (result.rows) {
                        output = result.rows.map(objToLowerCase);
                    } else {
                        output = {affectedRows: result.rowsAffected};
                    }
                }

				callbackFunction(error, output);
            }

            doRelease(connection);
		});
	});

    function doRelease(connection) {
        // No need to release it, only when server is killed or shutdown
        if (connection) {
            connection.close(
                function (err) {
                    if (err)
                        console.error(err.message);
                });
    	} else {
        	logger.error('ORACLE CONN CANNOT BE CLOSED')
		}
    }
};

exports.sqlEscape = function sqlEscape(value) {
	// As Oracle does not support escaping, we just use escaping via SqlString used in Mysql
    return sqlString.escape(value, true, 'local');
};

exports.getDateTime = function (oDate) {
	return oDate;
};

function getUpsertString(task, opt_updateUserIndex) {
	task.completeDefaults();
	var dateNow = new Date();
	var commandArg = [task.key, task.status, task.statusInfo, dateNow, task.userIndex, task.changeId, task.callback, task.baseurl];
	var commandArgEsc = commandArg.map(function(curVal) {
		return exports.sqlEscape(curVal)
	});
    var sql = "MERGE INTO task_result tr" +
		" USING (SELECT " + exports.sqlEscape(task.key) + " id FROM DUAL) tr2"+
		" ON (tr.id = tr2.id)" +
        " WHEN MATCHED THEN" +
		"	UPDATE SET tr.last_open_date = " + exports.sqlEscape(dateNow);

    	if (opt_updateUserIndex) {
        	sql += ", user_index = " + (task.userIndex + 1);
    	}

    	sql += " WHEN NOT MATCHED THEN" +
		"	INSERT ( id, status, status_info, last_open_date, user_index, change_id, callback, baseurl)"+
		"	VALUES (" + commandArgEsc.join(', ') + ")";

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
        ' AND NOT EXISTS(SELECT id FROM doc_changes WHERE doc_changes.id = task_result.id AND ROWNUM <= 1) AND ROWNUM <= ' + maxCount;
};

exports.insertChangesCallback = function(tableChanges, startIndex, objChanges, docId, index, user, callback) {
	var sqlCommand = "INSERT INTO " + tableChanges + " WITH temp AS (";
    var i = startIndex, l = objChanges.length, sqlNextRow = "";
    if (i === l)
        return;

    for (; i < l; i++, ++index) {
		if (i > startIndex) {
			sqlCommand += " UNION ALL ";
		}
        sqlCommand += "SELECT " + exports.sqlEscape(docId) + " ID," + exports.sqlEscape(index) + " CHANGE_ID,"
            + exports.sqlEscape(user.id) + " USER_ID," + exports.sqlEscape(user.idOriginal) + " USER_ID_ORIGINAL,"
            + exports.sqlEscape(user.username) + " USER_NAME," + exports.sqlEscape(objChanges[i].change) + " CHANGE_DATA,"
            + exports.sqlEscape(new Date(objChanges[i].time)) + " CHANGE_DATE FROM dual";
    }

    sqlCommand += ") select ID, CHANGE_ID, USER_ID, USER_ID_ORIGINAL, USER_NAME, CHANGE_DATA, CHANGE_DATE from temp";

    exports.sqlQuery(sqlCommand, callback);
};
