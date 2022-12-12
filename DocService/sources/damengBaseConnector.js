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

const co = require('co');
var sqlBase = require('./baseConnector');
const db = require("dmdb");
const config = require('config');

const cfgDbHost = config.get('services.CoAuthoring.sql.dbHost');
const cfgDbPort = config.get('services.CoAuthoring.sql.dbPort');
const cfgDbUser = config.get('services.CoAuthoring.sql.dbUser');
const cfgDbPass = config.get('services.CoAuthoring.sql.dbPass');
const cfgConnectionlimit = config.get('services.CoAuthoring.sql.connectionlimit');
const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');
var cfgDamengExtraOptions = config.get('services.CoAuthoring.sql.damengExtraOptions');

let pool = null;
let connectString = `dm://${cfgDbUser}:${cfgDbPass}@${cfgDbHost}:${cfgDbPort}`;
let connectionConfig = {
  connectString: connectString,
  poolMax: cfgConnectionlimit,
  poolMin: 0,
  localTimezone: 0
};
config.util.extendDeep(connectionConfig, cfgDamengExtraOptions);

function readLob(lob) {
  return new Promise(function(resolve, reject) {
    var blobData = Buffer.alloc(0);
    var totalLength = 0;
    lob.on('data', function(chunk) {
      totalLength += chunk.length;
      blobData = Buffer.concat([blobData, chunk], totalLength);
    });
    lob.on('error', function(err) {
      reject(err);
    });
    lob.on('end', function() {
      resolve(blobData);
    });
  });
}
function formatResult(result) {
  return co(function *() {
    let res = [];
    if (result?.rows && result ?.metaData) {
      for (let i = 0; i < result.rows.length; ++i) {
        let row = result.rows[i];
        let out = {};
        for (let j = 0; j < result.metaData.length; ++j) {
          let columnName = result.metaData[j].name.toLowerCase();
          if (row[j]?.on) {
            let buf = yield readLob(row[j]);
            out[columnName] = buf.toString('utf8');
          } else {
            out[columnName] = row[j];
          }
        }
        res.push(out);
      }
    }
    return res;
  });
}
exports.sqlQuery = function(ctx, sqlCommand, callbackFunction, opt_noModifyRes, opt_noLog, opt_values) {
  return co(function *() {
    var result = null;
    var output = null;
    var error = null;
    try {
      if (!pool) {
        pool = yield db.createPool(connectionConfig);
      }
      let conn = yield pool.getConnection();
      result = yield conn.execute(sqlCommand, opt_values, {resultSet: false});
      if (conn) {
        yield conn.close();
      }
      output = result;
      if (!opt_noModifyRes) {
        if (result?.rows) {
          output = yield formatResult(result);
        } else if (result?.rowsAffected) {
          output = {affectedRows: result.rowsAffected};
        } else {
          output = {rows: [], affectedRows: 0};
        }
      }
    } catch (err) {
      error = err;
      if (!opt_noLog) {
        ctx.logger.warn('sqlQuery error sqlCommand: %s: %s', sqlCommand.slice(0, 50), err.stack);
      }
    } finally {
      if (callbackFunction) {
        callbackFunction(error, output);
      }
    }
  });
};
let addSqlParam = function (val, values) {
  values.push({val: val});
  return ':' + values.length;
};
exports.addSqlParameter = addSqlParam;
let concatParams = function (val1, val2) {
  return `CONCAT(COALESCE(${val1}, ''), COALESCE(${val2}, ''))`;
};
exports.concatParams = concatParams;

exports.upsert = function(ctx, task, opt_updateUserIndex) {
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
    let p0 = addSqlParam(task.tenant, values);
    let p1 = addSqlParam(task.key, values);
    let p2 = addSqlParam(task.status, values);
    let p3 = addSqlParam(task.statusInfo, values);
    let p4 = addSqlParam(dateNow, values);
    let p5 = addSqlParam(task.userIndex, values);
    let p6 = addSqlParam(task.changeId, values);
    let p7 = addSqlParam(cbInsert, values);
    let p8 = addSqlParam(task.baseurl, values);
    let p9 = addSqlParam(dateNow, values);
    var sqlCommand = `MERGE INTO ${cfgTableResult} USING dual ON (tenant = ${p0} AND id = ${p1}) `;
    sqlCommand += `WHEN NOT MATCHED THEN INSERT (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) `;
    sqlCommand += `VALUES (${p0}, ${p1}, ${p2}, ${p3}, ${p4}, ${p5}, ${p6}, ${p7}, ${p8}) `;
    sqlCommand += `WHEN MATCHED THEN UPDATE SET last_open_date = ${p9}`;
    if (task.callback) {
      let p10 = addSqlParam(JSON.stringify(task.callback), values);
      sqlCommand += `, callback = CONCAT(callback , '${sqlBase.UserCallback.prototype.delimiter}{"userIndex":' , (user_index + 1) , ',"callback":', ${p10}, '}')`;
    }
    if (task.baseurl) {
      let p11 = addSqlParam(task.baseurl, values);
      sqlCommand += `, baseurl = ${p11}`;
    }
    if (opt_updateUserIndex) {
      sqlCommand += ', user_index = user_index + 1';
    }
    sqlCommand += ';';
    sqlCommand += `SELECT user_index FROM ${cfgTableResult} WHERE tenant = ${p0} AND id = ${p1};`;
    exports.sqlQuery(ctx, sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        let out = {affectedRows: 0, insertId: 0};
        if (result?.length > 0) {
          var first = result[0];
          out.affectedRows = task.userIndex !== first.user_index ? 2 : 1;
          out.insertId = first.user_index;
        }
        resolve(out);
      }
    }, undefined, undefined, values);
  });
};
exports.getTableColumns = function(ctx, tableName) {
  //todo
  return new Promise(function(resolve, reject) {
    resolve([]);
  });
};
