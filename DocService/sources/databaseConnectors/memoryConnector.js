/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * In-memory persistence connector for the public/community standalone runtime.
 *
 * Exports the combined API surface of both baseConnector.js (change store +
 * task-result helpers) and taskresult.js (TaskResultData + full CRUD), so that
 * the memory guard at the top of each original file can simply do:
 *   module.exports = require('./memoryConnector');
 *
 * No SQL pool, no driver dependencies, no persistence across restarts.
 */

'use strict';

const crypto = require('crypto');
const config = require('config');
const constants = require('../../../Common/sources/constants');
const commonDefines = require('../../../Common/sources/commondefines');
const connectorUtilities = require('./connectorUtilities');

// tenantManager loaded lazily to break circular init chain
function getDefaultTenant() {
  return require('../../../Common/sources/tenantManager').getDefautTenant();
}

const RANDOM_KEY_MAX = 10000;
const DELIMITER = constants.CHAR_DELIMITER;

const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');
const cfgTableChanges = config.get('services.CoAuthoring.sql.tableChanges');

// ---------------------------------------------------------------------------
// Change store
// ---------------------------------------------------------------------------

/** @type {Map<string, Array>} */
const changeStore = new Map();
const criticalSection = {};

function makeChangeKey(tenant, docId) {
  return `${tenant}\t${docId}`;
}

function getChangeList(tenant, docId) {
  const key = makeChangeKey(tenant, docId);
  let list = changeStore.get(key);
  if (!list) {
    list = [];
    changeStore.set(key, list);
  }
  return list;
}

function insertChangesPromise(ctx, objChanges, docId, startIndex, user) {
  const list = getChangeList(ctx.tenant, docId);
  let index = startIndex;
  for (let i = 0; i < objChanges.length; i++, index++) {
    const time = objChanges[i].time instanceof Date ? objChanges[i].time : new Date(objChanges[i].time);
    list.push({
      tenant: ctx.tenant,
      id: docId,
      change_id: index,
      user_id: user.id,
      user_id_original: user.idOriginal,
      user_name: user.username,
      change_data: objChanges[i].change,
      change_date: time
    });
  }
  return Promise.resolve({affectedRows: objChanges.length});
}

function deleteChangesPromise(ctx, docId, deleteIndex) {
  const key = makeChangeKey(ctx.tenant, docId);
  const list = changeStore.get(key);
  if (!list || list.length === 0) return Promise.resolve({affectedRows: 0});

  if (deleteIndex === null || deleteIndex === undefined) {
    const removed = list.length;
    changeStore.delete(key);
    return Promise.resolve({affectedRows: removed});
  }

  const before = list.length;
  const kept = list.filter(r => r.change_id < deleteIndex);
  if (kept.length === 0) {
    changeStore.delete(key);
  } else {
    changeStore.set(key, kept);
  }
  return Promise.resolve({affectedRows: before - kept.length});
}

function deleteChanges(ctx, docId, deleteIndex) {
  lockCriticalSection(docId, () => {
    deleteChangesPromise(ctx, docId, deleteIndex).finally(() => unLockCriticalSection(docId));
  });
}

function getChangesIndexPromise(ctx, docId) {
  const list = changeStore.get(makeChangeKey(ctx.tenant, docId));
  if (!list || list.length === 0) return Promise.resolve([]);
  let max = -1;
  for (const r of list) {
    if (r.change_id > max) max = r.change_id;
  }
  return Promise.resolve([{change_id: max}]);
}

function getChangesPromise(ctx, docId, optStartIndex, optEndIndex, opt_time) {
  const list = changeStore.get(makeChangeKey(ctx.tenant, docId));
  if (!list) return Promise.resolve([]);

  let timeFilter = null;
  if (opt_time != null) {
    timeFilter = opt_time instanceof Date ? opt_time : new Date(opt_time);
  }

  const result = [];
  for (const r of list) {
    if (optStartIndex != null && r.change_id < optStartIndex) continue;
    if (optEndIndex != null && r.change_id >= optEndIndex) continue;
    if (timeFilter != null && r.change_date > timeFilter) continue;
    result.push(r);
  }
  result.sort((a, b) => a.change_id - b.change_id);
  return Promise.resolve(result);
}

function isLockCriticalSection(id) {
  return !!criticalSection[id];
}

function lockCriticalSection(id, callback) {
  if (criticalSection[id]) {
    criticalSection[id].push(callback);
    return;
  }
  criticalSection[id] = [];
  criticalSection[id].push(callback);
  callback();
}

function unLockCriticalSection(id) {
  const arr = criticalSection[id];
  if (!arr) return;
  arr.shift();
  if (arr.length > 0) {
    arr[0]();
  } else {
    delete criticalSection[id];
  }
}

// ---------------------------------------------------------------------------
// Task result store
// ---------------------------------------------------------------------------

/** @type {Map<string, Object>} */
const taskResultStore = new Map();

function makeResultKey(tenant, id) {
  return `${tenant}\t${id}`;
}

function hasChangesForResultRow(row) {
  const list = changeStore.get(makeResultKey(row.tenant, row.id));
  return !!(list && list.length > 0);
}

function cloneRow(row) {
  return {...row, last_open_date: row.last_open_date instanceof Date ? new Date(row.last_open_date) : row.last_open_date};
}

function completeDefaults(task) {
  if (!task.tenant) task.tenant = getDefaultTenant();
  if (!task.key) task.key = '';
  if (!task.status) task.status = commonDefines.FileStatus.None;
  if (!task.statusInfo) task.statusInfo = constants.NO_ERROR;
  if (!task.lastOpenDate) task.lastOpenDate = new Date();
  if (!task.creationDate) task.creationDate = new Date();
  if (!task.userIndex) task.userIndex = 1;
  if (!task.changeId) task.changeId = 0;
  if (!task.callback) task.callback = '';
  if (!task.baseurl) task.baseurl = '';
}

function upsert(ctx, task) {
  completeDefaults(task);
  const key = makeResultKey(task.tenant, task.key);
  const existing = taskResultStore.get(key);
  const now = new Date();

  if (!existing) {
    let callback = task.callback || '';
    if (callback) {
      const userCallback = new connectorUtilities.UserCallback();
      userCallback.fromValues(task.userIndex, callback);
      callback = userCallback.toSQLInsert();
    }
    const row = {
      tenant: task.tenant,
      id: task.key,
      status: task.status,
      status_info: task.statusInfo,
      last_open_date: now,
      user_index: task.userIndex,
      change_id: task.changeId,
      callback,
      baseurl: task.baseurl || '',
      password: null,
      additional: null
    };
    taskResultStore.set(key, row);
    return Promise.resolve({isInsert: true, insertId: task.userIndex});
  }

  existing.last_open_date = now;
  existing.user_index = existing.user_index + 1;
  if (task.callback) {
    const segment = DELIMITER + JSON.stringify({userIndex: existing.user_index, callback: task.callback});
    existing.callback = (existing.callback || '') + segment;
  }
  if (task.baseurl) {
    existing.baseurl = task.baseurl;
  }
  return Promise.resolve({isInsert: false, insertId: existing.user_index});
}

function select(ctx, docId) {
  const row = taskResultStore.get(makeResultKey(ctx.tenant, docId));
  return Promise.resolve(row ? [cloneRow(row)] : []);
}

async function selectWithCache(ctx, docId) {
  if (ctx.taskResultCache && ctx.taskResultCache[0] && ctx.taskResultCache[0].id === docId) {
    return ctx.taskResultCache;
  }
  ctx.taskResultCache = await select(ctx, docId);
  return ctx.taskResultCache;
}

function applyFields(row, task, updateTime, setPassword) {
  if (task.status != null) row.status = task.status;
  if (task.statusInfo != null) row.status_info = task.statusInfo;
  if (updateTime) row.last_open_date = new Date();
  if (task.indexUser != null) row.user_index = task.indexUser;
  if (task.changeId != null) row.change_id = task.changeId;
  if (task.callback != null) {
    const userCallback = new connectorUtilities.UserCallback();
    userCallback.fromValues(task.indexUser, task.callback);
    const segment = userCallback.toSQLInsert();
    row.callback = (row.callback || '') + segment;
  }
  if (task.baseurl != null) row.baseurl = task.baseurl;
  if (setPassword) {
    row.password = task.password;
  } else if (task.password != null) {
    const documentPassword = new connectorUtilities.DocumentPassword();
    documentPassword.fromValues(task.password, task.innerPasswordChange);
    const segment = documentPassword.toSQLInsert();
    row.password = (row.password || '') + segment;
  }
  if (task.additional != null) {
    row.additional = (row.additional || '') + task.additional;
  }
}

function matchesMask(row, mask) {
  if (mask.tenant != null && row.tenant !== mask.tenant) return false;
  if (mask.key != null && row.id !== mask.key) return false;
  if (mask.status != null && row.status !== mask.status) return false;
  if (mask.statusInfo != null && row.status_info !== mask.statusInfo) return false;
  if (mask.indexUser != null && row.user_index !== mask.indexUser) return false;
  if (mask.changeId != null && row.change_id !== mask.changeId) return false;
  if (mask.callback === 'NOT_EMPTY') {
    if (!row.callback || row.callback === '') return false;
  } else if (mask.callback != null) {
    if (row.callback !== mask.callback) return false;
  }
  if (mask.baseurl != null && row.baseurl !== mask.baseurl) return false;
  return true;
}

function update(ctx, task, setPassword) {
  const row = taskResultStore.get(makeResultKey(task.tenant, task.key));
  if (!row) return Promise.resolve({affectedRows: 0});
  applyFields(row, task, true, !!setPassword);
  return Promise.resolve({affectedRows: 1});
}

function updateIf(ctx, task, mask) {
  const row = taskResultStore.get(makeResultKey(mask.tenant, mask.key));
  if (!row || !matchesMask(row, mask)) return Promise.resolve({affectedRows: 0});
  applyFields(row, task, true, false);
  return Promise.resolve({affectedRows: 1});
}

function updateStatusAndClearCallback(ctx, docId, status) {
  const row = taskResultStore.get(makeResultKey(ctx.tenant, docId));
  if (!row) return Promise.resolve({affectedRows: 0});
  row.status = status;
  row.callback = '';
  return Promise.resolve({affectedRows: 1});
}

async function restoreInitialPassword(ctx, docId) {
  const rows = await select(ctx, docId);
  if (rows.length === 0) return undefined;
  const docPassword = connectorUtilities.DocumentPassword.prototype.getDocPassword(ctx, rows[0].password);
  const updateTask = {tenant: ctx.tenant, key: docId};
  if (docPassword.initial) {
    const documentPassword = new connectorUtilities.DocumentPassword();
    documentPassword.fromValues(docPassword.initial);
    updateTask.password = documentPassword.toSQLInsert();
    return update(ctx, updateTask, true);
  }
  if (docPassword.current) {
    updateTask.password = null;
    return update(ctx, updateTask, true);
  }
  return undefined;
}

function addRandomKeyInner(ctx, task, key, opt_prefix, opt_size) {
  task.tenant = ctx.tenant;
  if (opt_prefix !== undefined && opt_size !== undefined) {
    task.key = opt_prefix + crypto.randomBytes(opt_size).toString('hex');
  } else {
    task.key = key + '_' + Math.round(Math.random() * RANDOM_KEY_MAX);
  }
  completeDefaults(task);
  const fullKey = makeResultKey(task.tenant, task.key);
  if (taskResultStore.has(fullKey)) {
    return Promise.resolve({affectedRows: 0});
  }
  const row = {
    tenant: task.tenant,
    id: task.key,
    status: task.status,
    status_info: task.statusInfo,
    last_open_date: new Date(),
    user_index: task.userIndex,
    change_id: task.changeId,
    callback: task.callback || '',
    baseurl: task.baseurl || '',
    password: null,
    additional: null
  };
  taskResultStore.set(fullKey, row);
  return Promise.resolve({affectedRows: 1});
}

function* addRandomKeyTask(ctx, key, opt_prefix, opt_size) {
  const task = {
    tenant: ctx.tenant,
    key,
    status: commonDefines.FileStatus.WaitQueue,
    statusInfo: Math.floor(Date.now() / 60000)
  };
  let nTryCount = RANDOM_KEY_MAX;
  let addRes = null;
  while (nTryCount-- > 0) {
    addRes = yield addRandomKeyInner(ctx, task, key, opt_prefix, opt_size);
    if (addRes && addRes.affectedRows > 0) break;
  }
  if (addRes && addRes.affectedRows > 0) return task;
  throw new Error('addRandomKeyTask Error');
}

function remove(ctx, docId) {
  const k = makeResultKey(ctx.tenant, docId);
  const had = taskResultStore.delete(k);
  return Promise.resolve({affectedRows: had ? 1 : 0});
}

function removeIf(ctx, mask) {
  const k = makeResultKey(mask.tenant, mask.key);
  const row = taskResultStore.get(k);
  if (!row || !matchesMask(row, mask)) return Promise.resolve({affectedRows: 0});
  taskResultStore.delete(k);
  return Promise.resolve({affectedRows: 1});
}

async function getExpired(ctx, maxCount, expireSeconds) {
  const cutoff = new Date(Date.now() - expireSeconds * 1000);
  // collect doc keys that still have pending changes
  const changeKeys = new Set();
  for (const [k, list] of changeStore) {
    if (list && list.length > 0) changeKeys.add(k);
  }
  const result = [];
  for (const [k, row] of taskResultStore) {
    if (row.last_open_date > cutoff) continue;
    if (changeKeys.has(k)) continue;
    result.push(cloneRow(row));
    if (result.length >= maxCount) break;
  }
  return result;
}

function getCountWithStatus(ctx, status, expireMs) {
  const cutoff = new Date(Date.now() - expireMs);
  let count = 0;
  for (const row of taskResultStore.values()) {
    if (row.status === status && row.last_open_date > cutoff) count++;
  }
  return Promise.resolve(count);
}

function getEmptyCallbacks() {
  const result = [];
  for (const row of taskResultStore.values()) {
    if (hasChangesForResultRow(row) && (!row.callback || row.callback === '')) {
      result.push({tenant: row.tenant, id: row.id});
    }
  }
  return Promise.resolve(result);
}

function getDocumentsWithChanges() {
  const result = [];
  for (const row of taskResultStore.values()) {
    if (hasChangesForResultRow(row)) {
      result.push(cloneRow(row));
    }
  }
  return Promise.resolve(result);
}

// ---------------------------------------------------------------------------
// Synthetic schema (so DocsCoServer schema-check passes without SQL)
// ---------------------------------------------------------------------------

function getTableColumns(_ctx, tableName) {
  if (tableName === cfgTableResult) {
    return Promise.resolve(constants.TABLE_RESULT_SCHEMA.map(column_name => ({column_name})));
  }
  if (tableName === cfgTableChanges) {
    return Promise.resolve(constants.TABLE_CHANGES_SCHEMA.map(column_name => ({column_name})));
  }
  return Promise.resolve([]);
}

function healthCheck() {
  return Promise.resolve(true);
}

function getDateTime(oDate) {
  return oDate.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// TaskResultData constructor (mirrors taskresult.js)
// ---------------------------------------------------------------------------

function TaskResultData() {
  this.tenant = null;
  this.key = null;
  this.status = null;
  this.statusInfo = null;
  this.lastOpenDate = null;
  this.creationDate = null;
  this.userIndex = null;
  this.changeId = null;
  this.callback = null;
  this.baseurl = null;
  this.password = null;
  this.additional = null;
  this.innerPasswordChange = null; //not a DB field
}
TaskResultData.prototype.completeDefaults = function () {
  if (!this.tenant) this.tenant = getDefaultTenant();
  if (!this.key) this.key = '';
  if (!this.status) this.status = commonDefines.FileStatus.None;
  if (!this.statusInfo) this.statusInfo = constants.NO_ERROR;
  if (!this.lastOpenDate) this.lastOpenDate = new Date();
  if (!this.creationDate) this.creationDate = new Date();
  if (!this.userIndex) this.userIndex = 1;
  if (!this.changeId) this.changeId = 0;
  if (!this.callback) this.callback = '';
  if (!this.baseurl) this.baseurl = '';
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function _resetForTests() {
  changeStore.clear();
  for (const k of Object.keys(criticalSection)) delete criticalSection[k];
  taskResultStore.clear();
}

// ---------------------------------------------------------------------------
// Exports - superset of both baseConnector and taskresult surfaces
// ---------------------------------------------------------------------------

module.exports = {
  ...connectorUtilities,
  // Change store
  insertChangesPromise,
  deleteChangesPromise,
  deleteChanges,
  getChangesIndexPromise,
  getChangesPromise,
  isLockCriticalSection,
  // Task result store (baseConnector-style helpers)
  getDocumentsWithChanges,
  upsert,
  getExpired,
  getCountWithStatus,
  getEmptyCallbacks,
  // Shared helpers
  healthCheck,
  getDateTime,
  getTableColumns,
  // taskresult.js surface
  TaskResultData,
  select,
  selectWithCache,
  update,
  updateIf,
  updateStatusAndClearCallback,
  restoreInitialPassword,
  addRandomKeyTask,
  remove,
  removeIf,
  // Test helper
  _resetForTests
};
