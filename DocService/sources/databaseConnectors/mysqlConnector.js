/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
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

const mysql = require('mysql2/promise');
const connectorUtilities = require('./connectorUtilities');
const config = require('config');

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = configSql.get('tableResult');

const connectionConfiguration = {
  host		: configSql.get('dbHost'),
  port		: parseInt(configSql.get('dbPort')),
  user		: configSql.get('dbUser'),
  password	: configSql.get('dbPass'),
  database	: configSql.get('dbName'),
  charset		: configSql.get('charset'),
  connectionLimit	: configSql.get('connectionlimit'),
  timezone	: 'Z',
  flags : '-FOUND_ROWS'
};

const additionalOptions = configSql.get('mysqlExtraOptions');
const configuration = Object.assign({}, connectionConfiguration, additionalOptions);
let queryTimeout = undefined;
if (configuration.queryTimeout) {
  queryTimeout = configuration.queryTimeout;
  delete configuration.queryTimeout;
}

const pool = mysql.createPool(configuration);

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = []) {
  return executeQuery(ctx, sqlCommand, opt_values, opt_noModifyRes, opt_noLog).then(
    result => callbackFunction?.(null, result),
    error => callbackFunction?.(error)
  );
}

async function executeQuery(ctx, sqlCommand, values = [], noModifyRes = false, noLog = false) {
  let connection = null;
  try {
    connection = await pool.getConnection();

    const result = await connection.query({ sql: sqlCommand, timeout: queryTimeout, values });

    let output;
    if (!noModifyRes) {
      output = result[0]?.affectedRows ? { affectedRows: result[0].affectedRows } : result[0];
    } else {
      output = result[0];
    }

    return output ?? { rows: [], affectedRows: 0 };
  } catch (error) {
    if (!noLog) {
      ctx.logger.error(`sqlQuery() error while executing query: ${sqlCommand}\n${error.stack}`);
    }

    throw error;
  } finally {
    if (connection) {
      try {
        // Put the connection back in the pool
        connection.release();
      } catch (error) {
        if (!noLog) {
          ctx.logger.error(`connection.release() error while executing query: ${sqlCommand}\n${error.stack}`);
        }
      }
    }
  }
}

async function closePool() {
  return await pool.end();
}

function addSqlParameter(parameter, accumulatedArray) {
  accumulatedArray.push(parameter);
  return '?';
}

function concatParams(firstParameter, secondParameter) {
  return `CONCAT(COALESCE(${firstParameter}, ''), COALESCE(${secondParameter}, ''))`;
}

async function upsert(ctx, task) {
  task.completeDefaults();
  const dateNow = new Date();

  let cbInsert = task.callback;
  if (task.callback) {
    const userCallback = new connectorUtilities.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
  }

  const values = [];
  const valuesPlaceholder = [
    addSqlParameter(task.tenant, values),
    addSqlParameter(task.key, values),
    addSqlParameter(task.status, values),
    addSqlParameter(task.statusInfo, values),
    addSqlParameter(dateNow, values),
    addSqlParameter(task.userIndex, values),
    addSqlParameter(task.changeId, values),
    addSqlParameter(cbInsert, values),
    addSqlParameter(task.baseurl, values)
  ];

  let updateStatement = `last_open_date = ${addSqlParameter(dateNow, values)}`;
  if (task.callback) {
    let callbackPlaceholder = addSqlParameter(JSON.stringify(task.callback), values);
    updateStatement += `, callback = CONCAT(callback , '${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":' , (user_index + 1) , ',"callback":', ${callbackPlaceholder}, '}')`;
  }

  if (task.baseurl) {
    let baseUrlPlaceholder = addSqlParameter(task.baseurl, values);
    updateStatement += `, baseurl = ${baseUrlPlaceholder}`;
  }

  updateStatement += ', user_index = LAST_INSERT_ID(user_index + 1);';

  const sqlCommand = `INSERT INTO ${cfgTableResult} (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) `+
    `VALUES (${valuesPlaceholder.join(', ')}) ` +
    `ON DUPLICATE KEY UPDATE ${updateStatement}`;

  const result = await executeQuery(ctx, sqlCommand, values, true);
  const insertId = result.affectedRows === 1 ? task.userIndex : result.insertId;
  //if CLIENT_FOUND_ROWS don't specify 1 row is inserted , 2 row is updated, and 0 row is set to its current values
  //http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
  const isInsert = result.affectedRows === 1;

  return { isInsert, insertId };
}

module.exports.sqlQuery = sqlQuery;
module.exports.closePool = closePool;
module.exports.addSqlParameter = addSqlParameter;
module.exports.concatParams = concatParams;
module.exports.upsert = upsert;
