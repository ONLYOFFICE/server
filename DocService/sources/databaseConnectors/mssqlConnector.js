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

const sql = require('mssql');
const config = require('config');
const connectorUtilities = require('./connectorUtilities');
const utils = require('../../../Common/sources/utils');

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = configSql.get('tableResult');
const cfgTableChanges = configSql.get('tableChanges');
const cfgMaxPacketSize = configSql.get('max_allowed_packet');

const connectionConfiguration = {
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  server: configSql.get('dbHost'),
  port: parseInt(configSql.get('dbPort')),
  database: configSql.get('dbName'),
  pool: {
    max: configSql.get('connectionlimit'),
    min: 0
  }
};
const additionalOptions = config.util.cloneDeep(configSql.get('msSqlExtraOptions'));
const configuration = utils.deepMergeObjects({}, connectionConfiguration, additionalOptions);

const placeholderPrefix = 'ph_';

function errorHandle(message, error, ctx) {
  ctx.logger.error(`${message}:`);

  if (error.precedingErrors?.length) {
    error.precedingErrors.forEach(category => ctx.logger.error(category.originalError));
  } else {
    ctx.logger.error(error.originalError);
  }
}

function dataType(value) {
  let type = sql.TYPES.NChar(1);
  switch (typeof value) {
    case 'number': {
      type = sql.TYPES.Decimal(18, 0);
      break;
    }
    case 'string': {
      type = sql.TYPES.NVarChar(sql.MAX);
      break;
    }
    case 'object': {
      if (value instanceof Date) {
        type = sql.TYPES.DateTime();
      }

      break;
    }
  }

  return type;
}

function convertPlaceholdersValues(values) {
  if (!Array.isArray(values)) {
    return values instanceof Object ? values : {};
  }

  const placeholdersObject = {};
  for (const index in values) {
    placeholdersObject[`${placeholderPrefix}${index}`] = values[index];
  }

  return placeholdersObject;
}

function registerPlaceholderValues(values, statement) {
  if (values._typesMetadata !== undefined) {
    for (const placeholderName of Object.keys(values._typesMetadata)) {
      statement.input(placeholderName, values._typesMetadata[placeholderName]);
    }

    delete values._typesMetadata;
  } else {
    for (const key of Object.keys(values)) {
      statement.input(key, dataType(values[key]));
    }
  }
}

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = {}) {
  return executeQuery(ctx, sqlCommand, opt_values, opt_noModifyRes, opt_noLog).then(
    result => callbackFunction?.(null, result),
    error => callbackFunction?.(error)
  );
}

async function executeQuery(ctx, sqlCommand, values = {}, noModifyRes = false, noLog = false) {
  try {
    await sql.connect(configuration);

    const statement = new sql.PreparedStatement();
    const placeholders = convertPlaceholdersValues(values);
    registerPlaceholderValues(placeholders, statement);

    await statement.prepare(sqlCommand);
    const result = await statement.execute(placeholders);
    await statement.unprepare();

    if (!result.recordset && !result.rowsAffected?.length) {
      return {rows: [], affectedRows: 0};
    }

    let output = result;
    if (!noModifyRes) {
      if (result.recordset) {
        output = result.recordset;
      } else {
        output = {affectedRows: result.rowsAffected.pop()};
      }
    }

    return output;
  } catch (error) {
    if (!noLog) {
      errorHandle(`sqlQuery() error while executing query: ${sqlCommand}`, error, ctx);
    }

    throw error;
  }
}

async function executeBulk(ctx, table) {
  try {
    await sql.connect(configuration);
    const result = await new sql.Request().bulk(table);

    return {affectedRows: result?.rowsAffected ?? 0};
  } catch (error) {
    errorHandle(`sqlQuery() error while executing bulk for table ${table.name}`, error, ctx);

    throw error;
  }
}

function closePool() {
  return sql.close();
}

function addSqlParameterObjectBased(parameter, name, type, accumulatedObject) {
  if (accumulatedObject._typesMetadata === undefined) {
    accumulatedObject._typesMetadata = {};
  }

  const placeholder = `${placeholderPrefix}${name}`;
  accumulatedObject[placeholder] = parameter;
  accumulatedObject._typesMetadata[placeholder] = type;

  return `@${placeholder}`;
}

function addSqlParameter(parameter, accumulatedArray) {
  const currentIndex = accumulatedArray.push(parameter) - 1;
  return `@${placeholderPrefix}${currentIndex}`;
}

function concatParams(...parameters) {
  return `CONCAT(${parameters.join(', ')})`;
}

function getTableColumns(ctx, tableName) {
  const values = [];
  const sqlParam = addSqlParameter(tableName, values);
  const sqlCommand = `SELECT column_name FROM information_schema.COLUMNS WHERE TABLE_NAME = ${sqlParam} AND TABLE_SCHEMA = SCHEMA_NAME();`;
  return executeQuery(ctx, sqlCommand, values);
}

function getDocumentsWithChanges(ctx) {
  const existingId = `SELECT TOP(1) id FROM ${cfgTableChanges} WHERE tenant=${cfgTableResult}.tenant AND id = ${cfgTableResult}.id`;
  const sqlCommand = `SELECT * FROM ${cfgTableResult} WHERE EXISTS(${existingId});`;

  return executeQuery(ctx, sqlCommand);
}

function getExpired(ctx, maxCount, expireSeconds) {
  const expireDate = new Date();
  utils.addSeconds(expireDate, -expireSeconds);

  const values = {};
  const date = addSqlParameterObjectBased(expireDate, 'expireDate', sql.TYPES.DateTime(), values);
  const count = addSqlParameterObjectBased(maxCount, 'maxCount', sql.TYPES.Int(), values);
  const notExistingTenantAndId = `SELECT TOP(1) tenant, id FROM ${cfgTableChanges} WHERE ${cfgTableChanges}.tenant = ${cfgTableResult}.tenant AND ${cfgTableChanges}.id = ${cfgTableResult}.id`;
  const sqlCommand = `SELECT TOP(${count}) * FROM ${cfgTableResult} WHERE last_open_date <= ${date} AND NOT EXISTS(${notExistingTenantAndId});`;

  return executeQuery(ctx, sqlCommand, values);
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

  const values = {};
  const insertValuesPlaceholder = [
    addSqlParameterObjectBased(task.tenant, 'tenant', sql.TYPES.NVarChar(255), values),
    addSqlParameterObjectBased(task.key, 'key', sql.TYPES.NVarChar(255), values),
    addSqlParameterObjectBased(task.status, 'status', sql.TYPES.SmallInt(), values),
    addSqlParameterObjectBased(task.statusInfo, 'statusInfo', sql.TYPES.Int(), values),
    addSqlParameterObjectBased(dateNow, 'dateNow', sql.TYPES.DateTime(), values),
    addSqlParameterObjectBased(task.userIndex, 'userIndex', sql.TYPES.Decimal(18, 0), values),
    addSqlParameterObjectBased(task.changeId, 'changeId', sql.TYPES.Decimal(18, 0), values),
    addSqlParameterObjectBased(cbInsert, 'cbInsert', sql.TYPES.NVarChar(sql.MAX), values),
    addSqlParameterObjectBased(task.baseurl, 'baseurl', sql.TYPES.NVarChar(sql.MAX), values)
  ];

  const tenant = insertValuesPlaceholder[0];
  const id = insertValuesPlaceholder[1];
  const lastOpenDate = insertValuesPlaceholder[4];
  const baseUrl = insertValuesPlaceholder[8];
  const insertValues = insertValuesPlaceholder.join(', ');
  const columns = ['tenant', 'id', 'status', 'status_info', 'last_open_date', 'user_index', 'change_id', 'callback', 'baseurl'];
  const sourceColumns = columns.join(', ');
  const sourceValues = columns.map(column => `source.${column}`).join(', ');

  const condition = `target.tenant = ${tenant} AND target.id = ${id}`;
  let updateColumns = `target.last_open_date = ${lastOpenDate}`;

  if (task.callback) {
    const parameter = addSqlParameterObjectBased(JSON.stringify(task.callback), 'callback', sql.TYPES.NVarChar(sql.MAX), values);
    const concatenatedColumns = concatParams(
      'target.callback',
      `'${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":'`,
      '(target.user_index + 1)',
      `',"callback":'`,
      parameter,
      `'}'`
    );

    updateColumns += `, target.callback = ${concatenatedColumns}`;
  }

  if (task.baseurl) {
    updateColumns += `, target.baseurl = ${baseUrl}`;
  }

  updateColumns += ', target.user_index = target.user_index + 1';

  const sqlMerge =
    `MERGE INTO ${cfgTableResult} AS target ` +
    `USING(VALUES(${insertValues})) AS source(${sourceColumns}) ` +
    `ON(${condition}) ` +
    `WHEN MATCHED THEN UPDATE SET ${updateColumns} ` +
    `WHEN NOT MATCHED THEN INSERT(${sourceColumns}) VALUES(${sourceValues}) ` +
    `OUTPUT $ACTION as action, INSERTED.user_index as insertId;`;

  const result = await executeQuery(ctx, sqlMerge, values, true);
  const insertId = result.recordset[0].insertId;
  const isInsert = result.recordset[0].action === 'INSERT';

  return {isInsert, insertId};
}

function insertChanges(ctx, tableChanges, startIndex, objChanges, docId, index, user, callback) {
  insertChangesAsync(ctx, tableChanges, startIndex, objChanges, docId, index, user).then(
    result => callback(null, result, true),
    error => callback(error, null, true)
  );
}

async function insertChangesAsync(ctx, tableChanges, startIndex, objChanges, docId, index, user) {
  if (startIndex === objChanges.length) {
    return {affectedRows: 0};
  }

  const table = new sql.Table(tableChanges);
  table.columns.add('tenant', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('id', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('change_id', sql.TYPES.Int, {nullable: false});
  table.columns.add('user_id', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('user_id_original', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('user_name', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('change_data', sql.TYPES.NVarChar(sql.MAX), {nullable: false, length: 'max'});
  table.columns.add('change_date', sql.TYPES.DateTime, {nullable: false});

  const indexBytes = 4;
  const timeBytes = 8;
  let bytes = 0;
  let currentIndex = startIndex;
  for (; currentIndex < objChanges.length && bytes <= cfgMaxPacketSize; ++currentIndex, ++index) {
    bytes +=
      indexBytes +
      timeBytes +
      4 *
        (ctx.tenant.length + docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[currentIndex].change.length);

    table.rows.add(ctx.tenant, docId, index, user.id, user.idOriginal, user.username, objChanges[currentIndex].change, objChanges[currentIndex].time);
  }

  const result = await executeBulk(ctx, table);
  if (currentIndex < objChanges.length) {
    const recursiveValue = await insertChangesAsync(ctx, tableChanges, currentIndex, objChanges, docId, index, user);
    result.affectedRows += recursiveValue.affectedRows;
  }

  return result;
}

module.exports = {
  sqlQuery,
  closePool,
  addSqlParameter,
  concatParams,
  getTableColumns,
  getDocumentsWithChanges,
  getExpired,
  upsert,
  insertChanges
};
