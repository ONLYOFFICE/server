/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const {afterEach, beforeEach, describe, expect, test, jest: jestApi} = require('@jest/globals');

const pubsubInstances = [];
const queueInstances = [];

jestApi.mock('../../DocService/sources/pubsubRabbitMQ', () =>
  jestApi.fn().mockImplementation(() => {
    const instance = {
      initPromise: jestApi.fn().mockResolvedValue(undefined),
      publish: jestApi.fn().mockResolvedValue(undefined),
      close: jestApi.fn().mockResolvedValue(undefined)
    };
    pubsubInstances.push(instance);
    return instance;
  })
);

jestApi.mock('../../Common/sources/taskqueueRabbitMQ', () =>
  jestApi.fn().mockImplementation(() => {
    const instance = {
      initPromise: jestApi.fn().mockResolvedValue(undefined),
      close: jestApi.fn().mockResolvedValue(undefined)
    };
    queueInstances.push(instance);
    return instance;
  })
);

jestApi.mock('../../DocService/sources/databaseConnectors/baseConnector', () => {
  function DocumentAdditional() {}
  DocumentAdditional.prototype.getShardKey = jestApi.fn(() => undefined);
  DocumentAdditional.prototype.getWopiSrc = jestApi.fn(() => undefined);
  return {
    DocumentAdditional,
    getDocumentsWithChanges: jestApi.fn(),
    getCountWithStatus: jestApi.fn()
  };
});

jestApi.mock('../../DocService/sources/taskresult', () => ({
  select: jestApi.fn()
}));

jestApi.mock('../../DocService/sources/DocsCoServer', () => ({
  getEditorsCountPromise: jestApi.fn(),
  hasChanges: jestApi.fn(),
  getIsShutdown: jestApi.fn()
}));

jestApi.mock('../../DocService/sources/canvasservice', () => ({
  saveChangesToForgotten: jestApi.fn()
}));

jestApi.mock('../../Common/sources/storage/storage-base', () => ({
  listObjects: jestApi.fn()
}));

jestApi.mock('../../Common/sources/utils', () => ({
  sleep: jestApi.fn(),
  getConvertionTimeout: jestApi.fn().mockReturnValue(60000)
}));

const shutdownModule = require('../../DocService/sources/shutdown');
const sqlBase = require('../../DocService/sources/databaseConnectors/baseConnector');
const taskResult = require('../../DocService/sources/taskresult');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const canvasService = require('../../DocService/sources/canvasservice');
const storage = require('../../Common/sources/storage/storage-base');
const utils = require('../../Common/sources/utils');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');

const FileStatus = commonDefines.FileStatus;
// WAIT_TIMEOUT + mocked conversion timeout
const EXEC_TIMEOUT = 30000 + 60000;
const RECOVERY_MAX_DOCS = 1000;
const RECOVERY_BATCH = 100;

let clock;
let timeSpy;

// a Date whose getTime is pinned while every other Date reports the fake clock
function atTime(ms) {
  return Object.assign(new Date(ms), {fixedTime: ms});
}

function makeCtx() {
  const ctx = {
    tenant: 'default',
    docId: undefined,
    userId: undefined,
    logger: {
      debug: jestApi.fn(),
      info: jestApi.fn(),
      warn: jestApi.fn(),
      error: jestApi.fn()
    },
    getCfg: jestApi.fn((_key, fallback) => fallback),
    initTenantCache: jestApi.fn().mockResolvedValue(undefined)
  };
  ctx.init = jestApi.fn((tenant, docId) => {
    ctx.tenant = tenant;
    ctx.docId = docId;
  });
  ctx.setDocId = jestApi.fn(docId => {
    ctx.docId = docId;
  });
  ctx.setShardKey = jestApi.fn();
  ctx.setWopiSrc = jestApi.fn();
  ctx.initDefault = jestApi.fn(() => {
    ctx.tenant = 'default';
    ctx.docId = undefined;
  });
  return ctx;
}

function makeEditorStat(remainingFiles) {
  return {
    cleanupShutdown: jestApi.fn().mockResolvedValue(undefined),
    getShutdownCount: jestApi.fn().mockResolvedValue(remainingFiles)
  };
}

function makeRow(id, overrides) {
  return {
    tenant: 'default',
    id,
    status: FileStatus.Ok,
    status_info: 0,
    callback: '{"userIndex":0,"callback":"http://cb"}',
    last_open_date: atTime(0),
    additional: '',
    ...overrides
  };
}

function makeRows(count, prefix, overrides) {
  const rows = [];
  for (let i = 0; i < count; ++i) {
    rows.push(makeRow(prefix + String(i).padStart(5, '0'), overrides));
  }
  return rows;
}

function findLog(logger, level, prefix) {
  return logger[level].mock.calls.find(call => typeof call[0] === 'string' && call[0].startsWith(prefix));
}

function endLog(logger) {
  return findLog(logger, 'info', 'shutdown recovery end');
}

function claimLog(logger) {
  return findLog(logger, 'info', 'shutdown recovery claimed');
}

function stopLog(logger) {
  return findLog(logger, 'warn', 'shutdown recovery stopped by');
}

// the row is gone and its forgotten copy exists: the outcome of a successful recovery assembly
function selectForgotten() {
  taskResult.select.mockResolvedValue([]);
  storage.listObjects.mockImplementation((_ctx, docId, bucket) => Promise.resolve(bucket ? [`${docId}/output.docx`] : ['Editor.bin']));
}

// the row stays in UpdateVersion without changes: the outcome of the regular callback path
function selectDelivered() {
  taskResult.select.mockImplementation((_ctx, docId) => Promise.resolve([makeRow(docId, {status: FileStatus.UpdateVersion})]));
}

function fullReport(overrides) {
  return {
    finished: true,
    clean: false,
    stoppedBy: null,
    enqueueFailed: 0,
    total: 0,
    claimed: 0,
    missed: 0,
    inFlight: 0,
    noCache: 0,
    status: 0,
    forgotten: 0,
    delivered: 0,
    pending: 0,
    unvisited: 0,
    unverified: 0,
    errors: 0,
    ...overrides
  };
}

beforeEach(() => {
  clock = 0;
  timeSpy = jestApi.spyOn(Date.prototype, 'getTime').mockImplementation(function () {
    return Object.prototype.hasOwnProperty.call(this, 'fixedTime') ? this.fixedTime : clock;
  });
  utils.sleep.mockImplementation(ms => {
    clock += ms;
    return Promise.resolve();
  });
  sqlBase.getDocumentsWithChanges.mockResolvedValue([]);
  sqlBase.getCountWithStatus.mockResolvedValue(0);
  taskResult.select.mockResolvedValue([]);
  canvasService.saveChangesToForgotten.mockResolvedValue('claimed');
  docsCoServer.getEditorsCountPromise.mockResolvedValue(0);
  docsCoServer.hasChanges.mockResolvedValue(false);
  docsCoServer.getIsShutdown.mockReturnValue(true);
  // every document has a cache and no forgotten copy unless a test says otherwise
  storage.listObjects.mockImplementation((_ctx, _docId, bucket) => Promise.resolve(bucket ? [] : ['Editor.bin']));
  pubsubInstances.length = 0;
  queueInstances.length = 0;
});

afterEach(() => {
  timeSpy.mockRestore();
});

describe('shutdown without recovery', () => {
  test('PUT without the flag keeps the old behavior: no enumeration, no assembly', async () => {
    const ctx = makeCtx();
    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, false);

    expect(res).toBe(true);
    expect(sqlBase.getDocumentsWithChanges).not.toHaveBeenCalled();
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(queueInstances).toHaveLength(0);
    expect(pubsubInstances[0].publish).toHaveBeenCalledWith(expect.stringContaining('"status":true'));
    expect(pubsubInstances[0].close).toHaveBeenCalled();
  });

  test('DELETE (resume) never recovers even when the flag is passed', async () => {
    const ctx = makeCtx();
    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), false, true);

    expect(res).toBe(true);
    expect(sqlBase.getDocumentsWithChanges).not.toHaveBeenCalled();
    expect(pubsubInstances[0].publish).toHaveBeenCalledWith(expect.stringContaining('"status":false'));
  });

  test('drain timeout returns false and warns with the remaining counters', async () => {
    const ctx = makeCtx();
    const res = await shutdownModule.shutdown(ctx, makeEditorStat(2), true, false);

    expect(res).toBe(false);
    expect(clock).toBeGreaterThanOrEqual(EXEC_TIMEOUT);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('shutdown timeout'), 2, 0);
  });

  test('the start window always runs out before the drain check', async () => {
    const ctx = makeCtx();
    await shutdownModule.shutdown(ctx, makeEditorStat(0), true, false);

    expect(clock).toBeGreaterThanOrEqual(30000);
    expect(clock).toBeLessThan(EXEC_TIMEOUT);
  });
});

describe('shutdown with recovery', () => {
  test('an orphan Ok row is claimed for a forgotten assembly with the shutdown queue', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-orphan', {status_info: 5})]);
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(queueInstances).toHaveLength(1);
    expect(queueInstances[0].initPromise).toHaveBeenCalledWith(true, false, false, false, false, false);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(1);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledWith(ctx, 'doc-orphan', FileStatus.Ok, 5, queueInstances[0]);
    expect(queueInstances[0].close).toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('parked in forgotten'), 'doc-orphan');
    expect(endLog(ctx.logger)).toEqual([expect.any(String), true, 1, 0, 0, 0, 0, 0, 0, 'none']);
    expect(shutdownModule.getLastRecoveryReport()).toEqual(fullReport({total: 1, claimed: 1, forgotten: 1, clean: true}));
  });

  test('recovery starts only after the pubsub start window', async () => {
    const ctx = makeCtx();
    let enumeratedAt = -1;
    sqlBase.getDocumentsWithChanges.mockImplementation(() => {
      enumeratedAt = clock;
      return Promise.resolve([makeRow('doc-orphan')]);
    });
    selectForgotten();

    await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(enumeratedAt).toBeGreaterThanOrEqual(30000);
  });

  test('the callback column and the assembly marker do not decide the branch: both rows are claimed', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([
      makeRow('doc-no-callback', {callback: ''}),
      makeRow('doc-null-callback', {callback: null}),
      makeRow('doc-marker', {status_info: constants.FILE_NOT_ASSEMBLED})
    ]);
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten.mock.calls.map(call => call[1]).sort()).toEqual([
      'doc-marker',
      'doc-no-callback',
      'doc-null-callback'
    ]);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledWith(
      ctx,
      'doc-marker',
      FileStatus.Ok,
      constants.FILE_NOT_ASSEMBLED,
      expect.anything()
    );
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({claimed: 3, forgotten: 3});
  });

  test('rows that cannot be assembled are skipped; saves in flight are verified', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([
      makeRow('doc-saving', {status: FileStatus.SaveVersion, last_open_date: atTime(29000)}),
      makeRow('doc-updating', {status: FileStatus.UpdateVersion}),
      makeRow('doc-none', {status: FileStatus.None}),
      makeRow('doc-queued', {status: FileStatus.WaitQueue})
    ]);
    selectDelivered();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(claimLog(ctx.logger)).toEqual([expect.any(String), 0, 4, 0, 0, 2, 0, 2, 0, 0]);
    expect(taskResult.select.mock.calls.map(call => call[1]).sort()).toEqual(['doc-none', 'doc-queued', 'doc-saving', 'doc-updating']);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({inFlight: 2, status: 2, delivered: 4});
  });

  test('a skipped status row that still holds changes leaves the report not clean', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-none', {status: FileStatus.None})]);
    taskResult.select.mockResolvedValue([makeRow('doc-none', {status: FileStatus.None})]);
    docsCoServer.hasChanges.mockResolvedValue(true);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: null, status: 1, pending: 1});
  });

  test('a document without a cache is skipped, kept in the database and leaves the report not clean', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-no-cache')]);
    storage.listObjects.mockResolvedValue([]);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(storage.listObjects).toHaveBeenCalledWith(ctx, 'doc-no-cache');
    expect(ctx.logger.debug).toHaveBeenCalledWith('shutdown recovery skip %s: %s', 'noCache', 'doc-no-cache');
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: null, claimed: 0, noCache: 1});
  });

  test('a save older than the drain window is taken over with its own token as the CAS mask', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([
      makeRow('doc-stale', {status: FileStatus.SaveVersion, status_info: 777, last_open_date: atTime(-EXEC_TIMEOUT)})
    ]);
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledWith(ctx, 'doc-stale', FileStatus.SaveVersion, 777, expect.anything());
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({claimed: 1, inFlight: 0, forgotten: 1});
  });

  test('a save that was in flight before the shutdown and still holds changes is reported pending', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-old-callback', {status: FileStatus.UpdateVersion})]);
    taskResult.select.mockResolvedValue([makeRow('doc-old-callback', {status: FileStatus.UpdateVersion})]);
    docsCoServer.hasChanges.mockResolvedValue(true);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('still %s'),
      'pending',
      'doc-old-callback',
      FileStatus.UpdateVersion,
      0,
      false
    );
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: null, claimed: 0, inFlight: 1, pending: 1});
  });

  test('presence left over by a killed process does not stop the claim', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-crashed')]);
    // a killed process leaves its presence in redis for expire.presence, so it cannot vouch for a live session
    docsCoServer.getEditorsCountPromise.mockResolvedValue(1);
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(docsCoServer.getEditorsCountPromise).not.toHaveBeenCalled();
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledWith(ctx, 'doc-crashed', FileStatus.Ok, 0, expect.anything());
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: true, claimed: 1, forgotten: 1});
  });

  test('a lost CAS counts as missed, not claimed, and the row is still verified', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-raced')]);
    canvasService.saveChangesToForgotten.mockResolvedValue('missed');
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(1);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({claimed: 0, missed: 1, forgotten: 1});
  });

  test('an enqueue failure is counted separately and leaves the report not clean', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-queue-down')]);
    canvasService.saveChangesToForgotten.mockResolvedValue('enqueueFailed');
    taskResult.select.mockResolvedValue([makeRow('doc-queue-down', {status: FileStatus.Ok, status_info: constants.FILE_NOT_ASSEMBLED})]);
    docsCoServer.hasChanges.mockResolvedValue(true);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('enqueue failed'), 'doc-queue-down');
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, claimed: 0, enqueueFailed: 1, noCache: 1});
  });

  test('verification tells forgotten, delivered, removed, pending and failed assemblies apart; leftovers are not clean', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([
      makeRow('doc-forgotten'),
      makeRow('doc-delivered'),
      makeRow('doc-removed'),
      makeRow('doc-pending'),
      makeRow('doc-failed')
    ]);
    taskResult.select.mockImplementation((_ctx, docId) => {
      if ('doc-delivered' === docId) {
        return Promise.resolve([makeRow(docId, {status: FileStatus.UpdateVersion})]);
      }
      if ('doc-pending' === docId) {
        return Promise.resolve([makeRow(docId, {status: FileStatus.SaveVersion, status_info: 42})]);
      }
      if ('doc-failed' === docId) {
        return Promise.resolve([makeRow(docId, {status: FileStatus.Ok, status_info: constants.FILE_NOT_ASSEMBLED})]);
      }
      return Promise.resolve([]);
    });
    storage.listObjects.mockImplementation((_ctx, docId, bucket) => {
      if (!bucket) {
        return Promise.resolve(['Editor.bin']);
      }
      return Promise.resolve('doc-forgotten' === docId ? ['doc-forgotten/output.docx'] : []);
    });
    docsCoServer.hasChanges.mockImplementation((_ctx, docId) => Promise.resolve('doc-pending' === docId || 'doc-failed' === docId));

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(5);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false});
    expect(endLog(ctx.logger)).toEqual([expect.any(String), false, 1, 1, 1, 1, 0, 0, 1, 'none']);
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('parked in forgotten'), 'doc-forgotten');
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('without forgotten copy'), 'doc-removed');
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('still %s'), 'pending', 'doc-pending', FileStatus.SaveVersion, 42, true);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('still %s'),
      'noCache',
      'doc-failed',
      FileStatus.Ok,
      constants.FILE_NOT_ASSEMBLED,
      true
    );
  });

  test('verification stops at the deadline and reports the tail as unverified', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue(makeRows(3, 'doc-'));
    selectDelivered();
    docsCoServer.hasChanges.mockImplementation(() => {
      clock = EXEC_TIMEOUT;
      return Promise.resolve(false);
    });

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(3);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('verification cut by the deadline'), 2);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: null, claimed: 3, delivered: 1, unverified: 2});
  });

  test('rows are walked in a stable tenant/id order and the context is reset at the end', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([
      makeRow('doc-b1', {tenant: 'tenant-b'}),
      makeRow('doc-a2', {tenant: 'tenant-a'}),
      makeRow('doc-a1', {tenant: 'tenant-a'})
    ]);
    selectForgotten();
    const seen = [];
    canvasService.saveChangesToForgotten.mockImplementation(context => {
      seen.push(context.tenant + '/' + context.docId);
      return Promise.resolve('claimed');
    });

    await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(seen).toEqual(['tenant-a/doc-a1', 'tenant-a/doc-a2', 'tenant-b/doc-b1']);
    expect(ctx.init).toHaveBeenCalledWith('tenant-a', 'doc-a1', undefined, undefined, undefined);
    expect(ctx.init).toHaveBeenCalledWith('tenant-b', 'doc-b1', undefined, undefined, undefined);
    expect(ctx.initDefault).toHaveBeenCalled();
    expect(ctx.tenant).toBe('default');
  });

  test('a failing document does not stop the others but is counted in errors', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-bad'), makeRow('doc-good')]);
    selectForgotten();
    canvasService.saveChangesToForgotten.mockImplementation((_ctx, docId) =>
      'doc-bad' === docId ? Promise.reject(new Error('boom')) : Promise.resolve('claimed')
    );

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(2);
    expect(claimLog(ctx.logger)).toEqual([expect.any(String), 1, 2, 0, 0, 0, 0, 0, 0, 1]);
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('shutdown recovery error'), expect.stringContaining('boom'));
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({finished: true, clean: false, errors: 1, forgotten: 1});
  });

  test('the per-run cap counts claimed assemblies, not skipped rows, and leaves the tail unvisited', async () => {
    const ctx = makeCtx();
    const rows = makeRows(5, 'a-none-', {status: FileStatus.None}).concat(makeRows(RECOVERY_MAX_DOCS + 1, 'b-doc-'));
    sqlBase.getDocumentsWithChanges.mockResolvedValue(rows);
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(RECOVERY_MAX_DOCS);
    expect(stopLog(ctx.logger)).toEqual([expect.any(String), 'cap', 1]);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({
      clean: false,
      stoppedBy: 'cap',
      total: rows.length,
      claimed: RECOVERY_MAX_DOCS,
      unvisited: 1,
      unverified: 0,
      status: 5,
      forgotten: RECOVERY_MAX_DOCS + 5
    });
  });

  test('assemblies are claimed in batches and each batch is drained before the next one', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue(makeRows(2 * RECOVERY_BATCH + 50, 'doc-'));
    selectForgotten();
    const timeline = [];
    canvasService.saveChangesToForgotten.mockImplementation(() => {
      timeline.push('start');
      return Promise.resolve('claimed');
    });
    const editorStat = makeEditorStat(0);
    editorStat.getShutdownCount.mockImplementation(() => {
      timeline.push('poll');
      return Promise.resolve(0);
    });

    const res = await shutdownModule.shutdown(ctx, editorStat, true, true);

    expect(res).toBe(true);
    const starts = timeline.reduce((acc, entry, index) => (entry === 'start' ? acc.concat(index) : acc), []);
    expect(starts).toHaveLength(2 * RECOVERY_BATCH + 50);
    expect(timeline.slice(starts[0] + 1, starts[RECOVERY_BATCH - 1])).not.toContain('poll');
    expect(timeline.slice(starts[RECOVERY_BATCH - 1] + 1, starts[RECOVERY_BATCH])).toContain('poll');
    expect(timeline.slice(starts[2 * RECOVERY_BATCH - 1] + 1, starts[2 * RECOVERY_BATCH])).toContain('poll');
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({stoppedBy: null, claimed: 2 * RECOVERY_BATCH + 50, unvisited: 0});
  });

  test('a batch that never drains stops claiming at the deadline and leaves the rest for the next run', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue(makeRows(250, 'doc-'));
    selectForgotten();

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(1), true, true);

    expect(res).toBe(false);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(RECOVERY_BATCH);
    expect(clock).toBeGreaterThanOrEqual(EXEC_TIMEOUT);
    expect(stopLog(ctx.logger)).toEqual([expect.any(String), 'timeout', 150]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('shutdown timeout'), 1, 0);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({
      stoppedBy: 'timeout',
      claimed: RECOVERY_BATCH,
      unvisited: 150,
      unverified: RECOVERY_BATCH
    });
  });

  test('a resume (flag cleared) between rows stops claiming', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue(makeRows(10, 'doc-'));
    selectForgotten();
    docsCoServer.getIsShutdown.mockImplementation(() => canvasService.saveChangesToForgotten.mock.calls.length < 3);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(3);
    expect(stopLog(ctx.logger)).toEqual([expect.any(String), 'aborted', 7]);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: 'aborted', claimed: 3, unvisited: 7, forgotten: 3});
  });

  test('a resume that lands during the cache check does not claim the row', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue(makeRows(2, 'doc-'));
    storage.listObjects.mockImplementation(() => {
      docsCoServer.getIsShutdown.mockReturnValue(false);
      return Promise.resolve(['Editor.bin']);
    });

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(canvasService.saveChangesToForgotten).not.toHaveBeenCalled();
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: 'aborted', claimed: 0, unvisited: 2});
  });

  test('a resume that lands inside the last row is still recorded as aborted', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-last')]);
    selectForgotten();
    canvasService.saveChangesToForgotten.mockImplementation(() => {
      docsCoServer.getIsShutdown.mockReturnValue(false);
      return Promise.resolve('claimed');
    });

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(stopLog(ctx.logger)).toEqual([expect.any(String), 'aborted', 0]);
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({clean: false, stoppedBy: 'aborted', claimed: 1, unvisited: 0, forgotten: 1});
  });

  test('recovery is skipped and reported not clean when this process never saw the shutdown flag', async () => {
    const ctx = makeCtx();
    docsCoServer.getIsShutdown.mockReturnValue(false);
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-orphan')]);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(true);
    expect(sqlBase.getDocumentsWithChanges).not.toHaveBeenCalled();
    expect(queueInstances).toHaveLength(0);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('shutdown recovery skipped'));
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({finished: true, clean: false, stoppedBy: 'noFlag', claimed: 0});
  });

  test('a drain timeout leaves the claimed documents unverified', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-slow')]);
    taskResult.select.mockResolvedValue([makeRow('doc-slow', {status: FileStatus.SaveVersion})]);
    docsCoServer.hasChanges.mockResolvedValue(true);

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(1), true, true);

    expect(res).toBe(false);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(1);
    expect(endLog(ctx.logger)).toEqual([expect.any(String), false, 0, 0, 0, 0, 0, 1, 0, 'none']);
  });

  test('enumeration failure ends the run as failed but still closes queue and pubsub', async () => {
    const ctx = makeCtx();
    sqlBase.getDocumentsWithChanges.mockRejectedValue(new Error('db down'));

    const res = await shutdownModule.shutdown(ctx, makeEditorStat(0), true, true);

    expect(res).toBe(false);
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('shutdown error'), expect.stringContaining('db down'));
    expect(queueInstances[0].close).toHaveBeenCalled();
    expect(pubsubInstances[0].close).toHaveBeenCalled();
    expect(shutdownModule.getLastRecoveryReport()).toMatchObject({finished: true, stoppedBy: 'error'});
  });

  test('a second PUT joins the run in progress instead of resetting its counters', async () => {
    const ctx = makeCtx();
    const editorStat = makeEditorStat(0);
    sqlBase.getDocumentsWithChanges.mockResolvedValue([makeRow('doc-orphan')]);
    selectForgotten();

    const first = shutdownModule.shutdown(ctx, editorStat, true, true);
    const second = shutdownModule.shutdown(makeCtx(), editorStat, true, false);
    expect(second).toBe(first);
    const results = await Promise.all([first, second]);

    expect(results).toEqual([true, true]);
    expect(pubsubInstances).toHaveLength(1);
    expect(editorStat.cleanupShutdown).toHaveBeenCalledTimes(2);
    expect(canvasService.saveChangesToForgotten).toHaveBeenCalledTimes(1);

    const third = await shutdownModule.shutdown(makeCtx(), editorStat, true, false);
    expect(third).toBe(true);
    expect(pubsubInstances).toHaveLength(2);
  });
});
