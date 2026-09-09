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

// The bundled AI Tools must disappear from the plugin list the editors read when a tenant turns AI off

'use strict';

const http = require('http');
const express = require('express');
const config = require('config');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const pluginsRouter = require('../../DocService/sources/routes/plugins');
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

const AI_GUID = 'asc.{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}';
const OTHER_GUID = 'asc.{00000000-0000-0000-0000-000000000000}';
const AUTOSTART_KEY = 'services.CoAuthoring.plugins.autostart';

let server;
let endpoint;
let configGet;

function mockCfg(aiEnable) {
  jest.spyOn(operationContext.Context.prototype, 'initFromRequest').mockImplementation(() => {});
  jest.spyOn(operationContext.Context.prototype, 'initTenantCache').mockResolvedValue(undefined);
  jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation((key, fallback) => ('aiSettings.enable' === key ? aiEnable : fallback));
}

// Both plugins installed and both autostarted, so filtering shows up in pluginsData and in autostart.
function mockPlugins(autostart = [AI_GUID, OTHER_GUID]) {
  jest.spyOn(utils, 'getInstalledPlugins').mockResolvedValue([
    {name: 'ai', guid: AI_GUID},
    {name: 'other', guid: OTHER_GUID}
  ]);
  jest.spyOn(config, 'get').mockImplementation(key => (AUTOSTART_KEY === key ? autostart : configGet(key)));
}

function getJson() {
  return new Promise((resolve, reject) => {
    http
      .get(endpoint, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString()}));
      })
      .on('error', reject);
  });
}

beforeAll(async () => {
  configGet = config.get.bind(config);
  const app = express();
  // mounted exactly as in server.js, so the route surface under test is the shipped one
  app.use('/plugins.json', pluginsRouter);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/plugins.json`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('plugins.json route', () => {
  test('serves every installed plugin while ai is enabled', async () => {
    mockCfg(true);
    mockPlugins();
    const res = await getJson();
    const body = JSON.parse(res.body);
    expect(res.status).toBe(200);
    expect(body.pluginsData).toHaveLength(2);
    expect(body.pluginsData.some(url => url.endsWith('/ai/config.json'))).toBe(true);
    expect(body.autostart).toEqual([AI_GUID, OTHER_GUID]);
  });

  test('hides AI Tools and its autostart entry while ai is disabled', async () => {
    mockCfg(false);
    mockPlugins();
    const res = await getJson();
    const body = JSON.parse(res.body);
    expect(res.status).toBe(200);
    expect(body.pluginsData).toEqual([expect.stringContaining('/other/config.json')]);
    expect(body.autostart).toEqual([OTHER_GUID]);
  });

  test('a failed plugin scan answers 404 instead of hanging', async () => {
    mockCfg(true);
    mockPlugins();
    utils.getInstalledPlugins.mockRejectedValue(new Error('scan failed'));
    const res = await getJson();
    expect(res.status).toBe(404);
  });
});
