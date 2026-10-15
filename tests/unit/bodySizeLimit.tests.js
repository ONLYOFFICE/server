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

// Early 413 on a declared Content-Length: the reply arrives and the socket closes without the body being sent.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('../../DocService/node_modules/multer');
const createError = require('../../DocService/node_modules/http-errors');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const {createBodySizeLimit, getErrorStatus} = require('../../DocService/sources/middleware/bodySizeLimit');
const {handleConvertUpload, createConvertUpload, multipartBodyAllowanceBytes} = require('../../DocService/sources/middleware/convertUpload');
const operationContext = require('../../Common/sources/operationContext');

const LIMIT = 1024;
const TERABYTE = 1024 ** 4;
const MAX_DOWNLOAD_KEY = 'FileConverter.converter.maxDownloadBytes';
const URLENCODED_LIMIT = 100 * 1024;
const MIB = 1024 * 1024;

let server;
let origin;
let handlerCalls;

beforeAll(async () => {
  const app = express();
  const rawParser = bodyParser.raw({limit: LIMIT, type: () => true});
  const handler = (req, res) => {
    handlerCalls++;
    res.json({length: req.body?.length ?? 0});
  };
  app.post('/guarded', [createBodySizeLimit(LIMIT), rawParser], handler);
  app.post('/unguarded', rawParser, handler);
  app.post('/multipart', handleConvertUpload, handler);
  // mirrors urleEcodedParser and convertToUpload in server.js
  const urlencodedParser = [
    createBodySizeLimit(URLENCODED_LIMIT, 'application/x-www-form-urlencoded'),
    bodyParser.urlencoded({extended: false, limit: URLENCODED_LIMIT})
  ];
  app.post(
    '/convert-to',
    urlencodedParser,
    createConvertUpload(upload => upload.any()),
    (req, res) => {
      handlerCalls++;
      res.json({files: (req.files ?? []).map(file => file.size)});
    }
  );
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Declares declaredLength but writes only sentBytes and never ends the request, like a client stalling a huge upload.
function postDeclared(route, declaredLength, sentBytes, headers = {}) {
  const req = http.request(`${origin}${route}`, {
    method: 'POST',
    agent: false,
    headers: {'Content-Length': declaredLength, ...headers}
  });
  req.on('error', () => {});
  const socketClosed = new Promise(resolve => req.on('socket', socket => socket.on('close', resolve)));
  const response = new Promise(resolve => {
    req.on('response', res => {
      res.resume();
      res.on('end', () => resolve({status: res.statusCode, connection: res.headers.connection}));
    });
  });
  req.write(Buffer.alloc(sentBytes));
  return {req, response, socketClosed};
}

function mockTenant(maxDownloadBytes) {
  jest.spyOn(operationContext.Context.prototype, 'initTenantCache').mockResolvedValue(undefined);
  const realGetCfg = operationContext.Context.prototype.getCfg;
  jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
    return MAX_DOWNLOAD_KEY === key && undefined !== maxDownloadBytes ? maxDownloadBytes : realGetCfg.call(this, key, def);
  });
}

// Sends one file part over node http, so a mid-upload 413 with Connection: close leaves no pooled client socket behind.
function postFile(route, size, preamble = '') {
  const body = Buffer.concat([
    Buffer.from(`${preamble}\r\n--b\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n`),
    Buffer.alloc(size),
    Buffer.from('\r\n--b--\r\n')
  ]);
  return new Promise(resolve => {
    const req = http.request(`${origin}${route}`, {
      method: 'POST',
      agent: false,
      headers: {'Content-Type': 'multipart/form-data; boundary=b', 'Content-Length': body.length}
    });
    req.on('error', () => {});
    req.on('response', res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString()}));
    });
    req.end(body);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('timeout'), ms))]);
}

describe('createBodySizeLimit', () => {
  test('answers 413 and closes the socket for a declared terabyte without waiting for the body', async () => {
    handlerCalls = 0;
    const {response, socketClosed} = postDeclared('/guarded', TERABYTE, 16);

    expect(await withTimeout(response, 2000)).toEqual({status: 413, connection: 'close'});
    expect(await withTimeout(socketClosed, 2000)).not.toBe('timeout');
    expect(handlerCalls).toBe(0);
  });

  test('premise: body-parser alone detects the size but holds the reply until the body is drained', async () => {
    const {req, response, socketClosed} = postDeclared('/unguarded', TERABYTE, 16);

    expect(await withTimeout(response, 500)).toBe('timeout');
    req.destroy();
    await socketClosed;
  });

  test('passes a body within the limit to the parser and the handler', async () => {
    handlerCalls = 0;
    const res = await fetch(`${origin}/guarded`, {method: 'POST', body: Buffer.alloc(LIMIT)});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({length: LIMIT});
    expect(handlerCalls).toBe(1);
  });

  test('leaves a chunked body without Content-Length to the parser limit', async () => {
    handlerCalls = 0;
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${origin}/guarded`, {method: 'POST', agent: false, headers: {'Transfer-Encoding': 'chunked'}});
      req.on('response', res => resolve(res.statusCode));
      req.on('error', reject);
      req.end(Buffer.alloc(2 * LIMIT));
    });

    expect(status).toBe(413);
    expect(handlerCalls).toBe(0);
  });
});

describe('multipart upload size rule', () => {
  test('from-file answers 413 before multer when the declared body exceeds the rule', async () => {
    mockTenant();
    handlerCalls = 0;
    const {response, socketClosed} = postDeclared('/multipart', TERABYTE, 16, {'Content-Type': 'multipart/form-data; boundary=x'});

    expect(await withTimeout(response, 2000)).toEqual({status: 413, connection: 'close'});
    expect(await withTimeout(socketClosed, 2000)).not.toBe('timeout');
    expect(handlerCalls).toBe(0);
  });

  test('convert-to answers 413 for a declared urlencoded terabyte because the urlencoded parser carries its own check', async () => {
    mockTenant();
    handlerCalls = 0;
    const {response, socketClosed} = postDeclared('/convert-to', TERABYTE, 16, {'Content-Type': 'application/x-www-form-urlencoded'});

    expect(await withTimeout(response, 2000)).toEqual({status: 413, connection: 'close'});
    expect(await withTimeout(socketClosed, 2000)).not.toBe('timeout');
    expect(handlerCalls).toBe(0);
  });

  test('convert-to answers 413 for a declared urlencoded body above the urlencoded limit but below the multipart rule', async () => {
    mockTenant();
    handlerCalls = 0;
    const {response, socketClosed} = postDeclared('/convert-to', MIB, 16, {'Content-Type': 'application/x-www-form-urlencoded'});

    expect(await withTimeout(response, 2000)).toEqual({status: 413, connection: 'close'});
    expect(await withTimeout(socketClosed, 2000)).not.toBe('timeout');
    expect(handlerCalls).toBe(0);
  });

  test('convert-to still accepts a multipart file larger than the urlencoded limit', async () => {
    mockTenant();
    const res = await postFile('/convert-to', MIB);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({files: [MIB]});
  });

  test('convert-to applies the tenant maxDownloadBytes, not the global default', async () => {
    mockTenant(16);
    handlerCalls = 0;

    expect((await postFile('/convert-to', 64)).status).toBe(413);
    const small = await postFile('/convert-to', 8);
    expect(small.status).toBe(200);
    expect(JSON.parse(small.body)).toEqual({files: [8]});
    expect(handlerCalls).toBe(1);
  });

  test('the allowance covers every field and part header multer can accept', () => {
    expect(multipartBodyAllowanceBytes).toBe(32 * 1024 * 1024);
    expect(multipartBodyAllowanceBytes).toBeGreaterThan(30 * 1024 * 1024 + 32 * 16 * 1024);
  });

  test('a preamble within the allowance is still accepted, so the rule only cuts bodies above it', async () => {
    mockTenant();
    const res = await postFile('/convert-to', 1, 'p'.repeat(4096));

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({files: [1]});
  });
});

describe('getErrorStatus', () => {
  test.each([
    ['body-parser size error', 413, createError(413, 'request entity too large')],
    ['body-parser bad body', 400, createError(400, 'bad')],
    ['server-side http error', 500, createError(502, 'upstream')],
    ['plain error', 500, new Error('boom')],
    ['multer file size', 413, new multer.MulterError('LIMIT_FILE_SIZE')],
    ['multer field count', 400, new multer.MulterError('LIMIT_FIELD_COUNT')]
  ])('%s -> %d', (_name, status, err) => {
    expect(getErrorStatus(err)).toBe(status);
  });
});

describe('server.js wiring', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../DocService/sources/server.js'), 'utf8');

  test('guards the raw parser and the convert-to multipart with the declared-length check', () => {
    expect(serverSource).toMatch(/const rawFileParser = \[\s*createBodySizeLimit\(rawBodyMaxBytes\),\s*bodyParser\.raw\(/);
    expect(serverSource).toMatch(
      /const urleEcodedParser = \[\s*createBodySizeLimit\(urlencodedMaxBytes, 'application\/x-www-form-urlencoded'\),\s*bodyParser\.urlencoded\(\{extended: false, limit: urlencodedMaxBytes\}\)\s*\]/
    );
    expect(serverSource).toMatch(/const convertToUpload = createConvertUpload\(upload => upload\.any\(\)\);/);
    expect(serverSource).toMatch(
      /app\.post\('\/lool\/convert-to\/:format\?', checkWopiEnable, utils\.checkClientIp, urleEcodedParser, convertToUpload,/
    );
    expect(serverSource).toMatch(
      /app\.post\('\/cool\/convert-to\/:format\?', checkWopiEnable, utils\.checkClientIp, urleEcodedParser, convertToUpload,/
    );
  });

  test('the default error handler keeps client error statuses', () => {
    expect(serverSource).toMatch(/const status = getErrorStatus\(err\);/);
  });
});
