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
const {afterEach, describe, expect, jest, test} = require('@jest/globals');
const operationContext = require('../../Common/sources/operationContext');
const tenantManager = require('../../Common/sources/tenantManager');
const utils = require('../../Common/sources/utils');
const editorDataMemory = require('../../DocService/sources/editorDataMemory');
const docsCoServer = require('../../DocService/sources/DocsCoServer');

// public compatibility surface: these names feed ds_expireDoc_connections_* dashboards
const LEGACY_GAUGE_NAMES = ['expireDoc.connections.edit', 'expireDoc.connections.liveview', 'expireDoc.connections.view'];
// per-replica metric: single name, mode and replica carried as DogStatsD tags
const REPLICA_GAUGE_NAME = 'coauth.connections';

function makeConn(mode) {
  switch (mode) {
    case 'view':
      return {user: {view: true}, coEditingMode: 'strict'};
    case 'liveview':
      return {user: {view: true}, coEditingMode: 'fast'};
    case 'closed':
      return {isCloseCoAuthoring: true, user: {view: false}};
    default:
      return {user: {view: false}};
  }
}

function makeStatsD() {
  return {gauge: jest.fn()};
}

function gaugesByName(statsDClient) {
  return Object.fromEntries(statsDClient.gauge.mock.calls);
}

// group coauth.connections calls by their mode tag
function replicaGaugesByMode(statsDClient) {
  const res = {};
  for (const call of statsDClient.gauge.mock.calls) {
    if (REPLICA_GAUGE_NAME === call[0]) {
      const tags = call[3] || [];
      const modeTag = tags.find(tag => tag.startsWith('mode:'));
      res[modeTag ? modeTag.slice('mode:'.length) : 'unknown'] = {value: call[1], tags};
    }
  }
  return res;
}

describe('connection count metrics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getConnectionCountMode classifies connections into exclusive modes', () => {
    expect(utils.getConnectionCountMode(makeConn('edit'))).toBe('edit');
    expect(utils.getConnectionCountMode(makeConn('view'))).toBe('view');
    expect(utils.getConnectionCountMode(makeConn('closed'))).toBe('view');
    expect(utils.getConnectionCountMode(makeConn('liveview'))).toBe('liveview');
  });

  test('no connections -> legacy gauges emit 0/0/0', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    const editorStat = new editorDataMemory.EditorStat();
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, []);
    expect(gaugesByName(statsDClient)).toEqual({
      'expireDoc.connections.edit': 0,
      'expireDoc.connections.liveview': 0,
      'expireDoc.connections.view': 0
    });
  });

  test('mixed connections -> legacy gauges emit per-mode counts', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    const editorStat = new editorDataMemory.EditorStat();
    const connections = [makeConn('edit'), makeConn('edit'), makeConn('view'), makeConn('closed'), makeConn('liveview')];
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, connections);
    expect(gaugesByName(statsDClient)).toEqual({
      'expireDoc.connections.edit': 2,
      'expireDoc.connections.liveview': 1,
      'expireDoc.connections.view': 2
    });
  });

  test('last connection gone -> stale non-zero gauges overwritten by zero', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    const editorStat = new editorDataMemory.EditorStat();
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, [makeConn('edit'), makeConn('view')]);
    expect(gaugesByName(statsDClient)['expireDoc.connections.edit']).toBe(1);
    statsDClient.gauge.mockClear();
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, []);
    expect(gaugesByName(statsDClient)).toEqual({
      'expireDoc.connections.edit': 0,
      'expireDoc.connections.liveview': 0,
      'expireDoc.connections.view': 0
    });
  });

  test('memory storage does not double count live viewers as viewers', async () => {
    const ctx = new operationContext.Context();
    const editorStat = new editorDataMemory.EditorStat();
    const connections = [makeConn('liveview')];
    expect(await editorStat.getLiveViewerConnectionsCount(ctx, connections)).toBe(1);
    expect(await editorStat.getViewerConnectionsCount(ctx, connections)).toBe(0);
    expect(await editorStat.getEditorConnectionsCount(ctx, connections)).toBe(0);
  });

  test('memory storage applies tenant filter to all modes including isCloseCoAuthoring', async () => {
    const ctx = new operationContext.Context();
    jest.spyOn(tenantManager, 'getTenantByConnection').mockImplementation((_ctx, conn) => conn.tenant);
    const editorStat = new editorDataMemory.EditorStat();
    const ownClosed = makeConn('closed');
    ownClosed.tenant = ctx.tenant;
    const foreignClosed = makeConn('closed');
    foreignClosed.tenant = 'foreign-tenant';
    const foreignView = makeConn('view');
    foreignView.tenant = 'foreign-tenant';
    const connections = [ownClosed, foreignClosed, foreignView];
    expect(await editorStat.getViewerConnectionsCount(ctx, connections)).toBe(1);
    expect(await editorStat.getEditorConnectionsCount(ctx, connections)).toBe(0);
  });

  test('legacy gauges use editorStat scope while local gauges stay strictly local', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    // simulates redis mode where storage returns a shared cluster aggregate
    const editorStatStub = {
      getEditorConnectionsCount: jest.fn().mockResolvedValue(7),
      getLiveViewerConnectionsCount: jest.fn().mockResolvedValue(5),
      getViewerConnectionsCount: jest.fn().mockResolvedValue(9)
    };
    const connections = [makeConn('edit')];
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStatStub, connections);
    docsCoServer.emitLocalConnectionGauges(statsDClient, {edit: 1, liveview: 0, view: 0}, ['replica:r1']);
    // legacy keeps the shared editorStat aggregate (7/5/9 from the redis stub)
    const legacy = gaugesByName(statsDClient);
    expect(legacy['expireDoc.connections.edit']).toBe(7);
    expect(legacy['expireDoc.connections.liveview']).toBe(5);
    expect(legacy['expireDoc.connections.view']).toBe(9);
    // replica metric stays strictly local: 1/0/0 from the passed counts, not the stub
    const replica = replicaGaugesByMode(statsDClient);
    expect(replica.edit.value).toBe(1);
    expect(replica.liveview.value).toBe(0);
    expect(replica.view.value).toBe(0);
    expect(replica.edit.tags).toEqual(['replica:r1', 'mode:edit']);
    expect(editorStatStub.getEditorConnectionsCount).toHaveBeenCalledWith(ctx, connections);
  });

  test('local gauges emit zeros for empty counts', () => {
    const statsDClient = makeStatsD();
    docsCoServer.emitLocalConnectionGauges(statsDClient, {edit: 0, liveview: 0, view: 0});
    const replica = replicaGaugesByMode(statsDClient);
    expect(replica.edit.value).toBe(0);
    expect(replica.liveview.value).toBe(0);
    expect(replica.view.value).toBe(0);
  });

  test('missing statsd client is a no-op', async () => {
    const ctx = new operationContext.Context();
    const editorStat = new editorDataMemory.EditorStat();
    await docsCoServer.emitLegacyConnectionGauges(ctx, null, editorStat, []);
    docsCoServer.emitLocalConnectionGauges(null, {edit: 0, liveview: 0, view: 0});
  });

  test('buildReplicaTags returns undefined when no replica id', () => {
    expect(docsCoServer.buildReplicaTags(undefined)).toBeUndefined();
    expect(docsCoServer.buildReplicaTags('')).toBeUndefined();
  });

  test('buildReplicaTags builds replica tag and sanitizes unsafe chars', () => {
    expect(docsCoServer.buildReplicaTags('shard-1')).toEqual(['replica:shard-1']);
    expect(docsCoServer.buildReplicaTags('a:b,c|d#e f')).toEqual(['replica:a_b_c_d_e_f']);
  });

  test('buildReplicaTags passes realistic replica ids through unchanged', () => {
    // k8s pod name and a crypto.randomUUID fallback are already tag-safe
    expect(docsCoServer.buildReplicaTags('documentserver-7c9f8b6d4-xv2kq')).toEqual(['replica:documentserver-7c9f8b6d4-xv2kq']);
    expect(docsCoServer.buildReplicaTags('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toEqual(['replica:3f2504e0-4f89-41d3-9a0c-0305e82c3301']);
  });

  test('replica gauges carry replica and mode tags on a single metric name', () => {
    const statsDClient = makeStatsD();
    docsCoServer.emitLocalConnectionGauges(statsDClient, {edit: 2, liveview: 1, view: 3}, ['replica:r1']);
    for (const call of statsDClient.gauge.mock.calls) {
      expect(call[0]).toBe('coauth.connections');
    }
    const replica = replicaGaugesByMode(statsDClient);
    expect(replica.edit).toEqual({value: 2, tags: ['replica:r1', 'mode:edit']});
    expect(replica.liveview).toEqual({value: 1, tags: ['replica:r1', 'mode:liveview']});
    expect(replica.view).toEqual({value: 3, tags: ['replica:r1', 'mode:view']});
  });

  test('replica gauges still emit mode tags when no replica id is set', () => {
    const statsDClient = makeStatsD();
    docsCoServer.emitLocalConnectionGauges(statsDClient, {edit: 1, liveview: 0, view: 0}, undefined);
    const replica = replicaGaugesByMode(statsDClient);
    expect(replica.edit.tags).toEqual(['mode:edit']);
  });

  test('legacy gauges never carry tags', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    const editorStat = new editorDataMemory.EditorStat();
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, [makeConn('edit')]);
    for (const call of statsDClient.gauge.mock.calls) {
      expect(call[3]).toBeUndefined();
    }
  });

  test('disappeared tenants get zero shard counters', async () => {
    const editorStat = docsCoServer.editorStat;
    const spyEdit = jest.spyOn(editorStat, 'setEditorConnectionsCountByShard');
    const spyLive = jest.spyOn(editorStat, 'setLiveViewerConnectionsCountByShard');
    const spyView = jest.spyOn(editorStat, 'setViewerConnectionsCountByShard');
    await docsCoServer.resetDisappearedTenantCounters(new Set(['tenant-gone', 'tenant-stays']), new Set(['tenant-stays']));
    for (const spy of [spyEdit, spyLive, spyView]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].tenant).toBe('tenant-gone');
      expect(spy.mock.calls[0][2]).toBe(0);
    }
  });

  test('unchanged tenant set writes no shard counters', async () => {
    const editorStat = docsCoServer.editorStat;
    const spyEdit = jest.spyOn(editorStat, 'setEditorConnectionsCountByShard');
    await docsCoServer.resetDisappearedTenantCounters(new Set(['tenant-a']), new Set(['tenant-a']));
    expect(spyEdit).not.toHaveBeenCalled();
  });

  test('emitted metric names match the agreed surface', async () => {
    const ctx = new operationContext.Context();
    const statsDClient = makeStatsD();
    const editorStat = new editorDataMemory.EditorStat();
    await docsCoServer.emitLegacyConnectionGauges(ctx, statsDClient, editorStat, []);
    docsCoServer.emitLocalConnectionGauges(statsDClient, {edit: 0, liveview: 0, view: 0}, ['replica:r1']);
    const emittedNames = statsDClient.gauge.mock.calls.map(call => call[0]);
    // legacy names byte-for-byte preserved, then the single per-replica name three times
    expect(emittedNames).toEqual([...LEGACY_GAUGE_NAMES, REPLICA_GAUGE_NAME, REPLICA_GAUGE_NAME, REPLICA_GAUGE_NAME]);
  });

  test('countConnectionsByMode recounts a mixed array by mode', () => {
    const conns = [makeConn('edit'), makeConn('edit'), makeConn('view'), makeConn('closed'), makeConn('liveview')];
    expect(docsCoServer.countConnectionsByMode(conns)).toEqual({edit: 2, liveview: 1, view: 2});
  });

  test('countConnectionsByMode returns 0/0/0 for no connections', () => {
    expect(docsCoServer.countConnectionsByMode([])).toEqual({edit: 0, liveview: 0, view: 0});
  });
});
