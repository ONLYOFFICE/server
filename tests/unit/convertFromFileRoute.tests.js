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

// Hermetic HTTP/multipart contract test for POST /converter/from-file. A minimal in-process Express
// app (real handleConvertUpload -> convertFromFile.commandConvertFromBody) is bound to a random port;
// no full server.js, no :8000, no storage/x2t/queue. Only the heavy converter boundary
// (converterService.convertFromCommandBody) is mocked for the happy path. The full strict-contract
// branch coverage lives in getRequestParamsFromFile.tests.js; this file checks the route wiring,
// real multipart parsing, and multer limits.

'use strict';

const http = require('http');
const stream = require('stream');
const express = require('express');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const {handleConvertUpload} = require('../../DocService/sources/middleware/convertUpload');
const convertFromFile = require('../../DocService/sources/convertFromFile');
const converterService = require('../../DocService/sources/converterservice');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const {signToken} = require('../../DocService/sources/DocsCoServer');
const taskResult = require('../../DocService/sources/taskresult');
const storageBase = require('../../Common/sources/storage/storage-base');
const commonDefines = require('../../Common/sources/commondefines');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');

let server;
let converterUrl;
let docbuilderUrl;

beforeAll(async () => {
  const app = express();
  // checkClientIp is intentionally omitted: it is an IP allowlist, not part of the multipart contract.
  app.post('/converter/from-file', handleConvertUpload, convertFromFile.commandConvertFromBody);
  app.post('/docbuilder/from-file', handleConvertUpload, convertFromFile.builderFromFile);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  converterUrl = `http://127.0.0.1:${port}/converter/from-file`;
  docbuilderUrl = `http://127.0.0.1:${port}/docbuilder/from-file`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function postForm(form, url = converterUrl, timeout = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {method: 'POST', body: form, signal: controller.signal});
  } finally {
    clearTimeout(timeoutId);
  }
}

describe('POST /converter/from-file route contract (in-process, no server)', () => {
  test('200; the converter boundary receives one file and the JSON params (non-token mode)', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockImplementation(async (req, res) => {
      res.status(200).send('mock');
    });
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));
    form.append('file', new Blob([Buffer.from('hello from-file')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const [req, , params, isDecoded] = spy.mock.calls[0];
    expect(req.file).toBeDefined();
    expect(req.file.originalname).toBe('sample.txt');
    expect(Buffer.from(req.file.buffer).toString()).toBe('hello from-file');
    expect(params).toEqual({filetype: 'txt', outputtype: 'docx'});
    expect(isDecoded).toBe(false);
  });

  test('legacy JSON error on an unexpected unsigned scalar field; the converter boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));
    form.append('outputtype', 'docx');
    form.append('file', new Blob([Buffer.from('hello')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-7);
    expect(spy).not.toHaveBeenCalled();
  });

  test('legacy JSON error on bracket-notation params fields; the converter boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params[filetype]', 'txt');
    form.append('params[outputtype]', 'docx');
    form.append('file', new Blob([Buffer.from('hello')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-7);
    expect(spy).not.toHaveBeenCalled();
  });

  test('legacy JSON error when both the file part and key are missing (real handler rejects before storage)', async () => {
    // No spy: the real convertFromCommandBody runs and returns the legacy JSON error before touching storage/x2t.
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));

    const res = await postForm(form);

    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-7);
  });

  test('413 when the upload exceeds maxDownloadBytes (real multer limit)', async () => {
    const realGetCfg = operationContext.Context.prototype.getCfg;
    jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
      if ('FileConverter.converter.maxDownloadBytes' === key) {
        return 16;
      }
      return realGetCfg.call(this, key, def);
    });
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));
    form.append('file', new Blob([Buffer.from('this body is definitely larger than sixteen bytes')]), 'big.txt');

    const res = await postForm(form);

    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  test('legacy JSON auth error (-8) when the token fails verification; the converter boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('token', 'not.a.valid.jwt');
    form.append('file', new Blob([Buffer.from('hello')]), 'sample.txt');

    const res = await postForm(form);

    // VKEY -> -8, the same wire code the legacy convertRequest returns on auth failure.
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-8);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /docbuilder/from-file route contract (in-process, no server)', () => {
  test('200; builder receives the JSON params and the uploaded script (non-token mode)', async () => {
    const spy = jest.spyOn(converterService, 'builder').mockImplementation(async (req, res) => {
      res.status(200).send('mock');
    });
    const form = new FormData();
    form.append('params', JSON.stringify({key: 'bld1', argument: '{}'}));
    form.append('file', new Blob([Buffer.from('builder script')]), 'script.docbuilder');

    const res = await postForm(form, docbuilderUrl);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const [req, , params, isDecoded] = spy.mock.calls[0];
    expect(req.file).toBeDefined();
    expect(req.file.originalname).toBe('script.docbuilder');
    expect(params).toEqual({key: 'bld1', argument: '{}'});
    expect(isDecoded).toBe(false);
  });

  test('legacy builder JSON error on an unexpected scalar field (argument); the builder boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'builder').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params', JSON.stringify({key: 'bld1'}));
    form.append('argument', '{}');
    form.append('file', new Blob([Buffer.from('builder script')]), 'script.docbuilder');

    const res = await postForm(form, docbuilderUrl);

    // -1 (UNKNOWN), matching the legacy builderRequest contract (it never emits CONVERT_PARAMS/-7).
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(-1);
    expect(spy).not.toHaveBeenCalled();
  });

  test('200; builder receives the decoded token params and isDecoded=true when params carries a nested token', async () => {
    const payload = {key: 'bld-token', argument: '{}'};
    const token = await signToken(new operationContext.Context(), payload, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const spy = jest.spyOn(converterService, 'builder').mockImplementation(async (req, res) => {
      res.status(200).send('mock');
    });
    const form = new FormData();
    form.append('params', JSON.stringify({token}));
    form.append('file', new Blob([Buffer.from('builder script')]), 'script.docbuilder');

    const res = await postForm(form, docbuilderUrl);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const [req, , params, isDecoded] = spy.mock.calls[0];
    expect(req.file.originalname).toBe('script.docbuilder');
    expect(params).toMatchObject(payload);
    expect(isDecoded).toBe(true);
  });
});

// The real convertFromCommandBody runs here; only the storage/db/queue boundary is mocked. These lock
// in the async/poll behavior: async returns endConvert=false immediately, a no-file poll never writes
// or enqueues, and a completed poll returns a fileUrl. The shardkey query param keeps async from being
// downgraded by the DEFAULT_SHARD_KEY guard.
describe('POST /converter/from-file async and polling behavior (real handler, mocked storage/db/queue)', () => {
  test('async=true with a file enqueues and answers endConvert=false immediately (no streamed bytes)', async () => {
    const putObject = jest.spyOn(storageBase, 'putObject').mockResolvedValue(undefined);
    const upsert = jest.spyOn(taskResult, 'upsert').mockResolvedValue({isInsert: true});
    const select = jest.spyOn(taskResult, 'select').mockResolvedValue([]);
    const addTask = jest.spyOn(docsCoServer, 'addTask').mockImplementation(function* () {});

    const form = new FormData();
    form.append('params', JSON.stringify({key: 'asynckey', filetype: 'txt', outputtype: 'docx', async: true}));
    form.append('file', new Blob([Buffer.from('hello async')]), 'sample.txt');

    const res = await postForm(form, `${converterUrl}?shardkey=test`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endConvert).toBe(false);
    expect(body.percent).toBe(0);
    expect(body.fileUrl).toBeUndefined();
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test('a no-file poll by key reads status and NEVER writes storage or enqueues a task', async () => {
    const putObject = jest.spyOn(storageBase, 'putObject').mockResolvedValue(undefined);
    const upsert = jest.spyOn(taskResult, 'upsert').mockResolvedValue({isInsert: true});
    const addTask = jest.spyOn(docsCoServer, 'addTask').mockImplementation(function* () {});
    const select = jest
      .spyOn(taskResult, 'select')
      .mockResolvedValue([{status: commonDefines.FileStatus.WaitQueue, last_open_date: new Date(), password: null}]);

    const form = new FormData();
    form.append('params', JSON.stringify({key: 'pollkey', filetype: 'txt', outputtype: 'docx'}));

    const res = await postForm(form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endConvert).toBe(false);
    expect(body.error).toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
    expect(putObject).not.toHaveBeenCalled();
    expect(addTask).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('a no-file poll for a completed task returns the fileUrl and endConvert=true without writing or enqueuing', async () => {
    const putObject = jest.spyOn(storageBase, 'putObject').mockResolvedValue(undefined);
    const upsert = jest.spyOn(taskResult, 'upsert').mockResolvedValue({isInsert: true});
    const addTask = jest.spyOn(docsCoServer, 'addTask').mockImplementation(function* () {});
    jest.spyOn(taskResult, 'select').mockResolvedValue([{status: commonDefines.FileStatus.Ok, last_open_date: new Date(), password: null}]);
    jest.spyOn(storageBase, 'getSignedUrl').mockResolvedValue('http://signed/result.docx');

    const form = new FormData();
    form.append('params', JSON.stringify({key: 'donekey', filetype: 'txt', outputtype: 'docx'}));

    const res = await postForm(form);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endConvert).toBe(true);
    expect(body.fileUrl).toBe('http://signed/result.docx');
    expect(body.fileType).toBe('docx');
    expect(putObject).not.toHaveBeenCalled();
    expect(addTask).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('synchronous success streams the converted bytes back (not JSON)', async () => {
    const outBytes = Buffer.from('converted-bytes');
    const putObject = jest.spyOn(storageBase, 'putObject').mockResolvedValue(undefined);
    // upsert isInsert=false + an Ok task row makes convertByCmd return end=true on the first check (no wait, no enqueue).
    jest.spyOn(taskResult, 'upsert').mockResolvedValue({isInsert: false});
    jest.spyOn(taskResult, 'select').mockResolvedValue([{status: commonDefines.FileStatus.Ok, last_open_date: new Date(), password: null}]);
    jest.spyOn(storageBase, 'createReadStream').mockResolvedValue({readStream: stream.Readable.from(outBytes), contentLength: outBytes.length});
    const addTask = jest.spyOn(docsCoServer, 'addTask').mockImplementation(function* () {});

    const form = new FormData();
    form.append('params', JSON.stringify({key: 'syncdone', filetype: 'txt', outputtype: 'docx'}));
    form.append('file', new Blob([Buffer.from('hello sync')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wordprocessingml');
    expect(res.headers.get('content-disposition')).toContain('sample.docx');
    expect(await res.text()).toBe('converted-bytes');
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(addTask).not.toHaveBeenCalled();
  });
});
