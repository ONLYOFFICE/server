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

// Sink-level guards for the two browser sinks that are reachable over HTTP: a signed but empty token
// must be refused before anything is read, written, enqueued or fetched. A minimal in-process Express
// app binds the real handlers; the boundaries are spied on so a side effect is a test failure.

'use strict';

const http = require('http');
const {Readable} = require('stream');
const express = require('express');
const {listenOnFetchablePort} = require('./fetchPort.helper');
const {describe, test, expect, beforeAll, afterAll, afterEach, jest} = require('@jest/globals');

const canvasService = require('../../DocService/sources/canvasservice');
const taskResult = require('../../DocService/sources/taskresult');
const utils = require('../../Common/sources/utils');
const wopiUtils = require('../../DocService/sources/wopiUtils');
const wopiEgress = require('../../DocService/sources/wopiEgress');
const {mintWithSecretType} = require('./mintToken.helper');
const commonDefines = require('../../Common/sources/commondefines');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');

let server;
let downloadAsUrl;
let downloadFileUrl;

beforeAll(async () => {
  const app = express();
  const rawAny = express.raw({type: () => true});
  app.post('/downloadas', rawAny, canvasService.downloadAs);
  // server.js mounts this one as POST behind the same raw parser, so the carrier under test is the real one
  app.post('/downloadfile/:docid', rawAny, canvasService.downloadFile);
  server = http.createServer(app);
  await listenOnFetchablePort(server);
  const {port} = server.address();
  downloadAsUrl = `http://127.0.0.1:${port}/downloadas`;
  downloadFileUrl = `http://127.0.0.1:${port}/downloadfile/doc-1`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// node-config is immutable, so the only honest way to vary a key is to intercept the lookup of that key
function withCfg(overrides) {
  const real = operationContext.Context.prototype.getCfg;
  return jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation(function (key, def) {
    return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : real.call(this, key, def);
  });
}
function withTokenRequiredParams(value) {
  return withCfg({'services.CoAuthoring.server.tokenRequiredParams': value});
}

function mintBrowser(payload) {
  return mintWithSecretType(new operationContext.Context(), payload, commonDefines.c_oAscSecretType.Browser, {
    algorithm: cfgTokenAlgorithm,
    expiresIn: cfgTokenExpires
  });
}

// Every boundary downloadAs would touch after it accepts a token.
function spyOnDownloadAsBoundaries() {
  return {
    select: jest.spyOn(taskResult, 'select').mockResolvedValue([]),
    download: jest.spyOn(utils, 'downloadUrlPromise').mockResolvedValue({body: Buffer.alloc(0)})
  };
}

async function postDownloadAs(cmd) {
  return await fetch(`${downloadAsUrl}?cmd=${encodeURIComponent(JSON.stringify(cmd))}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/octet-stream'},
    body: Buffer.alloc(0)
  });
}

describe('downloadAs refuses a token that authorizes nothing', () => {
  test('an empty but validly signed download token is refused and nothing is read or fetched', async () => {
    const spies = spyOnDownloadAsBoundaries();
    const token = await mintBrowser({});
    const res = await postDownloadAs({c: 'save', id: 'doc-1', userid: 'u1', tokenDownload: token});
    expect(res.status).toBe(403);
    expect(spies.select).not.toHaveBeenCalled();
    expect(spies.download).not.toHaveBeenCalled();
  });

  test('a download token with a url but no fileType is refused the same way', async () => {
    const spies = spyOnDownloadAsBoundaries();
    const token = await mintBrowser({url: 'http://storage/src.docx'});
    const res = await postDownloadAs({c: 'save', id: 'doc-1', userid: 'u1', tokenDownload: token});
    expect(res.status).toBe(403);
    expect(spies.select).not.toHaveBeenCalled();
  });

  test('the same request with a complete download token gets past the guard', async () => {
    const spies = spyOnDownloadAsBoundaries();
    const token = await mintBrowser({url: 'http://storage/src.docx', fileType: 'docx'});
    const res = await postDownloadAs({c: 'save', id: 'doc-1', userid: 'u1', tokenDownload: token});
    expect(res.status).not.toBe(403);
    // proof that authorization passed rather than that the whole flow succeeded
    expect(spies.select).toHaveBeenCalled();
  });
});

describe('downloadFile refuses a request that resolves to no source', () => {
  // the real client posts a JSON body; the token rides in it exactly as it does in production
  async function postDownloadFileBody(body) {
    return await fetch(downloadFileUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
  }

  async function postDownloadFile(token) {
    return await postDownloadFileBody({token});
  }

  test('a signed token with no url and no template leaves no source, and answers 403 without fetching', async () => {
    const download = jest.spyOn(utils, 'downloadUrlPromise').mockResolvedValue({body: Buffer.alloc(0)});
    const res = await postDownloadFile(await mintBrowser({key: 'doc-1'}));
    expect(res.status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });

  test('a source that is signed but not a string is refused too, instead of reaching the url parser', async () => {
    const download = jest.spyOn(utils, 'downloadUrlPromise').mockResolvedValue({body: Buffer.alloc(0)});
    const payloads = [
      {url: {}, fileType: 'pdf'},
      {url: ['http://storage/in.pdf'], fileType: 'pdf'},
      {changesUrl: {}},
      {document: {url: {}, fileType: 'pdf'}}
    ];
    for (const payload of payloads) {
      const res = await postDownloadFile(await mintBrowser(payload));
      expect(res.status).toBe(403);
    }
    expect(download).not.toHaveBeenCalled();
  });

  // a WOPI url is attacker-supplied whether or not we signed it, so signing it can not grant the private-address exemption
  test('a WOPI source is fetched through the wopi egress boundary, never as a privileged request', async () => {
    jest.spyOn(utils, 'checkHostFilter').mockReturnValue({[Symbol.iterator]: () => ({next: () => ({value: 0, done: true})})});
    jest.spyOn(wopiEgress, 'evaluateDestination').mockResolvedValue({status: 0, filterAllowIPs: undefined});
    const wopiDownload = jest
      .spyOn(wopiEgress, 'download')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    jest.spyOn(wopiUtils, 'getWopiFileUrl').mockResolvedValue({url: 'http://storage/wopi.docx', headers: {}, expectedDigest: undefined});
    const download = jest
      .spyOn(utils, 'downloadUrlPromise')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    const cfgFalse = withTokenRequiredParams(false);
    const userAuth = {wopiSrc: 'http://private.invalid/w', access_token: 't'};

    // neither half-signed nor fully signed fileInfo turns the fetch into a plain privileged download
    for (const token of [await mintBrowser({fileInfo: {Size: 10}}), await mintBrowser({fileInfo: {Size: 10}, userAuth})]) {
      wopiDownload.mockClear();
      download.mockClear();
      const res = await postDownloadFileBody({token, userAuth});
      expect(res.status).toBe(200);
      expect(wopiDownload).toHaveBeenCalledTimes(1);
      expect(download).not.toHaveBeenCalled();
    }
    cfgFalse.mockRestore();
  });

  test('isInJwtToken follows the url, not the token: only a signed url may skip the private-address filter', async () => {
    jest.spyOn(utils, 'checkHostFilter').mockReturnValue({[Symbol.iterator]: () => ({next: () => ({value: 0, done: true})})});
    const download = jest
      .spyOn(utils, 'downloadUrlPromise')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    const cfgFalse = withTokenRequiredParams(false);

    // the same signed token, once naming the url itself and once merely accompanying an unsigned one
    for (const [payload, body, expected] of [
      [{url: 'http://storage/signed.pdf', fileType: 'pdf'}, {}, true],
      [{fileType: 'pdf'}, {url: 'http://storage/unsigned.pdf', fileType: 'pdf'}, false],
      [{changesUrl: 'http://storage/signed.zip'}, {}, true],
      [{}, {changesUrl: 'http://storage/unsigned.zip'}, false],
      [{document: {url: 'http://storage/signed.pdf', fileType: 'pdf'}}, {}, true],
      [{}, {document: {url: 'http://storage/unsigned.pdf', fileType: 'pdf'}}, false]
    ]) {
      download.mockClear();
      const res = await postDownloadFileBody({token: await mintBrowser(payload), ...body});
      expect(res.status).toBe(200);
      expect(download.mock.calls[0][2].isInJwtToken).toBe(expected);
      // redirects are blocked exactly where the privilege was granted, and left alone where it was not
      expect(typeof download.mock.calls[0][2].beforeRedirect).toBe(expected ? 'function' : 'undefined');
    }
    cfgFalse.mockRestore();
  });

  test('tokenRequiredParams decides whether an unsigned url may complete a partially signed token', async () => {
    jest.spyOn(utils, 'checkHostFilter').mockReturnValue({[Symbol.iterator]: () => ({next: () => ({value: 0, done: true})})});
    const download = jest
      .spyOn(utils, 'downloadUrlPromise')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    const partial = await mintBrowser({fileType: 'pdf'});

    // false: the unsigned body params survive the merge and complete the token, but the url is not treated as signed
    const cfgFalse = withTokenRequiredParams(false);
    const permissive = await postDownloadFileBody({token: partial, url: 'http://storage/unsigned.pdf', fileType: 'pdf'});
    expect(permissive.status).toBe(200);
    expect(download.mock.calls[0][1]).toBe('http://storage/unsigned.pdf');
    expect(download.mock.calls[0][2].isInJwtToken).toBe(false);
    cfgFalse.mockRestore();
    download.mockClear();

    // true: they are discarded, the token alone names no source, and the request is refused before any fetch
    const cfgTrue = withTokenRequiredParams(true);
    const strict = await postDownloadFileBody({token: partial, url: 'http://storage/unsigned.pdf', fileType: 'pdf'});
    expect(strict.status).toBe(403);
    expect(download).not.toHaveBeenCalled();

    // true with a complete token: it works, because everything it needs is signed
    const full = await mintBrowser({url: 'http://storage/signed.pdf', fileType: 'pdf'});
    const ok = await postDownloadFileBody({token: full, url: 'http://storage/unsigned.pdf'});
    expect(ok.status).toBe(200);
    expect(download.mock.calls[0][1]).toBe('http://storage/signed.pdf');
    cfgTrue.mockRestore();
  });

  test('the legacy x-url header is an unsigned source, and it is browser auth that decides whether it survives', async () => {
    jest.spyOn(utils, 'checkHostFilter').mockReturnValue({[Symbol.iterator]: () => ({next: () => ({value: 0, done: true})})});
    const download = jest
      .spyOn(utils, 'downloadUrlPromise')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    const partial = await mintBrowser({fileType: 'pdf'});
    const postWithHeader = () =>
      fetch(downloadFileUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-url': 'http://storage/legacy.pdf'},
        body: JSON.stringify({token: partial})
      });

    // with browser auth off (the shipped default) the header is a legacy unsigned source and is used as one
    const legacy = withCfg({'services.CoAuthoring.server.tokenRequiredParams': true, 'services.CoAuthoring.token.enable.browser': false});
    expect((await postWithHeader()).status).toBe(200);
    expect(download.mock.calls[0][1]).toBe('http://storage/legacy.pdf');
    legacy.mockRestore();
    download.mockClear();

    // with browser auth on, the same partial token names no source and the request is refused, header or not
    const enforced = withCfg({'services.CoAuthoring.server.tokenRequiredParams': true, 'services.CoAuthoring.token.enable.browser': true});
    expect((await postWithHeader()).status).toBe(403);
    expect(download).not.toHaveBeenCalled();
    enforced.mockRestore();
  });

  test('a signed url of an allowed type is fetched, and it is the signed one', async () => {
    // the host filter would otherwise refuse the test host before the download is attempted
    // the handler consumes it with yield*, so the stub is an iterator that finishes immediately with 0
    jest.spyOn(utils, 'checkHostFilter').mockReturnValue({[Symbol.iterator]: () => ({next: () => ({value: 0, done: true})})});
    const download = jest
      .spyOn(utils, 'downloadUrlPromise')
      .mockImplementation(() => Promise.resolve({stream: Readable.from([Buffer.from('ok')]), response: {headers: {}, data: null}}));
    const res = await postDownloadFile(await mintBrowser({url: 'http://storage/in.pdf', fileType: 'pdf'}));
    expect(res.status).toBe(200);
    expect(download).toHaveBeenCalled();
    expect(download.mock.calls[0][1]).toBe('http://storage/in.pdf');
  });
});
