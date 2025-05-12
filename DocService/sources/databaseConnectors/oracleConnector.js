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

import oracledb from 'oracledb';
import config from 'config';
import * as connectorUtilities from './connectorUtilities.js';
import * as utils from '../../../Common/sources/utils.js';

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = configSql.get('tableResult');
const cfgTableChanges = configSql.get('tableChanges');
const cfgMaxPacketSize = configSql.get('max_allowed_packet');

const connectionConfiguration = {
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  connectString: `${configSql.get('dbHost')}:${configSql.get('dbPort')}/${configSql.get('dbName')}`,
  poolMin: 0,
  poolMax: configSql.get('connectionlimit')
};
const additionalOptions = config.util.cloneDeep(configSql.get('oracleExtraOptions'));
const configuration = Object.assign({}, connectionConfiguration, additionalOptions);
const forceClosingCountdownMs = 2000;
let pool = null;

oracledb.fetchAsString = [ oracledb.NCLOB, oracledb.CLOB ];
oracledb.autoCommit = true;

function columnsToLowercase(rows) {
  const formattedRows = [];
  for (const row of rows) {
    const newRow = {};
    for (const column in row) {
      if (row.hasOwnProperty(column)) {
        newRow[column.toLowerCase()] = row[column];
      }
    }

    formattedRows.push(newRow);
  }

  return formattedRows;
}

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = []) {
  return executeQuery(ctx, sqlCommand, opt_values, opt_noModifyRes, opt_noLog).then(
    result => callbackFunction?.(null, result),
    error => callbackFunction?.(error)
  );
}

async function executeQuery(ctx, sqlCommand, values = [], noModifyRes = false, noLog = false) {
  // Query must not have any ';' in oracle connector.
  const correctedSql = sqlCommand.replace(/;/g, '');

  let connection = null;
  try {
    if (!pool) {
      pool = await oracledb.createPool(configuration);
    }

    connection = await pool.getConnection();

    const bondedValues = values ?? [];
    const outputFormat = { outFormat: !noModifyRes ? oracledb.OUT_FORMAT_OBJECT : oracledb.OUT_FORMAT_ARRAY };
    const result = await connection.execute(correctedSql, bondedValues, outputFormat);

    let output = { rows: [], affectedRows: 0 };
    if (!noModifyRes) {
      if (result?.rowsAffected) {
        output = { affectedRows: result.rowsAffected };
      }

      if (result?.rows) {
        output = columnsToLowercase(result.rows);
      }
    } else {
      output = result;
    }

    return output;
  } catch (error) {
    if (!noLog) {
      ctx.logger.error(`sqlQuery() error while executing query: ${sqlCommand}\n${error.stack}`);
    }

    throw error;
  } finally {
    if (connection) {
      try {
        // Put the connection back in the pool
        await connection.close();
      } catch (error) {
        if (!noLog) {
          ctx.logger.error(`connection.close() error while executing query: ${sqlCommand}\n${error.stack}`);
        }
      }
    }
  }
}

async function executeBunch(ctx, sqlCommand, values = [], noLog = false) {
  let connection = null;
  try {
    if (!pool) {
      pool = await oracledb.createPool(configuration);
    }

    connection = await pool.getConnection();
    
    const result = await connection.executeMany(sqlCommand, values);

    return { affectedRows: result?.rowsAffected ?? 0 };
  } catch (error) {
    if (!noLog) {
      ctx.logger.error(`sqlQuery() error while executing query: ${sqlCommand}\n${error.stack}`);
    }

    throw error;
  } finally {
    connection?.close();
  }
}

function closePool() {
  return pool?.close(forceClosingCountdownMs);
}

function healthCheck(ctx) {
  return executeQuery(ctx, 'SELECT 1 FROM DUAL');
}

function addSqlParameter(parameter, accumulatedArray) {
  const currentIndex = accumulatedArray.push(parameter) - 1;
  return `:${currentIndex}`;
}

function concatParams(firstParameter, secondParameter) {
  return `${firstParameter} || ${secondParameter} || ''`;
}

function getTableColumns(ctx, tableName) {
  let values = [];
  let sqlParam = addSqlParameter(tableName.toUpperCase(), values);
  return executeQuery(ctx, `SELECT LOWER(column_name) AS column_name FROM user_tab_columns WHERE table_name = ${sqlParam}`, values);
}

function getEmptyCallbacks(ctx) {
  const joinCondition = 'ON t2.tenant = t1.tenant AND t2.id = t1.id AND t2.callback IS NULL';
  const sqlCommand = `SELECT DISTINCT t1.tenant, t1.id FROM ${cfgTableChanges} t1 INNER JOIN ${cfgTableResult} t2 ${joinCondition}`;
  return executeQuery(ctx, sqlCommand);
}

function getDocumentsWithChanges(ctx) {
  const existingId = `SELECT id FROM ${cfgTableChanges} WHERE tenant=${cfgTableResult}.tenant AND id = ${cfgTableResult}.id AND ROWNUM <= 1`;
  const sqlCommand = `SELECT * FROM ${cfgTableResult} WHERE EXISTS(${existingId})`;

  return executeQuery(ctx, sqlCommand);
}

function getExpired(ctx, maxCount, expireSeconds) {
  const expireDate = new Date();
  utils.addSeconds(expireDate, -expireSeconds);

  const values = [];
  const date = addSqlParameter(expireDate, values);
  const count = addSqlParameter(maxCount, values);
  const notExistingTenantAndId = `SELECT tenant, id FROM ${cfgTableChanges} WHERE ${cfgTableChanges}.tenant = ${cfgTableResult}.tenant AND ${cfgTableChanges}.id = ${cfgTableResult}.id AND ROWNUM <= 1`
  const sqlCommand = `SELECT * FROM ${cfgTableResult} WHERE last_open_date <= ${date} AND NOT EXISTS(${notExistingTenantAndId}) AND ROWNUM <= ${count}`;

  return executeQuery(ctx, sqlCommand, values);
}

function makeUpdateSql(dateNow, task, values) {
  const lastOpenDate = addSqlParameter(dateNow, values);

  let callback = '';
  if (task.callback) {
    const parameter = addSqlParameter(JSON.stringify(task.callback), values);
    callback = `, callback = callback || '${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":' || (user_index + 1) || ',"callback":' || ${parameter} || '}'`;
  }

  let baseUrl = '';
  if (task.baseurl) {
    const parameter = addSqlParameter(task.baseurl, values);
    baseUrl = `, baseurl = ${parameter}`;
  }

  const userIndex = ', user_index = user_index + 1';

  const updateQuery = `last_open_date = ${lastOpenDate}${callback}${baseUrl}${userIndex}`;
  const tenant = addSqlParameter(task.tenant, values);
  const id = addSqlParameter(task.key, values);
  const condition = `tenant = ${tenant} AND id = ${id}`;

  const returning = addSqlParameter({ type: oracledb.NUMBER, dir: oracledb.BIND_OUT }, values);

  return `UPDATE ${cfgTableResult} SET ${updateQuery} WHERE ${condition} RETURNING user_index INTO ${returning}`;
}

function getReturnedValue(returned) {
  return returned?.outBinds?.pop()?.pop();
}

async function upsert(ctx, task) {
  task.completeDefaults();

  let cbInsert = task.callback;
  if (task.callback) {
    const userCallback = new connectorUtilities.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
  }

  const dateNow = new Date();

  const insertValues = [];
  const insertValuesPlaceholder = [
    addSqlParameter(task.tenant, insertValues),
    addSqlParameter(task.key, insertValues),
    addSqlParameter(task.status, insertValues),
    addSqlParameter(task.statusInfo, insertValues),
    addSqlParameter(dateNow, insertValues),
    addSqlParameter(task.userIndex, insertValues),
    addSqlParameter(task.changeId, insertValues),
    addSqlParameter(cbInsert, insertValues),
    addSqlParameter(task.baseurl, insertValues)
  ];

  const returned = addSqlParameter({ type: oracledb.NUMBER, dir: oracledb.BIND_OUT }, insertValues);
  let sqlInsertTry = `INSERT INTO ${cfgTableResult} (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) `
    + `VALUES(${insertValuesPlaceholder.join(', ')}) RETURNING user_index INTO ${returned}`;

  try {
    const insertResult = await executeQuery(ctx, sqlInsertTry, insertValues, true, true);
    const insertId = getReturnedValue(insertResult);

    return { isInsert: true, insertId };
  } catch (insertError) {
    if (insertError.code !== 'ORA-00001') {
      throw insertError;
    }

    const values = [];
    const updateResult = await executeQuery(ctx, makeUpdateSql(dateNow, task, values), values, true);
    const insertId = getReturnedValue(updateResult);

    return { isInsert: false, insertId };
  }
}

function insertChanges(ctx, tableChanges, startIndex, objChanges, docId, index, user, callback) {
  insertChangesAsync(ctx, tableChanges, startIndex, objChanges, docId, index, user).then(
    result => callback(null, result, true),
    error => callback(error, null, true)
  );
}

async function insertChangesAsync(ctx, tableChanges, startIndex, objChanges, docId, index, user) {
  if (startIndex === objChanges.length) {
    return { affectedRows: 0 };
  }

  const parametersCount = 8;
  const maxPlaceholderLength = ':99'.length;
  // (parametersCount - 1) - separator symbols length.
  const maxInsertStatementLength = `INSERT /*+ APPEND_VALUES*/INTO ${tableChanges} VALUES()`.length + maxPlaceholderLength * parametersCount + (parametersCount - 1);
  let packetCapacityReached = false;

  const values = [];
  const indexBytes = 4;
  const timeBytes = 8;
  let lengthUtf8Current = 0;
  let currentIndex = startIndex;
  for (; currentIndex < objChanges.length; ++currentIndex, ++index) {
    // 4 bytes is maximum for utf8 symbol.
    const lengthUtf8Row = maxInsertStatementLength + indexBytes + timeBytes
      + 4 * (ctx.tenant.length + docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[currentIndex].change.length);

    if (lengthUtf8Row + lengthUtf8Current >= cfgMaxPacketSize && currentIndex > startIndex) {
      packetCapacityReached = true;
      break;
    }

    const parameters = [
      ctx.tenant,
      docId,
      index,
      user.id,
      user.idOriginal,
      user.username,
      objChanges[currentIndex].change,
      objChanges[currentIndex].time
    ];

    const rowValues = { ...parameters };

    values.push(rowValues);
    lengthUtf8Current += lengthUtf8Row;
  }

  const placeholder = [];
  for (let i = 0; i < parametersCount; i++) {
    placeholder.push(`:${i}`);
  }

  const sqlInsert = `INSERT /*+ APPEND_VALUES*/INTO ${tableChanges} VALUES(${placeholder.join(',')})`;
  const result = await executeBunch(ctx, sqlInsert, values);

  if (packetCapacityReached) {
    const recursiveValue = await insertChangesAsync(ctx, tableChanges, currentIndex, objChanges, docId, index, user);
    result.affectedRows += recursiveValue.affectedRows;
  }

  return result;
}

export {
  sqlQuery,
  closePool,
  healthCheck,
  addSqlParameter,
  concatParams,
  getTableColumns,
  getEmptyCallbacks,
  getDocumentsWithChanges,
  getExpired,
  upsert,
  insertChanges
}
