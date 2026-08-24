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

const {describe, afterEach, test, expect, jest: jestGlobals} = require('@jest/globals');
const path = require('path');
const fsPromises = require('node:fs/promises');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const CONFIG_PATH = '/cfg/runtime.json';
const RUNTIME_CONFIG = {filePath: CONFIG_PATH, cache: {stdTTL: 0, checkperiod: 0, useClones: false}};

const ctx = {
  logger: {trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}},
  cleanRuntimeConfigCache: jestGlobals.fn()
};

// Config mock factory: a Proxy that overrides runtimeConfig and forwards everything else to the real config.
function makeConfigMock(overrides) {
  const actual = jestGlobals.requireActual('config');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'get') return key => (key in overrides ? overrides[key] : target.get(key));
      if (prop === 'has') return key => key in overrides || target.has(key);
      return target[prop];
    }
  });
}

// Loads a fresh runtimeConfigManager with a known filePath and a spy on utils.readFileStable.
function loadRcm() {
  let rcm, utilsMod, loggerStub;
  jestGlobals.isolateModules(() => {
    jestGlobals.doMock('config', () => makeConfigMock({runtimeConfig: RUNTIME_CONFIG}));
    loggerStub = {
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      shutdown: cb => cb && cb(),
      configureLogger: jestGlobals.fn(),
      getLogger: () => ({trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, addContext() {}}),
      getLoggerConfig: () => ({}),
      getInitialLoggerConfig: () => ({})
    };
    jestGlobals.doMock('../../Common/sources/logger', () => loggerStub);
    utilsMod = require('../../Common/sources/utils');
    jestGlobals.spyOn(utilsMod, 'readFileStable').mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    rcm = require('../../Common/sources/runtimeConfigManager');
  });
  return {rcm, utilsMod, loggerStub};
}

describe('runtimeConfigManager stable read', () => {
  afterEach(() => {
    jestGlobals.restoreAllMocks();
    jestGlobals.useRealTimers();
  });

  test('getConfig returns a legitimate null for an absent file and caches it', async () => {
    const {rcm, utilsMod} = loadRcm();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));

    const first = await rcm.getConfig(ctx);
    const second = await rcm.getConfig(ctx);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(utilsMod.readFileStable).toHaveBeenCalledTimes(1);
  });

  test('getConfig does not cache a transient read failure', async () => {
    const {rcm, utilsMod} = loadRcm();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('boom'), {code: 'EUNSTABLE'}));

    const first = await rcm.getConfig(ctx);
    const second = await rcm.getConfig(ctx);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(utilsMod.readFileStable).toHaveBeenCalledTimes(2);
  });

  test('reloadConfig keeps last good on a transient read, then retries and applies once stable', async () => {
    const {rcm, utilsMod, loggerStub} = loadRcm();
    utilsMod.readFileStable.mockResolvedValue(JSON.stringify({log: {options: {level: 'warn'}}}));
    const good = await rcm.getConfig(ctx);
    expect(good.log.options.level).toBe('warn');

    jestGlobals.useFakeTimers();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('boom'), {code: 'EUNSTABLE'}));
    await rcm.reloadConfig(ctx);
    // transient: last good kept, nothing applied yet, a retry is scheduled
    expect((await rcm.getConfig(ctx)).log.options.level).toBe('warn');
    expect(loggerStub.configureLogger).not.toHaveBeenCalled();

    utilsMod.readFileStable.mockResolvedValue(JSON.stringify({log: {options: {level: 'error'}}}));
    await jestGlobals.advanceTimersByTimeAsync(600);
    // retry read is now stable: the new config gets applied
    expect(loggerStub.configureLogger).toHaveBeenCalledWith({level: 'error'});
    expect((await rcm.getConfig(ctx)).log.options.level).toBe('error');
  });

  test('reloadConfig keeps last good and stops after exhausting retries', async () => {
    const {rcm, utilsMod, loggerStub} = loadRcm();
    utilsMod.readFileStable.mockResolvedValue(JSON.stringify({log: {options: {level: 'warn'}}}));
    await rcm.getConfig(ctx);

    jestGlobals.useFakeTimers();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('boom'), {code: 'EUNSTABLE'}));
    await rcm.reloadConfig(ctx, 1);
    await jestGlobals.advanceTimersByTimeAsync(600); // single retry fires with 0 left -> gives up
    await jestGlobals.advanceTimersByTimeAsync(600); // nothing more is scheduled

    expect(loggerStub.configureLogger).not.toHaveBeenCalled();
    expect((await rcm.getConfig(ctx)).log.options.level).toBe('warn');
  });

  test('replaceConfig applies the new log config immediately, without a watcher poll', async () => {
    const {rcm, utilsMod, loggerStub} = loadRcm();
    jestGlobals.spyOn(fsPromises, 'mkdir').mockResolvedValue();
    jestGlobals.spyOn(fsPromises, 'writeFile').mockResolvedValue();
    const cfg = {log: {options: {level: 'error'}}};

    const result = await rcm.replaceConfig(ctx, cfg);

    expect(result).toBe(cfg);
    expect(loggerStub.configureLogger).toHaveBeenCalledWith({level: 'error'});
    expect(ctx.cleanRuntimeConfigCache).toHaveBeenCalled();
    // served from the in-memory cache the write populated, so no file read is needed
    const after = await rcm.getConfig(ctx);
    expect(after.log.options.level).toBe('error');
    expect(utilsMod.readFileStable).not.toHaveBeenCalled();
  });

  test('saveConfig merges, persists and applies immediately', async () => {
    const {rcm, utilsMod, loggerStub} = loadRcm();
    utilsMod.readFileStable.mockResolvedValue(JSON.stringify({log: {options: {level: 'warn'}}, storage: {a: 1}}));
    jestGlobals.spyOn(fsPromises, 'mkdir').mockResolvedValue();
    const writeSpy = jestGlobals.spyOn(fsPromises, 'writeFile').mockResolvedValue();

    const merged = await rcm.saveConfig(ctx, {log: {options: {level: 'error'}}});

    expect(merged.log.options.level).toBe('error');
    expect(merged.storage.a).toBe(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(loggerStub.configureLogger).toHaveBeenCalledWith({level: 'error'});
    expect(ctx.cleanRuntimeConfigCache).toHaveBeenCalled();
  });

  test('saveConfig throws on a transient read instead of merging onto an empty config', async () => {
    const {rcm, utilsMod} = loadRcm();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('boom'), {code: 'EUNSTABLE'}));
    jestGlobals.spyOn(fsPromises, 'mkdir').mockResolvedValue();
    const writeSpy = jestGlobals.spyOn(fsPromises, 'writeFile').mockResolvedValue();

    await expect(rcm.saveConfig(ctx, {log: {options: {level: 'error'}}})).rejects.toThrow(/unstable/);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('coalesces concurrent misses into a single file read', async () => {
    const {rcm, utilsMod} = loadRcm();
    let releaseRead;
    utilsMod.readFileStable.mockImplementation(() => new Promise(resolve => (releaseRead = resolve)));

    const first = rcm.getConfig(ctx);
    const second = rcm.getConfig(ctx);
    await new Promise(resolve => setImmediate(resolve));
    releaseRead(JSON.stringify({log: {options: {level: 'warn'}}}));
    await Promise.all([first, second]);

    expect(utilsMod.readFileStable).toHaveBeenCalledTimes(1);
  });

  test('saveConfig writes a fresh config when no file exists yet (cold start)', async () => {
    const {rcm, utilsMod, loggerStub} = loadRcm();
    utilsMod.readFileStable.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    jestGlobals.spyOn(fsPromises, 'mkdir').mockResolvedValue();
    const writeSpy = jestGlobals.spyOn(fsPromises, 'writeFile').mockResolvedValue();

    const saved = await rcm.saveConfig(ctx, {log: {options: {level: 'error'}}});

    expect(saved).toEqual({log: {options: {level: 'error'}}});
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(loggerStub.configureLogger).toHaveBeenCalledWith({level: 'error'});
  });
});

const TENANT = 'tenant1';
const CACHE_TTL_MS = 301 * 1000;

const contextLoggerStub = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  shutdown: cb => cb && cb(),
  configureLogger() {},
  getLogger: () => ({trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, addContext() {}}),
  getLoggerConfig: () => ({}),
  getInitialLoggerConfig: () => ({})
};

// Loads a fresh operationContext/tenantManager pair in multitenant mode with a spy on the tenant config read.
function loadModules() {
  let operationContext, tenantManager;
  const readFile = jestGlobals.fn();
  jestGlobals.isolateModules(() => {
    jestGlobals.doMock('fs/promises', () => ({...jestGlobals.requireActual('fs/promises'), readFile}));
    jestGlobals.doMock('../../Common/sources/logger', () => contextLoggerStub);
    // operationContext first: tenantManager -> utils -> operationContext is circular and the reverse order breaks it
    operationContext = require('../../Common/sources/operationContext');
    tenantManager = require('../../Common/sources/tenantManager');
  });
  tenantManager.setMultitenantMode(true);
  return {operationContext, readFile};
}

async function initCtx(operationContext) {
  const ctx = new operationContext.Context();
  ctx.setTenant(TENANT);
  await ctx.initTenantCache();
  return ctx;
}

describe('tenant config cache', () => {
  afterEach(() => {
    jestGlobals.restoreAllMocks();
    jestGlobals.useRealTimers();
  });

  test('picks up a tenant config change written by another instance once the ttl expires', async () => {
    const {operationContext, readFile} = loadModules();
    readFile.mockResolvedValue(JSON.stringify({wopi: {enable: false}}));
    const before = await initCtx(operationContext);
    expect(before.getCfg('wopi.enable', 'absent')).toBe(false);

    // another instance enabled wopi: nothing invalidates this process, only the ttl can
    readFile.mockResolvedValue(JSON.stringify({wopi: {enable: true}}));
    jestGlobals.useFakeTimers();
    await jestGlobals.advanceTimersByTimeAsync(CACHE_TTL_MS);
    const after = await initCtx(operationContext);

    expect(after.getCfg('wopi.enable', 'absent')).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  test('reuses the merged config while the sources are unchanged', async () => {
    const {operationContext, readFile} = loadModules();
    readFile.mockResolvedValue(JSON.stringify({wopi: {enable: true}}));

    const first = await initCtx(operationContext);
    const second = await initCtx(operationContext);

    expect(second.config).toBe(first.config);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  test('caches an absent tenant config instead of reading the file on every request', async () => {
    const {operationContext, readFile} = loadModules();
    readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));

    await initCtx(operationContext);
    await initCtx(operationContext);

    expect(readFile).toHaveBeenCalledTimes(1);
  });

  test('survives a runtime config reload landing between the source reads', async () => {
    const {operationContext, readFile} = loadModules();
    let releaseRead;
    readFile.mockImplementation(() => new Promise(resolve => (releaseRead = resolve)));

    const ctxTenant = new operationContext.Context();
    ctxTenant.setTenant(TENANT);
    const pending = ctxTenant.initTenantCache();
    while (0 === readFile.mock.calls.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
    ctxTenant.cleanRuntimeConfigCache();
    releaseRead(JSON.stringify({wopi: {enable: false}}));

    // the reload drops the merged cache mid-flight, which must not leave the sources unreadable
    await expect(pending).resolves.toBeUndefined();
    expect(ctxTenant.getCfg('wopi.enable', 'absent')).toBe(false);
  });

  test('serves concurrent cache misses with a single file read', async () => {
    const {operationContext, readFile} = loadModules();
    let releaseRead;
    readFile.mockImplementation(() => new Promise(resolve => (releaseRead = resolve)));

    const first = initCtx(operationContext);
    const second = initCtx(operationContext);
    // the runtime config lookup ahead of the tenant read does real io, so wait for the read itself rather than a fixed tick
    while (0 === readFile.mock.calls.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
    releaseRead(JSON.stringify({wopi: {enable: true}}));
    await Promise.all([first, second]);

    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
