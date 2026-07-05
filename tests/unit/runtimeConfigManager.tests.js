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
