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

const {describe, test, expect, jest, afterEach} = require('@jest/globals');
const fs = require('fs');
const fsPromises = require('node:fs/promises');
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses native fs.watch when file and dir share a device', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockResolvedValue({dev: 2049});
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
    const fakeStatWatcher = {};
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue(fakeStatWatcher);

    const result = await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchFileSpy).toHaveBeenCalledWith(filePath, {}, listener);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fakeStatWatcher);
  });

  test('treats a missing file as same mount so native watch observes its creation', async () => {
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue({type: SAFE_FS});
    jest.spyOn(fsPromises, 'stat').mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue({on: jest.fn(), close: jest.fn()});
    const watchFileSpy = jest.spyOn(fs, 'watchFile').mockReturnValue({});

    await utils.watchWithFallback(ctx, dirPath, filePath, listener);

    expect(watchSpy).toHaveBeenCalledWith(dirPath, {}, listener);
    expect(watchFileSpy).not.toHaveBeenCalled();
  });
});
