/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Smoke tests for the in-memory TaskResultStore used by the public/community
 * standalone runtime.
 */

'use strict';

const {describe, beforeEach, test, expect} = require('@jest/globals');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const memoryConnector = require('../../DocService/sources/databaseConnectors/memoryConnector');
const memoryTaskResultStore = memoryConnector;
const memoryChangeStore = memoryConnector;
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');

function makeCtx(tenant) {
  return {
    tenant: tenant || 'tenant-default',
    logger: {debug() {}, info() {}, warn() {}, error() {}}
  };
}

function makeTask(overrides) {
  return {
    tenant: 'tenant-default',
    key: 'doc-1',
    status: commonDefines.FileStatus.None,
    statusInfo: constants.NO_ERROR,
    userIndex: 1,
    changeId: 0,
    callback: '',
    baseurl: '',
    ...overrides
  };
}

describe('MemoryTaskResultStore', () => {
  beforeEach(() => {
    memoryConnector._resetForTests();
  });

  test('upsert inserts a new row and returns isInsert=true with userIndex', async () => {
    const ctx = makeCtx();
    const task = makeTask({callback: 'http://callback'});
    const res = await memoryTaskResultStore.upsert(ctx, task);
    expect(res).toEqual({isInsert: true, insertId: 1});

    const rows = await memoryTaskResultStore.select(ctx, 'doc-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('doc-1');
    expect(rows[0].user_index).toBe(1);
    expect(rows[0].callback).toContain('http://callback');
  });

  test('upsert on existing row increments user_index and appends callback', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({callback: 'http://callback-1'}));
    const second = await memoryTaskResultStore.upsert(ctx, makeTask({callback: 'http://callback-2'}));
    expect(second).toEqual({isInsert: false, insertId: 2});

    const [row] = await memoryTaskResultStore.select(ctx, 'doc-1');
    expect(row.user_index).toBe(2);
    expect(row.callback).toContain('http://callback-1');
    expect(row.callback).toContain('http://callback-2');
  });

  test('update with setPassword=true replaces the password field', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask());
    await memoryTaskResultStore.update(ctx, {tenant: 'tenant-default', key: 'doc-1', password: 'pass-1'});
    let [row] = await memoryTaskResultStore.select(ctx, 'doc-1');
    expect(row.password).toContain('pass-1');

    await memoryTaskResultStore.update(ctx, {tenant: 'tenant-default', key: 'doc-1', password: 'pass-final'}, true);
    [row] = await memoryTaskResultStore.select(ctx, 'doc-1');
    expect(row.password).toBe('pass-final');
  });

  test('updateIf applies fields only when mask matches', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({status: commonDefines.FileStatus.Ok}));

    const noMatch = await memoryTaskResultStore.updateIf(
      ctx,
      {status: commonDefines.FileStatus.SaveVersion},
      {tenant: 'tenant-default', key: 'doc-1', status: commonDefines.FileStatus.WaitQueue}
    );
    expect(noMatch.affectedRows).toBe(0);

    const match = await memoryTaskResultStore.updateIf(
      ctx,
      {status: commonDefines.FileStatus.SaveVersion},
      {tenant: 'tenant-default', key: 'doc-1', status: commonDefines.FileStatus.Ok}
    );
    expect(match.affectedRows).toBe(1);

    const [row] = await memoryTaskResultStore.select(ctx, 'doc-1');
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
  });

  test('updateIf with callback=NOT_EMPTY only updates when callback is present', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-empty'}));
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-cb', callback: 'http://x'}));

    const r1 = await memoryTaskResultStore.updateIf(
      ctx,
      {status: commonDefines.FileStatus.SaveVersion},
      {tenant: 'tenant-default', key: 'doc-empty', callback: 'NOT_EMPTY'}
    );
    expect(r1.affectedRows).toBe(0);

    const r2 = await memoryTaskResultStore.updateIf(
      ctx,
      {status: commonDefines.FileStatus.SaveVersion},
      {tenant: 'tenant-default', key: 'doc-cb', callback: 'NOT_EMPTY'}
    );
    expect(r2.affectedRows).toBe(1);
  });

  test('remove and removeIf delete rows as expected', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-a'}));
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-b', status: commonDefines.FileStatus.Ok}));

    expect((await memoryTaskResultStore.remove(ctx, 'doc-a')).affectedRows).toBe(1);
    expect(await memoryTaskResultStore.select(ctx, 'doc-a')).toHaveLength(0);

    const noMatch = await memoryTaskResultStore.removeIf(ctx, {tenant: 'tenant-default', key: 'doc-b', status: commonDefines.FileStatus.None});
    expect(noMatch.affectedRows).toBe(0);
    const match = await memoryTaskResultStore.removeIf(ctx, {tenant: 'tenant-default', key: 'doc-b', status: commonDefines.FileStatus.Ok});
    expect(match.affectedRows).toBe(1);
  });

  test('getCountWithStatus counts only rows within expiry window', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-1', status: commonDefines.FileStatus.SaveVersion}));
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-2', status: commonDefines.FileStatus.Ok}));

    expect(await memoryTaskResultStore.getCountWithStatus(ctx, commonDefines.FileStatus.SaveVersion, 60000)).toBe(1);
    expect(await memoryTaskResultStore.getCountWithStatus(ctx, commonDefines.FileStatus.Ok, 60000)).toBe(1);
    expect(await memoryTaskResultStore.getCountWithStatus(ctx, commonDefines.FileStatus.SaveVersion, -1)).toBe(0);
  });

  test('getExpired returns rows older than cutoff with no pending changes', async () => {
    const ctx = makeCtx();
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-old'}));
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-with-changes'}));

    // Force last_open_date into the past so doc-old is considered expired.
    const stored = await memoryTaskResultStore.select(ctx, 'doc-old');
    expect(stored).toHaveLength(1);

    // Insert a change for the second doc so getExpired must skip it.
    await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: new Date()}], 'doc-with-changes', 0, {
      id: 'u',
      idOriginal: 'u',
      username: 'u'
    });

    // Make both task rows artificially old by calling getExpired with negative expireSeconds.
    const expired = await memoryTaskResultStore.getExpired(ctx, 10, -1);
    expect(expired.map(r => r.id)).toEqual(['doc-old']);
  });

  test('addRandomKeyTask generates a unique key and inserts the row', async () => {
    const ctx = makeCtx();
    const co = require('co');
    const task = await co(memoryTaskResultStore.addRandomKeyTask(ctx, 'doc'));
    expect(task.key).toMatch(/^doc_/);
    const rows = await memoryTaskResultStore.select(ctx, task.key);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(commonDefines.FileStatus.WaitQueue);
  });

  test('restoreInitialPassword restores the recorded initial password', async () => {
    const ctx = makeCtx();
    const connectorUtilities = require('../../DocService/sources/databaseConnectors/connectorUtilities');
    await memoryTaskResultStore.upsert(ctx, makeTask({key: 'doc-pw'}));

    // Seed an initial password segment (no `change` flag).
    const initialPassword = new connectorUtilities.DocumentPassword();
    initialPassword.fromValues('initial-secret');
    await memoryTaskResultStore.update(ctx, {tenant: 'tenant-default', key: 'doc-pw', password: 'initial-secret'});

    // Add a change segment so current diverges from initial.
    await memoryTaskResultStore.update(ctx, {
      tenant: 'tenant-default',
      key: 'doc-pw',
      password: 'changed-secret',
      innerPasswordChange: 'change-token'
    });

    let [row] = await memoryTaskResultStore.select(ctx, 'doc-pw');
    expect(row.password).toContain('initial-secret');
    expect(row.password).toContain('changed-secret');

    await memoryTaskResultStore.restoreInitialPassword(ctx, 'doc-pw');
    [row] = await memoryTaskResultStore.select(ctx, 'doc-pw');
    expect(row.password).toContain('initial-secret');
    expect(row.password).not.toContain('changed-secret');
  });
});
