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
const express = require('express');
const {describe, test, expect, jest, beforeAll, afterAll, afterEach} = require('@jest/globals');

const {handleConvertUpload} = require('../../DocService/sources/middleware/convertUpload');
const convertFromFile = require('../../DocService/sources/convertFromFile');
const converterService = require('../../DocService/sources/converterservice');
const {signToken} = require('../../DocService/sources/DocsCoServer');
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

  test('400 on an unexpected unsigned scalar field; the converter boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));
    form.append('outputtype', 'docx');
    form.append('file', new Blob([Buffer.from('hello')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  test('400 on bracket-notation params fields; the converter boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'convertFromCommandBody').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params[filetype]', 'txt');
    form.append('params[outputtype]', 'docx');
    form.append('file', new Blob([Buffer.from('hello')]), 'sample.txt');

    const res = await postForm(form);

    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  test('400 when the file part is missing (real handler rejects before storage)', async () => {
    // No spy: the real convertFromCommandBody runs and returns 400 before touching storage/x2t.
    const form = new FormData();
    form.append('params', JSON.stringify({filetype: 'txt', outputtype: 'docx'}));

    const res = await postForm(form);

    expect(res.status).toBe(400);
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

  test('400 on an unexpected scalar field (argument); the builder boundary is not reached', async () => {
    const spy = jest.spyOn(converterService, 'builder').mockResolvedValue(undefined);
    const form = new FormData();
    form.append('params', JSON.stringify({key: 'bld1'}));
    form.append('argument', '{}');
    form.append('file', new Blob([Buffer.from('builder script')]), 'script.docbuilder');

    const res = await postForm(form, docbuilderUrl);

    expect(res.status).toBe(400);
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
