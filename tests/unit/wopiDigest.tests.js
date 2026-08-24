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

const {describe, test, expect} = require('@jest/globals');
const crypto = require('crypto');
const {Readable, Writable} = require('stream');
const {pipeline} = require('node:stream/promises');

const {planIntegrityChecks, IntegrityStream} = require('../../Common/sources/downloadIntegrity');
const {getContentsExpectedDigest, getWopiFileUrl} = require('../../DocService/sources/wopiUtils');
const wopiClient = require('../../DocService/sources/wopiClient');
const {signToken, checkJwt} = require('../../DocService/sources/DocsCoServer');
const constants = require('../../Common/sources/constants');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

const tokenCtx = operationContext.global;
const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');

const body = Buffer.from('wopi file contents');
const otherBody = Buffer.from('changed file contents');
const sha256 = crypto.createHash('sha256').update(body).digest('base64');

function devNull() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}

// Runs the digest supplied by CheckFileInfo through the same pipeline as a real download
async function runContentsDigest(fileInfo, chunks) {
  const plan = planIntegrityChecks({}, 200, undefined, getContentsExpectedDigest(fileInfo));
  if (!plan) {
    return null;
  }
  const stream = new IntegrityStream(plan);
  await pipeline(Readable.from(chunks), stream, devNull());
  return stream;
}

// Minimal context: proof signing is disabled by returning empty WOPI keys
function fakeCtx() {
  return {
    userSessionId: 'session-1',
    getCfg(key, def) {
      switch (key) {
        case 'wopi.privateKey':
        case 'wopi.privateKeyOld':
          return '';
        case 'wopi.sendAuthorizationHeader':
          return false;
        default:
          return def;
      }
    },
    logger: {debug() {}}
  };
}

describe('getContentsExpectedDigest', () => {
  test('maps a present SHA256 to a caller digest', () => {
    expect(getContentsExpectedDigest({SHA256: sha256})).toEqual({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256});
  });

  test('returns undefined when SHA256 is absent', () => {
    expect(getContentsExpectedDigest({})).toBeUndefined();
    expect(getContentsExpectedDigest(undefined)).toBeUndefined();
  });

  test('returns undefined for an empty or non-string SHA256', () => {
    expect(getContentsExpectedDigest({SHA256: ''})).toBeUndefined();
    expect(getContentsExpectedDigest({SHA256: 12345})).toBeUndefined();
  });
});

describe('getWopiFileUrl expectedDigest selection', () => {
  test('FileUrl carries the file contents digest', async () => {
    const result = await getWopiFileUrl(fakeCtx(), {FileUrl: 'https://host/file', SHA256: sha256}, undefined);
    expect(result.url).toBe('https://host/file');
    expect(result.expectedDigest).toMatchObject({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256});
  });

  test('the /contents endpoint carries the file contents digest', async () => {
    const result = await getWopiFileUrl(fakeCtx(), {SHA256: sha256}, {wopiSrc: 'https://host/wopi/files/1', access_token: 'tok'});
    expect(result.url).toContain('/contents?access_token=');
    expect(result.expectedDigest).toMatchObject({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256});
  });

  test('TemplateSource is not tied to the file SHA256', async () => {
    const result = await getWopiFileUrl(fakeCtx(), {TemplateSource: 'https://host/template', SHA256: sha256}, undefined);
    expect(result.url).toBe('https://host/template');
    expect(result.expectedDigest).toBeUndefined();
  });

  test('no digest when SHA256 is absent', async () => {
    const result = await getWopiFileUrl(fakeCtx(), {FileUrl: 'https://host/file'}, undefined);
    expect(result.expectedDigest).toBeUndefined();
  });
});

describe('WOPI SHA256 verification through the integrity pipeline', () => {
  test('a valid SHA256 passes', async () => {
    const stream = await runContentsDigest({SHA256: sha256}, [body]);
    expect(stream.integrity).toEqual({source: 'WOPI SHA256', algorithm: 'sha256'});
  });

  test('a wrong SHA256 fails with EBADDIGEST', async () => {
    await expect(runContentsDigest({SHA256: sha256}, [otherBody])).rejects.toMatchObject({code: 'EBADDIGEST'});
  });

  test('a missing SHA256 is skipped, not failed', async () => {
    expect(await runContentsDigest({}, [body])).toBeNull();
  });

  test('a malformed SHA256 is skipped, not failed', async () => {
    expect(await runContentsDigest({SHA256: 'not a real digest'}, [body])).toBeNull();
  });
});

// the convert-and-edit status token is signed with a key derived for its own purpose,
// so it must not verify as an inbox/browser/session token on the shared secret.
// and it is verified through the shared checkJwt, where the key and the payload rule come from one policy.
describe('convert-and-edit status token purpose binding', () => {
  test('its own handler accepts it and carries the signed callback target', async () => {
    const token = await wopiClient.signConvertStatusToken(tokenCtx, 'doc-83205', 'https://host/wopi/files/1');
    const res = await checkJwt(tokenCtx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(res.decoded.docId).toBe('doc-83205');
    expect(res.decoded.wopiSrc).toBe('https://host/wopi/files/1');
  });

  test('the inbox path rejects it, so it cannot reach /docbuilder', async () => {
    const token = await wopiClient.signConvertStatusToken(tokenCtx, 'doc-83205', 'https://host/wopi/files/1');
    for (const purpose of [constants.JWT_PURPOSE_CONVERTER, constants.JWT_PURPOSE_BROWSER_OPEN, constants.JWT_PURPOSE_EDITOR_SESSION]) {
      const res = await checkJwt(tokenCtx, token, purpose);
      expect(res.decoded).toBe(null);
      // the derived key is what rejects it, so the failure must be a signature failure and not a policy mismatch
      expect(res.description).toMatch(/signature/i);
    }
  });

  test('a missing token is rejected, so the handler has no tokenless branch left', async () => {
    for (const token of [undefined, '', 'not-a-jwt']) {
      const res = await checkJwt(tokenCtx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
      expect(res.decoded).toBe(null);
      expect(res.code).toBe(constants.JWT_ERROR_CODE);
    }
  });

  test('an inbox token is rejected by the convert-and-edit handler', async () => {
    const token = await signToken(tokenCtx, constants.JWT_PURPOSE_CONVERTER, {docId: 'doc-83205'}, cfgTokenAlgorithm, 300);
    const res = await checkJwt(tokenCtx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(res.decoded).toBe(null);
  });
});
