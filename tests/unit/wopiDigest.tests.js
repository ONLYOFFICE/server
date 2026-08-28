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

const {describe, test, expect, beforeAll, afterAll} = require('@jest/globals');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

// a file type comes from the WOPI host and was interpolated straight into a path, so it could name one outside the folder
describe('WOPI new-file template path', () => {
  const SECRET = 'S3CR3T-INBOX-JWT-KEY';
  let root;
  let templateRoot;

  // a layout that mirrors a deployment: the templates folder sits below a root that also holds the server config
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oo-wopi-tpl-'));
    templateRoot = path.join(root, 'document-templates', 'new');
    fs.mkdirSync(path.join(templateRoot, 'en-US'), {recursive: true});
    for (const ext of ['docx', 'pdf', 'pptx', 'xlsx', 'odt']) {
      fs.writeFileSync(path.join(templateRoot, 'en-US', `new.${ext}`), 'LEGIT-TEMPLATE');
    }
    fs.writeFileSync(path.join(root, 'local.json'), JSON.stringify({secret: {inbox: {string: SECRET}}}));
  });
  afterAll(() => fs.rmSync(root, {recursive: true, force: true}));

  function templateMeta(fileType) {
    const ctx = new operationContext.Context();
    ctx.config = {services: {CoAuthoring: {server: {newFileTemplate: templateRoot}}}};
    return wopiClient._getNewFileTemplateMetaForTesting(ctx, 'en', 'en', fileType);
  }

  test('resolves a shipped extension to a file inside the templates folder', async () => {
    const res = await templateMeta('docx');
    expect(res.templateFileType).toBe('docx');
    expect(res.size).toBe('LEGIT-TEMPLATE'.length);
    expect(path.resolve(res.filePath).startsWith(path.resolve(templateRoot) + path.sep)).toBe(true);
    expect(fs.readFileSync(res.filePath, 'utf8')).toBe('LEGIT-TEMPLATE');
  });

  test('keeps mapping the create-new aliases', async () => {
    await expect(templateMeta('dotx')).resolves.toEqual(expect.objectContaining({templateFileType: 'docx'}));
  });

  test.each([
    ['the reported proof of concept', 'Zx/../../../../local.json'],
    ['backslash separators', String.raw`Zx\..\..\..\..\local.json`],
    ['mixed separators', String.raw`Zx/..\../..\../local.json`],
    ['a bare parent segment', '../local.json'],
    ['an absolute posix path', '/etc/passwd'],
    ['an absolute windows path', String.raw`C:\Windows\win.ini`],
    ['a unc share', String.raw`\\attacker\share\x`],
    // lexical containment alone accepts the rest, because they stay under the templates folder
    ['an alternate data stream', 'docx:secret'],
    ['the $DATA stream', 'docx::$DATA'],
    ['a trailing dot', 'docx.'],
    ['a trailing space', 'docx '],
    ['an inner separator that stays inside', 'docx/../../en-US/new.docx'],
    ['an empty type', ''],
    ['a type with no template', 'notaformat'],
    ['an inherited object member', 'constructor'],
    ['the prototype accessor', '__proto__']
  ])('refuses %s', async (_label, fileType) => {
    await expect(templateMeta(fileType)).rejects.toThrow();
  });

  // odt ships no template in the product, so accepting it proves the list is read from the configured folder
  test.each([['docx'], ['pdf'], ['pptx'], ['xlsx'], ['odt']])('accepts the template %s present in the folder', async fileType => {
    await expect(templateMeta(fileType)).resolves.toEqual(expect.objectContaining({templateFileType: fileType}));
  });

  // discovery advertises editnew only for extensions that have a template, and the guard applies the same test
  test('refuses a real document format that has no template in the folder', async () => {
    await expect(templateMeta('rtf')).rejects.toThrow();
  });

  test('never reads a file outside the templates folder', async () => {
    let leaked;
    try {
      const res = await templateMeta('Zx/../../../../local.json');
      leaked = fs.readFileSync(res.filePath, 'utf8');
    } catch {
      leaked = undefined;
    }
    expect(leaked).toBeUndefined();
    // the file the proof of concept targets is present, so the refusal is why it was not read
    expect(fs.readFileSync(path.join(root, 'local.json'), 'utf8')).toContain(SECRET);
  });
});
