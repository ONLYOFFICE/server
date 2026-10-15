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

const {describe, beforeEach, afterEach, test, expect, jest: jestGlobals} = require('@jest/globals');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const constants = require('../../Common/sources/constants');

const TENANT = 'tenant1';
const NOW = new Date('2026-08-25T00:00:00Z').getTime();
const REVALIDATE_SEC = 5;
const REVALIDATE_MS = REVALIDATE_SEC * 1000;
const TTL_SEC = 20;
const TRIAL_LICENSE = JSON.stringify({start_date: '2020-01-01', end_date: '2030-01-01', users_count: 1000, trial: true, signature: 'sig'});
const PAID_LICENSE = JSON.stringify({start_date: '2020-01-01', end_date: '2030-01-01', users_count: 10, trial: false, signature: 'sig'});

const ctx = {tenant: TENANT, logger: {trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}}};

// A fresh log4js per isolateModules load would pile listeners onto the shared cluster module, so the logger is stubbed out.
const loggerStub = {
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

let baseDir;
let licensePath;

// Config mock factory: a Proxy that overrides the tenants keys and forwards everything else to the real config.
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

function baseLicense() {
  return {
    hasLicense: true,
    type: constants.LICENSE_RESULT.Success,
    mode: constants.LICENSE_MODE.None,
    branding: true,
    customization: true,
    advancedApi: true,
    connections: constants.LICENSE_CONNECTIONS,
    connectionsView: constants.LICENSE_CONNECTIONS,
    usersCount: 0,
    usersViewCount: 0,
    usersExpire: constants.LICENSE_EXPIRE_USERS_ONE_DAY,
    startDate: new Date('2020-01-01T00:00:00Z'),
    endDate: new Date('2030-01-01T00:00:00Z'),
    buildDate: new Date('2026-01-01T00:00:00Z'),
    multitenancy: true,
    graceDays: 0,
    count: 1
  };
}

// Writes the tenant license with an explicit mtime, so a replacement is detectable regardless of clock granularity.
function writeLicense(content, mtimeSec) {
  fs.writeFileSync(licensePath, content);
  fs.utimesSync(licensePath, mtimeSec, mtimeSec);
}

// Builds a paid license of exactly the trial size, so only ino and ctime can tell a tmp+rename swap.
function sameSizePaidLicense() {
  const parsed = {start_date: '2020-01-01', end_date: '2030-01-01', users_count: 10, trial: false, signature: 'sig'};
  parsed.signature += 'x'.repeat(Math.max(0, TRIAL_LICENSE.length - JSON.stringify(parsed).length));
  return JSON.stringify(parsed);
}

// Loads a fresh tenantManager over a real tenant directory and counts the file calls it makes.
function loadTenantManager(revalidateSec = REVALIDATE_SEC) {
  let tm, statSpy, readSpy;
  jestGlobals.isolateModules(() => {
    const actualFs = jestGlobals.requireActual('fs/promises');
    statSpy = jestGlobals.fn((...args) => actualFs.stat(...args));
    readSpy = jestGlobals.fn((...args) => actualFs.readFile(...args));
    jestGlobals.doMock('fs/promises', () => ({...actualFs, stat: statSpy, readFile: readSpy}));
    jestGlobals.doMock('../../Common/sources/logger', () => loggerStub);
    jestGlobals.doMock('config', () =>
      makeConfigMock({
        'tenants.baseDir': baseDir,
        'tenants.cache': {stdTTL: TTL_SEC, checkperiod: 0, useClones: false},
        'tenants.licenseRevalidateInterval': revalidateSec
      })
    );
    // operationContext must win the require cycle it forms with tenantManager, exactly as it does on a real start
    require('../../Common/sources/operationContext');
    tm = require('../../Common/sources/tenantManager');
  });
  tm.setMultitenantMode(true);
  tm.setDefLicense(baseLicense(), {});
  return {tm, statSpy, readSpy};
}

describe('tenant license cache revalidation', () => {
  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-license-'));
    fs.mkdirSync(path.join(baseDir, TENANT));
    licensePath = path.join(baseDir, TENANT, 'license.lic');
    writeLicense(TRIAL_LICENSE, 1000000);
    jestGlobals.useFakeTimers({now: NOW});
  });
  afterEach(() => {
    jestGlobals.useRealTimers();
    jestGlobals.restoreAllMocks();
    fs.rmSync(baseDir, {recursive: true, force: true});
  });

  test('serves the cache without a stat inside the revalidation interval', async () => {
    const {tm, statSpy} = loadTenantManager();

    for (let i = 0; i < 100; i++) {
      const [license] = await tm.getTenantLicense(ctx);
      expect(license.usersCount).toBe(1000);
    }

    expect(statSpy).toHaveBeenCalledTimes(1);
  });

  test('revalidates an unchanged file with a stat and no re-read', async () => {
    const {tm, statSpy} = loadTenantManager();
    const [first] = await tm.getTenantLicense(ctx);

    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [second] = await tm.getTenantLicense(ctx);

    expect(statSpy).toHaveBeenCalledTimes(2);
    // the very same object means the cached entry was reused instead of re-read
    expect(second).toBe(first);
  });

  test('picks up a replaced license within the revalidation interval', async () => {
    const {tm} = loadTenantManager();
    const [trial] = await tm.getTenantLicense(ctx);
    expect(trial.usersCount).toBe(1000);
    expect(trial.mode & constants.LICENSE_MODE.Trial).toBeTruthy();

    writeLicense(PAID_LICENSE, 2000000);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [paid] = await tm.getTenantLicense(ctx);

    expect(paid.usersCount).toBe(10);
    expect(paid.mode & constants.LICENSE_MODE.Trial).toBeFalsy();
  });

  test('coalesces parallel revalidations into a single stat', async () => {
    const {tm, statSpy} = loadTenantManager();
    await tm.getTenantLicense(ctx);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);

    const results = await Promise.all(Array.from({length: 100}, () => tm.getTenantLicense(ctx)));

    expect(results.every(([license]) => 1000 === license.usersCount)).toBe(true);
    expect(statSpy).toHaveBeenCalledTimes(2);
  });

  test('an unchanged revalidation does not extend the cache ttl', async () => {
    const {tm} = loadTenantManager();
    const [first] = await tm.getTenantLicense(ctx);

    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [reused] = await tm.getTenantLicense(ctx);
    expect(reused).toBe(first);

    // past the ttl counted from the last real read, so the entry is gone and the file is read again
    await jestGlobals.advanceTimersByTimeAsync(TTL_SEC * 1000);
    const [afterTtl] = await tm.getTenantLicense(ctx);
    expect(afterTtl).not.toBe(first);
    expect(afterTtl.usersCount).toBe(1000);
  });

  test('stops revalidating when the interval is disabled, the first load still reads the file', async () => {
    const {tm, statSpy} = loadTenantManager(0);
    await tm.getTenantLicense(ctx);

    writeLicense(PAID_LICENSE, 2000000);
    // well past the revalidation interval but inside the cache ttl, so only the ttl could refresh the entry
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS * 2);
    const [stale] = await tm.getTenantLicense(ctx);

    expect(stale.usersCount).toBe(1000);
    expect(statSpy).toHaveBeenCalledTimes(1);
  });

  test('keeps the previous license when a re-read fails and applies the file once it reads again', async () => {
    const {tm} = loadTenantManager();
    await tm.getTenantLicense(ctx);

    writeLicense('{"users_count": 10, broken', 2000000);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [kept] = await tm.getTenantLicense(ctx);

    expect(kept.type).toBe(constants.LICENSE_RESULT.Success);
    expect(kept.usersCount).toBe(1000);

    writeLicense(PAID_LICENSE, 3000000);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [paid] = await tm.getTenantLicense(ctx);
    expect(paid.usersCount).toBe(10);
  });

  test('keeps the previous license when stat fails and does not cache the failure', async () => {
    const {tm, statSpy} = loadTenantManager();
    await tm.getTenantLicense(ctx);

    statSpy.mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [kept] = await tm.getTenantLicense(ctx);
    expect(kept.usersCount).toBe(1000);

    writeLicense(PAID_LICENSE, 2000000);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [paid] = await tm.getTenantLicense(ctx);
    expect(paid.usersCount).toBe(10);
  });

  test('an absent file is revalidated too, so a late delivery is picked up', async () => {
    fs.rmSync(licensePath);
    const {tm} = loadTenantManager();
    const [missing] = await tm.getTenantLicense(ctx);
    expect(missing.type).toBe(constants.LICENSE_RESULT.Error);

    writeLicense(PAID_LICENSE, 2000000);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [paid] = await tm.getTenantLicense(ctx);

    expect(paid.type).toBe(constants.LICENSE_RESULT.Success);
    expect(paid.usersCount).toBe(10);
  });

  test('a deleted file becomes a cached stable state instead of keeping the old license', async () => {
    const {tm, readSpy} = loadTenantManager();
    const [good] = await tm.getTenantLicense(ctx);
    expect(good.usersCount).toBe(1000);

    fs.rmSync(licensePath);
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [gone] = await tm.getTenantLicense(ctx);

    expect(gone.type).toBe(constants.LICENSE_RESULT.Error);
    expect(gone.usersCount).toBe(0);

    // absent is stable, so a call inside the interval is served from the cache without another read
    const readsSoFar = readSpy.mock.calls.length;
    const [again] = await tm.getTenantLicense(ctx);
    expect(again).toBe(gone);
    expect(readSpy).toHaveBeenCalledTimes(readsSoFar);
  });

  test('does not cache a transient read failure when there is nothing good to serve', async () => {
    const {tm, readSpy} = loadTenantManager();
    readSpy.mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));

    const [failed] = await tm.getTenantLicense(ctx);
    expect(failed.type).toBe(constants.LICENSE_RESULT.Error);

    // the very next call reads again, it does not wait out the interval or the ttl
    const [recovered] = await tm.getTenantLicense(ctx);
    expect(recovered.usersCount).toBe(1000);
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  test('coalesces parallel calls into a single read even when that read fails', async () => {
    const {tm, statSpy, readSpy} = loadTenantManager();
    readSpy.mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));

    const results = await Promise.all(Array.from({length: 100}, () => tm.getTenantLicense(ctx)));

    // one shared chain serves every caller, a failure must not fan out into a hundred reads
    expect(results.every(([license]) => constants.LICENSE_RESULT.Error === license.type)).toBe(true);
    expect(statSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledTimes(1);

    const [recovered] = await tm.getTenantLicense(ctx);
    expect(recovered.usersCount).toBe(1000);
  });

  test('retries unreadable content instead of caching it', async () => {
    writeLicense('{"users_count": 10, broken', 1000000);
    const {tm, readSpy} = loadTenantManager();

    const [broken] = await tm.getTenantLicense(ctx);
    expect(broken.type).toBe(constants.LICENSE_RESULT.Error);
    // the file did not change, but a failure is never served from the cache
    await tm.getTenantLicense(ctx);
    expect(readSpy).toHaveBeenCalledTimes(2);

    writeLicense(PAID_LICENSE, 2000000);
    const [paid] = await tm.getTenantLicense(ctx);
    expect(paid.usersCount).toBe(10);
  });

  test('recovers from a transient read of a file that appeared after an absent state', async () => {
    fs.rmSync(licensePath);
    const {tm, readSpy} = loadTenantManager();
    const [missing] = await tm.getTenantLicense(ctx);
    expect(missing.type).toBe(constants.LICENSE_RESULT.Error);

    writeLicense(PAID_LICENSE, 2000000);
    readSpy.mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));
    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [stillMissing] = await tm.getTenantLicense(ctx);
    expect(stillMissing.type).toBe(constants.LICENSE_RESULT.Error);

    // the file has not changed since the failed read, the next call still reads it again
    const [paid] = await tm.getTenantLicense(ctx);
    expect(paid.usersCount).toBe(10);
  });

  test('detects a tmp+rename swap that keeps the size and the mtime', async () => {
    const {tm} = loadTenantManager();
    const [trial] = await tm.getTenantLicense(ctx);
    expect(trial.usersCount).toBe(1000);

    const swapped = sameSizePaidLicense();
    expect(swapped.length).toBe(TRIAL_LICENSE.length);
    const tmpPath = licensePath + '.tmp';
    fs.writeFileSync(tmpPath, swapped);
    fs.renameSync(tmpPath, licensePath);
    fs.utimesSync(licensePath, 1000000, 1000000);

    await jestGlobals.advanceTimersByTimeAsync(REVALIDATE_MS + 200);
    const [paid] = await tm.getTenantLicense(ctx);
    expect(paid.usersCount).toBe(10);
  });

  test('does not touch the file at all outside the multitenant mode', async () => {
    const {tm, statSpy} = loadTenantManager();
    tm.setMultitenantMode(false);

    const [license] = await tm.getTenantLicense(ctx);

    expect(license.usersCount).toBe(0);
    expect(statSpy).not.toHaveBeenCalled();
  });
});

describe('server license reloader', () => {
  const GOOD = [{hasLicense: true}, null];
  const UNREAD = [{hasLicense: false}, null];
  const denied = async () => {
    throw Object.assign(new Error('denied'), {code: 'EACCES'});
  };

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-license-'));
    licensePath = path.join(baseDir, 'license.lic');
  });
  afterEach(() => {
    jestGlobals.restoreAllMocks();
    fs.rmSync(baseDir, {recursive: true, force: true});
  });

  test('reads an unchanged file once and only stats it afterwards', async () => {
    const {tm, statSpy} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, read, apply);

    await reload(true);
    await reload();
    await reload();

    expect(read).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(statSpy).toHaveBeenCalledTimes(3);
  });

  test('applies a replaced file on the next call without waiting for the watcher', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const applied = [];
    const read = async () => [{hasLicense: true}, fs.readFileSync(licensePath, 'utf8')];
    const reload = tm.createLicenseReloader(licensePath, read, ([, content]) => applied.push(content));

    await reload(true);
    writeLicense(PAID_LICENSE, 2000000);
    await reload();

    expect(applied).toEqual([TRIAL_LICENSE, PAID_LICENSE]);
  });

  test('an absent file is a settled state and a license written later is applied on the next call', async () => {
    const {tm} = loadTenantManager();
    const read = jestGlobals.fn(async () => UNREAD);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, read, apply);

    await reload(true);
    await reload();
    expect(read).toHaveBeenCalledTimes(1);

    writeLicense(PAID_LICENSE, 2000000);
    read.mockResolvedValue(GOOD);
    await reload();
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(GOOD);
  });

  test('force reads even an unchanged file', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    await reload(true);
    await reload(true);

    expect(read).toHaveBeenCalledTimes(2);
  });

  test('an unforced read that fails keeps the applied license and is retried after the interval', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const nowSpy = jestGlobals.spyOn(Date, 'now').mockReturnValue(NOW);
    const read = jestGlobals.fn(async () => GOOD);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, read, apply);
    await reload(true);

    writeLicense(PAID_LICENSE, 2000000);
    read.mockResolvedValueOnce(UNREAD);
    await reload();
    nowSpy.mockReturnValue(NOW + 1000);
    await reload();
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(NOW + 5001);
    await reload();
    expect(apply).toHaveBeenCalledTimes(2);

    nowSpy.mockReturnValue(NOW + 60000);
    await reload();
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('a failed read is applied when nothing good was applied before it', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, async () => UNREAD, apply);

    await reload();

    expect(apply).toHaveBeenCalledWith(UNREAD);
  });

  test('a forced read applies even a failed read, as the watcher always did', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, read, apply);
    await reload(true);

    read.mockResolvedValueOnce(UNREAD);
    await reload(true);

    expect(apply).toHaveBeenLastCalledWith(UNREAD);
  });

  test('a forced call reads a file an unforced call could not read, without waiting for the interval', async () => {
    const {tm} = loadTenantManager();
    writeLicense(PAID_LICENSE, 2000000);
    jestGlobals.spyOn(Date, 'now').mockReturnValue(NOW);
    const read = jestGlobals.fn(async () => GOOD);
    read.mockResolvedValueOnce(UNREAD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    await reload();
    await reload(true);
    await reload();

    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a file that came back between stat and read is not applied over a settled license', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const nowSpy = jestGlobals.spyOn(Date, 'now').mockReturnValue(NOW);
    const read = jestGlobals.fn(async () => GOOD);
    const apply = jestGlobals.fn();
    const reload = tm.createLicenseReloader(licensePath, read, apply);
    await reload(true);

    fs.rmSync(licensePath);
    await reload();
    expect(apply).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(NOW + 5001);
    read.mockResolvedValue(UNREAD);
    await reload();
    expect(apply).toHaveBeenLastCalledWith(UNREAD);
  });

  test('an unforced call keeps the loaded license when stat fails, a forced one still reads', async () => {
    const {tm, statSpy} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});
    await reload(true);

    statSpy.mockImplementation(denied);
    await reload();
    expect(read).toHaveBeenCalledTimes(1);

    await reload(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a stat that recovers after a failure reads the file once more and then settles', async () => {
    const {tm, statSpy} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    statSpy.mockImplementationOnce(denied);
    const read = jestGlobals.fn(async () => GOOD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    await reload(true);
    await reload();
    await reload();

    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a read that throws is retried on the next call and does not block later calls', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    read.mockRejectedValueOnce(new Error('read failed'));
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    await expect(reload(true)).rejects.toThrow('read failed');
    await reload();

    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a failed forced read of an unchanged file is retried by the next call', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    await reload(true);
    read.mockRejectedValueOnce(new Error('read failed'));
    await expect(reload(true)).rejects.toThrow('read failed');
    await reload();
    await reload();

    expect(read).toHaveBeenCalledTimes(3);
  });

  test('calls made before a check starts share one stat and one read', async () => {
    const {tm, statSpy} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const read = jestGlobals.fn(async () => GOOD);
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    const calls = [reload(true)];
    for (let i = 0; i < 99; i++) {
      calls.push(reload());
    }
    await Promise.all(calls);

    expect(statSpy).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a call made during a read waits for a check of its own that sees the replaced file', async () => {
    const {tm} = loadTenantManager();
    writeLicense(TRIAL_LICENSE, 1000000);
    const events = [];
    let firstStarted;
    const started = new Promise(resolve => (firstStarted = resolve));
    let releaseFirst;
    const firstDone = new Promise(resolve => (releaseFirst = resolve));
    const read = async () => {
      const content = fs.readFileSync(licensePath, 'utf8');
      events.push(`start ${content === TRIAL_LICENSE ? 'trial' : 'paid'}`);
      if (1 === events.length) {
        firstStarted();
        await firstDone;
      }
      events.push('end');
      return GOOD;
    };
    const reload = tm.createLicenseReloader(licensePath, read, () => {});

    const first = reload(true);
    await started;
    writeLicense(PAID_LICENSE, 2000000);
    const second = reload();
    // give a second read that ignored the running one time to start
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(events).toEqual(['start trial']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['start trial', 'end', 'start paid', 'end']);
  });
});
