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

const {describe, test, expect} = require('@jest/globals');

const {signToken} = require('../../DocService/sources/DocsCoServer');
const {getRequestParamsFromFile} = require('../../DocService/sources/convertFromFile');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');
const operationContext = require('../../Common/sources/operationContext');
const config = require('../../Common/node_modules/config');

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
    const token = await signToken(ctx, PARAMS, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParamsFromFile(ctx, fakeReq({token}));
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('accepts a token nested inside the params JSON (classic body.token contract)', async () => {
    const token = await signToken(ctx, PARAMS, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({outputtype: 'spoiled', token})}));
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
    expect(res.params.outputtype).toBe(PARAMS.outputtype);
  });

  test('accepts a header token alongside an unsigned params part', async () => {
    const token = await signToken(ctx, PARAMS, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({outputtype: 'spoiled'})}, token));
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('a nested params token wins over the header (classic precedence: body token, header ignored)', async () => {
    const token = await signToken(ctx, PARAMS, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({token})}, 'garbageheader'));
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('an empty nested token is ignored (classic !!params.token), unsigned params used in non-token mode', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({...PARAMS, token: ''})}));
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(false);
      expect(res.isDecoded).toBe(false);
      expect(res.params).toMatchObject(PARAMS);
    }
  });

  test('a non-string truthy nested token fails verification like classic, never accepted unsigned', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify({...PARAMS, token: 12345})}));
    expect(res.code).not.toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(false);
  });

  test('400 on an unexpected unsigned scalar field', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify(PARAMS), outputtype: 'docx'}));
    expect(res.badRequest).toBe(true);
  });

  test('400 when both a token part and a params part are present', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({token: 'x', params: JSON.stringify(PARAMS)}));
    expect(res.badRequest).toBe(true);
  });

  test('a token part wins over the header (classic precedence: body token, header ignored)', async () => {
    const token = await signToken(ctx, PARAMS, cfgTokenAlgorithm, cfgTokenExpires, commonDefines.c_oAscSecretType.Inbox);
    const res = await getRequestParamsFromFile(ctx, fakeReq({token}, 'garbageheader'));
    expect(res.badRequest).toBe(false);
    expect(res.code).toBe(constants.NO_ERROR);
    expect(res.isDecoded).toBe(true);
    expect(res.params).toMatchObject(PARAMS);
  });

  test('400 when the token part is duplicated into an array', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({token: ['a', 'b']}));
    expect(res.badRequest).toBe(true);
  });

  test('400 when the params part is duplicated into an array', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: [JSON.stringify(PARAMS), JSON.stringify(PARAMS)]}));
    expect(res.badRequest).toBe(true);
  });

  test('400 on invalid params JSON', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: '{not valid'}));
    expect(res.badRequest).toBe(true);
  });

  test('params source depends on mode: accepted in non-token mode, rejected when inbox tokens are required', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({params: JSON.stringify(PARAMS)}));
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(false);
      expect(res.isDecoded).toBe(false);
      expect(res.params).toEqual(PARAMS);
    }
  });

  test('missing both a params part and a token: 400 in non-token mode, auth error when tokens required', async () => {
    const res = await getRequestParamsFromFile(ctx, fakeReq({}));
    if (inboxEnabled) {
      expect(res.code).not.toBe(constants.NO_ERROR);
    } else {
      expect(res.badRequest).toBe(true);
    }
  });
});
