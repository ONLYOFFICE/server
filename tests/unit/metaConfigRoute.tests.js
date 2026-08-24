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

// Bug 83352: /meta/config is a discovery document, so a missing url means the api is unavailable

'use strict';

const http = require('http');
const express = require('express');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const metaRouter = require('../../DocService/sources/routes/meta');
const operationContext = require('../../Common/sources/operationContext');

const DOCBUILDER_KEY = 'services.CoAuthoring.server.docbuilderEnable';
const CONVERT_KEY = 'services.CoAuthoring.server.convertServiceEnable';

let server;
let configEndpoint;

function mockCfg(overrides = {}) {
  jest.spyOn(operationContext.Context.prototype, 'initFromRequest').mockImplementation(() => {});
  jest.spyOn(operationContext.Context.prototype, 'initTenantCache').mockResolvedValue(undefined);
  jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation((key, fallback) => (key in overrides ? overrides[key] : fallback));
}

beforeAll(async () => {
  const app = express();
  // mounted exactly as in server.js, so the route surface under test is the shipped one
  app.use('/meta', metaRouter);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  configEndpoint = `http://127.0.0.1:${server.address().port}/meta/config`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /meta/config', () => {
  test('advertises every url with the default config', async () => {
    mockCfg({});

    const body = await (await fetch(configEndpoint)).json();

    expect(body.urls).toMatchObject({
      api: '/web-apps/apps/api/documents/api.js',
      command: '/command',
      converter: '/converter',
      converterFromFile: '/converter/from-file',
      docbuilder: '/docbuilder',
      docbuilderFromFile: '/docbuilder/from-file'
    });
  });

  test('drops the urls of both APIs when they are disabled', async () => {
    mockCfg({[DOCBUILDER_KEY]: false, [CONVERT_KEY]: false});

    const body = await (await fetch(configEndpoint)).json();

    expect(body.urls).not.toHaveProperty('converter');
    expect(body.urls).not.toHaveProperty('converterFromFile');
    expect(body.urls).not.toHaveProperty('docbuilder');
    expect(body.urls).not.toHaveProperty('docbuilderFromFile');
    expect(body.urls).toMatchObject({api: '/web-apps/apps/api/documents/api.js', command: '/command'});
  });

  test('drops only the docbuilder urls when only docbuilder is disabled', async () => {
    mockCfg({[DOCBUILDER_KEY]: false});

    const body = await (await fetch(configEndpoint)).json();

    expect(body.urls).toMatchObject({converter: '/converter', converterFromFile: '/converter/from-file'});
    expect(body.urls).not.toHaveProperty('docbuilder');
    expect(body.urls).not.toHaveProperty('docbuilderFromFile');
  });

  test('drops only the converter urls when only the convert service is disabled', async () => {
    mockCfg({[CONVERT_KEY]: false});

    const body = await (await fetch(configEndpoint)).json();

    expect(body.urls).toMatchObject({docbuilder: '/docbuilder', docbuilderFromFile: '/docbuilder/from-file'});
    expect(body.urls).not.toHaveProperty('converter');
    expect(body.urls).not.toHaveProperty('converterFromFile');
  });

  test('never reports a services block', async () => {
    mockCfg({[DOCBUILDER_KEY]: false, [CONVERT_KEY]: false});

    const body = await (await fetch(configEndpoint)).json();

    expect(body).not.toHaveProperty('services');
  });
});
