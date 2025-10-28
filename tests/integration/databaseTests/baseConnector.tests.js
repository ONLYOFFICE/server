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

const {describe, test, expect, afterAll} = require('@jest/globals');
const config = require('../../../Common/node_modules/config');

const baseConnector = require('../../../DocService/sources/databaseConnectors/baseConnector');
const operationContext = require('../../../Common/sources/operationContext');
const taskResult = require('../../../DocService/sources/taskresult');
const commonDefines = require('../../../Common/sources/commondefines');
const constants = require('../../../Common/sources/constants');
const utils = require('../../../Common/sources/utils');
const configSql = config.get('services.CoAuthoring.sql');

const ctx = new operationContext.Context();
const cfgDbType = configSql.get('type');
const cfgTableResult = configSql.get('tableResult');
const cfgTableChanges = configSql.get('tableChanges');
const dbTypes = {
  oracle: {
    number: 'NUMBER',
    string: 'NVARCHAR(50)'
  },
  mssql: {
    number: 'INT',
    string: 'NVARCHAR(50)'
  },
  mysql: {
    number: 'INT',
    string: 'VARCHAR(50)'
  },
  dameng: {
    number: 'INT',
    string: 'VARCHAR(50)'
  },
  postgres: {
    number: 'INT',
    string: 'VARCHAR(50)'
  },
  number() {
    return this[cfgDbType].number;
  },
  string() {
    return this[cfgDbType].string;
  }
};

const insertCases = {
  5: 'baseConnector-insert()-tester-5-rows',
  500: 'baseConnector-insert()-tester-500-rows',
  1000: 'baseConnector-insert()-tester-1000-rows',
  5000: 'baseConnector-insert()-tester-5000-rows',
  10000: 'baseConnector-insert()-tester-10000-rows'
};
const changesCases = {
  range: 'baseConnector-getChangesPromise()-tester',
  index: 'baseConnector-getChangesIndexPromise()-tester',
  delete: 'baseConnector-deleteChangesPromise()-tester'
};
const emptyCallbacksCase = [
  'baseConnector-getEmptyCallbacks()-tester-0',
  'baseConnector-getEmptyCallbacks()-tester-1',
  'baseConnector-getEmptyCallbacks()-tester-2',
  'baseConnector-getEmptyCallbacks()-tester-3',
  'baseConnector-getEmptyCallbacks()-tester-4'
];
const documentsWithChangesCase = ['baseConnector-getDocumentsWithChanges()-tester-0', 'baseConnector-getDocumentsWithChanges()-tester-1'];
const getExpiredCase = ['baseConnector-getExpired()-tester-0', 'baseConnector-getExpired()-tester-1', 'baseConnector-getExpired()-tester-2'];
const getCountWithStatusCase = ['baseConnector-getCountWithStatusCase()-tester-0'];
const upsertCases = {
  insert: 'baseConnector-upsert()-tester-row-inserted',
  update: 'baseConnector-upsert()-tester-row-updated'
};

function createChanges(changesLength, date) {
  const objChanges = [
    {
      docid: '__ffff_127.0.0.1new.docx41692082262909',
      change: '"64;AgAAADEA//8BAG+X6xGnEAMAjgAAAAIAAAAEAAAABAAAAAUAAACCAAAAggAAAA4AAAAwAC4AMAAuADAALgAwAA=="',
      time: date,
      user: 'uid-18',
      useridoriginal: 'uid-1'
    }
  ];

  const length = changesLength - 1;
  for (let i = 1; i <= length; i++) {
    objChanges.push({
      docid: '__ffff_127.0.0.1new.docx41692082262909',
      change: '"39;CgAAADcAXwA2ADQAMAACABwAAQAAAAAAAAABAAAALgAAAAAAAAAA"',
      time: date,
      user: 'uid-18',
      useridoriginal: 'uid-1'
    });
  }

  return objChanges;
}

async function getRowsCountById(table, id) {
  const result = await executeSql(`SELECT COUNT(id) AS count FROM ${table} WHERE id = '${id}';`);
  // Return type of COUNT() in postgres is bigint which treats as string by connector. Dameng DB returns js bigint type.
  return Number(result[0].count);
}

async function noRowsExistenceCheck(table, id) {
  const noRows = await getRowsCountById(table, id);
  expect(noRows).toEqual(0);
}

function deleteRowsByIds(table, ids) {
  const idToDelete = ids.map(id => `id = '${id}'`).join(' OR ');
  return executeSql(`DELETE FROM ${table} WHERE ${idToDelete};`);
}

function executeSql(sql, values = []) {
  return new Promise((resolve, reject) => {
    baseConnector.sqlQuery(
      ctx,
      sql,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
      false,
      false,
      values
    );
  });
}

function createTask(id, callback = '', baseurl = '') {
  const task = new taskResult.TaskResultData();
  task.tenant = ctx.tenant;
  task.key = id;
  task.status = commonDefines.FileStatus.None;
  task.statusInfo = constants.NO_ERROR;
  task.callback = callback;
  task.baseurl = baseurl;
  task.completeDefaults();

  return task;
}

function insertIntoResultTable(dateNow, task) {
  let cbInsert = task.callback;
  if (task.callback) {
    const userCallback = new baseConnector.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
  }

  const columns = ['tenant', 'id', 'status', 'status_info', 'last_open_date', 'user_index', 'change_id', 'callback', 'baseurl'];
  const values = [];
  const placeholder = [
    baseConnector.addSqlParameter(task.tenant, values),
    baseConnector.addSqlParameter(task.key, values),
    baseConnector.addSqlParameter(task.status, values),
    baseConnector.addSqlParameter(task.statusInfo, values),
    baseConnector.addSqlParameter(dateNow, values),
    baseConnector.addSqlParameter(task.userIndex, values),
    baseConnector.addSqlParameter(task.changeId, values),
    baseConnector.addSqlParameter(cbInsert, values),
    baseConnector.addSqlParameter(task.baseurl, values)
  ];

  return executeSql(`INSERT INTO ${cfgTableResult}(${columns.join(', ')}) VALUES(${placeholder.join(', ')});`, values);
}

afterAll(async () => {
  const insertIds = Object.values(insertCases);
  const changesIds = Object.values(changesCases);
  const upsertIds = Object.values(upsertCases);

  const tableChangesIds = [...emptyCallbacksCase, ...documentsWithChangesCase, ...changesIds, ...insertIds];
  const tableResultIds = [...emptyCallbacksCase, ...documentsWithChangesCase, ...getExpiredCase, ...getCountWithStatusCase, ...upsertIds];

  const deletionPool = [
    deleteRowsByIds(cfgTableChanges, tableChangesIds),
    deleteRowsByIds(cfgTableResult, tableResultIds),
    executeSql('DROP TABLE test_table;')
  ];

  await Promise.allSettled(deletionPool);
  baseConnector.closePool?.();
}, 10000); //default timeout is 5000ms. increased to 10000ms to prevent timeout on Oracle DB

// Assumed that at least default DB was installed and configured.
describe('Base database connector', () => {
  test('Availability of configured DB', async () => {
    const result = await baseConnector.healthCheck(ctx);

    expect(result.length).toEqual(1);
  });

  test('Correct return format of requested rows', async () => {
    const result = await baseConnector.healthCheck(ctx);

    // The [[constructor]] field is referring to a parent class instance, so for Object-like values it is equal to itself.
    expect(result.constructor).toEqual(Array);
    // SQL in healthCheck() request column with value 1, so we expect only one value. The default format, that used here is [{ columnName: columnValue }, { columnName: columnValue }].
    expect(result.length).toEqual(1);
    expect(result[0].constructor).toEqual(Object);
    expect(Object.values(result[0]).length).toEqual(1);
    // Value itself.
    expect(Object.values(result[0])[0]).toEqual(1);
  });

  test('Correct return format of changing in DB', async () => {
    const createTableSql = `CREATE TABLE test_table(num ${dbTypes.number()});`;
    const alterTableSql = `INSERT INTO test_table VALUES(1);`;

    await executeSql(createTableSql);
    const result = await executeSql(alterTableSql);

    expect(result).toEqual({affectedRows: 1});
  });

  describe('DB tables existence', () => {
    const tables = {
      [cfgTableResult]: constants.TABLE_RESULT_SCHEMA.map(column => {
        return {column_name: column};
      }),
      [cfgTableChanges]: constants.TABLE_CHANGES_SCHEMA.map(column => {
        return {column_name: column};
      })
    };

    for (const table in tables) {
      test(`${table} table existence`, async () => {
        const result = await baseConnector.getTableColumns(ctx, table);
        for (const row of tables[table]) {
          expect(result).toContainEqual(row);
        }
      });
    }

    const table = 'unused_table';
    test(`${table} table absence`, async () => {
      const result = await baseConnector.getTableColumns(ctx, table);
      expect(result).toEqual([]);
    });
  });

  describe('Changes manipulations', () => {
    const date = new Date();
    const index = 0;
    const user = {
      id: 'uid-18',
      idOriginal: 'uid-1',
      username: 'John Smith',
      indexUser: 8,
      view: false
    };

    describe('Add changes', () => {
      for (const testCase in insertCases) {
        test(`${testCase} rows inserted`, async () => {
          const docId = insertCases[testCase];
          const objChanges = createChanges(+testCase, date);

          await noRowsExistenceCheck(cfgTableChanges, docId);

          await baseConnector.insertChangesPromise(ctx, objChanges, docId, index, user);
          const result = await getRowsCountById(cfgTableChanges, docId);

          expect(result).toEqual(objChanges.length);
        });
      }
    });

    describe('Get and delete changes', () => {
      const changesCount = 10;
      const objChanges = createChanges(changesCount, date);

      test('Get changes in range', async () => {
        const docId = changesCases.range;
        const additionalChangesCount = 5;
        const dayBefore = new Date();
        dayBefore.setDate(dayBefore.getDate() - 1);
        const limitedByDateChanges = createChanges(additionalChangesCount, dayBefore);
        const fullChanges = [...objChanges, ...limitedByDateChanges];

        await noRowsExistenceCheck(cfgTableChanges, docId);

        await baseConnector.insertChangesPromise(ctx, fullChanges, docId, index, user);

        const result = await baseConnector.getChangesPromise(ctx, docId, index, changesCount);
        expect(result.length).toEqual(changesCount);

        dayBefore.setSeconds(dayBefore.getSeconds() + 1);
        const resultByDate = await baseConnector.getChangesPromise(ctx, docId, index, changesCount + additionalChangesCount, dayBefore);
        expect(resultByDate.length).toEqual(additionalChangesCount);
      });

      test('Get changes index', async () => {
        const docId = changesCases.index;

        await noRowsExistenceCheck(cfgTableChanges, docId);

        await baseConnector.insertChangesPromise(ctx, objChanges, docId, index, user);

        const result = await baseConnector.getChangesIndexPromise(ctx, docId);

        // We created 10 changes rows, change_id: 0..9, changes index is MAX(change_id).
        const expected = [{change_id: 9}];
        expect(result).toEqual(expected);
      });

      test('Delete changes', async () => {
        const docId = changesCases.delete;

        await baseConnector.insertChangesPromise(ctx, objChanges, docId, index, user);

        // Deleting 6 rows.
        await baseConnector.deleteChangesPromise(ctx, docId, 4);

        const result = await getRowsCountById(cfgTableChanges, docId);

        // Rest rows.
        expect(result).toEqual(4);
      });
    });

    test('Get empty callbacks', async () => {
      const idCount = 5;
      const notNullCallbacks = idCount - 2;

      const resultBefore = await baseConnector.getEmptyCallbacks(ctx);

      // Adding non-empty callbacks.
      for (let i = 0; i < notNullCallbacks; i++) {
        const task = createTask(emptyCallbacksCase[i], 'some_callback');
        await insertIntoResultTable(date, task);
      }

      // Adding empty callbacks.
      for (let i = notNullCallbacks; i < idCount; i++) {
        const task = createTask(emptyCallbacksCase[i], '');
        await insertIntoResultTable(date, task);
      }

      // Adding same amount of changes with same tenant and id.
      const objChanges = createChanges(1, date);
      for (let i = 0; i < idCount; i++) {
        await baseConnector.insertChangesPromise(ctx, objChanges, emptyCallbacksCase[i], index, user);
      }

      const resultAfter = await baseConnector.getEmptyCallbacks(ctx);

      expect(resultAfter.length).toEqual(resultBefore.length + idCount - notNullCallbacks);
    });

    test('Get documents with changes', async () => {
      const objChanges = createChanges(1, date);

      const resultBeforeNewRows = await baseConnector.getDocumentsWithChanges(ctx);

      for (const id of documentsWithChangesCase) {
        const task = createTask(id);
        await Promise.all([baseConnector.insertChangesPromise(ctx, objChanges, id, index, user), insertIntoResultTable(date, task)]);
      }

      const resultAfterNewRows = await baseConnector.getDocumentsWithChanges(ctx);
      expect(resultAfterNewRows.length).toEqual(resultBeforeNewRows.length + documentsWithChangesCase.length);
    });

    test('Get expired', async () => {
      const maxCount = 100;
      const dayBefore = new Date();
      dayBefore.setDate(dayBefore.getDate() - 1);

      const resultBeforeNewRows = await baseConnector.getExpired(ctx, maxCount, 0);

      for (const id of getExpiredCase) {
        const task = createTask(id);
        await insertIntoResultTable(dayBefore, task);
      }

      // 3 rows were added.
      const resultAfterNewRows = await baseConnector.getExpired(ctx, maxCount + 3, 0);

      expect(resultAfterNewRows.length).toEqual(resultBeforeNewRows.length + getExpiredCase.length);
    });

    test('Get Count With Status', async () => {
      let countWithStatus;
      const unknownStatus = 99; //to avoid collision with running server
      const EXEC_TIMEOUT = 30000 + utils.getConvertionTimeout(undefined);
      countWithStatus = await baseConnector.getCountWithStatus(ctx, unknownStatus, EXEC_TIMEOUT);
      expect(countWithStatus).toEqual(0);
      for (const id of getCountWithStatusCase) {
        const task = createTask(id);
        task.status = unknownStatus;
        await insertIntoResultTable(date, task);
      }
      countWithStatus = await baseConnector.getCountWithStatus(ctx, unknownStatus, EXEC_TIMEOUT);
      expect(countWithStatus).toEqual(getCountWithStatusCase.length);
    });
  });

  describe('upsert() method', () => {
    test('New row inserted', async () => {
      const task = createTask(upsertCases.insert);

      await noRowsExistenceCheck(cfgTableResult, task.key);

      const result = await baseConnector.upsert(ctx, task);

      // isInsert should be true because of insert operation, insertId should be 1 by default.
      const expected = {isInsert: true, insertId: 1};
      expect(result).toEqual(expected);

      const insertedResult = await getRowsCountById(cfgTableResult, task.key);

      expect(insertedResult).toEqual(1);
    });

    test('Row updated', async () => {
      const task = createTask(upsertCases.update, '', 'some-url');

      await noRowsExistenceCheck(cfgTableResult, task.key);

      await baseConnector.upsert(ctx, task);

      // Changing baseurl to verify upsert() changing the row.
      task.baseurl = 'some-updated-url';
      const result = await baseConnector.upsert(ctx, task);

      // isInsert should be false because of update operation, insertId should be 2 by updating clause.
      const expected = {isInsert: false, insertId: 2};
      expect(result).toEqual(expected);

      const updatedRow = await executeSql(`SELECT id, baseurl FROM ${cfgTableResult} WHERE id = '${task.key}';`);

      const expectedUrlChanges = [{id: task.key, baseurl: 'some-updated-url'}];
      expect(updatedRow).toEqual(expectedUrlChanges);
    });
  });
});
