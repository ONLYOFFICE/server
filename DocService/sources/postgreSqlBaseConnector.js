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

var pg = require('pg');
var co = require('co');
var pgEscape = require('pg-escape');
var types = require('pg').types;
var sqlBase = require('./baseConnector');
var configSql = require('config').get('services.CoAuthoring.sql');
var pool = new pg.Pool({
  host: configSql.get('dbHost'),
  port: configSql.get('dbPort'),
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  database: configSql.get('dbName'),
  max: configSql.get('connectionlimit'),
  min: 0,
  ssl: false,
  idleTimeoutMillis: 30000
});
//todo datetime timezone
types.setTypeParser(1114, function(stringValue) {
  return new Date(stringValue + '+0000');
});
types.setTypeParser(1184, function(stringValue) {
  return new Date(stringValue + '+0000');
});

var logger = require('./../../Common/sources/logger');

var maxPacketSize = configSql.get('max_allowed_packet');

exports.sqlQuery = function(sqlCommand, callbackFunction, opt_noModifyRes, opt_noLog, opt_values) {
  co(function *() {
    var result = null;
    var error = null;
    try {
      result = yield pool.query(sqlCommand, opt_values);
    } catch (err) {
      error = err;
      if (!opt_noLog) {
        logger.warn('sqlQuery error sqlCommand: %s:\r\n%s', sqlCommand.slice(0, 50), err.stack);
      }
    } finally {
      if (callbackFunction) {
        var output = result;
        if (result && !opt_noModifyRes) {
          if ('SELECT' === result.command) {
            output = result.rows;
          } else {
            output = {affectedRows: result.rowCount};
          }
        }
        callbackFunction(error, output);
      }
    }
  });
};
exports.sqlEscape = function(value) {
  //todo parameterized queries
  return undefined !== value ? pgEscape.literal(value.toString()) : 'NULL';
};
var isSupportOnConflict = true;

function getUpsertString(task) {
  task.completeDefaults();
  var dateNow = sqlBase.getDateTime(new Date());
  var cbInsert = task.callback, cbUpdate = '';
  if (isSupportOnConflict && task.callback) {
    var userCallback = new sqlBase.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
    cbUpdate = ", callback = task_result.callback || " + exports.sqlEscape(userCallback.delimiter + '{"userIndex":') +
      " || (task_result.user_index + 1) || " + exports.sqlEscape(',"callback":' + JSON.stringify(userCallback.callback) + '}');
  }
  var commandArg = [task.key, task.status, task.statusInfo, dateNow, task.userIndex, task.changeId, cbInsert, task.baseurl];
  var commandArgEsc = commandArg.map(function(curVal) {
    return exports.sqlEscape(curVal)
  });
  if (isSupportOnConflict) {
    //http://stackoverflow.com/questions/34762732/how-to-find-out-if-an-upsert-was-an-update-with-postgresql-9-5-upsert
    return "INSERT INTO task_result (id, status, status_info, last_open_date, user_index, change_id, callback," +
      " baseurl) SELECT " + commandArgEsc.join(', ') + " WHERE 'false' = set_config('myapp.isupdate', 'false', true) " +
      "ON CONFLICT (id) DO UPDATE SET  last_open_date = " +
      sqlBase.baseConnector.sqlEscape(dateNow) + cbUpdate +
      ", user_index = task_result.user_index + 1 WHERE 'true' = set_config('myapp.isupdate', 'true', true) RETURNING" +
      " current_setting('myapp.isupdate') as isupdate, user_index as userindex;";
  } else {
    return "SELECT * FROM merge_db(" + commandArgEsc.join(', ') + ");";
  }
}
exports.upsert = function(task) {
  return new Promise(function(resolve, reject) {
    var sqlCommand = getUpsertString(task);
    exports.sqlQuery(sqlCommand, function(error, result) {
      if (error) {
        if (isSupportOnConflict && '42601' == error.code) {
          //SYNTAX ERROR
          isSupportOnConflict = false;
          logger.warn('checkIsSupportOnConflict false');
          resolve(exports.upsert(task));
        } else {
          reject(error);
        }
      } else {
        if (result && result.rows.length > 0) {
          var first = result.rows[0];
          result = {affectedRows: 0, insertId: 0};
          result.affectedRows = 'true' == first.isupdate ? 2 : 1;
          result.insertId = first.userindex;
        }
        resolve(result);
      }
    }, true);
  });
};
exports.insertChanges = function(tableChanges, startIndex, objChanges, docId, index, user, callback) {
  let i = startIndex;
  if (i >= objChanges.length) {
    return;
  }
  let isSupported = true;
  let id = [];
  let changeId = [];
  let userId = [];
  let userIdOriginal = [];
  let username = [];
  let change = [];
  let time = [];
  //Postgres 9.4 multi-argument unnest
  let sqlCommand = `INSERT INTO ${tableChanges} (id, change_id, user_id, user_id_original, user_name, change_data, change_date) `;
  sqlCommand += "SELECT * FROM UNNEST ($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamp[]);";
  let values = [id, changeId, userId, userIdOriginal, username, change, time];
  let curLength = sqlCommand.length;
  for (; i < objChanges.length; ++i) {
    //4 is max utf8 bytes per symbol
    curLength += 4 * (docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[i].change.length) + 4 + 8;
    if (curLength >= maxPacketSize && i > startIndex) {
      exports.sqlQuery(sqlCommand, function(error, output) {
        if (error && '42883' == error.code) {
          isSupported = false;
          logger.warn('postgresql does not support UNNEST');
        }
        if (error) {
          callback(error, output, isSupported);
        } else {
          exports.insertChanges(tableChanges, i, objChanges, docId, index, user, callback);
        }
      }, undefined, undefined, values);
      return;
    }
    id.push(docId);
    changeId.push(index++);
    userId.push(user.id);
    userIdOriginal.push(user.idOriginal);
    username.push(user.username);
    change.push(objChanges[i].change);
    time.push(objChanges[i].time);
  }
  exports.sqlQuery(sqlCommand, function(error, output) {
    if (error && '42883' == error.code) {
      isSupported = false;
      logger.warn('postgresql does not support UNNEST');
    }
    callback(error, output, isSupported);
  }, undefined, undefined, values);
};
