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
const {afterEach, describe, expect, jest, test} = require('@jest/globals');
const utils = require('../../Common/sources/utils');
const commonDefines = require('../../Common/sources/commondefines');
const storage = require('../../Common/sources/storage/storage-base');
const taskResult = require('../../DocService/sources/taskresult');
const {UserCallback} = require('../../DocService/sources/databaseConnectors/connectorUtilities');
const docsCoServer = require('../../DocService/sources/DocsCoServer');

function createContext() {
  return {
    getCfg(_key, fallback) {
      return fallback;
    },
    logger: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  };
}

function storedCallbacks(...entries) {
  return entries
    .map(([userIndex, callback]) => {
      const userCallback = new UserCallback();
      userCallback.fromValues(userIndex, callback);
      return userCallback.toSQLInsert();
    })
    .join('');
}

describe('DocsCoServer isAiDisabledByJwt', () => {
  const openToken = customization => ({editorConfig: {user: {id: 'u'}, customization}});

  test('open token keeps ai unless the integrator turned it off', () => {
    expect(docsCoServer.isAiDisabledByJwt(openToken())).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt(openToken({ai: {disabled: false}}))).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt(openToken({ai: {disabled: true}}))).toBe(true);
  });

  test('session token carries the restriction back on reconnect', () => {
    expect(docsCoServer.isAiDisabledByJwt({editorConfig: {ds_sessionTimeConnect: 1, ds_aiDisabled: true}})).toBe(true);
    expect(docsCoServer.isAiDisabledByJwt({editorConfig: {ds_sessionTimeConnect: 1}})).toBe(false);
  });

  test('version history token keeps ai when it says nothing, as before the flag existed', () => {
    const historyToken = {key: 'doc_1', url: 'https://example.com/1', version: 1};
    expect(docsCoServer.isAiDisabledByJwt(historyToken)).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt({...historyToken, editorConfig: {customization: {ai: {disabled: false}}}})).toBe(false);
  });

  test('version history token carries the restriction in either shape the integrator signs', () => {
    const historyToken = {key: 'doc_1', url: 'https://example.com/1', version: 1};
    expect(docsCoServer.isAiDisabledByJwt({...historyToken, editorConfig: {customization: {ai: {disabled: true}}}})).toBe(true);
    expect(docsCoServer.isAiDisabledByJwt({...historyToken, customization: {ai: {disabled: true}}})).toBe(true);
  });

  test('a malformed or empty token restricts nothing', () => {
    expect(docsCoServer.isAiDisabledByJwt(undefined)).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt({editorConfig: null})).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt({editorConfig: {customization: {ai: false}}})).toBe(false);
    expect(docsCoServer.isAiDisabledByJwt({editorConfig: {customization: {ai: {disabled: 'true'}}}})).toBe(false);
  });
});

describe('DocsCoServer canStartForceSave', () => {
  test('an editor may start a forcesave', () => {
    expect(docsCoServer.canStartForceSave({user: {view: false}})).toBe(true);
  });

  test('a viewer may not, even with download allowed', () => {
    expect(docsCoServer.canStartForceSave({user: {view: true}, permissions: {download: true}})).toBe(false);
  });

  test('a connection before auth may not', () => {
    expect(docsCoServer.canStartForceSave({})).toBe(false);
  });
});

describe('DocsCoServer sendForm RPC', () => {
  const {UnknownError} = commonDefines.c_oAscServerCommandErrors;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createConn(view) {
    return {docId: 'doc-key', user: {id: 'u1', idOriginal: 'u', indexUser: 1, view}, emit: jest.fn()};
  }

  test('sendForm from a viewer is refused before any forcesave work', async () => {
    const getPresence = jest.spyOn(docsCoServer.editorData, 'getPresence');
    const conn = createConn(true);

    await docsCoServer.startRPCPromise(createContext(), conn, 7, {type: 'sendForm', formdata: {formsdata: []}});

    expect(getPresence).not.toHaveBeenCalled();
    expect(conn.emit).toHaveBeenCalledWith('message', {type: 'rpc', responseKey: 7, data: {code: UnknownError, time: null, inProgress: false}});
  });
});

describe('DocsCoServer getSessionCallback', () => {
  test('a reconnect gets the callback its user index registered at open, not one added later', () => {
    const row = {callback: storedCallbacks([1, 'https://integrator.example/track?u=1'], [2, 'https://attacker.example/cb'])};

    expect(docsCoServer.getSessionCallback(createContext(), row, 1)).toBe('https://integrator.example/track?u=1');
  });

  test('a document without a stored callback gives none', () => {
    expect(docsCoServer.getSessionCallback(createContext(), null, 1)).toBeUndefined();
    expect(docsCoServer.getSessionCallback(createContext(), {callback: ''}, 1)).toBeUndefined();
  });

  test('a user index without its own entry gives none instead of the last registered callback', () => {
    const row = {callback: storedCallbacks([1, 'https://integrator.example/track?u=1'], [2, 'https://attacker.example/cb'])};

    expect(docsCoServer.getSessionCallback(createContext(), row, 3)).toBeUndefined();
    expect(UserCallback.prototype.getCallbackByUserIndex(createContext(), row.callback, 3)).toBe('https://attacker.example/cb');
  });
});

describe('UserCallback exact lookup', () => {
  const lookup = (callbacksStr, userIndex) => UserCallback.prototype.getCallbackByUserIndex(createContext(), callbacksStr, userIndex, true);

  test('old format keeps its single callback for every user', () => {
    expect(lookup('https://integrator.example/track', 5)).toBe('https://integrator.example/track');
  });

  test('entries without a user index never match', () => {
    const subscription = new UserCallback();
    subscription.fromValues(null, 'https://integrator.example/subscription');
    const callbacksStr = storedCallbacks([1, 'https://integrator.example/track?u=1']) + subscription.toSQLInsert();

    expect(lookup(callbacksStr, 2)).toBe('');
    expect(lookup(callbacksStr, undefined)).toBe('');
    expect(lookup(callbacksStr, 1)).toBe('https://integrator.example/track?u=1');
  });

  test('an empty value gives none', () => {
    expect(lookup('', 1)).toBe('');
    expect(lookup(null, 1)).toBe('');
  });
});

describe('DocsCoServer startForceSave not modified result', () => {
  const {Button, Command, Internal} = commonDefines.c_oAscForceSaveTypes;
  const forceSaveTime = 1700000000000;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockForceSaveDone() {
    jest.spyOn(docsCoServer.editorData, 'getPresence').mockResolvedValue([]);
    jest.spyOn(docsCoServer.editorData, 'getForceSave').mockResolvedValue({
      time: forceSaveTime,
      index: 1,
      started: true,
      ended: true,
      convertInfo: {id: 'doc-key', savekey: '/save', outputpath: 'output.docx', forcesave: {type: Button, time: forceSaveTime}}
    });
    jest.spyOn(storage, 'headObject').mockResolvedValue({ContentLength: 1});
    jest.spyOn(taskResult, 'select').mockResolvedValue([{key: 'doc-key'}]);
    return jest.spyOn(storage, 'getSignedUrl').mockResolvedValue('https://example.com/signed/output.docx');
  }

  test.each([
    ['Button', Button],
    ['Command', Command]
  ])('%s result carries no download link', async (_name, type) => {
    const getSignedUrl = mockForceSaveDone();

    const res = await docsCoServer.startForceSave(createContext(), 'doc-key', type);

    expect(res.code).toBe(commonDefines.c_oAscServerCommandErrors.NotModified);
    expect(res.url).toBeUndefined();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  test('relative save still gets the link it needs', async () => {
    mockForceSaveDone();

    const res = await docsCoServer.startForceSave(createContext(), 'doc-key', Internal, ...Array(14).fill(undefined), forceSaveTime);

    expect(res.code).toBe(commonDefines.c_oAscServerCommandErrors.NotModified);
    expect(res.url).toBe('https://example.com/signed/output.docx');
  });
});

describe('DocsCoServer sendServerRequest', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sends status callback with connection close', async () => {
    const ctx = createContext();
    const dataObject = {
      key: 'doc-key',
      status: 1,
      setToken: jest.fn()
    };
    const postRequestPromise = jest.spyOn(utils, 'postRequestPromise').mockResolvedValue({body: '{"error":0}'});
    jest.spyOn(utils, 'canIncludeOutboxAuthorization').mockReturnValue(false);

    await docsCoServer.sendServerRequest(ctx, 'https://example.com/callback', dataObject);

    expect(postRequestPromise).toHaveBeenCalledWith(ctx, 'https://example.com/callback', {
      data: JSON.stringify(dataObject),
      timeout: expect.anything(),
      authorization: undefined,
      isInJwtToken: expect.anything(),
      headers: {'Content-Type': 'application/json', Connection: 'close'}
    });
  });
});
