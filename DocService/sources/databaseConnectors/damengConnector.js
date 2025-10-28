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

const connectorUtilities = require('./connectorUtilities');
const db = require('dmdb');
const config = require('config');

const configSql = config.get('services.CoAuthoring.sql');
const cfgDbHost = configSql.get('dbHost');
const cfgDbPort = configSql.get('dbPort');
const cfgDbUser = configSql.get('dbUser');
const cfgDbPass = configSql.get('dbPass');
const cfgConnectionLimit = configSql.get('connectionlimit');
const cfgTableResult = configSql.get('tableResult');
const cfgDamengExtraOptions = config.util.cloneDeep(configSql.get('damengExtraOptions'));
const forceClosingCountdownMs = 2000;

// dmdb driver separates PoolAttributes and ConnectionAttributes.
// For some reason if you use pool you must define connection attributes in connectString, they are not included in config object, and pool.getConnection() can't configure it.
const poolHostInfo = `dm://${cfgDbUser}:${cfgDbPass}@${cfgDbHost}:${cfgDbPort}`;
const connectionOptions = Object.entries(cfgDamengExtraOptions)
  .map(option => option.join('='))
  .join('&');

let pool = null;
const poolConfig = {
  // String format dm://username:password@host:port[?prop1=val1[&prop2=val2]]
  connectString: `${poolHostInfo}${connectionOptions.length > 0 ? '?' : ''}${connectionOptions}`,
  poolMax: cfgConnectionLimit,
  poolMin: 0
};

function readLob(lob) {
  return new Promise((resolve, reject) => {
    let blobData = Buffer.alloc(0);
    let totalLength = 0;

    lob.on('data', chunk => {
      totalLength += chunk.length;
      blobData = Buffer.concat([blobData, chunk], totalLength);
    });

    lob.on('error', err => {
      reject(err);
    });

    lob.on('end', () => {
      resolve(blobData);
    });
  });
}

async function formatResult(result) {
  const res = [];
  if (result?.rows && result?.metaData) {
    for (let i = 0; i < result.rows.length; ++i) {
      const row = result.rows[i];
      const out = {};
      for (let j = 0; j < result.metaData.length; ++j) {
        const columnName = result.metaData[j].name;
        if (row[j]?.on) {
          const buf = await readLob(row[j]);
          out[columnName] = buf.toString('utf8');
        } else {
          out[columnName] = row[j];
        }
      }

      res.push(out);
    }
  }

  return res;
}

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = []) {
  return executeQuery(ctx, sqlCommand, opt_values, opt_noModifyRes, opt_noLog).then(
    result => callbackFunction?.(null, result),
    error => callbackFunction?.(error)
  );
}

async function executeQuery(ctx, sqlCommand, values = [], noModifyRes = false, noLog = false) {
  let connection = null;
  try {
    if (!pool) {
      pool = await db.createPool(poolConfig);
    }

    connection = await pool.getConnection();
    const result = await connection.execute(sqlCommand, values, {resultSet: false});

    let output = result;
    if (!noModifyRes) {
      if (result?.rows) {
        output = await formatResult(result);
      } else if (result?.rowsAffected) {
        output = {affectedRows: result.rowsAffected};
      } else {
        output = {rows: [], affectedRows: 0};
      }
    }

    return output;
  } catch (error) {
    if (!noLog) {
      ctx.logger.warn('sqlQuery error sqlCommand: %s: %s', sqlCommand.slice(0, 50), error.stack);
    }

    throw error;
  } finally {
    connection?.close();
  }
}

function closePool() {
  return pool.close(forceClosingCountdownMs);
}

function addSqlParameter(val, values) {
  values.push({val});
  return `:${values.length}`;
}

function concatParams(val1, val2) {
  return `CONCAT(COALESCE(${val1}, ''), COALESCE(${val2}, ''))`;
}

async function getTableColumns(ctx, tableName) {
  const values = [];
  const sqlParam = addSqlParameter(tableName.toUpperCase(), values);
  const result = await executeQuery(ctx, `SELECT column_name FROM DBA_TAB_COLUMNS WHERE table_name = ${sqlParam};`, values);
  return result.map(row => {
    return {column_name: row.column_name.toLowerCase()};
  });
}

async function upsert(ctx, task) {
  task.completeDefaults();
  const dateNow = new Date();
  const values = [];

  let cbInsert = task.callback;
  if (task.callback) {
    const userCallback = new connectorUtilities.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
  }

  const p0 = addSqlParameter(task.tenant, values);
  const p1 = addSqlParameter(task.key, values);
  const p2 = addSqlParameter(task.status, values);
  const p3 = addSqlParameter(task.statusInfo, values);
  const p4 = addSqlParameter(dateNow, values);
  const p5 = addSqlParameter(task.userIndex, values);
  const p6 = addSqlParameter(task.changeId, values);
  const p7 = addSqlParameter(cbInsert, values);
  const p8 = addSqlParameter(task.baseurl, values);
  const p9 = addSqlParameter(dateNow, values);

  let sqlCommand = `MERGE INTO ${cfgTableResult} USING dual ON (tenant = ${p0} AND id = ${p1}) `;
  sqlCommand += `WHEN NOT MATCHED THEN INSERT (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) `;
  sqlCommand += `VALUES (${p0}, ${p1}, ${p2}, ${p3}, ${p4}, ${p5}, ${p6}, ${p7}, ${p8}) `;
  sqlCommand += `WHEN MATCHED THEN UPDATE SET last_open_date = ${p9}`;

  if (task.callback) {
    const p10 = addSqlParameter(JSON.stringify(task.callback), values);
    sqlCommand += `, callback = CONCAT(callback , '${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":' , (user_index + 1) , ',"callback":', ${p10}, '}')`;
  }

  if (task.baseurl) {
    const p11 = addSqlParameter(task.baseurl, values);
    sqlCommand += `, baseurl = ${p11}`;
  }

  sqlCommand += ', user_index = user_index + 1';
  sqlCommand += ';';
  sqlCommand += `SELECT user_index FROM ${cfgTableResult} WHERE tenant = ${p0} AND id = ${p1};`;

  const out = {};
  const result = await executeQuery(ctx, sqlCommand, values);
  if (result?.length > 0) {
    const first = result[0];
    out.isInsert = task.userIndex === first.user_index;
    out.insertId = first.user_index;
  }

  return out;
}

module.exports = {
  sqlQuery,
  closePool,
  addSqlParameter,
  concatParams,
  getTableColumns,
  upsert
};
