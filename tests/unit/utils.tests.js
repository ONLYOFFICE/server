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

const {describe, test, expect, jest, beforeEach, afterEach} = require('@jest/globals');
const fs = require('fs');
const fsPromises = require('node:fs/promises');
const path = require('path');
const config = require('../../Common/node_modules/config');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

const ctx = new operationContext.Context();
const minimumIterationsByteLength = 4;

describe('AES encryption & decryption', () => {
  test('Iterations range', async () => {
    const configuration = config.util.cloneDeep(config.get('aesEncrypt.config'));
    const encrypted = await utils.encryptPassword(ctx, 'secretstring');
    const {iterationsByteLength = 5} = configuration;

    const [iterationsHex] = encrypted.split(':');
    const iterations = parseInt(iterationsHex, 16);

    const iterationsLength = iterationsByteLength < minimumIterationsByteLength ? minimumIterationsByteLength : iterationsByteLength;
    expect(iterations).toBeGreaterThanOrEqual(Math.pow(10, iterationsLength - 1));
    expect(iterations).toBeLessThanOrEqual(Math.pow(10, iterationsLength) - 1);
  });

  test('Correct workflow', async () => {
    const encrypted = await utils.encryptPassword(ctx, 'secretstring');
    const decrypted = await utils.decryptPassword(ctx, encrypted);
    expect(decrypted).toEqual('secretstring');
  });
});

describe('watchWithFallback', () => {
  const SAFE_FS = 0xef53; // ext4 magic, not in UNSAFE_MAGIC
  const dirPath = '/cfg';
  const filePath = '/cfg/runtime.json';
  const listener = () => {};
  // mountinfo lines: index 4 (before the " - " separator) is the mount point
  const mountInfoNoMatch = '21 20 0:20 / /proc rw - proc proc rw\n22 20 0:21 / /sys rw - sysfs sysfs rw';
  // mountinfo stores absolute paths; isMountPoint compares against path.resolve(filePath)
  const mountInfoMatch = `40 35 8:1 /app/runtime.json ${path.resolve(filePath)} rw,relatime - ext4 /dev/sda1 rw`;

  beforeEach(() => {
    // isMountPoint canonicalizes via realpath; for a non-symlinked file that equals path.resolve
    jest.spyOn(fsPromises, 'realpath').mockImplementation(async p => path.resolve(p));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses native fs.watch when file and dir share a device and file is not a mount point', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(mountInfoNoMatch);
    const fakeWatcher = {on: jest.fn(), close: jest.fn()};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(fakeWatcher);
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue({});

    const result = await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchSpy).toHaveBeenCalledWith(dirPath, {}, listener);
    expect(watchFileSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeWatcher);
  });

  test('falls back to fs.watchFile when file is on a separate mount (single-file bind mount)', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockImplementation(async p => ({dev: p === filePath ? 100 : 200}));
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(mountInfoNoMatch);
    const fakeStatWatcher = {};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue(fakeStatWatcher);

    const result = await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchFileSpy).toHaveBeenCalledWith(filePath, {}, listener);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeStatWatcher);
  });

  test('falls back to fs.watchFile when file is a mount point with the same device', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(mountInfoMatch);
    const fakeStatWatcher = {};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue(fakeStatWatcher);

    const result = await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchFileSpy).toHaveBeenCalledWith(filePath, {}, listener);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeStatWatcher);
  });

  test('resolves a relative filePath before matching mountinfo', async () => {
    const relPath = 'cfg/runtime.json';
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(`50 35 8:1 /src ${path.resolve(relPath)} rw - ext4 /dev/sda1 rw`);
    const fakeStatWatcher = {};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue(fakeStatWatcher);

    const result = await utils.watchWithFallback(ctx, dirPath, relPath, listener);

    expect(watchFileSpy).toHaveBeenCalledWith(relPath, {}, listener);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeStatWatcher);
  });

  test('decodes octal escapes so a mount point with a space still matches', async () => {
    const spacedPath = '/cfg/my run.json';
    const escaped = path.resolve(spacedPath).replace(/ /g, '\\040');
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(`60 35 8:1 /src ${escaped} rw - ext4 /dev/sda1 rw`);
    const fakeStatWatcher = {};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue(fakeStatWatcher);

    const result = await utils.watchWithFallback(ctx, dirPath, spacedPath, listener);

    expect(watchFileSpy).toHaveBeenCalledWith(spacedPath, {}, listener);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeStatWatcher);
  });

  test('unavailable mountinfo does not break the native watch path', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
    jest.spyOn(fsPromises, 'readFile').mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    const fakeWatcher = {on: jest.fn(), close: jest.fn()};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(fakeWatcher);
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue({});

    const result = await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchSpy).toHaveBeenCalledWith(dirPath, {}, listener);
    expect(watchFileSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeWatcher);
  });

  test('treats a missing file as same mount so native watch observes its creation', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    jest.spyOn(fsPromises, 'readFile').mockResolvedValue(mountInfoNoMatch);
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue({});

    await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchSpy).toHaveBeenCalledWith(dirPath, {}, listener);
    expect(watchFileSpy).not.toHaveBeenCalled();
  });
});

describe('readFileStable', () => {
  const filePath = '/cfg/runtime.json';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns contents when the file is stable around the read', async () => {
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({mtimeMs: 100, size: 10});
    const readSpy = jest.spyOn(fsPromises, 'readFile').mockResolvedValue('{"a":1}');

    const data = await utils.readFileStable(ctx, filePath);

    expect(data).toBe('{"a":1}');
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  test('retries when the file changes mid-read and then succeeds', async () => {
    const statValues = [
      {mtimeMs: 100, size: 10}, // attempt 1 before
      {mtimeMs: 200, size: 12}, // attempt 1 after - changed, retry
      {mtimeMs: 200, size: 12}, // attempt 2 before
      {mtimeMs: 200, size: 12} // attempt 2 after - stable
    ];
    let i = 0;
    jest.spyOn(fsPromises, 'stat').mockImplementation(async () => statValues[i++]);
    const readSpy = jest.spyOn(fsPromises, 'readFile').mockResolvedValue('{"a":2}');

    const data = await utils.readFileStable(ctx, filePath, 3);

    expect(data).toBe('{"a":2}');
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  test('throws EUNSTABLE when the file keeps changing', async () => {
    let m = 0;
    jest.spyOn(fsPromises, 'stat').mockImplementation(async () => ({mtimeMs: m++, size: 10}));
    const readSpy = jest.spyOn(fsPromises, 'readFile').mockResolvedValue('x');

    await expect(utils.readFileStable(ctx, filePath, 3)).rejects.toMatchObject({code: 'EUNSTABLE'});
    expect(readSpy).toHaveBeenCalledTimes(3);
  });

  test('propagates ENOENT for a missing file', async () => {
    jest.spyOn(fsPromises, 'stat').mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));

    await expect(utils.readFileStable(ctx, filePath)).rejects.toMatchObject({code: 'ENOENT'});
  });
});

describe('getBaseUrlByRequest', () => {
  function makeRequest(headers, protocol = 'http') {
    const lowerCased = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    return {protocol, get: name => lowerCased[name.toLowerCase()]};
  }

  test('reports the external scheme and host', () => {
    const req = makeRequest({'x-forwarded-proto': 'https', 'x-forwarded-host': 'docs.example.com'});

    expect(utils.getBaseUrlByRequest(ctx, req)).toBe('https://docs.example.com');
  });

  // public proxy configs put the virtual path into X-Forwarded-Host itself, so a hostname-only check would break them
  test('keeps a virtual path encoded into X-Forwarded-Host', () => {
    const req = makeRequest({'x-forwarded-proto': 'https', 'x-forwarded-host': 'docs.example.com/documentserver-virtual-path'});

    expect(utils.getBaseUrlByRequest(ctx, req)).toBe('https://docs.example.com/documentserver-virtual-path');
  });

  test('keeps a virtual path passed as X-Forwarded-Prefix', () => {
    const req = makeRequest({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'docs.example.com',
      'x-forwarded-prefix': '/documentserver-virtual-path'
    });

    expect(utils.getBaseUrlByRequest(ctx, req)).toBe('https://docs.example.com/documentserver-virtual-path');
  });

  test('keeps a host with an explicit port', () => {
    const req = makeRequest({'x-forwarded-host': 'docs.example.com:8443'});

    expect(utils.getBaseUrlByRequest(ctx, req)).toBe('http://docs.example.com:8443');
  });

  test('falls back to the Host header when no forwarded headers are sent', () => {
    const req = makeRequest({host: 'docs.example.com'});

    expect(utils.getBaseUrlByRequest(ctx, req)).toBe('http://docs.example.com');
  });
});
