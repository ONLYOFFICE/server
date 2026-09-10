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

// Hermetic tests for the JWT layer: marker classifier, operation claim, purpose registry, getRequestParams guard and derived keys. No server, storage or x2t.
// Browser and Inbox share secret.inbox, so a browser token verifies as inbox; the wire-level counterpart is converterAuthConfusion.tests.js.

'use strict';

// pin purposeCheck=validate before the first require('config') and restore right after: NODE_CONFIG outranks every config file, and jest reuses one process env per worker
const savedNodeConfig = process.env.NODE_CONFIG;
process.env.NODE_CONFIG = JSON.stringify({services: {CoAuthoring: {token: {purposeCheck: 'validate'}}}});

const {describe, beforeEach, afterEach, test, expect, jest: jestGlobals} = require('@jest/globals');
const path = require('path');
const fs = require('fs');
const os = require('os');

const jwtService = require('../../DocService/sources/jwtService');
const converterService = require('../../DocService/sources/converterservice');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');
const utils = require('../../Common/sources/utils');
const crypto = require('crypto');
const jwtLib = require('../../DocService/node_modules/jsonwebtoken');
const tenantManager = require('../../Common/sources/tenantManager');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

if (undefined === savedNodeConfig) {
  delete process.env.NODE_CONFIG;
} else {
  process.env.NODE_CONFIG = savedNodeConfig;
}

const {getRequestParams, validateJwtPayloadForOperation} = docsCoServer;
// the gate is internal to jwtService now; DocsCoServer no longer re-exports it
const {checkJwtPurpose} = jwtService;

const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgInboxPrefix = config.get('services.CoAuthoring.token.inbox.prefix');

const ctx = new operationContext.Context();
const PRINT_PAYLOAD = {document: {key: 'print-doc-1'}, ds_tokenType: 'printfile'};
const DERIVE_BASE = 'shared-base-secret';

// Sign with a raw configured secret. Production can no longer do this - the signer takes a purpose - so the tests
// reach for the key directly whenever they need a token minted under a FOREIGN key on purpose.
async function mintWithSecretType(payload, type, expiresIn = cfgTokenExpires) {
  const secret = await tenantManager.getTenantSecret(ctx, type);
  return jwtLib.sign(payload, utils.getJwtHsKey(secret), {algorithm: cfgTokenAlgorithm, expiresIn});
}
// Sign a payload with a chosen secret type; Browser and Inbox both resolve to secret.inbox today.
function mint(payload, type) {
  return mintWithSecretType(payload, type);
}

// the session family has its own derived key, so a session fixture cannot be signed with the flat session secret
function mintSession(payload) {
  return jwtService.signToken(ctx, constants.JWT_PURPOSE_EDITOR_SESSION, payload, cfgTokenAlgorithm, 300);
}

// mint for a sink: the session sink takes the derived key, everything else a configured secret
function mintFor(purpose, payload, type) {
  return constants.JWT_PURPOSE_EDITOR_SESSION === purpose ? mintSession(payload) : mint(payload, type);
}

// Minimal Express-like request; a body token goes in a JSON Buffer, a header token in Authorization.
function fakeReq({bodyObj, headerToken} = {}) {
  return {
    body: bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : undefined,
    query: {},
    get: name => (headerToken && 'authorization' === String(name).toLowerCase() ? cfgInboxPrefix + headerToken : undefined)
  };
}

// stub ctx that forces a purposeCheck mode regardless of config
const purposeModeCtx = mode => ({getCfg: () => mode, logger: {warn: () => {}}});
// one positive fixture per sink: the smallest payload the consumer of that sink actually reads
const SINK_FIXTURES = {
  [constants.JWT_PURPOSE_CONVERTER]: {url: 'http://storage/in.docx', filetype: 'docx', outputtype: 'pdf'},
  [constants.JWT_PURPOSE_DOCBUILDER]: {url: 'http://storage/script.docbuilder'},
  [constants.JWT_PURPOSE_COMMAND]: {c: 'info', key: 'k'},
  // downloadFileAllowExt defaults to pdf/xlsx, so a docx fixture would not be one the endpoint acts on
  [constants.JWT_PURPOSE_DOWNLOAD]: {url: 'http://storage/in.pdf', fileType: 'pdf'},
  // with tokenRequiredParams:true the open token has to carry the document url as well
  [constants.JWT_PURPOSE_BROWSER_OPEN]: {document: {key: 'd', url: 'http://storage/d.docx'}, editorConfig: {}},
  [constants.JWT_PURPOSE_BROWSER_IMGURLS]: {url: 'http://storage/img.png'},
  [constants.JWT_PURPOSE_BROWSER_DOWNLOADAS]: {url: 'http://storage/src.docx', fileType: 'docx'},
  [constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE]: {key: 'k'},
  [constants.JWT_PURPOSE_EDITOR_SESSION]: {document: {key: 'd'}, editorConfig: {user: {id: 'u'}, ds_sessionTimeConnect: 1}}
};

describe('validateJwtPayloadForOperation (unit)', () => {
  test('a non-object payload is not classified, the shape rules only apply to an object', () => {
    for (const decoded of [undefined, null, 'string', 42]) {
      expect(validateJwtPayloadForOperation(decoded, 'docbuilder')).toBe(true);
    }
  });

  test('marker keys are rejected on every guarded operation', () => {
    for (const op of ['docbuilder', 'converter', 'command']) {
      expect(validateJwtPayloadForOperation({editorConfig: {}}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({document: {key: 'd'}}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({version: 1, key: 'k', url: 'u'}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({changesUrl: 'c'}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({images: [{url: 'u'}]}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({fileInfo: {}}, op)).toBe(false);
      expect(validateJwtPayloadForOperation({docId: 'd'}, op)).toBe(false);
    }
  });

  test('docbuilder takes a closed field set: everything a build request never has is refused', () => {
    const gate = purposeModeCtx('validate');
    // the four fields builderRequest reads, plus the claim, in any combination
    expect(checkJwtPurpose(gate, {}, 'docbuilder')).toBe(true);
    expect(checkJwtPurpose(gate, {key: 'k', url: 'u', argument: {a: 1}, async: true}, 'docbuilder')).toBe(true);
    expect(checkJwtPurpose(gate, {url: 'u', operation: 'docbuilder', iat: 1, exp: 2}, 'docbuilder')).toBe(true);
    // anything else, whether it is a known marker, a converter field or a name nobody has seen yet
    for (const extra of [
      {fileType: 'docx'},
      {filetype: 'docx'},
      {outputtype: 'pdf'},
      {title: 'x'},
      {c: 'info'},
      {document: {key: 'd'}},
      {editorConfig: {}},
      {images: [{url: 'u'}]},
      {ds_tokenType: 'printfile'},
      {somethingNew: 1}
    ]) {
      expect(checkJwtPurpose(gate, {url: 'u', ...extra}, 'docbuilder')).toBe(false);
      // and the same field hidden in a header wrapper
      expect(checkJwtPurpose(gate, {url: 'u', payload: extra}, 'docbuilder')).toBe(false);
    }
    // a matching claim names the token positively, so it lifts the field set - but never the marker rule
    expect(checkJwtPurpose(gate, {operation: 'docbuilder', url: 'u', outputtype: 'pdf', somethingNew: 1}, 'docbuilder')).toBe(true);
    expect(checkJwtPurpose(gate, {operation: 'docbuilder', url: 'u', editorConfig: {}}, 'docbuilder')).toBe(false);
    // the from-file twin shares the field set and adds a url ban the claim does not lift, because there the script is the file part
    expect(checkJwtPurpose(gate, {operation: 'docbuilder', key: 'k'}, 'docbuilder-from-file')).toBe(true);
    expect(checkJwtPurpose(gate, {operation: 'docbuilder', key: 'k', url: 'u'}, 'docbuilder-from-file')).toBe(false);
    expect(checkJwtPurpose(gate, {operation: 'converter', key: 'k', url: 'u'}, 'converter-from-file')).toBe(false);
    expect(checkJwtPurpose(gate, {operation: 'converter', key: 'k', filetype: 'docx'}, 'converter-from-file')).toBe(true);
  });

  test('command takes a closed field set too, lifted by the same matching claim', () => {
    const gate = purposeModeCtx('validate');
    expect(checkJwtPurpose(gate, {c: 'info', key: 'k'}, 'command')).toBe(true);
    expect(checkJwtPurpose(gate, {c: 'forcesave', key: 'k', userdata: 'u', users: ['a']}, 'command')).toBe(true);
    expect(checkJwtPurpose(gate, {c: 'info', key: 'k', url: 'http://storage/in.docx'}, 'command')).toBe(false);
    expect(checkJwtPurpose(gate, {c: 'info', key: 'k', outputtype: 'pdf'}, 'command')).toBe(false);
    expect(checkJwtPurpose(gate, {operation: 'command', c: 'info', key: 'k', url: 'http://storage/in.docx'}, 'command')).toBe(true);
    // the envelope a header token builds is always allowed, and so is an inert `token` an integrator left in the payload
    expect(checkJwtPurpose(gate, {query: {}, payload: {c: 'info', key: 'k'}, token: '', iat: 1, exp: 2}, 'command')).toBe(true);
  });

  test('the marker denylist still guards converter and command', () => {
    expect(validateJwtPayloadForOperation({url: 'u', outputtype: 'pdf'})).toBe(true);
    expect(validateJwtPayloadForOperation({c: 'info', key: 'k'})).toBe(true);
    // a converter field that is merely wrong for docbuilder is fine here: converter reads it
    expect(validateJwtPayloadForOperation({url: 'u', fileType: 'docx'})).toBe(true);
    for (const marker of [{document: {key: 'd'}}, {editorConfig: {}}, {version: 1}, {changesUrl: 'u'}, {images: []}, {ds_tokenType: 'printfile'}]) {
      expect(validateJwtPayloadForOperation({url: 'u', ...marker})).toBe(false);
    }
  });

  test('converter/command: allowed when no marker present', () => {
    expect(validateJwtPayloadForOperation({url: 'u', outputtype: 'docx'}, 'converter')).toBe(true);
    expect(validateJwtPayloadForOperation({c: 'version', key: 'k'}, 'command')).toBe(true);
  });

  test('a marker hidden inside the header payload wrapper is still caught', () => {
    expect(validateJwtPayloadForOperation({payload: {version: 1, url: 'u'}})).toBe(false);
    expect(validateJwtPayloadForOperation({payload: {key: 'k', url: 'u'}})).toBe(true);
  });
});

describe('checkJwtPurpose (mode-aware global gate)', () => {
  test('off mode is a full no-op: a browser marker token is accepted even on a guarded purpose', () => {
    expect(checkJwtPurpose(purposeModeCtx('off'), {editorConfig: {}}, 'docbuilder')).toBe(true);
  });

  test('validate mode rejects a foreign marker on a guarded purpose', () => {
    expect(checkJwtPurpose(purposeModeCtx('validate'), {editorConfig: {}}, 'docbuilder')).toBe(false);
  });

  test('an unexpected mode fails closed: rejects even marker-free and non-guarded tokens (not a silent validate)', () => {
    const enforce = purposeModeCtx('enforce');
    // marker-free {url}: validate would accept on docbuilder, an invalid mode must reject
    expect(checkJwtPurpose(enforce, {url: 'u'}, 'docbuilder')).toBe(false);
    // non-guarded purpose: validate is a no-op (accept), an invalid mode must reject
    expect(checkJwtPurpose(enforce, {url: 'u'}, 'download')).toBe(false);
    expect(checkJwtPurpose(enforce, {editorConfig: {}}, 'docbuilder')).toBe(false);
    // a typo behaves the same
    expect(checkJwtPurpose(purposeModeCtx('typo'), {url: 'u'}, 'download')).toBe(false);
  });

  test('a known no-op purpose (download) passes under validate; positive match waits for the type claim', () => {
    expect(checkJwtPurpose(purposeModeCtx('validate'), {editorConfig: {}}, 'download')).toBe(true);
    expect(checkJwtPurpose(purposeModeCtx('validate'), {document: {key: 'd'}}, 'download')).toBe(true);
  });

  test('an unknown purpose fails closed under validate (a caller typo cannot silently disable the gate)', () => {
    // a typo of a guarded purpose must not fall through to accept
    expect(checkJwtPurpose(purposeModeCtx('validate'), {url: 'u'}, 'docbuiler')).toBe(false);
    // an unregistered sink name also fails closed
    expect(checkJwtPurpose(purposeModeCtx('validate'), {url: 'u'}, 'open')).toBe(false);
  });

  test('swap-safety: a {url,filetype} token is valid for converter but not for docbuilder', () => {
    expect(checkJwtPurpose(purposeModeCtx('validate'), {url: 'u', filetype: 'docx'}, 'converter')).toBe(true);
    expect(checkJwtPurpose(purposeModeCtx('validate'), {url: 'u', filetype: 'docx'}, 'docbuilder')).toBe(false);
  });

  test('a falsy purpose fails closed: a mistyped constant reads as undefined and must not disable the gate', () => {
    for (const falsy of [undefined, null, '', 0, false]) {
      expect(checkJwtPurpose(purposeModeCtx('validate'), {editorConfig: {}}, falsy)).toBe(false);
      expect(checkJwtPurpose(purposeModeCtx('off'), {editorConfig: {}}, falsy)).toBe(false);
    }
  });

  test('a prototype key resolves to no policy and fails closed instead of throwing', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(checkJwtPurpose(purposeModeCtx('validate'), {editorConfig: {}}, key)).toBe(false);
    }
  });
});

describe('purpose registry choke points', () => {
  const gateCtx = purposeModeCtx('validate');

  test('every integrator-token purpose used by a sink is registered and takes the payload its sink reads', () => {
    for (const [purpose, payload] of Object.entries(SINK_FIXTURES)) {
      expect(jwtService.checkJwtPurpose(gateCtx, payload, purpose)).toBe(true);
    }
  });

  test('every DS-issued purpose is registered and demands its own payload, not just any shape', () => {
    expect(jwtService.checkJwtPurpose(gateCtx, PRINT_PAYLOAD, constants.JWT_PURPOSE_PRINT_FILE)).toBe(true);
    expect(jwtService.checkJwtPurpose(gateCtx, {url: 'u'}, constants.JWT_PURPOSE_PRINT_FILE)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, {docId: 'd', wopiSrc: 'http://h/w'}, constants.JWT_PURPOSE_WOPI_CONVERT)).toBe(true);
    expect(jwtService.checkJwtPurpose(gateCtx, {url: 'u'}, constants.JWT_PURPOSE_WOPI_CONVERT)).toBe(false);
  });

  test('an unknown purpose fails closed even when the inbound check is switched off', () => {
    expect(jwtService.checkJwtPurpose(purposeModeCtx('off'), {url: 'u'}, 'editor-sesion')).toBe(false);
  });

  test('a print-file payload is rejected on the session policy but allowed on printfile itself', () => {
    expect(jwtService.checkJwtPurpose(gateCtx, PRINT_PAYLOAD, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, PRINT_PAYLOAD, constants.JWT_PURPOSE_PRINT_FILE)).toBe(true);
  });

  test('a nested layer cannot erase a marker the layer above declared', () => {
    // the merge is last-write-wins, so a security rule that reads the merged view would see document:null and let this through
    const masked = {document: {key: 'd'}, payload: {document: null}};
    expect(jwtService.checkJwtPurpose(gateCtx, masked, constants.JWT_PURPOSE_CONVERTER)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, {ds_tokenType: 'printfile', query: {ds_tokenType: null}}, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(
      false
    );
  });

  test('the session sink demands what its consumers read, so an inbox token is not a session token', () => {
    for (const purpose of [constants.JWT_PURPOSE_CONVERTER, constants.JWT_PURPOSE_COMMAND, constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE]) {
      expect(jwtService.checkJwtPurpose(gateCtx, SINK_FIXTURES[purpose], constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
    }
    // document.key without an editorConfig is what the ai proxy used to accept through optional chaining
    expect(jwtService.checkJwtPurpose(gateCtx, {document: {key: 'd'}}, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, {document: {key: ''}, editorConfig: {}}, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
  });

  test('a print-shaped token is refused on the session sink even with the inbound check switched off', () => {
    // purposeCheck can disable the heuristic but not a structural rule, which is what keeps an old flat-key print token out during a rollout
    expect(jwtService.checkJwtPurpose(purposeModeCtx('off'), PRINT_PAYLOAD, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
  });

  test('a payload that is not a plain object authorizes nothing', () => {
    for (const payload of ['a string payload', 42, [{url: 'http://x/a.docx'}]]) {
      expect(jwtService.checkJwtPurpose(gateCtx, payload, constants.JWT_PURPOSE_CONVERTER)).toBe(false);
      expect(jwtService.checkJwtPurpose(gateCtx, payload, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(false);
    }
  });

  test('a real editor session payload passes the session policy', () => {
    const session = {document: {key: 'd', ds_encrypted: false}, editorConfig: {user: {id: 'u'}, ds_sessionTimeConnect: 1}};
    expect(jwtService.checkJwtPurpose(gateCtx, session, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(true);
  });

  test('the six session sinks share ONE policy: fillJwtByConnection issues one token for all of them', () => {
    // a stale per-sink label must fail closed rather than silently behave like the session policy
    for (const stale of ['session-open', 'session-handshake', 'session-downloadas', 'session-savefile', 'session-upload', 'session-ai']) {
      expect(jwtService.checkJwtPurpose(gateCtx, {document: {key: 'd'}}, stale)).toBe(false);
    }
  });

  test('the browser open config is not a valid token for the three sinks that read fixed fields', () => {
    const browser = SINK_FIXTURES[constants.JWT_PURPOSE_BROWSER_OPEN];
    for (const purpose of [
      constants.JWT_PURPOSE_BROWSER_IMGURLS,
      constants.JWT_PURPOSE_BROWSER_DOWNLOADAS,
      constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE
    ]) {
      expect(jwtService.checkJwtPurpose(gateCtx, browser, purpose)).toBe(false);
    }
    expect(jwtService.checkJwtPurpose(gateCtx, browser, constants.JWT_PURPOSE_DOCBUILDER)).toBe(false);
  });

  test('an empty but validly signed token authorizes none of the three', () => {
    for (const purpose of [
      constants.JWT_PURPOSE_BROWSER_IMGURLS,
      constants.JWT_PURPOSE_BROWSER_DOWNLOADAS,
      constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE
    ]) {
      expect(jwtService.checkJwtPurpose(gateCtx, {}, purpose)).toBe(false);
      // and the structural rule is not something purposeCheck can switch off
      expect(jwtService.checkJwtPurpose(purposeModeCtx('off'), {}, purpose)).toBe(false);
    }
  });

  test('the structural rules separate the three sinks, except where a bare url is genuinely ambiguous', () => {
    const downloadAs = SINK_FIXTURES[constants.JWT_PURPOSE_BROWSER_DOWNLOADAS];
    const saveRelative = SINK_FIXTURES[constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE];
    expect(jwtService.checkJwtPurpose(gateCtx, downloadAs, constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, saveRelative, constants.JWT_PURPOSE_BROWSER_DOWNLOADAS)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, saveRelative, constants.JWT_PURPOSE_BROWSER_IMGURLS)).toBe(false);
    // known and accepted: a downloadAs token is a valid insert-image token, because a signed url is all imgurls needs
    expect(jwtService.checkJwtPurpose(gateCtx, downloadAs, constants.JWT_PURPOSE_BROWSER_IMGURLS)).toBe(true);
  });

  test('the full fixture x sink matrix: every acceptance outside the diagonal is a deliberate one', () => {
    const S = constants;
    // a sink accepts a foreign fixture only where the two genuinely read the same fields
    const ALSO_ACCEPTED = {
      // browser-open and download take any signed payload, so every fixture lands there; the session sink no longer does, it demands document.key plus an editorConfig object
      [S.JWT_PURPOSE_CONVERTER]: [S.JWT_PURPOSE_DOWNLOAD, S.JWT_PURPOSE_BROWSER_OPEN, S.JWT_PURPOSE_BROWSER_IMGURLS],
      [S.JWT_PURPOSE_DOCBUILDER]: [S.JWT_PURPOSE_CONVERTER, S.JWT_PURPOSE_DOWNLOAD, S.JWT_PURPOSE_BROWSER_OPEN, S.JWT_PURPOSE_BROWSER_IMGURLS],
      // the command fixture carries `c`, which the docbuilder field set does not allow
      [S.JWT_PURPOSE_COMMAND]: [S.JWT_PURPOSE_CONVERTER, S.JWT_PURPOSE_DOWNLOAD, S.JWT_PURPOSE_BROWSER_OPEN, S.JWT_PURPOSE_BROWSER_SAVE_RELATIVE],
      // the docbuilder field set keeps the download and downloadAs fixtures out of docbuilder
      [S.JWT_PURPOSE_DOWNLOAD]: [
        S.JWT_PURPOSE_CONVERTER,
        S.JWT_PURPOSE_BROWSER_OPEN,
        S.JWT_PURPOSE_BROWSER_IMGURLS,
        S.JWT_PURPOSE_BROWSER_DOWNLOADAS
      ],
      [S.JWT_PURPOSE_BROWSER_OPEN]: [S.JWT_PURPOSE_DOWNLOAD],
      [S.JWT_PURPOSE_BROWSER_IMGURLS]: [S.JWT_PURPOSE_CONVERTER, S.JWT_PURPOSE_DOCBUILDER, S.JWT_PURPOSE_DOWNLOAD, S.JWT_PURPOSE_BROWSER_OPEN],
      // the imgurls fixture is a bare {url}, which is the one browser shape the docbuilder field set still allows
      [S.JWT_PURPOSE_BROWSER_DOWNLOADAS]: [
        S.JWT_PURPOSE_CONVERTER,
        S.JWT_PURPOSE_DOWNLOAD,
        S.JWT_PURPOSE_BROWSER_OPEN,
        S.JWT_PURPOSE_BROWSER_IMGURLS
      ],
      [S.JWT_PURPOSE_BROWSER_SAVE_RELATIVE]: [
        S.JWT_PURPOSE_CONVERTER,
        S.JWT_PURPOSE_DOCBUILDER,
        S.JWT_PURPOSE_COMMAND,
        S.JWT_PURPOSE_DOWNLOAD,
        S.JWT_PURPOSE_BROWSER_OPEN
      ],
      [S.JWT_PURPOSE_EDITOR_SESSION]: [S.JWT_PURPOSE_DOWNLOAD, S.JWT_PURPOSE_BROWSER_OPEN]
    };
    // nothing else reaches the session sink: ds_sessionTimeConnect is stamped by the connection and an integrator open config does not carry it
    const unexpected = [];
    for (const [fixtureFor, payload] of Object.entries(SINK_FIXTURES)) {
      for (const sink of Object.keys(SINK_FIXTURES)) {
        const got = jwtService.checkJwtPurpose(gateCtx, payload, sink);
        const want = sink === fixtureFor || ALSO_ACCEPTED[fixtureFor].includes(sink);
        if (got !== want) {
          unexpected.push(`${fixtureFor} -> ${sink}: got ${got}, want ${want}`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  test('imgurls takes the images array only when every entry carries a url', () => {
    expect(
      jwtService.checkJwtPurpose(gateCtx, {images: [{url: 'http://x/a.png'}, {url: 'http://x/b.png'}]}, constants.JWT_PURPOSE_BROWSER_IMGURLS)
    ).toBe(true);
    expect(jwtService.checkJwtPurpose(gateCtx, {images: [{url: 'http://x/a.png'}, {}]}, constants.JWT_PURPOSE_BROWSER_IMGURLS)).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, {images: []}, constants.JWT_PURPOSE_BROWSER_IMGURLS)).toBe(false);
  });

  test('a truthy non-array images is refused instead of falling back to url', () => {
    // commandImgurls branches on truthy images and then calls .map(), so the fallback must not rescue these
    for (const images of [{}, 'http://x/a.png', 42, true, {0: {url: 'http://x/a.png'}}]) {
      expect(jwtService.checkJwtPurpose(gateCtx, {images, url: 'http://x/a.png'}, constants.JWT_PURPOSE_BROWSER_IMGURLS)).toBe(false);
    }
  });

  test('a sink that serves no named operation refuses a token typed for one', () => {
    const typed = {...SINK_FIXTURES[constants.JWT_PURPOSE_BROWSER_OPEN], [constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER};
    expect(jwtService.checkJwtPurpose(gateCtx, typed, constants.JWT_PURPOSE_BROWSER_OPEN)).toBe(false);
    expect(
      jwtService.checkJwtPurpose(
        gateCtx,
        {url: 'http://x/a.docx', [constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER},
        constants.JWT_PURPOSE_DOWNLOAD
      )
    ).toBe(false);
    // a nested copy counts too, and off stays the escape hatch
    expect(jwtService.checkJwtPurpose(gateCtx, {document: {key: 'd'}, payload: {operation: 'converter'}}, constants.JWT_PURPOSE_BROWSER_OPEN)).toBe(
      false
    );
    expect(jwtService.checkJwtPurpose(purposeModeCtx('off'), typed, constants.JWT_PURPOSE_BROWSER_OPEN)).toBe(true);
  });

  test('a purpose that is not in the registry still fails closed', () => {
    expect(jwtService.checkJwtPurpose(gateCtx, {url: 'u'}, 'editor-sesion')).toBe(false);
    expect(jwtService.checkJwtPurpose(gateCtx, {url: 'u'}, 'open')).toBe(false);
  });
});

describe('signed provenance', () => {
  // getRequestParams reads the setting off ctx, so a shadowed getCfg is enough to drive both modes
  const ctxWithCfg = overrides => {
    const proxy = Object.create(ctx);
    proxy.getCfg = (key, def) => (key in overrides ? overrides[key] : ctx.getCfg(key, def));
    return proxy;
  };
  const REQUIRED = 'services.CoAuthoring.server.tokenRequiredParams';

  test('signedParams is what the token carried, params is what the request effectively acts on', async () => {
    const token = await mint({filetype: 'docx', outputtype: 'pdf'}, commonDefines.c_oAscSecretType.Inbox);
    const loose = await getRequestParams(
      ctxWithCfg({[REQUIRED]: false}),
      fakeReq({bodyObj: {token, url: 'http://attacker/x.docx'}}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(loose.isDecoded).toBe(true);
    expect(loose.params.url).toBe('http://attacker/x.docx');
    expect(loose.signedParams.url).toBe(undefined);
    expect(loose.signedParams).toMatchObject({filetype: 'docx', outputtype: 'pdf'});

    const strict = await getRequestParams(
      ctxWithCfg({[REQUIRED]: true}),
      fakeReq({bodyObj: {token, url: 'http://attacker/x.docx'}}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(strict.params.url).toBe(undefined);
    expect(strict.params).toEqual(strict.signedParams);
  });

  test('the signed view is flattened the same way the effective one is, so a payload wrapper is not a blind spot', async () => {
    const token = await mint({payload: {url: 'http://storage/in.docx', filetype: 'docx', outputtype: 'pdf'}}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctxWithCfg({[REQUIRED]: false}), fakeReq({headerToken: token}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.isDecoded).toBe(true);
    expect(res.signedParams.url).toBe('http://storage/in.docx');
  });

  test('a token carrying its own __proto__ cannot install fields the gate never sees', async () => {
    // jsonwebtoken cannot build this payload, so it is assembled the way an attacker would: raw JSON, base64url, HMAC
    const raw = '{"operation":"docbuilder","key":"k","__proto__":{"url":"http://private.invalid/"}}';
    const b64 = value => Buffer.from(value).toString('base64url');
    const secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Inbox);
    const signing = b64(JSON.stringify({alg: 'HS256', typ: 'JWT'})) + '.' + b64(raw);
    const token = signing + '.' + crypto.createHmac('sha256', utils.getJwtHsKey(secret)).update(signing).digest('base64url');
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), constants.JWT_PURPOSE_DOCBUILDER);
    // the field set refuses the member outright; even if it did not, the merge must not turn it into a readable url
    expect(res.params.url).toBe(undefined);
    expect(res.signedParams.url).toBe(undefined);
    expect(Object.getPrototypeOf(res.params)).toBe(Object.prototype);
  });

  test('getRequestParams never writes into req.query, because proxyCommand forwards it on the shard hop', async () => {
    const token = await mint({c: 'info', key: 'k'}, commonDefines.c_oAscSecretType.Inbox);
    const query = {shardkey: 'k'};
    const req = {body: undefined, query, get: name => ('authorization' === String(name).toLowerCase() ? cfgInboxPrefix + token : undefined)};
    const res = await getRequestParams(ctx, req, constants.JWT_PURPOSE_COMMAND);
    expect(res.isDecoded).toBe(true);
    expect(res.params.c).toBe('info');
    // the claims must not have leaked into the request object the proxy re-sends
    expect(query).toEqual({shardkey: 'k'});
  });

  test('a falsy signed url is not a signed source, so it cannot stand in for a script', () => {
    for (const url of [null, '', false, 0, undefined]) {
      expect(converterService.isSignedSource({isDecoded: true, signedParams: {url}}, url)).toBe(false);
    }
    expect(converterService.isSignedSource({isDecoded: true, signedParams: {url: 'http://s/a'}}, 'http://s/a')).toBe(true);
  });

  test('a nested operation claim is fatal in every mode, so it can never read as a top-level one', () => {
    for (const mode of ['off', 'validate', 'strict']) {
      const gate = purposeModeCtx(mode);
      expect(checkJwtPurpose(gate, {payload: {operation: 'docbuilder', key: 'k'}}, 'docbuilder')).toBe(false);
      expect(checkJwtPurpose(gate, {query: {operation: 'docbuilder'}, key: 'k'}, 'docbuilder')).toBe(false);
      // a sink that serves no operation refuses the nested copy too
      expect(checkJwtPurpose(gate, {document: {key: 'd'}, payload: {operation: 'converter'}}, 'browser-open')).toBe(false);
    }
  });

  test('isSignedSource grants the outbox credential only to a url the token named', () => {
    const signed = {signedParams: {url: 'http://storage/in.docx'}, isDecoded: true};
    expect(converterService.isSignedSource(signed, 'http://storage/in.docx')).toBe(true);
    expect(converterService.isSignedSource(signed, 'http://attacker/x.docx')).toBe(false);
    // no source url at all: unsigned bytes in the body or a file part must not inherit the token's network privileges
    expect(converterService.isSignedSource(signed, undefined)).toBe(false);
    // no token: never
    expect(converterService.isSignedSource({signedParams: {url: 'http://storage/in.docx'}, isDecoded: false}, 'http://storage/in.docx')).toBe(false);
  });
});

describe('getRequestParams operation guard (accept/reject, no server)', () => {
  test('legit inbox docbuilder {key,url} is accepted', async () => {
    const token = await mint({key: 'doc1', url: 'http://storage/in.docx'}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'docbuilder');
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('legit inbox converter {url,filetype,outputtype,key} is accepted', async () => {
    const token = await mint({url: 'http://storage/in.docx', filetype: 'docx', outputtype: 'pdf', key: 'c1'}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'converter');
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('inbox docbuilder token without url or key (script goes in the body) is accepted, not rejected as -8', async () => {
    const token = await mint({async: true}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({headerToken: token}), 'docbuilder');
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('browser version-history token (top-level url) is rejected on docbuilder', async () => {
    const token = await mint(
      {
        version: 1,
        key: 'v1',
        url: 'http://attacker/x.docx',
        changesUrl: 'http://attacker/c.zip',
        previous: {key: 'p', url: 'http://attacker/p.docx'}
      },
      commonDefines.c_oAscSecretType.Browser
    );
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'docbuilder');
    expect(res.code).toBe(constants.VKEY);
    expect(res.isDecoded).toBe(false);
  });

  test('browser open config token (document+editorConfig) is rejected on docbuilder', async () => {
    const token = await mint({document: {key: 'd', url: 'http://x/d.docx'}, editorConfig: {user: {id: '1'}}}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'docbuilder');
    expect(res.code).toBe(constants.VKEY);
    expect(res.isDecoded).toBe(false);
  });

  test('browser downloadAs token {url,fileType} is rejected on docbuilder (fileType rule)', async () => {
    const token = await mint({url: 'http://attacker/x.docx', fileType: 'docx'}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'docbuilder');
    expect(res.code).toBe(constants.VKEY);
  });

  test('browser editorConfig token is rejected on converter', async () => {
    const token = await mint({editorConfig: {ds_sessionTimeConnect: 1}}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'converter');
    expect(res.code).toBe(constants.VKEY);
  });

  test('header token: a browser marker hidden in the payload wrapper is rejected on docbuilder', async () => {
    const token = await mint({payload: {version: 1, url: 'http://attacker/x.docx'}}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({headerToken: token}), 'docbuilder');
    expect(res.code).toBe(constants.VKEY);
  });

  test('header token: a legit inbox payload wrapper flattens and is accepted on docbuilder', async () => {
    const token = await mint({payload: {key: 'h1', url: 'http://storage/in.docx'}}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({headerToken: token}), 'docbuilder');
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('the download policy still accepts the browser shapes /downloadfile legitimately consumes', async () => {
    // the endpoint reads a url and a format out of one of four shapes; this is the document one
    const token = await mint({document: {key: 'd', url: 'http://storage/in.docx', fileType: 'docx'}}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), constants.JWT_PURPOSE_DOWNLOAD);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('an operation the caller forgot to pass fails closed instead of verifying signature only', async () => {
    const token = await mint({url: 'u', key: 'k'}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}));
    expect(res.code).toBe(constants.VKEY);
    expect(res.isDecoded).toBe(false);
    expect(res.params).toEqual({});
  });

  test('legit inbox command token {c,key} is accepted on command', async () => {
    const token = await mint({c: 'version', key: 'k1'}, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'command');
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('browser WOPI convert-and-edit token {docId} is rejected on docbuilder', async () => {
    const token = await mint({docId: 'conv-and-edit-1'}, commonDefines.c_oAscSecretType.Browser);
    const res = await getRequestParams(ctx, fakeReq({bodyObj: {token}}), 'docbuilder');
    expect(res.code).toBe(constants.VKEY);
    expect(res.isDecoded).toBe(false);
  });
});

describe('checkJwt applies the purpose gate inline', () => {
  test('a browser marker token verified for a guarded purpose comes back as a bad token', async () => {
    const token = await mint({document: {key: 'd'}, editorConfig: {}}, commonDefines.c_oAscSecretType.Browser);
    // the same signature is fine for a policy with no payload rule and rejected by a guarded one
    const ok = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_DOWNLOAD);
    expect(ok.decoded).toBeTruthy();
    const gated = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_DOCBUILDER);
    expect(gated.decoded).toBe(null);
    expect(gated.code).toBe(constants.JWT_ERROR_CODE);
  });
});

describe('derived-key tokens: the ones Document Server issues to itself', () => {
  test('a derived-key token round-trips through the shared verifier', async () => {
    const token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_PRINT_FILE, PRINT_PAYLOAD, cfgTokenAlgorithm, 300);
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBeTruthy();
    expect(res.decoded.document.key).toBe('print-doc-1');
  });

  test('a derived-key token is NOT accepted as a plain session token (this is the W1 fix)', async () => {
    const token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_PRINT_FILE, PRINT_PAYLOAD, cfgTokenAlgorithm, 300);
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_EDITOR_SESSION);
    expect(res.decoded).toBe(null);
    // the rejection must come from the key, not from a missing or mismatched policy
    expect(res.description).toMatch(/signature/i);
  });

  test('a session token is not a print token, and the flat session secret is no longer a session key (W2)', async () => {
    const session = {document: {key: 'print-doc-1'}, editorConfig: {user: {id: 'u'}, ds_sessionTimeConnect: 1}};
    const token = await mintSession(session);
    // it is a valid session token on its own policy, and still refused as a print token: the derivation purpose differs
    expect((await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_EDITOR_SESSION)).decoded).toBeTruthy();
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBe(null);
    expect(res.description).toMatch(/signature/i);
    // and the reverse of V2: the same payload signed with the flat session secret no longer verifies at a session sink
    const flat = await mintWithSecretType(session, commonDefines.c_oAscSecretType.Session, 300);
    const refused = await jwtService.checkJwt(ctx, flat, constants.JWT_PURPOSE_EDITOR_SESSION);
    expect(refused.decoded).toBe(null);
    expect(refused.description).toMatch(/signature/i);
  });

  test('an inbox token cannot reach a session sink even when both secrets are the same string (W2)', async () => {
    // Browser, Inbox and Session all read "secret" in the default config, so only the derivation separates them
    const shaped = await mint(
      {document: {key: 'd'}, editorConfig: {user: {id: 'u'}, ds_sessionTimeConnect: 1}},
      commonDefines.c_oAscSecretType.Inbox
    );
    expect((await jwtService.checkJwt(ctx, shaped, constants.JWT_PURPOSE_EDITOR_SESSION)).decoded).toBe(null);
  });

  test('even a print-shaped payload signed with the plain session key is refused', async () => {
    const token = await mintWithSecretType(PRINT_PAYLOAD, commonDefines.c_oAscSecretType.Session, 300);
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBe(null);
  });

  test('a derived-key token minted for one purpose does not verify under another purpose', async () => {
    const token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_PRINT_FILE, PRINT_PAYLOAD, cfgTokenAlgorithm, 300);
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(res.decoded).toBe(null);
  });

  test('the payload rule of a DS-issued token is enforced even when the inbound check is switched off', async () => {
    const token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_PRINT_FILE, {document: {key: 'd'}}, cfgTokenAlgorithm, 300);
    // purposeCheck governs integrator tokens only; our own token must still match its shape
    expect(jwtService.checkJwtPurpose(purposeModeCtx('off'), {document: {key: 'd'}}, constants.JWT_PURPOSE_PRINT_FILE)).toBe(false);
    const res = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBe(null);
  });

  test('an unknown purpose is refused by both doors, and neither mints nor trusts a token', async () => {
    await expect(jwtService.signToken(ctx, 'printfil', PRINT_PAYLOAD, cfgTokenAlgorithm, 300)).rejects.toThrow(/no token policy/);
    const res = await jwtService.checkJwt(ctx, 'x.y.z', 'printfil');
    expect(res.decoded).toBe(null);
    expect(res.code).toBe(constants.JWT_ERROR_CODE);
  });

  test('the production print-file URL carries a derived-key token that no session sink accepts (V1)', async () => {
    const canvasService = require('../../DocService/sources/canvasservice');
    const url = await canvasService.getPrintFileUrl(ctx, 'print-doc-1', 'http://localhost:8000', 'file.pdf');
    const token = decodeURIComponent(/[?&]token=([^&]+)/.exec(url)[1]);
    const asSession = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_EDITOR_SESSION);
    expect(asSession.decoded).toBe(null);
    // the session key is what fails, not a missing policy
    expect(asSession.description).toMatch(/signature/i);
    const asInternal = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(asInternal.decoded.document.key).toBe('print-doc-1');
    expect(asInternal.decoded.ds_tokenType).toBe('printfile');
  });

  test('the WOPI convert-and-edit token keeps its own derived key and a positive payload rule', async () => {
    const token = await jwtService.signToken(
      ctx,
      constants.JWT_PURPOSE_WOPI_CONVERT,
      {docId: 'd1', wopiSrc: 'http://host/wopi'},
      cfgTokenAlgorithm,
      300
    );
    const ok = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(ok.decoded.docId).toBe('d1');
    const incomplete = await jwtService.signToken(ctx, constants.JWT_PURPOSE_WOPI_CONVERT, {docId: 'd1'}, cfgTokenAlgorithm, 300);
    const bad = await jwtService.checkJwt(ctx, incomplete, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(bad.decoded).toBe(null);
  });

  test('one verifier serves every purpose, and a configured key never satisfies a derived one', async () => {
    // the payload is exactly right in both cases; only the key is foreign, so the refusal must come from the signature
    const printShaped = await mintWithSecretType(PRINT_PAYLOAD, commonDefines.c_oAscSecretType.Session, 300);
    const res = await jwtService.checkJwt(ctx, printShaped, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBe(null);
    expect(res.description).toMatch(/signature/i);
    const wopiShaped = await mintWithSecretType({docId: 'd', wopiSrc: 'http://h/w'}, commonDefines.c_oAscSecretType.Inbox, 300);
    const res2 = await jwtService.checkJwt(ctx, wopiShaped, constants.JWT_PURPOSE_WOPI_CONVERT);
    expect(res2.decoded).toBe(null);
    expect(res2.description).toMatch(/signature/i);
  });

  test('there is no signature-only door left: a forgotten policy argument fails closed', async () => {
    const token = await mint({url: 'http://storage/in.docx', key: 'k'}, commonDefines.c_oAscSecretType.Inbox);
    const forgotten = await jwtService.checkJwt(ctx, token);
    expect(forgotten.decoded).toBe(null);
    expect(forgotten.code).toBe(constants.JWT_ERROR_CODE);
    expect(constants.JWT_PURPOSE_NONE).toBe(undefined);
  });

  test('the policy picks the secret, so a purpose can never be paired with the wrong key', async () => {
    const sessionPayload = SINK_FIXTURES[constants.JWT_PURPOSE_EDITOR_SESSION];
    const sessionToken = await mintSession(sessionPayload);
    // the same token: accepted under the session policy, refused under an inbox one, with no way for a caller to choose the key
    expect((await jwtService.checkJwt(ctx, sessionToken, constants.JWT_PURPOSE_EDITOR_SESSION)).decoded).toBeTruthy();
    const inbox = await jwtService.checkJwt(ctx, sessionToken, constants.JWT_PURPOSE_CONVERTER);
    expect(inbox.decoded).toBe(null);
  });

  test('the operation claim is an integrator contract, so a derived purpose neither requires nor refuses it', async () => {
    // the derived key already binds the token to its purpose, so the claim adds nothing and its presence is not an error
    const gate = purposeModeCtx('strict');
    const session = SINK_FIXTURES[constants.JWT_PURPOSE_EDITOR_SESSION];
    expect(jwtService.checkJwtPurpose(gate, session, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(true);
    for (const claim of [constants.JWT_PURPOSE_CONVERTER, constants.JWT_PURPOSE_COMMAND]) {
      expect(jwtService.checkJwtPurpose(gate, {...session, [constants.JWT_CLAIM_OPERATION]: claim}, constants.JWT_PURPOSE_EDITOR_SESSION)).toBe(true);
    }
    // what still separates it is the key, not the claim
    const claimed = await mintSession({...session, [constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER});
    expect((await jwtService.checkJwt(ctx, claimed, constants.JWT_PURPOSE_EDITOR_SESSION)).decoded).toBeTruthy();
    expect((await jwtService.checkJwt(ctx, claimed, constants.JWT_PURPOSE_CONVERTER)).decoded).toBe(null);
  });

  test('a token Document Server signs for the WOPI editor verifies at every sink that consumes it', async () => {
    // wopiEditor mints this one and the browser carries it back to the WS handshake and to /downloadfile, so the whole browser-carried family has to share one key with inbox
    const editorToken = await jwtService.signToken(
      ctx,
      constants.JWT_PURPOSE_BROWSER_OPEN,
      {key: 'd', fileInfo: {BaseFileName: 'a.docx', Size: 10}, userAuth: {wopiSrc: 'http://h/w'}},
      cfgTokenAlgorithm,
      300
    );
    expect((await jwtService.checkJwt(ctx, editorToken, constants.JWT_PURPOSE_BROWSER_OPEN)).decoded).toBeTruthy();
    expect((await jwtService.checkJwt(ctx, editorToken, constants.JWT_PURPOSE_DOWNLOAD)).decoded).toBeTruthy();
    // and it is the inbox secret that does it, not a browser one: secret.browser is read by nothing
    const asInbox = await mintWithSecretType({key: 'd'}, commonDefines.c_oAscSecretType.Inbox, 300);
    expect((await jwtService.checkJwt(ctx, asInbox, constants.JWT_PURPOSE_BROWSER_OPEN)).decoded).toBeTruthy();
  });

  test('the gate is no longer reachable through DocsCoServer, so there is one way to call it', () => {
    expect(docsCoServer.checkJwtPurpose).toBe(undefined);
  });

  test('the signer takes a purpose, so no caller can choose a key at all', async () => {
    for (const purpose of [constants.JWT_PURPOSE_CONVERTER, constants.JWT_PURPOSE_EDITOR_SESSION, constants.JWT_PURPOSE_PRINT_FILE]) {
      expect(typeof (await jwtService.signToken(ctx, purpose, {a: 1}, cfgTokenAlgorithm, 300))).toBe('string');
    }
    // a typo, a secret type left over from the old signature and a missing purpose all fail loudly instead of signing
    for (const purpose of ['converterr', 3, undefined, null]) {
      await expect(jwtService.signToken(ctx, purpose, {a: 1}, cfgTokenAlgorithm, 300)).rejects.toThrow(/no token policy/);
    }
  });

  test('checkJwtHeader reads a custom carrier and still applies the policy', async () => {
    const good = await mintSession(SINK_FIXTURES[constants.JWT_PURPOSE_EDITOR_SESSION]);
    const req = h => ({get: name => ('authorization' === String(name).toLowerCase() ? h : undefined)});
    const carrier = {header: 'Authorization', prefix: 'Bearer '};
    const ok = await jwtService.checkJwtHeader(ctx, req('Bearer ' + good), constants.JWT_PURPOSE_EDITOR_SESSION, carrier);
    expect(ok.decoded).toBeTruthy();
    // the default inbox prefix must not match a Bearer carrier, and a print token must still be refused on a session sink
    expect(await jwtService.checkJwtHeader(ctx, req('Token ' + good), constants.JWT_PURPOSE_EDITOR_SESSION, carrier)).toBe(null);
    const printToken = await mintSession(PRINT_PAYLOAD);
    const refused = await jwtService.checkJwtHeader(ctx, req('Bearer ' + printToken), constants.JWT_PURPOSE_EDITOR_SESSION, carrier);
    expect(refused.decoded).toBe(null);
  });

  test('a DS-issued payload rule requires top-level values, not a nested copy', () => {
    const gate = purposeModeCtx('validate');
    expect(jwtService.checkJwtPurpose(gate, {payload: {docId: 'd', wopiSrc: 'http://h/w'}}, constants.JWT_PURPOSE_WOPI_CONVERT)).toBe(false);
    expect(jwtService.checkJwtPurpose(gate, {docId: '', wopiSrc: 'http://h/w'}, constants.JWT_PURPOSE_WOPI_CONVERT)).toBe(false);
    expect(jwtService.checkJwtPurpose(gate, {docId: {}, wopiSrc: 'http://h/w'}, constants.JWT_PURPOSE_WOPI_CONVERT)).toBe(false);
    expect(jwtService.checkJwtPurpose(gate, {payload: PRINT_PAYLOAD}, constants.JWT_PURPOSE_PRINT_FILE)).toBe(false);
    expect(jwtService.checkJwtPurpose(gate, {ds_tokenType: 'printfile'}, constants.JWT_PURPOSE_PRINT_FILE)).toBe(false);
  });

  test('there is one signer and one verifier, and DocsCoServer re-exports exactly those', () => {
    expect(typeof docsCoServer.signToken).toBe('function');
    expect(typeof docsCoServer.checkJwt).toBe('function');
    // the separate internal doors are gone: the purpose alone selects the key
    expect(jwtService.signInternalToken).toBe(undefined);
    expect(jwtService.verifyInternalToken).toBe(undefined);
    expect(docsCoServer.signInternalToken).toBe(undefined);
    expect(docsCoServer.verifyInternalToken).toBe(undefined);
  });
});

describe('operation claim', () => {
  const CONVERTER = constants.JWT_PURPOSE_CONVERTER;
  const CONVERTER_FROM_FILE = constants.JWT_PURPOSE_CONVERTER_FROM_FILE;
  const DOCBUILDER_FROM_FILE = constants.JWT_PURPOSE_DOCBUILDER_FROM_FILE;
  const claim = value => ({[constants.JWT_CLAIM_OPERATION]: value, key: 'k'});
  const plain = () => ({key: 'k'});

  test('validate accepts a legacy token without the claim and rejects one that claims another operation', () => {
    const gate = purposeModeCtx('validate');
    expect(checkJwtPurpose(gate, plain(), CONVERTER)).toBe(true);
    expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_CONVERTER), CONVERTER)).toBe(true);
    expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_DOCBUILDER), CONVERTER)).toBe(false);
  });

  test('strict also rejects a token that carries no claim', () => {
    const gate = purposeModeCtx('strict');
    expect(checkJwtPurpose(gate, plain(), CONVERTER)).toBe(false);
    expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_CONVERTER), CONVERTER)).toBe(true);
    // strict keeps the marker rule of validate
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER, editorConfig: {}}, CONVERTER)).toBe(false);
  });

  test('off ignores the claim entirely', () => {
    const gate = purposeModeCtx('off');
    expect(checkJwtPurpose(gate, plain(), CONVERTER)).toBe(true);
    expect(checkJwtPurpose(gate, claim('anything'), CONVERTER)).toBe(true);
  });

  test('an unknown mode fails closed', () => {
    const gate = purposeModeCtx('required');
    expect(checkJwtPurpose(gate, plain(), CONVERTER)).toBe(false);
    expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_CONVERTER), CONVERTER)).toBe(false);
  });

  test('a non-string claim is not a match', () => {
    const gate = purposeModeCtx('validate');
    for (const value of [null, 1, {}, ['converter'], 'Converter', ' converter']) {
      expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: value}, CONVERTER)).toBe(false);
    }
  });

  test('the claim must be top-level: any copy inside payload or query rejects the token', () => {
    const gate = purposeModeCtx('validate');
    const top = constants.JWT_PURPOSE_CONVERTER;
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: top, payload: {operation: 'command'}}, CONVERTER)).toBe(false);
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: top, query: {operation: 'command'}}, CONVERTER)).toBe(false);
    expect(checkJwtPurpose(gate, {payload: {operation: top}}, CONVERTER)).toBe(false);
    // a wrapper must not be able to mask a conflict in the other one by agreeing with the top level
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: top, payload: {operation: 'command'}, query: {operation: top}}, CONVERTER)).toBe(
      false
    );
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: top, payload: {operation: top}}, CONVERTER)).toBe(false);
    expect(checkJwtPurpose(gate, {[constants.JWT_CLAIM_OPERATION]: top}, CONVERTER)).toBe(true);
  });

  test('the download sink takes no claim, because the editor gets one token for open and for download', () => {
    const gate = purposeModeCtx('strict');
    expect(checkJwtPurpose(gate, {document: {key: 'd'}, editorConfig: {}}, constants.JWT_PURPOSE_DOWNLOAD)).toBe(true);
  });

  test('the from-file sinks require the claim in every mode, including off', () => {
    for (const mode of ['off', 'validate', 'strict']) {
      const gate = purposeModeCtx(mode);
      expect(checkJwtPurpose(gate, plain(), CONVERTER_FROM_FILE)).toBe(false);
      expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_CONVERTER), CONVERTER_FROM_FILE)).toBe(true);
      expect(checkJwtPurpose(gate, claim(constants.JWT_PURPOSE_CONVERTER), DOCBUILDER_FROM_FILE)).toBe(false);
    }
  });

  test('the from-file sinks keep the marker rule of the operation they serve', () => {
    const gate = purposeModeCtx('validate');
    const builderClaim = {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_DOCBUILDER};
    // the docbuilder fileType rule must fire under the from-file label too
    expect(checkJwtPurpose(gate, {...builderClaim, url: 'http://attacker/x.docx', fileType: 'docx'}, DOCBUILDER_FROM_FILE)).toBe(false);
    expect(checkJwtPurpose(gate, {...builderClaim, key: 'b1'}, DOCBUILDER_FROM_FILE)).toBe(true);
  });

  test('the header carrier takes the wrapper form only with the claim at the top level', async () => {
    const wrapped = await mint(
      {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER, payload: {url: 'http://storage/in.docx', outputtype: 'docx'}},
      commonDefines.c_oAscSecretType.Inbox
    );
    const ok = await getRequestParams(ctx, fakeReq({headerToken: wrapped}), CONVERTER);
    expect(ok.code).toBe(constants.NO_ERROR);
    expect(ok.params.outputtype).toBe('docx');
    // the naive migration - dropping the claim into the existing params wrapper - must not pass
    const nested = await mint(
      {payload: {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER, url: 'http://storage/in.docx'}},
      commonDefines.c_oAscSecretType.Inbox
    );
    const refused = await getRequestParams(ctx, fakeReq({headerToken: nested}), CONVERTER);
    expect(refused.code).toBe(constants.VKEY);
    expect(refused.params).toEqual({});
  });

  test('a valid body token wins over the header, so a broken header claim can hide behind it', async () => {
    const body = await mint(
      {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER, url: 'http://storage/in.docx'},
      commonDefines.c_oAscSecretType.Inbox
    );
    const brokenHeader = await mint(
      {payload: {[constants.JWT_CLAIM_OPERATION]: constants.JWT_PURPOSE_CONVERTER}},
      commonDefines.c_oAscSecretType.Inbox
    );
    const req = fakeReq({bodyObj: {token: body}});
    req.get = () => cfgInboxPrefix + brokenHeader;
    const res = await getRequestParams(ctx, req, CONVERTER);
    // documented, not desired: the header is never looked at while a body token verifies
    expect(res.code).toBe(constants.NO_ERROR);
  });

  test('claim x sink x mode: acceptance follows the four stated rules and nothing else', () => {
    const S = constants;
    // the sink -> operation map is restated here on purpose, so a change in the registry has to be mirrored deliberately
    const SINK_OPERATION = {
      [S.JWT_PURPOSE_CONVERTER]: S.JWT_PURPOSE_CONVERTER,
      [S.JWT_PURPOSE_DOCBUILDER]: S.JWT_PURPOSE_DOCBUILDER,
      [S.JWT_PURPOSE_COMMAND]: S.JWT_PURPOSE_COMMAND,
      [S.JWT_PURPOSE_CONVERTER_FROM_FILE]: S.JWT_PURPOSE_CONVERTER,
      [S.JWT_PURPOSE_DOCBUILDER_FROM_FILE]: S.JWT_PURPOSE_DOCBUILDER,
      [S.JWT_PURPOSE_DOWNLOAD]: null,
      [S.JWT_PURPOSE_BROWSER_OPEN]: null,
      [S.JWT_PURPOSE_BROWSER_IMGURLS]: null,
      [S.JWT_PURPOSE_BROWSER_DOWNLOADAS]: null,
      [S.JWT_PURPOSE_BROWSER_SAVE_RELATIVE]: null
      // editor-session is derived: its key is its own, no tenant mode reaches it and it never sees the claim, so it is covered by the derived-key tests instead
    };
    const ALWAYS_REQUIRES = new Set([S.JWT_PURPOSE_CONVERTER_FROM_FILE, S.JWT_PURPOSE_DOCBUILDER_FROM_FILE]);
    // a payload every remaining structural rule accepts, so only the claim decides the outcome
    // docbuilder and command take closed field sets and the from-file pair refuses a url, so each sink starts from a payload its own rules accept and only the claim varies
    const INBOX_BASE = {url: 'http://storage/in.docx', fileType: 'docx', key: 'k'};
    const BASES = {
      [S.JWT_PURPOSE_DOCBUILDER]: {url: 'http://storage/script.docbuilder', key: 'k'},
      [S.JWT_PURPOSE_COMMAND]: {c: 'info', key: 'k'},
      [S.JWT_PURPOSE_CONVERTER_FROM_FILE]: {key: 'k'},
      [S.JWT_PURPOSE_DOCBUILDER_FROM_FILE]: {key: 'k'}
    };
    const baseFor = sink => ({...(BASES[sink] || INBOX_BASE)});
    const CARRIERS = {
      missing: (value, base) => base,
      top: (value, base) => ({...base, [S.JWT_CLAIM_OPERATION]: value}),
      nestedPayload: (value, base) => ({...base, payload: {[S.JWT_CLAIM_OPERATION]: value}}),
      nestedQuery: (value, base) => ({...base, [S.JWT_CLAIM_OPERATION]: value, query: {[S.JWT_CLAIM_OPERATION]: value}}),
      queryOnly: (value, base) => ({...base, query: {[S.JWT_CLAIM_OPERATION]: value}})
    };
    const WIRE_VALUES = [S.JWT_PURPOSE_CONVERTER, S.JWT_PURPOSE_DOCBUILDER, S.JWT_PURPOSE_COMMAND];

    // 1. a nested copy is fatal in every mode, off included: the merge would flatten it into the signed view
    // 2. off otherwise never looks at the claim, except where the sink requires it outright
    // 3. a sink with no operation refuses any claim, and accepts a claimless token
    // 4. a sink with an operation accepts an exact match; a missing claim only outside strict and outside the from-file pair
    function expected(sink, carrier, value, mode) {
      const operation = SINK_OPERATION[sink];
      const requires = ALWAYS_REQUIRES.has(sink);
      if ('nestedPayload' === carrier || 'nestedQuery' === carrier || 'queryOnly' === carrier) {
        return false;
      }
      if ('missing' === carrier) {
        return 'strict' === mode && operation && !requires ? false : !requires;
      }
      if ('off' === mode && !requires) {
        return true;
      }
      return operation === value;
    }

    const unexpected = [];
    for (const mode of ['off', 'validate', 'strict']) {
      for (const sink of Object.keys(SINK_OPERATION)) {
        for (const carrier of Object.keys(CARRIERS)) {
          for (const value of WIRE_VALUES) {
            const payload = CARRIERS[carrier](value, baseFor(sink));
            // the docbuilder marker rule would answer for the payload rather than for the claim
            if (S.JWT_PURPOSE_DOCBUILDER === SINK_OPERATION[sink]) {
              delete payload.fileType;
            }
            const got = jwtService.checkJwtPurpose(purposeModeCtx(mode), payload, sink);
            const want = expected(sink, carrier, value, mode);
            if (got !== want) {
              unexpected.push(`${mode} | ${sink} | ${carrier}=${value}: got ${got}, want ${want}`);
            }
            if ('missing' === carrier) {
              break;
            }
          }
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  test('a real token claiming one operation does not verify at another sink', async () => {
    const token = await mint(
      {operation: constants.JWT_PURPOSE_CONVERTER, url: 'http://storage/in.docx', key: 'k'},
      commonDefines.c_oAscSecretType.Inbox
    );
    expect((await jwtService.checkJwt(ctx, token, CONVERTER)).decoded).toBeTruthy();
    const wrongSink = await jwtService.checkJwt(ctx, token, constants.JWT_PURPOSE_COMMAND);
    expect(wrongSink.decoded).toBe(null);
    expect(wrongSink.description).toBe(constants.JWT_ERROR_REASON + 'purpose');
  });

  test('a real from-file token is refused without the claim and accepted with it', async () => {
    const bare = await mint({filetype: 'docx', outputtype: 'pdf', key: 'k'}, commonDefines.c_oAscSecretType.Inbox);
    expect((await jwtService.checkJwt(ctx, bare, CONVERTER_FROM_FILE)).decoded).toBe(null);
    const claimed = await mint(
      {operation: constants.JWT_PURPOSE_CONVERTER, filetype: 'docx', outputtype: 'pdf', key: 'k'},
      commonDefines.c_oAscSecretType.Inbox
    );
    expect((await jwtService.checkJwt(ctx, claimed, CONVERTER_FROM_FILE)).decoded).toBeTruthy();
    // the same token naming a url is refused: at from-file the source is the file part
    const withUrl = await mint(
      {operation: constants.JWT_PURPOSE_CONVERTER, url: 'http://storage/in.docx', key: 'k'},
      commonDefines.c_oAscSecretType.Inbox
    );
    expect((await jwtService.checkJwt(ctx, withUrl, CONVERTER_FROM_FILE)).decoded).toBe(null);
    expect((await jwtService.checkJwt(ctx, withUrl, CONVERTER)).decoded).toBeTruthy();
  });
});

describe('the verdict line', () => {
  // a spy context so the exact wording, level and count of the gate lines can be asserted
  function spyCtx(mode) {
    const lines = {warn: [], debug: [], error: []};
    const record =
      level =>
      (format, ...args) =>
        lines[level].push(require('util').format(format, ...args));
    return {
      lines,
      ctx: {
        getCfg: (key, fallback) => ('services.CoAuthoring.token.purposeCheck' === key ? mode : fallback),
        logger: {warn: record('warn'), debug: record('debug'), error: record('error')}
      }
    };
  }
  const SESSION = SINK_FIXTURES[constants.JWT_PURPOSE_EDITOR_SESSION];

  const CASES = [
    ['accepted', 'validate', SESSION, constants.JWT_PURPOSE_EDITOR_SESSION, commonDefines.c_oAscSecretType.Session, null, 'internal'],
    [
      'marker heuristic',
      'validate',
      {document: {key: 'd'}},
      constants.JWT_PURPOSE_CONVERTER,
      commonDefines.c_oAscSecretType.Inbox,
      'marker-heuristic',
      'validate'
    ],
    [
      'claim mismatch',
      'validate',
      {url: 'http://s/a.docx', operation: constants.JWT_PURPOSE_COMMAND},
      constants.JWT_PURPOSE_CONVERTER,
      commonDefines.c_oAscSecretType.Inbox,
      'claim-mismatch',
      'validate'
    ],
    [
      'claim missing under strict',
      'strict',
      {url: 'http://s/a.docx'},
      constants.JWT_PURPOSE_CONVERTER,
      commonDefines.c_oAscSecretType.Inbox,
      'claim-missing',
      'strict'
    ],
    [
      'claim on a sink that serves none',
      'validate',
      {url: 'http://s/a.pdf', fileType: 'pdf', operation: constants.JWT_PURPOSE_COMMAND},
      constants.JWT_PURPOSE_DOWNLOAD,
      commonDefines.c_oAscSecretType.Inbox,
      'claim-not-served-here',
      'validate'
    ],
    [
      'payload shape',
      'validate',
      {url: 'http://s/a.docx'},
      constants.JWT_PURPOSE_BROWSER_DOWNLOADAS,
      commonDefines.c_oAscSecretType.Browser,
      'payload-shape',
      'validate'
    ],
    [
      'payload shape on a derived purpose, reported as internal',
      'validate',
      {document: {key: 'd'}},
      constants.JWT_PURPOSE_EDITOR_SESSION,
      commonDefines.c_oAscSecretType.Session,
      'payload-shape',
      'internal'
    ],
    [
      'invalid mode',
      'sloppy',
      {url: 'http://s/a.docx'},
      constants.JWT_PURPOSE_CONVERTER,
      commonDefines.c_oAscSecretType.Inbox,
      'invalid-mode',
      'sloppy'
    ]
  ];

  test.each(CASES)('%s produces exactly one gate line', async (_name, mode, payload, purpose, secretType, reason, reportedMode) => {
    const {lines, ctx: spy} = spyCtx(mode);
    const token = await mintFor(purpose, payload, secretType);
    const res = await jwtService.checkJwt(spy, token, purpose);
    const verdicts = lines.warn.filter(line => line.startsWith('checkJwt purpose '));
    if (null === reason) {
      expect(verdicts).toEqual([]);
      expect(lines.debug).toContain(`checkJwt accepted: purpose=${purpose} mode=${reportedMode}`);
      expect(res.decoded).toBeTruthy();
      return;
    }
    expect(verdicts).toEqual([`checkJwt purpose rejected: purpose=${purpose} mode=${reportedMode} reason=${reason}`]);
    expect(res.decoded).toBe(null);
    expect(res.code).toBe(constants.JWT_ERROR_CODE);
    // the gate never echoes a value out of the token, and there is no ERROR-level line for a client-triggered refusal
    expect(verdicts[0]).not.toContain(constants.JWT_PURPOSE_COMMAND === payload.operation ? 'operation=' : 'zzz-never');
    expect(lines.error).toEqual([]);
  });

  test('a bad signature produces no gate line at all: the key refused it before the gate', async () => {
    const {lines, ctx: spy} = spyCtx('validate');
    const foreign = await mintSession(SESSION);
    const res = await jwtService.checkJwt(spy, `${foreign}x`, constants.JWT_PURPOSE_EDITOR_SESSION);
    expect(res.decoded).toBe(null);
    expect(lines.warn.filter(line => line.startsWith('checkJwt purpose '))).toEqual([]);
  });

  test('an unknown purpose reports itself and never reaches a key', async () => {
    const {lines, ctx: spy} = spyCtx('validate');
    await jwtService.checkJwt(spy, 'whatever', 'editor-sesion');
    expect(lines.warn.filter(line => line.startsWith('checkJwt purpose '))).toEqual([
      'checkJwt purpose rejected: purpose=editor-sesion mode=internal reason=unknown-purpose'
    ]);
  });

  test('a DS-issued token is never reported under a tenant mode', async () => {
    const {lines, ctx: spy} = spyCtx('off');
    const token = await jwtService.signToken(spy, constants.JWT_PURPOSE_PRINT_FILE, {url: 'u'}, cfgTokenAlgorithm, 300);
    const res = await jwtService.checkJwt(spy, token, constants.JWT_PURPOSE_PRINT_FILE);
    expect(res.decoded).toBe(null);
    expect(lines.warn.filter(line => line.startsWith('checkJwt purpose '))).toEqual([
      `checkJwt purpose rejected: purpose=${constants.JWT_PURPOSE_PRINT_FILE} mode=internal reason=payload-shape`
    ]);
  });

  test('a validly signed but falsy payload is refused through the gate, with the standard error contract', async () => {
    const {lines, ctx: spy} = spyCtx('validate');
    const secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Inbox);
    // jwt.sign refuses a falsy payload, so the token is assembled by hand the way an attacker would
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
    const body = Buffer.from('false').toString('base64url');
    const signature = crypto.createHmac('sha256', utils.getJwtHsKey(secret)).update(`${header}.${body}`).digest('base64url');
    const res = await jwtService.checkJwt(spy, `${header}.${body}.${signature}`, constants.JWT_PURPOSE_CONVERTER);
    expect(res.decoded).toBe(null);
    expect(res.code).toBe(constants.JWT_ERROR_CODE);
    expect(res.description).toBe(`${constants.JWT_ERROR_REASON}purpose`);
    expect(lines.warn.filter(line => line.startsWith('checkJwt purpose '))).toEqual([
      `checkJwt purpose rejected: purpose=${constants.JWT_PURPOSE_CONVERTER} mode=validate reason=payload-shape`
    ]);
  });
});

describe('deriveSecret primitive, shared by every token Document Server issues to itself', () => {
  test('deriveSecret is deterministic and purpose-specific', () => {
    expect(utils.deriveSecret(DERIVE_BASE, 'printfile')).toBe(utils.deriveSecret(DERIVE_BASE, 'printfile'));
    expect(utils.deriveSecret(DERIVE_BASE, 'printfile')).not.toBe(utils.deriveSecret(DERIVE_BASE, 'save'));
  });

  test('empty secret or empty purpose yields undefined, never an accidental unsigned key', () => {
    expect(utils.deriveSecret('', 'printfile')).toBe(undefined);
    expect(utils.deriveSecret(DERIVE_BASE, '')).toBe(undefined);
    expect(utils.deriveSecret(null, 'printfile')).toBe(undefined);
  });
});

// the connection sink is the one place that takes either family: Presenter View reuses the session token but sdkjs sends it in the open slot
describe('checkJwtForConnection (socket connection sink)', () => {
  const OPEN = SINK_FIXTURES[constants.JWT_PURPOSE_BROWSER_OPEN];
  const SESSION = SINK_FIXTURES[constants.JWT_PURPOSE_EDITOR_SESSION];
  // longer than verifyOptions.clockTolerance, so the token is expired rather than merely stale
  const EXPIRED_AGO = -120;

  function connCtx() {
    const lines = {warn: [], debug: [], error: []};
    const record =
      level =>
      (format, ...args) =>
        lines[level].push(require('util').format(format, ...args));
    return {
      lines,
      ctx: {
        getCfg: (_key, fallback) => fallback,
        logger: {warn: record('warn'), debug: record('debug'), error: record('error')}
      }
    };
  }

  test('an integrator open token passes in the open slot and logs no refusal', async () => {
    const {lines, ctx: spy} = connCtx();
    const token = await mint(OPEN, commonDefines.c_oAscSecretType.Browser);
    const res = await docsCoServer.checkJwtForConnection(spy, token, false);
    expect(res.decoded).toMatchObject(OPEN);
    expect(lines.warn).toEqual([]);
  });

  test('a session token passes in the session slot', async () => {
    const token = await mintSession(SESSION);
    expect((await docsCoServer.checkJwtForConnection(ctx, token, true)).decoded).toMatchObject(SESSION);
  });

  test('a session token passes in the open slot, which is what Presenter View sends', async () => {
    const {lines, ctx: spy} = connCtx();
    const token = await mintSession(SESSION);
    const res = await docsCoServer.checkJwtForConnection(spy, token, false);
    expect(res.decoded).toMatchObject(SESSION);
    // the open-key attempt is expected to fail here, so it must not reach warn
    expect(lines.warn).toEqual([]);
  });

  test('an open token is still refused in the session slot', async () => {
    const token = await mint(OPEN, commonDefines.c_oAscSecretType.Browser);
    const res = await docsCoServer.checkJwtForConnection(ctx, token, true);
    expect(res.decoded).toBeNull();
    expect(res.code).toBe(constants.JWT_ERROR_CODE);
  });

  test('a token from another derived family is refused in both slots and reported once', async () => {
    const {lines, ctx: spy} = connCtx();
    const token = await jwtService.signToken(spy, constants.JWT_PURPOSE_PRINT_FILE, PRINT_PAYLOAD, cfgTokenAlgorithm, 300);
    const res = await docsCoServer.checkJwtForConnection(spy, token, false);
    expect(res.decoded).toBeNull();
    expect(res.code).toBe(constants.JWT_ERROR_CODE);
    // the whole refusal must be that one line: any extra warn here would be a second, unexplained verdict
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toMatch(/^checkJwtForConnection refused/);
  });

  test('an expired session token in the open slot keeps the expired code, not the open-key signature error', async () => {
    const token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_EDITOR_SESSION, SESSION, cfgTokenAlgorithm, EXPIRED_AGO);
    const res = await docsCoServer.checkJwtForConnection(ctx, token, false);
    expect(res.decoded).toBeNull();
    expect(res.code).toBe(constants.JWT_EXPIRED_CODE);
  });

  test('an expired open token keeps the expired code too', async () => {
    const token = await mintWithSecretType(OPEN, commonDefines.c_oAscSecretType.Browser, EXPIRED_AGO);
    const res = await docsCoServer.checkJwtForConnection(ctx, token, false);
    expect(res.decoded).toBeNull();
    expect(res.code).toBe(constants.JWT_EXPIRED_CODE);
  });
});

describe('shipped JWT defaults', () => {
  //the placeholder is spelled out in both the config and the constant, so a drift would silently stop the startup warning from recognizing it
  test('keeps the config and the constant in step', () => {
    const coAuthoring = require('../../Common/config/default.json').services.CoAuthoring;

    for (const type of ['browser', 'inbox', 'outbox', 'session']) {
      expect(coAuthoring.secret[type].string).toBe(constants.PUBLIC_DEFAULT_SECRET);
    }
    expect(coAuthoring.token.enable).toEqual({browser: true, request: {inbox: true, outbox: true}});
  });
});

describe('getJwtHsKey', () => {
  //modern Node turns zero bytes into a working key, so this guard is the only thing keeping empty material out of sign and verify
  test('refuses zero-length key material', () => {
    expect(utils.getJwtHsKey('')).toBeUndefined();
    expect(utils.getJwtHsKey(Buffer.alloc(0))).toBeUndefined();
  });
  test('gives a string and a Buffer of the same bytes the same key material', () => {
    const fromString = utils.getJwtHsKey('shared-key-material');
    const fromBuffer = utils.getJwtHsKey(Buffer.from('shared-key-material', 'utf8'));
    expect(fromString).toBeDefined();
    expect(fromBuffer).toBeDefined();
    expect(fromString.export().equals(fromBuffer.export())).toBe(true);
  });
  test('refuses an absent secret whether or not a string secret warmed the cache', () => {
    expect(utils.getJwtHsKey(undefined)).toBeUndefined();
    expect(utils.getJwtHsKey(null)).toBeUndefined();
    // a tenant whose secret file holds the literal text used to seed the cache slot an absent secret coerced to
    expect(utils.getJwtHsKey('undefined')).toBeDefined();
    expect(utils.getJwtHsKey('null')).toBeDefined();
    expect(utils.getJwtHsKey(undefined)).toBeUndefined();
    expect(utils.getJwtHsKey(null)).toBeUndefined();
  });
  test('refuses everything that is not string or Buffer key material', () => {
    for (const bad of [0, 1, true, false, {}, [], () => {}, Symbol('s'), new Uint8Array([1, 2, 3])]) {
      expect(utils.getJwtHsKey(bad)).toBeUndefined();
    }
  });
  test('keeps binary secrets apart that a utf8 coercion would merge', () => {
    const first = utils.getJwtHsKey(Buffer.from([0x80]));
    const second = utils.getJwtHsKey(Buffer.from([0x81]));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.export().equals(Buffer.from([0x80]))).toBe(true);
    expect(second.export().equals(Buffer.from([0x81]))).toBe(true);
  });
  test('a Buffer secret never picks up the key of a string that looks like its cache label', () => {
    const binary = Buffer.from([0xc3, 0x28]);
    const asBase64 = binary.toString('base64');
    expect(utils.getJwtHsKey(asBase64).export().equals(Buffer.from(asBase64, 'utf8'))).toBe(true);
    expect(utils.getJwtHsKey(binary).export().equals(binary)).toBe(true);
  });
});

describe('signing refuses missing key material', () => {
  const signCtx = {getCfg: (key, def) => def, logger: {debug() {}, warn() {}, error() {}}};
  test('fillJwtForRequest throws instead of signing with a cached foreign key', () => {
    // the literal text is what an absent secret coerced to while the key cache was a plain object
    utils.getJwtHsKey('undefined');
    expect(() => utils.fillJwtForRequest(signCtx, {a: 1}, undefined, true)).toThrow(/missing or invalid jwt secret/);
    expect(() => utils.fillJwtForRequest(signCtx, {a: 1}, '', true)).toThrow(/missing or invalid jwt secret/);
  });
  test('isJwtHsKeyMaterial agrees with what getJwtHsKey accepts', () => {
    for (const good of ['s', 'undefined', Buffer.from([0x00])]) {
      expect(utils.isJwtHsKeyMaterial(good)).toBe(true);
      expect(utils.getJwtHsKey(good)).toBeDefined();
    }
    for (const bad of [undefined, null, '', Buffer.alloc(0), 42, {}]) {
      expect(utils.isJwtHsKeyMaterial(bad)).toBe(false);
      expect(utils.getJwtHsKey(bad)).toBeUndefined();
    }
  });
});

// The tenant half of the same guard: over real tenant directories, a tenant without secret.key is refused whichever tenant was served before it.
describe('tenant secret isolation in the jwt key cache', () => {
  const SEED_TENANT = 'seed.example.test';
  const MISSING_TENANT = 'missing.example.test';
  const SEED_SECRET = 'undefined';
  const CONVERTER_PAYLOAD = {url: 'http://storage/in.docx', filetype: 'docx', outputtype: 'pdf'};
  const SESSION_PAYLOAD = {document: {key: 'doc-1'}, editorConfig: {user: {id: 'u1'}, ds_sessionTimeConnect: 1756000000000}};
  const MOCKED_MODULES = ['config', '../../Common/sources/logger'];

  let baseDir;
  let tm;
  let tenantJwtService;

  // A fresh log4js per isolateModules load would pile listeners onto the shared cluster module, so the logger is stubbed out.
  const loggerStub = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    shutdown: cb => cb && cb(),
    configureLogger() {},
    getLogger: () => ({trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, addContext() {}}),
    getLoggerConfig: () => ({}),
    getInitialLoggerConfig: () => ({})
  };

  // Config mock factory: a Proxy that overrides the tenants keys and forwards everything else to the real config.
  function makeConfigMock(overrides) {
    const actual = jestGlobals.requireActual('config');
    return new Proxy(actual, {
      get(target, prop) {
        if (prop === 'get') return key => (key in overrides ? overrides[key] : target.get(key));
        if (prop === 'has') return key => key in overrides || target.has(key);
        return target[prop];
      }
    });
  }

  function makeCtx(tenant) {
    return {
      tenant,
      logger: {trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}},
      getCfg: (key, def) => def,
      cleanTenantConfigCache() {}
    };
  }

  // Loads tenantManager over a real tenant directory and the jwt layer on top of that same instance.
  function loadModules() {
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('../../Common/sources/logger', () => loggerStub);
      jestGlobals.doMock('config', () =>
        makeConfigMock({'tenants.baseDir': baseDir, 'tenants.cache': {stdTTL: 60, checkperiod: 0, useClones: false}})
      );
      // operationContext must win the require cycle it forms with tenantManager, exactly as it does on a real start
      require('../../Common/sources/operationContext');
      tm = require('../../Common/sources/tenantManager');
      tenantJwtService = require('../../DocService/sources/jwtService');
    });
    tm.setMultitenantMode(true);
  }

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-secret-'));
    fs.mkdirSync(path.join(baseDir, SEED_TENANT));
    fs.mkdirSync(path.join(baseDir, MISSING_TENANT));
    fs.writeFileSync(path.join(baseDir, SEED_TENANT, 'secret.key'), SEED_SECRET);
    loadModules();
  });
  afterEach(() => {
    // resetModules drops the loaded instances but keeps the doMock registrations, so every mocked module is released by name
    MOCKED_MODULES.forEach(name => jestGlobals.dontMock(name));
    jestGlobals.resetModules();
    fs.rmSync(baseDir, {recursive: true, force: true});
  });

  test('the tenant directories are the ones the scenario describes', async () => {
    expect(await tm.getTenantSecret(makeCtx(SEED_TENANT), commonDefines.c_oAscSecretType.Inbox)).toBe(SEED_SECRET);
    expect(await tm.getTenantSecret(makeCtx(MISSING_TENANT), commonDefines.c_oAscSecretType.Inbox)).toBeUndefined();
    expect(fs.existsSync(path.join(baseDir, MISSING_TENANT, 'secret.key'))).toBe(false);
  });

  test('a tenant without secret.key is refused before and after the seeding tenant is served', async () => {
    const seedCtx = makeCtx(SEED_TENANT);
    const missingCtx = makeCtx(MISSING_TENANT);
    const purpose = constants.JWT_PURPOSE_CONVERTER;
    // minted outside the server, so the first check below runs against a key cache nothing has warmed yet
    const foreignToken = jwtLib.sign(CONVERTER_PAYLOAD, SEED_SECRET, {algorithm: 'HS256', expiresIn: 300});

    const cold = await tenantJwtService.checkJwt(missingCtx, foreignToken, purpose);
    expect(cold.decoded).toBeNull();
    expect(cold.code).toBe(constants.JWT_ERROR_CODE);

    const seed = await tenantJwtService.checkJwt(seedCtx, foreignToken, purpose);
    expect(seed.decoded).toBeTruthy();

    const warmed = await tenantJwtService.checkJwt(missingCtx, foreignToken, purpose);
    expect(warmed.decoded).toBeNull();
    expect(warmed.code).toBe(constants.JWT_ERROR_CODE);
  });

  test('the derived key path refuses a token minted with the seeding text once the cache is warm', async () => {
    const seedCtx = makeCtx(SEED_TENANT);
    const missingCtx = makeCtx(MISSING_TENANT);
    const purpose = constants.JWT_PURPOSE_EDITOR_SESSION;
    // the derived key is a hash, so only an ordinary sink puts the literal text of the seeding secret into the shared cache
    const inboxToken = jwtLib.sign(CONVERTER_PAYLOAD, SEED_SECRET, {algorithm: 'HS256', expiresIn: 300});
    expect((await tenantJwtService.checkJwt(seedCtx, inboxToken, constants.JWT_PURPOSE_CONVERTER)).decoded).toBeTruthy();

    // a tenant without secret.key has no derived key either, so a token signed with that text must stay foreign
    const forged = jwtLib.sign(SESSION_PAYLOAD, SEED_SECRET, {algorithm: 'HS256', expiresIn: 300});
    const warmed = await tenantJwtService.checkJwt(missingCtx, forged, purpose);
    expect(warmed.decoded).toBeNull();
    expect(warmed.code).toBe(constants.JWT_ERROR_CODE);

    // the seeding tenant keeps its own session tokens working, so the refusal above is about the missing key alone
    const seedToken = await tenantJwtService.signToken(seedCtx, purpose, SESSION_PAYLOAD, 'HS256', 300);
    expect((await tenantJwtService.checkJwt(seedCtx, seedToken, purpose)).decoded).toBeTruthy();
    expect((await tenantJwtService.checkJwt(missingCtx, seedToken, purpose)).decoded).toBeNull();
  });

  test('signing for a tenant without secret.key throws instead of reusing a warm key', async () => {
    const seedCtx = makeCtx(SEED_TENANT);
    const missingCtx = makeCtx(MISSING_TENANT);
    await tenantJwtService.signToken(seedCtx, constants.JWT_PURPOSE_CONVERTER, CONVERTER_PAYLOAD, 'HS256', 300);
    await expect(tenantJwtService.signToken(missingCtx, constants.JWT_PURPOSE_CONVERTER, CONVERTER_PAYLOAD, 'HS256', 300)).rejects.toThrow(
      /missing or invalid secret/
    );
    await expect(tenantJwtService.signToken(missingCtx, constants.JWT_PURPOSE_EDITOR_SESSION, SESSION_PAYLOAD, 'HS256', 300)).rejects.toThrow(
      /missing or invalid secret/
    );
  });
});
