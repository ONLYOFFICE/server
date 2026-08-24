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

// Hermetic from-file params/token parser tests; no server or x2t.

'use strict';

// pin purposeCheck=validate before the first require('config') and restore right after: NODE_CONFIG outranks every config file, and jest reuses one process env per worker
const savedNodeConfig = process.env.NODE_CONFIG;
process.env.NODE_CONFIG = JSON.stringify({services: {CoAuthoring: {token: {purposeCheck: 'validate'}}}});

const {describe, test, expect} = require('@jest/globals');

const {mintWithSecretType} = require('./mintToken.helper');
const {getRequestParamsFromFile} = require('../../DocService/sources/convertFromFile');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

if (undefined === savedNodeConfig) {
  delete process.env.NODE_CONFIG;
} else {
  process.env.NODE_CONFIG = savedNodeConfig;
}

const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgInboxPrefix = config.get('services.CoAuthoring.token.inbox.prefix');
const inboxEnabled = config.get('services.CoAuthoring.token.enable.request.inbox');

const ctx = new operationContext.Context();
const PARAMS = {filetype: 'txt', outputtype: 'docx'};

// Minimal Express-like request.
function fakeReq(body, headerToken) {
  return {
    body,
    get: () => (headerToken ? cfgInboxPrefix + headerToken : undefined)
  };
}

describe('getRequestParamsFromFile (accept/reject contract, no server)', () => {
  test('accepts a signed token part and uses only the signed payload', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(ctx, fakeReq({token}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('accepts a token nested inside the params JSON (classic body.token contract)', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(
      ctx,
      fakeReq({params: JSON.stringify({outputtype: 'spoiled', token})}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
    expect(res.params.outputtype).toBe(PARAMS.outputtype);
  });

  test('accepts a header token alongside an unsigned params part', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(
      ctx,
      fakeReq({params: JSON.stringify({outputtype: 'spoiled'})}, token),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('a nested params token wins over the header (classic precedence: body token, header ignored)', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({token})}, 'garbageheader'), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('an empty nested token is ignored (classic !!params.token), unsigned params used in non-token mode', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({...PARAMS, token: ''})}), constants.JWT_PURPOSE_CONVERTER);
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(false);
      expect(res.isDecoded).toBe(false);
      expect(res.params).toMatchObject(PARAMS);
    }
  });

  test('a non-string truthy nested token fails verification like classic, never accepted unsigned', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({...PARAMS, token: 12345})}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.code).not.toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(false);
  });

  test('an unsigned params field outside the token is dropped, and no setting can put it back', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(
      ctx,
      fakeReq({token, params: JSON.stringify({url: 'http://attacker/x.docx'})}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(res.isDecoded).toBe(true);
    expect(res.params.url).toBe(undefined);
    expect(res.signedParams).toMatchObject(PARAMS);
    // these routes never shipped stable, so the effective view is the signed one and tokenRequiredParams is not consulted at all
    expect(res.params).toEqual(res.signedParams);
  });

  test('400 on an unexpected unsigned scalar field', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify(PARAMS), outputtype: 'docx'}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(true);
  });

  test('accepts a token part together with a params part (3-part layout: token, params, file)', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(
      ctx,
      fakeReq({token, params: JSON.stringify({outputtype: 'spoiled'})}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
    expect(res.params.outputtype).toBe(PARAMS.outputtype);
  });

  test('a token part wins over the header (classic precedence: body token, header ignored)', async () => {
    const token = await mintWithSecretType(ctx, PARAMS, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(ctx, fakeReq({token}, 'garbageheader'), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('400 when the token part is duplicated into an array', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({token: ['a', 'b']}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(true);
  });

  test('400 when the params part is duplicated into an array', async () => {
    const res = await getRequestParamsFromFile(
      ctx,
      fakeReq({params: [JSON.stringify(PARAMS), JSON.stringify(PARAMS)]}),
      constants.JWT_PURPOSE_CONVERTER
    );
    expect(res.badRequest).toBe(true);
  });

  test('400 on invalid params JSON', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: '{not valid'}), constants.JWT_PURPOSE_CONVERTER);
    expect(res.badRequest).toBe(true);
  });

  test('params source depends on mode: accepted in non-token mode, rejected when inbox tokens are required', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify(PARAMS)}), constants.JWT_PURPOSE_CONVERTER);
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(false);
      expect(res.isDecoded).toBe(false);
      expect(res.params).toEqual(PARAMS);
    }
  });

  test('missing both a params part and a token: 400 in non-token mode, auth error when tokens required', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({}), constants.JWT_PURPOSE_CONVERTER);
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(true);
    }
  });
});

describe('getRequestParamsFromFile operation guard', () => {
  test('a legit inbox converter token with filetype: accepted for converter, rejected for docbuilder (labels are not interchangeable)', async () => {
    const token = await mintWithSecretType(
      ctx,
      {filetype: 'txt', outputtype: 'docx', url: 'http://storage/in.txt', key: 'c1'},
      commonDefines.c_oAscSecretType.Inbox,
      {algorithm: cfgTokenAlgorithm, expiresIn: cfgTokenExpires}
    );
    const ok = await getRequestParamsFromFile(ctx, fakeReq({token}), constants.JWT_PURPOSE_CONVERTER);
    expect(ok.code).toBe(constants.NO_ERROR);
    expect(ok.isDecoded).toBe(true);
    const swapped = await getRequestParamsFromFile(ctx, fakeReq({token}), constants.JWT_PURPOSE_DOCBUILDER);
    expect(swapped.code).toBe(constants.VKEY);
    expect(swapped.isDecoded).toBe(false);
  });

  test('a legit inbox docbuilder token (no filetype, script goes in the file) reaches the builder on docbuilder', async () => {
    const token = await mintWithSecretType(ctx, {key: 'b1', async: true}, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const res = await getRequestParamsFromFile(ctx, fakeReq({token}), constants.JWT_PURPOSE_DOCBUILDER);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
  });

  test('a browser marker token is rejected on both from-file operations', async () => {
    const token = await mintWithSecretType(ctx, {document: {key: 'd'}, editorConfig: {}}, commonDefines.c_oAscSecretType.Browser, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    for (const op of ['converter', 'docbuilder']) {
      const res = await getRequestParamsFromFile(ctx, fakeReq({token}), op);
      expect(res.code).toBe(constants.VKEY);
      expect(res.isDecoded).toBe(false);
    }
  });

  test('the from-file purposes demand the operation claim the body endpoints only accept', async () => {
    const bare = await mintWithSecretType(ctx, {filetype: 'txt', outputtype: 'docx', key: 'c1'}, commonDefines.c_oAscSecretType.Inbox, {
      algorithm: cfgTokenAlgorithm,
      expiresIn: cfgTokenExpires
    });
    const refused = await getRequestParamsFromFile(ctx, fakeReq({token: bare}), constants.JWT_PURPOSE_CONVERTER_FROM_FILE);
    expect(refused.code).toBe(constants.VKEY);
    expect(refused.params).toEqual({});
    const claimed = await mintWithSecretType(
      ctx,
      {operation: constants.JWT_PURPOSE_CONVERTER, filetype: 'txt', outputtype: 'docx', key: 'c1'},
      commonDefines.c_oAscSecretType.Inbox,
      {algorithm: cfgTokenAlgorithm, expiresIn: cfgTokenExpires}
    );
    const accepted = await getRequestParamsFromFile(ctx, fakeReq({token: claimed}), constants.JWT_PURPOSE_CONVERTER_FROM_FILE);
    expect(accepted.code).toBe(constants.NO_ERROR);
    expect(accepted.isDecoded).toBe(true);
    // the same claimed token is not interchangeable with the other from-file route
    const swapped = await getRequestParamsFromFile(ctx, fakeReq({token: claimed}), constants.JWT_PURPOSE_DOCBUILDER_FROM_FILE);
    expect(swapped.code).toBe(constants.VKEY);
  });
});
