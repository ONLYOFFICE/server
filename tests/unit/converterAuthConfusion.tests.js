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

// Wire-level token-confusion test: a browser-typed JWT replayed on /docbuilder, /converter and their
// from-file twins must be rejected with the legacy auth error -8. Auth failure short-circuits before
// storage/x2t/queue, so no boundary is mocked. A minimal in-process Express app binds the real
// handlers to a random port.

'use strict';

// pin purposeCheck=validate before the first require('config') and restore right after: NODE_CONFIG outranks every config file, and jest reuses one process env per worker
const savedNodeConfig = process.env.NODE_CONFIG;
process.env.NODE_CONFIG = JSON.stringify({services: {CoAuthoring: {token: {purposeCheck: 'validate'}}}});

const http = require('http');
const express = require('express');
const {listenOnFetchablePort} = require('./fetchPort.helper');
const {describe, test, expect, beforeAll, afterAll, jest} = require('@jest/globals');

const converterService = require('../../DocService/sources/converterservice');
const convertFromFile = require('../../DocService/sources/convertFromFile');
const {handleConvertUpload} = require('../../DocService/sources/middleware/convertUpload');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const {mintWithSecretType} = require('./mintToken.helper');
const commonDefines = require('../../Common/sources/commondefines');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

if (undefined === savedNodeConfig) {
  delete process.env.NODE_CONFIG;
} else {
  process.env.NODE_CONFIG = savedNodeConfig;
}

const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');

let server;
let docbuilderUrl;
let converterUrl;
let docbuilderFromFileUrl;
let converterFromFileUrl;
let commandUrl;

beforeAll(async () => {
  const app = express();
  // checkClientIp (IP allowlist) is intentionally omitted; it is not part of the auth-confusion contract.
  const rawAny = express.raw({type: () => true});
  app.post('/docbuilder', rawAny, (req, res) => converterService.builder(req, res));
  app.post('/converter', rawAny, converterService.convertJson);
  app.post('/docbuilder/from-file', handleConvertUpload, convertFromFile.builderFromFile);
  app.post('/converter/from-file', handleConvertUpload, convertFromFile.commandConvertFromBody);
  app.post('/command', rawAny, docsCoServer.commandFromServer);
  server = http.createServer(app);
  await listenOnFetchablePort(server);
  const {port} = server.address();
  docbuilderUrl = `http://127.0.0.1:${port}/docbuilder`;
  converterUrl = `http://127.0.0.1:${port}/converter`;
  docbuilderFromFileUrl = `http://127.0.0.1:${port}/docbuilder/from-file`;
  converterFromFileUrl = `http://127.0.0.1:${port}/converter/from-file`;
  commandUrl = `http://127.0.0.1:${port}/command`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

function mintBrowser(payload) {
  return mintWithSecretType(new operationContext.Context(), payload, commonDefines.c_oAscSecretType.Browser, {
    algorithm: cfgTokenAlgorithm,
    expiresIn: cfgTokenExpires
  });
}

function mintInbox(payload) {
  return mintWithSecretType(new operationContext.Context(), payload, commonDefines.c_oAscSecretType.Inbox, {
    algorithm: cfgTokenAlgorithm,
    expiresIn: cfgTokenExpires
  });
}

async function post(url, token, body) {
  return await fetch(url, {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain'},
    body: body || ''
  });
}

// from-file is multipart: the token rides as a `token` field and a real file part satisfies multer.
async function postFromFile(url, token, script) {
  const form = new FormData();
  form.append('token', token);
  form.append('file', new Blob([Buffer.from(script)]), 'script.docbuilder');
  return await fetch(url, {method: 'POST', body: form});
}

describe('token confusion on high-privilege inbox endpoints', () => {
  test('browser version-history token (top-level url) on /docbuilder -> -8', async () => {
    const token = await mintBrowser({
      version: 1,
      key: 'v1',
      url: 'http://attacker/x.docx',
      changesUrl: 'http://attacker/c.zip',
      previous: {key: 'p', url: 'http://attacker/p.docx'}
    });
    const res = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });

  test('browser open config token (document+editorConfig) on /docbuilder -> -8', async () => {
    const token = await mintBrowser({document: {key: 'd', url: 'http://x/d.docx'}, editorConfig: {user: {id: '1'}}});
    const res = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });

  test('browser downloadAs token {url,fileType} on /docbuilder -> -8 (fileType rule)', async () => {
    const token = await mintBrowser({url: 'http://attacker/x.docx', fileType: 'docx'});
    const res = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });

  test('browser open config token on /converter -> -8', async () => {
    const token = await mintBrowser({document: {key: 'd', url: 'http://x/d.docx'}, editorConfig: {user: {id: '1'}}});
    const res = await post(converterUrl, token, '');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });
});

describe('token confusion on from-file endpoints', () => {
  test('browser version-history token (top-level url) on /docbuilder/from-file -> -8', async () => {
    // the claim is correct on purpose, so the rejection can only come from the marker rule
    const token = await mintBrowser({
      operation: 'docbuilder',
      version: 1,
      key: 'v1',
      url: 'http://attacker/x.docx',
      changesUrl: 'http://attacker/c.zip',
      previous: {key: 'p', url: 'http://attacker/p.docx'}
    });
    const res = await postFromFile(docbuilderFromFileUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });

  test('browser open config token (document+editorConfig) on /converter/from-file -> -8', async () => {
    const token = await mintBrowser({operation: 'converter', document: {key: 'd', url: 'http://x/d.docx'}, editorConfig: {user: {id: '1'}}});
    const res = await postFromFile(converterFromFileUrl, token, 'hello');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
  });
});

describe('operation claim on the wire', () => {
  test('only the literal false switches the unsigned-source rule off; a bad tenant value fails closed', async () => {
    const real = operationContext.Context.prototype.getCfg;
    for (const [value, expectRefused] of [
      [false, false],
      [true, true],
      [0, true],
      ['', true],
      [null, true],
      ['false', true]
    ]) {
      const cfg = jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
        return 'services.CoAuthoring.token.requireOperationForUnsignedSource' === key ? value : real.call(this, key, def);
      });
      try {
        const answer = await post(docbuilderUrl, await mintInbox({key: 'b5'}), 'builder.CreateFile("docx");builder.CloseFile();');
        expect([String(value), (await answer.json()).error === -8]).toEqual([String(value), expectRefused]);
      } finally {
        cfg.mockRestore();
      }
    }
  });

  test('purposeCheck off does NOT disable the unsigned-source rule: that rule has a switch of its own', async () => {
    const real = operationContext.Context.prototype.getCfg;
    const cfg = jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
      return 'services.CoAuthoring.token.purposeCheck' === key ? 'off' : real.call(this, key, def);
    });
    try {
      // off still lifts the heuristic and the field sets, so a command-shaped token reaches the builder
      const shaped = await post(docbuilderUrl, await mintInbox({c: 'info', key: 'b6', url: 'http://storage/script.docbuilder'}), '');
      expect((await shaped.json()).error).not.toBe(-8);
      // but an unsigned script still needs the claim, because the blanket off must not hand that permission back
      const inline = await post(docbuilderUrl, await mintInbox({key: 'b6'}), 'builder.CreateFile("docx");builder.CloseFile();');
      expect((await inline.json()).error).toBe(-8);
    } finally {
      cfg.mockRestore();
    }
  });

  test('a claim that matches lets the body script through with the rule on', async () => {
    const token = await mintInbox({operation: 'docbuilder', key: 'b7'});
    const answer = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect((await answer.json()).error).not.toBe(-8);
  });

  test('requireOperationForUnsignedSource false restores the pre-10.0.0 behaviour for the body script', async () => {
    // the operator escape hatch: the rule is on by default, and turning it off must bring back exactly the old acceptance
    const real = operationContext.Context.prototype.getCfg;
    const cfg = jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
      return 'services.CoAuthoring.token.requireOperationForUnsignedSource' === key ? false : real.call(this, key, def);
    });
    try {
      const token = await mintInbox({key: 'b4'});
      const answer = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
      expect((await answer.json()).error).not.toBe(-8);
    } finally {
      cfg.mockRestore();
    }
  });

  test('a claimless token cannot run an unsigned script on either docbuilder route', async () => {
    // this is the {key} token external data links mint: it used to be a complete build request, because the script itself is never signed
    const token = await mintInbox({key: 'b1'});
    const body = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect((await body.json()).error).toBe(-8);
    const fromFile = await postFromFile(docbuilderFromFileUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect((await fromFile.json()).error).toBe(-8);
  });

  test('the same token still reaches the builder when the script is named by a signed url', async () => {
    // the url is inside the token, so the claim is not what authorizes the script here
    const token = await mintInbox({key: 'b2', url: 'http://storage/script.docbuilder'});
    const answer = await post(docbuilderUrl, token, '');
    expect((await answer.json()).error).not.toBe(-8);
  });

  test('a token claiming the converter is refused on both docbuilder routes', async () => {
    const token = await mintInbox({operation: 'converter', key: 'b1'});
    const body = await post(docbuilderUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect((await body.json()).error).toBe(-8);
    const fromFile = await postFromFile(docbuilderFromFileUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect((await fromFile.json()).error).toBe(-8);
  });

  test('the matching claim is accepted on /docbuilder/from-file', async () => {
    const token = await mintInbox({operation: 'docbuilder'});
    // no script target and no file part: the request fails later at param validation, never with the auth -8
    const form = new FormData();
    form.append('token', token);
    const res = await fetch(docbuilderFromFileUrl, {method: 'POST', body: form});
    expect((await res.json()).error).not.toBe(-8);
  });
});

describe('command route wiring', () => {
  const TOKEN_ERR = commonDefines.c_oAscServerCommandErrors.Token;
  const DOC_ID_ERR = commonDefines.c_oAscServerCommandErrors.DocumentIdError;

  test('browser open config token on /command -> Token error (proves the fourth-arg guard runs)', async () => {
    const token = await mintBrowser({document: {key: 'd', url: 'http://x/d.docx'}, editorConfig: {user: {id: '1'}}});
    const res = await post(commandUrl, token, '');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(TOKEN_ERR);
  });

  test('legit inbox command token is not rejected by the guard (stops at input validation, not Token)', async () => {
    // a key-less non-version command stops at DocumentIdError before any command handler / DB
    const token = await mintInbox({c: 'info'});
    const res = await post(commandUrl, token, '');
    expect(res.status).toBe(200);
    const err = (await res.json()).error;
    expect(err).not.toBe(TOKEN_ERR);
    expect(err).toBe(DOC_ID_ERR);
  });
});

// Proves the real route handlers pass the right operation label: filetype is accepted by 'converter' and rejected by 'docbuilder', so swapping the labels would flip both assertions.
describe('/command runs on what the token signed', () => {
  const withoutRequiredParams = () => {
    const real = operationContext.Context.prototype.getCfg;
    return jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
      return 'services.CoAuthoring.server.tokenRequiredParams' === key ? false : real.call(this, key, def);
    });
  };
  const postJson = async (token, body) =>
    fetch(commandUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token, ...body})
    });

  test('a field the token never signed is refused by name, not silently dropped', async () => {
    const cfg = withoutRequiredParams();
    try {
      const token = await mintInbox({key: 'cmd1'});
      const res = await postJson(token, {c: 'info'});
      expect((await res.json()).error).toBe(commonDefines.c_oAscServerCommandErrors.Token);
    } finally {
      cfg.mockRestore();
    }
  });

  test('a deep value that differs from the signed one is refused too', async () => {
    const cfg = withoutRequiredParams();
    try {
      const token = await mintInbox({c: 'meta', key: 'cmd2', meta: {title: 'signed.docx'}});
      const res = await postJson(token, {meta: {title: 'spoofed.docx'}});
      expect((await res.json()).error).toBe(commonDefines.c_oAscServerCommandErrors.Token);
    } finally {
      cfg.mockRestore();
    }
  });

  test('the shard keys are transport, so the internal proxy hop is not mistaken for an unsigned field', async () => {
    const cfg = withoutRequiredParams();
    try {
      const token = await mintInbox({c: 'version', key: 'cmd3'});
      const res = await fetch(`${commandUrl}?shardkey=cmd3&WOPISrc=http%3A%2F%2Fh%2Fw`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token})
      });
      expect((await res.json()).error).not.toBe(commonDefines.c_oAscServerCommandErrors.Token);
    } finally {
      cfg.mockRestore();
    }
  });

  test('a fully signed command passes in both carriers, and the default mode is unaffected', async () => {
    const body = await postJson(await mintInbox({c: 'version', key: 'cmd4'}), {});
    expect((await body.json()).error).not.toBe(commonDefines.c_oAscServerCommandErrors.Token);
    const header = await post(commandUrl, await mintInbox({query: {}, payload: {c: 'version', key: 'cmd5'}}), '{}');
    expect((await header.json()).error).not.toBe(commonDefines.c_oAscServerCommandErrors.Token);
    // the same request that is refused under the test-only mode is accepted under the shipped one, where the merge discards the wire field
    const strict = await postJson(await mintInbox({c: 'version', key: 'cmd6'}), {c: 'drop'});
    expect((await strict.json()).error).not.toBe(commonDefines.c_oAscServerCommandErrors.Token);
  });
});

describe('from-file route-label wiring (swap safety)', () => {
  test('inbox {filetype} token on /converter/from-file passes auth (route uses the converter label)', async () => {
    const token = await mintInbox({operation: 'converter', filetype: 'docx', outputtype: 'pdf'});
    // no file part and no key: the request fails later at param validation, never with the auth -8
    const form = new FormData();
    form.append('token', token);
    const res = await fetch(converterFromFileUrl, {method: 'POST', body: form});
    expect(res.status).toBe(200);
    expect((await res.json()).error).not.toBe(-8);
  });

  test('a token naming a script url is refused on /docbuilder/from-file, where the script is the file part', async () => {
    // the same token passes auth on /docbuilder, so this proves the label wiring and not a payload accident
    const token = await mintInbox({operation: 'docbuilder', key: 'b3', url: 'http://storage/script.docbuilder'});
    const res = await postFromFile(docbuilderFromFileUrl, token, 'builder.CreateFile("docx");builder.CloseFile();');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
    const body = await post(docbuilderUrl, token, '');
    expect((await body.json()).error).not.toBe(-8);
  });
});
