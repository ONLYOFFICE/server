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
const {describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, jest} = require('@jest/globals');
const http = require('http');
const express = require('express');
const {Readable} = require('stream');
const {buffer} = require('node:stream/consumers');
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const aiProxyHandler = require('../../DocService/sources/ai/aiProxyHandler');

const HANDLER_PORT = 3478;
const UPSTREAM_PORT = 3479;
const HANDLER_URL = `http://127.0.0.1:${HANDLER_PORT}`;
const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;

// Collect the request body into a Buffer, mirroring the server rawFileParser.
function rawBody(req, _res, next) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    req.body = Buffer.concat(chunks);
    next();
  });
}

function postJson(path, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(HANDLER_URL + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function postRaw(path, rawBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(HANDLER_URL + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

describe('aiProxyHandler sanitizers', () => {
  test('sanitizeProxyResponseHeaders strips cookies, hop-by-hop and control chars', () => {
    const out = aiProxyHandler.sanitizeProxyResponseHeaders({
      'content-type': 'application/json',
      'set-cookie': 'sid=1',
      Connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-disposition': 'attachment; filename="a\r\nb.txt"'
    });
    expect(out['content-type']).toBe('application/json');
    expect(out['set-cookie']).toBeUndefined();
    expect(out['Connection']).toBeUndefined();
    expect(out['transfer-encoding']).toBeUndefined();
    expect(out['content-disposition']).toBe('attachment; filename="ab.txt"');
  });

  test('sanitizeProxyRequestHeaders drops hop-by-hop and proxy headers, keeps client auth', () => {
    const out = aiProxyHandler.sanitizeProxyRequestHeaders({
      Authorization: 'Bearer userkey',
      'x-api-key': 'k',
      Host: 'evil.example.com',
      'Content-Length': '10',
      Connection: 'close',
      'Proxy-Authorization': 'secret'
    });
    expect(out['Authorization']).toBe('Bearer userkey');
    expect(out['x-api-key']).toBe('k');
    const lower = Object.keys(out).map(k => k.toLowerCase());
    expect(lower).not.toContain('host');
    expect(lower).not.toContain('content-length');
    expect(lower).not.toContain('connection');
    expect(lower).not.toContain('proxy-authorization');
  });

  test('mergeProviderHeaders drops client case-variants so the injected value wins', () => {
    const out = aiProxyHandler.mergeProviderHeaders(
      {Authorization: 'junk', authorization: '', 'content-type': 'application/json'},
      {Authorization: 'Bearer sk-server'}
    );
    const authKeys = Object.keys(out).filter(k => k.toLowerCase() === 'authorization');
    expect(authKeys).toEqual(['Authorization']);
    expect(out['Authorization']).toBe('Bearer sk-server');
    expect(out['content-type']).toBe('application/json');
  });

  test('describeRequestError logs only message/code/status, never axios config or headers', () => {
    const err = new Error('Request failed with status code 401');
    err.code = 'ERR_BAD_REQUEST';
    err.config = {headers: {Authorization: 'Bearer server-secret'}, data: '{"prompt":"secret"}'};
    err.response = {status: 401, headers: {'set-cookie': 'sid=1'}};
    const out = aiProxyHandler.describeRequestError(err);
    expect(out).toContain('Request failed with status code 401');
    expect(out).toContain('ERR_BAD_REQUEST');
    expect(out).toContain('401');
    expect(out).not.toContain('server-secret');
    expect(out).not.toContain('Authorization');
    expect(out).not.toContain('sid=1');
  });
});

describe('aiProxyHandler proxyRequest (merged relay)', () => {
  let server;

  beforeAll(async () => {
    const app = express();
    app.use('/ai-proxy', rawBody, aiProxyHandler.proxyRequest);
    await new Promise(resolve => {
      server = app.listen(HANDLER_PORT, resolve);
    });
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // AI plugin present by default so the install gate lets requests through; disabled-path tests override this.
  beforeEach(() => {
    jest.spyOn(utils, 'getInstalledPluginGuids').mockResolvedValue(new Set(['asc.{9dc93cdb-b576-4f0c-b55e-fcc9c48dd007}']));
  });

  // Stub the per-request context so getCfg returns the test config and tenant init is a no-op.
  function mockContext(cfg) {
    const base = {aiSettings: {}, 'aiSettings.proxy': '', 'aiSettings.timeout': '5m'};
    const merged = {...base, ...cfg};
    jest.spyOn(operationContext.Context.prototype, 'initFromRequest').mockImplementation(() => {});
    jest.spyOn(operationContext.Context.prototype, 'initTenantCache').mockResolvedValue(undefined);
    jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation((key, fallback) => (key in merged ? merged[key] : fallback));
  }

  function mockAuthOk() {
    jest.spyOn(docsCoServer, 'checkJwtHeader').mockResolvedValue({decoded: {document: {key: 'doc'}, editorConfig: {user: {id: 'user'}}}});
  }

  test('unmatched target with browser-proxy disabled returns 403', async () => {
    mockContext({'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com', method: 'GET'});
    expect(res.status).toBe(403);
  });

  test.each([
    ['no plugins installed', new Set()],
    ['only an unrelated plugin installed', new Set(['asc.{00000000-0000-0000-0000-000000000000}'])]
  ])('AI plugin not installed (%s) returns 404', async (_label, guids) => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    utils.getInstalledPluginGuids.mockResolvedValue(guids);
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com', method: 'GET'});
    expect(res.status).toBe(404);
  });

  test('invalid session JWT returns 403', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    jest.spyOn(docsCoServer, 'checkJwtHeader').mockResolvedValue({decoded: null, description: 'bad'});
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com', method: 'GET'});
    expect(res.status).toBe(403);
  });

  test('relay rejects invalid target URL with 400', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const res = await postJson('/ai-proxy', {target: 'ftp://api.example.com', method: 'GET'});
    expect(res.status).toBe(400);
  });

  test.each(['PUT', 'PATCH', 'OPTIONS', 'TRACE'])('relay rejects disallowed method %s with 400', async method => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com', method});
    expect(res.status).toBe(400);
  });

  test('relay allows HEAD as untrusted browser-proxy request', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {}},
      stream: Readable.from([])
    });
    const res = await postJson('/ai-proxy', {target: 'https://mcp.example.com/sse', method: 'HEAD'});
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    expect(args[1]).toBe('HEAD');
    expect(args[7]).toBe(false);
  });

  test('relay forwards untrusted request (isInJwtToken=false), preserves status, strips hop-by-hop request headers', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json', 'set-cookie': 'sid=1'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {
      target: 'https://mcp.example.com/sse',
      method: 'POST',
      headers: {Authorization: 'Bearer userkey', 'Proxy-Authorization': 'secret', Host: 'evil'},
      data: '{"q":1}'
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.headers['set-cookie']).toBeUndefined();
    const args = httpSpy.mock.calls[0];
    // opt_filterPrivate must be false (untrusted) and there must be NO forced-filter 10th arg.
    expect(args[7]).toBe(false);
    expect(args.length).toBe(9);
    const sentHeaders = args[3];
    expect(sentHeaders['Authorization']).toBe('Bearer userkey');
    const lower = Object.keys(sentHeaders).map(k => k.toLowerCase());
    expect(lower).not.toContain('proxy-authorization');
    expect(lower).not.toContain('host');
  });

  test('relay propagates upstream error status and strips Set-Cookie', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const err = new Error('upstream 401');
    err.response = {
      status: 401,
      headers: {'set-cookie': 'sid=1', 'www-authenticate': 'Bearer', 'content-type': 'application/json'},
      data: Readable.from(['{"error":"unauth"}'])
    };
    jest.spyOn(utils, 'httpRequest').mockRejectedValue(err);
    const res = await postJson('/ai-proxy', {target: 'https://mcp.example.com', method: 'GET'});
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('unauth');
  });

  test('matched configured provider injects key and marks request trusted (isInJwtToken=true)', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json', 'set-cookie': 'sid=1'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {
      target: 'https://api.example.com/v1/chat',
      method: 'POST',
      headers: {Host: 'evil', 'Proxy-Authorization': 'secret'},
      data: '{}'
    });
    expect(res.status).toBe(200);
    // Matched-provider response is also sanitized before reaching the editor origin.
    expect(res.headers['set-cookie']).toBeUndefined();
    const args = httpSpy.mock.calls[0];
    // Matched provider path is trusted and the server key is injected.
    expect(args[7]).toBe(true);
    expect(args[3]['Authorization']).toBe('Bearer sk-server');
    const lower = Object.keys(args[3]).map(k => k.toLowerCase());
    expect(lower).not.toContain('host');
    expect(lower).not.toContain('proxy-authorization');
  });

  test('invalid JSON body returns 400', async () => {
    mockContext({'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const res = await postRaw('/ai-proxy', 'not json{');
    expect(res.status).toBe(400);
  });

  test('matched provider preserves upstream success status', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 202, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(202);
  });

  test('matched provider preserves upstream error status', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const err = new Error('upstream 429');
    err.response = {
      status: 429,
      headers: {'set-cookie': 'sid=1', 'content-type': 'application/json'},
      data: Readable.from(['{"error":"rate"}'])
    };
    jest.spyOn(utils, 'httpRequest').mockRejectedValue(err);
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(429);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('rate');
  });

  test('path escape via ".." is rejected: no match, no key, no egress', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com/v1', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({response: {status: 200, headers: {}}, stream: Readable.from([])});
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/../admin', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(403);
    expect(httpSpy).not.toHaveBeenCalled();
  });

  test('path escape via encoded "%2e%2e" is rejected', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com/v1', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({response: {status: 200, headers: {}}, stream: Readable.from([])});
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/%2e%2e/admin', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(403);
    expect(httpSpy).not.toHaveBeenCalled();
  });

  test('sibling-prefix "/v1beta" is not matched by base "/v1"', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com/v1', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({response: {status: 200, headers: {}}, stream: Readable.from([])});
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1beta/models', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(403);
    expect(httpSpy).not.toHaveBeenCalled();
  });

  test('legitimate "/v1/chat" under base "/v1" matches, injects key, stays trusted', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com/v1', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    expect(args[7]).toBe(true);
    expect(args[3]['Authorization']).toBe('Bearer sk-server');
  });

  test('matched path disables redirect following (maxRedirects: 0)', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    expect(args[8]).toMatchObject({maxRedirects: 0});
  });

  test('auth case-shadow cannot suppress the injected key', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {
      target: 'https://api.example.com/v1/chat',
      method: 'POST',
      headers: {Authorization: 'junk', authorization: ''},
      data: '{}'
    });
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    const authKeys = Object.keys(args[3]).filter(k => k.toLowerCase() === 'authorization');
    expect(authKeys).toHaveLength(1);
    expect(args[3][authKeys[0]]).toBe('Bearer sk-server');
    expect(Object.values(args[3])).not.toContain('junk');
  });

  test('configured MCP headers win over a client case-shadow', async () => {
    mockContext({
      aiSettings: {pluginSettings: {mcpServers: {m1: {url: 'https://mcp.example.com/sse', headers: {Authorization: 'Bearer mcp-secret'}}}}},
      'aiSettings.allowBrowserProxy': false
    });
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {
      target: 'https://mcp.example.com/sse',
      method: 'POST',
      headers: {authorization: 'junk'},
      data: '{}'
    });
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    const authKeys = Object.keys(args[3]).filter(k => k.toLowerCase() === 'authorization');
    expect(authKeys).toEqual(['Authorization']);
    expect(args[3]['Authorization']).toBe('Bearer mcp-secret');
  });

  test('proxy without explicit port does not inherit the provider port', async () => {
    mockContext({
      aiSettings: {providers: {p1: {url: 'http://127.0.0.1:11434', key: 'sk-server'}}},
      'aiSettings.proxy': 'https://egress.internal',
      'aiSettings.allowBrowserProxy': false
    });
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {target: 'http://127.0.0.1:11434/api/x', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    expect(args[2]).toBe('https://egress.internal/api/x');
    expect(args[2]).not.toContain('11434');
  });

  test('proxy with explicit port keeps that port', async () => {
    mockContext({
      aiSettings: {providers: {p1: {url: 'http://127.0.0.1:11434', key: 'sk-server'}}},
      'aiSettings.proxy': 'https://egress.internal:9443',
      'aiSettings.allowBrowserProxy': false
    });
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({
      response: {status: 200, headers: {'content-type': 'application/json'}},
      stream: Readable.from(['{"ok":true}'])
    });
    const res = await postJson('/ai-proxy', {target: 'http://127.0.0.1:11434/api/x', method: 'POST', headers: {}, data: '{}'});
    expect(res.status).toBe(200);
    const args = httpSpy.mock.calls[0];
    expect(args[2]).toBe('https://egress.internal:9443/api/x');
  });

  test('matched path rejects forbidden method TRACE with 400', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': false});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({response: {status: 200, headers: {}}, stream: Readable.from([])});
    const res = await postJson('/ai-proxy', {target: 'https://api.example.com/v1/chat', method: 'TRACE', headers: {}, data: '{}'});
    expect(res.status).toBe(400);
    expect(httpSpy).not.toHaveBeenCalled();
  });

  test('invalid target URL returns 400 (unsupported protocol, browser-proxy relays and rejects)', async () => {
    mockContext({aiSettings: {providers: {p1: {url: 'https://api.example.com', key: 'sk-server'}}}, 'aiSettings.allowBrowserProxy': true});
    mockAuthOk();
    const httpSpy = jest.spyOn(utils, 'httpRequest').mockResolvedValue({response: {status: 200, headers: {}}, stream: Readable.from([])});
    const res = await postJson('/ai-proxy', {target: 'file:///etc/passwd', method: 'GET'});
    expect(res.status).toBe(400);
    expect(httpSpy).not.toHaveBeenCalled();
  });
});

describe('httpRequest private-IP filtering by isInJwtToken', () => {
  let upstream;

  beforeAll(async () => {
    const app = express();
    app.get('/ok', (_req, res) => res.json({ok: true}));
    await new Promise(resolve => {
      upstream = app.listen(UPSTREAM_PORT, resolve);
    });
  });

  afterAll(async () => {
    await new Promise(resolve => upstream.close(resolve));
  });

  // Shipped defaults: blockPrivateIP on, empty allowList, jwtToken true.
  function ctx() {
    return {
      getCfg(key, fallback) {
        switch (key) {
          case 'services.CoAuthoring.requestDefaults':
            return {headers: {}, decompress: true, rejectUnauthorized: true, followRedirect: false};
          case 'externalRequest.action':
            return {allow: true, blockPrivateIP: true, proxyUrl: '', proxyUser: {}, proxyHeaders: {}};
          case 'services.CoAuthoring.request-filtering-agent':
            return {allowPrivateIPAddress: false, allowMetaIPAddress: false};
          case 'externalRequest.directIfIn':
            return {allowList: [], jwtToken: true};
          default:
            return fallback;
        }
      },
      logger: {debug() {}, warn() {}, error() {}}
    };
  }

  test('untrusted (isInJwtToken=false) blocks a private host under default config', async () => {
    await expect(utils.httpRequest(ctx(), 'GET', `${UPSTREAM_URL}/ok`, null, undefined, undefined, null, false, {})).rejects.toBeDefined();
  });

  test('trusted (isInJwtToken=true) bypasses the filter and connects (matched-provider parity)', async () => {
    const result = await utils.httpRequest(ctx(), 'GET', `${UPSTREAM_URL}/ok`, null, undefined, undefined, null, true, {});
    expect(result.response.status).toBe(200);
    await buffer(result.stream);
  });
});
