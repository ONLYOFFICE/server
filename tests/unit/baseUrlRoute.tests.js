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

// Bug 83134: /baseurl reflected X-Forwarded-* as text/html. The computed base url itself is covered by getBaseUrlByRequest in utils.tests.js

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const baseUrlHandler = require('../../DocService/sources/routes/baseurl');
const utils = require('../../Common/sources/utils');

let server;
let baseUrlEndpoint;

beforeAll(async () => {
  const app = express();
  // mounted exactly as in server.js, so the route surface under test is the shipped one
  app.get('/baseurl', baseUrlHandler);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  baseUrlEndpoint = `http://127.0.0.1:${port}/baseurl`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /baseurl', () => {
  test('serves an X-Forwarded-Host payload as inert plain text', async () => {
    const res = await fetch(baseUrlEndpoint, {headers: {'X-Forwarded-Host': 'x<img src=x onerror=alert(1)>'}});

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('http://x<img src=x onerror=alert(1)>');
  });

  test('serves an X-Forwarded-Prefix payload as inert plain text', async () => {
    const res = await fetch(baseUrlEndpoint, {headers: {'X-Forwarded-Prefix': '/<script>alert(document.domain)</script>'}});

    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toContain('/<script>alert(document.domain)</script>');
  });

  test('keeps the route surface of the plain app.get registration', async () => {
    const [exact, trailingSlash, doubledSlash] = await Promise.all([
      fetch(baseUrlEndpoint),
      fetch(`${baseUrlEndpoint}/`),
      fetch(`${baseUrlEndpoint}//`)
    ]);

    expect([exact.status, trailingSlash.status, doubledSlash.status]).toEqual([200, 200, 404]);
  });

  test('answers with a status instead of hanging when the handler throws', async () => {
    jest.spyOn(utils, 'getBaseUrlByRequest').mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await fetch(baseUrlEndpoint);

    expect(res.status).toBe(500);
  });

  test('is wired into server.js', () => {
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../../DocService/sources/server.js'), 'utf8');

    expect(serverSource).toMatch(/require\('\.\/routes\/baseurl'\)/);
    expect(serverSource).toMatch(/app\.get\('\/baseurl',\s*baseUrlHandler\)/);
  });
});
