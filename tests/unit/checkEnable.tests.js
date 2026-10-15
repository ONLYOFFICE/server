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

// Bug 83352: createCheckEnable gates the docbuilder and conversion public APIs per tenant config.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const {createCheckEnable} = require('../../DocService/sources/middleware/checkEnable');
const operationContext = require('../../Common/sources/operationContext');

const DOCBUILDER_KEY = 'services.CoAuthoring.server.docbuilderEnable';
const CONVERT_KEY = 'services.CoAuthoring.server.convertServiceEnable';

let server;
let origin;
let parserCalls;
let handlerCalls;

function mockCfg(overrides = {}, tenantInitError = null) {
  jest.spyOn(operationContext.Context.prototype, 'initFromRequest').mockImplementation(() => {});
  const initSpy = jest.spyOn(operationContext.Context.prototype, 'initTenantCache');
  if (tenantInitError) {
    initSpy.mockRejectedValue(tenantInitError);
  } else {
    initSpy.mockResolvedValue(undefined);
  }
  jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation((key, fallback) => (key in overrides ? overrides[key] : fallback));
}

beforeAll(async () => {
  const app = express();
  const checkDocbuilderEnable = createCheckEnable('checkDocbuilderEnable', 403, ctx => ctx.getCfg(DOCBUILDER_KEY, true));
  const checkConvertServiceEnable = createCheckEnable('checkConvertServiceEnable', 403, ctx => ctx.getCfg(CONVERT_KEY, true));
  const trackedParser = (req, res, next) => {
    parserCalls++;
    next();
  };
  const handler = (req, res) => {
    handlerCalls++;
    res.json({ok: true});
  };
  // mounted in the same order as server.js: gate first, body handling and handler after it
  app.post('/docbuilder', checkDocbuilderEnable, trackedParser, handler);
  app.post('/converter', checkConvertServiceEnable, trackedParser, handler);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function post(route) {
  return fetch(`${origin}${route}`, {method: 'POST', body: 'x'});
}

describe('createCheckEnable gate', () => {
  test('passes both endpoints through when the keys are absent (enabled by default)', async () => {
    mockCfg({});
    parserCalls = handlerCalls = 0;

    const [builder, converter] = await Promise.all([post('/docbuilder'), post('/converter')]);

    expect([builder.status, converter.status]).toEqual([200, 200]);
    expect(parserCalls).toBe(2);
    expect(handlerCalls).toBe(2);
  });

  test('rejects only /docbuilder when docbuilderEnable is false, without body handling', async () => {
    mockCfg({[DOCBUILDER_KEY]: false});
    parserCalls = handlerCalls = 0;

    const [builder, converter] = await Promise.all([post('/docbuilder'), post('/converter')]);

    expect([builder.status, converter.status]).toEqual([403, 200]);
    expect(parserCalls).toBe(1);
    expect(handlerCalls).toBe(1);
  });

  test('rejects only /converter when convertServiceEnable is false', async () => {
    mockCfg({[CONVERT_KEY]: false});

    const [builder, converter] = await Promise.all([post('/docbuilder'), post('/converter')]);

    expect([builder.status, converter.status]).toEqual([200, 403]);
  });

  // runtime/tenant config reload itself is covered by runtimeConfigManager.tests.js
  test('evaluates tenant-aware config on every request, without capturing the initial value', async () => {
    mockCfg({[DOCBUILDER_KEY]: true});
    expect((await post('/docbuilder')).status).toBe(200);

    jest.restoreAllMocks();
    mockCfg({[DOCBUILDER_KEY]: false});
    expect((await post('/docbuilder')).status).toBe(403);
  });

  test('fails closed when tenant config initialization throws', async () => {
    mockCfg({}, new Error('tenant cache boom'));
    parserCalls = handlerCalls = 0;

    const [builder, converter] = await Promise.all([post('/docbuilder'), post('/converter')]);

    expect([builder.status, converter.status]).toEqual([403, 403]);
    expect(parserCalls).toBe(0);
    expect(handlerCalls).toBe(0);
  });

  test('is wired into server.js ahead of the body parsers', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../DocService/sources/server.js'), 'utf8');

    expect(serverSource).toMatch(/require\('\.\/middleware\/checkEnable'\)/);
    expect(serverSource).toMatch(/ctx\.getCfg\('services\.CoAuthoring\.server\.docbuilderEnable', cfgDocbuilderEnable\)/);
    expect(serverSource).toMatch(/ctx\.getCfg\('services\.CoAuthoring\.server\.convertServiceEnable', cfgConvertServiceEnable\)/);
    expect(serverSource).toMatch(/app\.post\('\/docbuilder', checkDocbuilderEnable, utils\.checkClientIp, rawFileParser/);
    expect(serverSource).toMatch(/app\.post\('\/docbuilder\/from-file', checkDocbuilderEnable, utils\.checkClientIp, handleConvertUpload/);
    expect(serverSource).toMatch(/app\.get\('\/ConvertService\.ashx', checkConvertServiceEnable, utils\.checkClientIp, rawFileParser/);
    expect(serverSource).toMatch(/app\.post\('\/ConvertService\.ashx', checkConvertServiceEnable, utils\.checkClientIp, rawFileParser/);
    expect(serverSource).toMatch(/app\.post\('\/converter', checkConvertServiceEnable, utils\.checkClientIp, rawFileParser/);
    expect(serverSource).toMatch(/app\.post\('\/converter\/from-file', checkConvertServiceEnable, utils\.checkClientIp, handleConvertUpload/);
  });

  test('keeps the WOPI gates on the shared factory with status 404', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../DocService/sources/server.js'), 'utf8');

    expect(serverSource).toMatch(/createCheckEnable\('checkWopiEnable', 404,/);
    expect(serverSource).toMatch(/createCheckEnable\(\s*'checkWopiDummyEnable',\s*404,/);
  });
});
