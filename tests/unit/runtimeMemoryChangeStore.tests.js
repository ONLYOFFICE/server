/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Smoke tests for the in-memory ChangeStore used by the public/community
 * standalone runtime.
 */

'use strict';

const {describe, beforeEach, test, expect} = require('@jest/globals');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const memoryChangeStore = require('../../DocService/sources/databaseConnectors/memoryConnector');

const ctx = {tenant: 'tenant-1'};
const user = {id: 'user-1', idOriginal: 'user-1-orig', username: 'Alice'};

describe('MemoryChangeStore', () => {
  beforeEach(() => {
    memoryChangeStore._resetForTests();
  });

  test('insertChangesPromise stores records and getChangesIndexPromise returns max change_id', async () => {
    await memoryChangeStore.insertChangesPromise(
      ctx,
      [
        {change: 'c1', time: new Date()},
        {change: 'c2', time: new Date()}
      ],
      'doc-1',
      0,
      user
    );

    const idx = await memoryChangeStore.getChangesIndexPromise(ctx, 'doc-1');
    expect(idx).toEqual([{change_id: 1}]);

    const empty = await memoryChangeStore.getChangesIndexPromise(ctx, 'doc-2');
    expect(empty).toEqual([]);
  });

  test('getChangesPromise returns range filtered records ordered by change_id', async () => {
    const t = new Date();
    await memoryChangeStore.insertChangesPromise(
      ctx,
      [
        {change: 'c0', time: t},
        {change: 'c1', time: t},
        {change: 'c2', time: t},
        {change: 'c3', time: t}
      ],
      'doc-1',
      0,
      user
    );

    const all = await memoryChangeStore.getChangesPromise(ctx, 'doc-1');
    expect(all.map(r => r.change_id)).toEqual([0, 1, 2, 3]);

    const ranged = await memoryChangeStore.getChangesPromise(ctx, 'doc-1', 1, 3);
    expect(ranged.map(r => r.change_id)).toEqual([1, 2]);
  });

  test('getChangesPromise filters by opt_time (changes before or equal)', async () => {
    const old = new Date(2020, 0, 1);
    const recent = new Date(2026, 0, 1);

    await memoryChangeStore.insertChangesPromise(
      ctx,
      [
        {change: 'c0', time: old},
        {change: 'c1', time: recent}
      ],
      'doc-1',
      0,
      user
    );

    const before = await memoryChangeStore.getChangesPromise(ctx, 'doc-1', null, null, new Date(2023, 0, 1));
    expect(before.map(r => r.change_data)).toEqual(['c0']);
  });

  test('deleteChangesPromise(deleteIndex) removes the tail and keeps prior records', async () => {
    const t = new Date();
    await memoryChangeStore.insertChangesPromise(
      ctx,
      [
        {change: 'c0', time: t},
        {change: 'c1', time: t},
        {change: 'c2', time: t}
      ],
      'doc-1',
      0,
      user
    );

    const res = await memoryChangeStore.deleteChangesPromise(ctx, 'doc-1', 2);
    expect(res.affectedRows).toBe(1);

    const remaining = await memoryChangeStore.getChangesPromise(ctx, 'doc-1');
    expect(remaining.map(r => r.change_id)).toEqual([0, 1]);
  });

  test('deleteChangesPromise(null) removes all records for the document', async () => {
    const t = new Date();
    await memoryChangeStore.insertChangesPromise(
      ctx,
      [
        {change: 'c0', time: t},
        {change: 'c1', time: t}
      ],
      'doc-1',
      0,
      user
    );

    const res = await memoryChangeStore.deleteChangesPromise(ctx, 'doc-1', null);
    expect(res.affectedRows).toBe(2);

    expect(await memoryChangeStore.getChangesPromise(ctx, 'doc-1')).toEqual([]);
    expect(await memoryChangeStore.getChangesIndexPromise(ctx, 'doc-1')).toEqual([]);
  });

  describe('getDocumentsWithChanges', () => {
    test('does not return change-only docs that have no task_result row', async () => {
      const t = new Date();
      await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: t}], 'doc-norow', 0, user);

      const docs = await memoryChangeStore.getDocumentsWithChanges();
      expect(docs.some(d => d.id === 'doc-norow')).toBe(false);
    });

    test('returns full task_result row when both task_result and changes exist', async () => {
      const t = new Date();
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-1', callback: ''});
      await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: t}], 'doc-1', 0, user);

      const docs = await memoryChangeStore.getDocumentsWithChanges();
      expect(docs.length).toBe(1);
      expect(docs[0].tenant).toBe('tenant-1');
      expect(docs[0].id).toBe('doc-1');
      expect(docs[0].status).toBeDefined();
    });

    test('does not return task_result rows that have no changes', async () => {
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-nochanges', callback: ''});

      const docs = await memoryChangeStore.getDocumentsWithChanges();
      expect(docs.some(d => d.id === 'doc-nochanges')).toBe(false);
    });

    test('spans multiple tenants when both have task_result and changes', async () => {
      const t = new Date();
      const ctx2 = {tenant: 'tenant-2'};
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-1', callback: ''});
      await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: t}], 'doc-1', 0, user);
      await memoryChangeStore.upsert(ctx2, {tenant: ctx2.tenant, key: 'doc-2', callback: ''});
      await memoryChangeStore.insertChangesPromise(ctx2, [{change: 'c0', time: t}], 'doc-2', 0, user);

      const docs = await memoryChangeStore.getDocumentsWithChanges();
      expect(docs.length).toBe(2);
      expect(docs.some(d => d.tenant === 'tenant-1' && d.id === 'doc-1')).toBe(true);
      expect(docs.some(d => d.tenant === 'tenant-2' && d.id === 'doc-2')).toBe(true);
    });
  });

  describe('getEmptyCallbacks', () => {
    test('does not return empty-callback rows that have no changes', async () => {
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-nochanges', callback: ''});

      const docs = await memoryChangeStore.getEmptyCallbacks();
      expect(docs.some(d => d.id === 'doc-nochanges')).toBe(false);
    });

    test('returns {tenant, id} for docs with both changes and empty callback', async () => {
      const t = new Date();
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-1', callback: ''});
      await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: t}], 'doc-1', 0, user);

      const docs = await memoryChangeStore.getEmptyCallbacks();
      expect(docs).toEqual([{tenant: 'tenant-1', id: 'doc-1'}]);
    });

    test('excludes doc with non-empty callback even when changes exist', async () => {
      const t = new Date();
      await memoryChangeStore.upsert(ctx, {tenant: ctx.tenant, key: 'doc-cb', callback: 'https://example.com/callback'});
      await memoryChangeStore.insertChangesPromise(ctx, [{change: 'c0', time: t}], 'doc-cb', 0, user);

      const docs = await memoryChangeStore.getEmptyCallbacks();
      expect(docs.some(d => d.id === 'doc-cb')).toBe(false);
    });
  });

  test('multiple tenants stay isolated', async () => {
    const t = new Date();
    await memoryChangeStore.insertChangesPromise(ctx, [{change: 'a', time: t}], 'doc', 0, user);
    await memoryChangeStore.insertChangesPromise({tenant: 'tenant-2'}, [{change: 'b', time: t}], 'doc', 0, user);

    const t1 = await memoryChangeStore.getChangesPromise(ctx, 'doc');
    const t2 = await memoryChangeStore.getChangesPromise({tenant: 'tenant-2'}, 'doc');

    expect(t1.map(r => r.change_data)).toEqual(['a']);
    expect(t2.map(r => r.change_data)).toEqual(['b']);
  });
});
