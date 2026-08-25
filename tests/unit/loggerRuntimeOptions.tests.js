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

const {describe, afterEach, beforeAll, afterAll, test, expect, jest: jestGlobals} = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const logger = require('../../Common/sources/logger');

const baseLogConfig = logger.getInitialLoggerConfig();
let evilAppenderPath;

beforeAll(() => {
  evilAppenderPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-')), 'evilAppender.js');
  fs.writeFileSync(evilAppenderPath, 'global.__evilAppenderLoaded = true;\nmodule.exports.configure = () => () => {};\n');
});

afterAll(() => {
  fs.rmSync(path.dirname(evilAppenderPath), {recursive: true, force: true});
});

afterEach(() => {
  logger.configureLogger(undefined);
});

describe('runtime log options', () => {
  test('applies a level change for a category declared in the base config', () => {
    logger.configureLogger({categories: {default: {level: 'ERROR'}}});
    expect(logger.getLoggerConfig().categories.default.level).toBe('ERROR');
  });

  test('ignores a runtime appender and never loads its module', () => {
    logger.configureLogger({
      appenders: {evil: {type: evilAppenderPath}},
      categories: {default: {appenders: ['evil'], level: 'ALL'}}
    });
    const current = logger.getLoggerConfig();
    expect(current.appenders).toEqual(baseLogConfig.appenders);
    expect(current.categories.default.appenders).toEqual(baseLogConfig.categories.default.appenders);
    expect(global.__evilAppenderLoaded).toBeUndefined();
  });

  test('ignores unsupported runtime log options', () => {
    logger.configureLogger({
      filePath: '/tmp/hijack.json',
      replaceConsole: false,
      categories: {default: {level: 'WARN', layout: {type: 'pattern', pattern: '%m'}}}
    });
    const current = logger.getLoggerConfig();
    expect(current.filePath).toBeUndefined();
    expect(current.appenders).toEqual(baseLogConfig.appenders);
    expect(current.categories.default.layout).toBeUndefined();
    expect(current.categories.default.level).toBe('WARN');
  });

  test('ignores an unknown category and an invalid level', () => {
    logger.configureLogger({categories: {injected: {level: 'ALL'}, default: {level: 'VERBOSE'}}});
    const current = logger.getLoggerConfig();
    expect(current.categories.injected).toBeUndefined();
    expect(current.categories.default.level).toBe(baseLogConfig.categories.default.level);

    logger.configureLogger({categories: {default: {level: {}}}});
    expect(logger.getLoggerConfig().categories.default.level).toBe(baseLogConfig.categories.default.level);
  });

  test('keeps logging enabled on the base config after an invalid override', () => {
    logger.configureLogger({appenders: {evil: {type: evilAppenderPath}}, categories: {default: 'not-an-object'}});
    expect(logger.getLoggerConfig()).toEqual(baseLogConfig);
    expect(() => logger.error('logger is still usable')).not.toThrow();
  });
});

const hasRedisStorage = fs.existsSync(path.join(__dirname, '..', '..', 'DocService', 'sources', 'editorDataRedis.js'));

// the module resolves the configured storage when it loads, so each case needs a fresh module registry
function loadStorageModule(editorDataStorage, editorStatStorage) {
  jestGlobals.resetModules();
  const prevNodeConfig = process.env.NODE_CONFIG;
  process.env.NODE_CONFIG = JSON.stringify({services: {CoAuthoring: {server: {editorDataStorage, editorStatStorage}}}});
  try {
    return require('../../DocService/sources/editorDataStorage');
  } finally {
    if (undefined === prevNodeConfig) {
      delete process.env.NODE_CONFIG;
    } else {
      process.env.NODE_CONFIG = prevNodeConfig;
    }
  }
}

describe('editor data storage loading', () => {
  test('loads the supported storages', () => {
    expect(typeof loadStorageModule('editorDataMemory', '').editorDataStorage.EditorData).toBe('function');
    if (hasRedisStorage) {
      // editorDataRedis ships with the lockstorage addon, so it is only checked where that build is present
      expect(typeof loadStorageModule('editorDataRedis', '').editorDataStorage.EditorData).toBe('function');
    }
  });

  test('falls back to the data storage when the stat storage is not set', () => {
    const loaded = loadStorageModule('editorDataMemory', '');
    expect(loaded.editorStatStorage).toBe(loaded.editorDataStorage);
  });

  test('rejects a path, an unknown name and an empty storage', () => {
    expect(() => loadStorageModule('../../../tmp/evil', '')).toThrow('unknown editor data storage');
    expect(() => loadStorageModule('editorDataMemory', '../../../tmp/evil')).toThrow('unknown editor data storage');
    expect(() => loadStorageModule('', '')).toThrow('unknown editor data storage');
    expect(() => loadStorageModule('constructor', '')).toThrow('unknown editor data storage');
  });
});
