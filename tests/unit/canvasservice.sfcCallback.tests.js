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

'use strict';

const {afterEach, beforeEach, describe, expect, test, jest: jestApi} = require('@jest/globals');

jestApi.mock('../../DocService/sources/databaseConnectors/baseConnector', () => {
  function UserCallback() {}
  UserCallback.prototype.getCallbackByUserIndex = jestApi.fn(() => 'http://callback');

  function DocumentPassword() {}
  DocumentPassword.prototype.getCurPassword = jestApi.fn(() => null);
  DocumentPassword.prototype.getDocPassword = jestApi.fn(() => ({}));

  function DocumentAdditional() {}
  DocumentAdditional.prototype.getOpenedAt = jestApi.fn(() => undefined);
  DocumentAdditional.prototype.getDocumentLayout = jestApi.fn(() => undefined);

  return {DocumentAdditional, DocumentPassword, UserCallback, deleteChanges: jestApi.fn()};
});

jestApi.mock('../../DocService/sources/DocsCoServer', () => ({
  c_oAscServerStatus: {
    MustSave: 2,
    Corrupted: 3,
    MustSaveForce: 6,
    CorruptedForce: 7
  },
  editorData: {
    cleanDocumentOnExit: jestApi.fn().mockResolvedValue(undefined),
    getForceSave: jestApi.fn().mockResolvedValue(null),
    getdelSaved: jestApi.fn().mockResolvedValue(null)
  },
  editorStat: {
    addShutdown: jestApi.fn().mockResolvedValue(undefined),
    removeShutdown: jestApi.fn().mockResolvedValue(undefined)
  },
  getEditorsCountPromise: jestApi.fn().mockResolvedValue(0),
  sendServerRequest: jestApi.fn().mockResolvedValue('{"error":1,"descr":"save uri is empty"}'),
  parseReplyData: jestApi.fn((_ctx, value) => (value ? JSON.parse(value) : null)),
  cleanDocumentOnExitPromise: jestApi.fn().mockResolvedValue(undefined),
  cleanDocumentOnExitNoChangesPromise: jestApi.fn().mockResolvedValue(undefined),
  unlockWopiDoc: jestApi.fn().mockResolvedValue(undefined),
  getIsShutdown: jestApi.fn().mockReturnValue(false),
  getIsPreStop: jestApi.fn().mockReturnValue(false),
  getOpenFormatByEditor: jestApi.fn().mockReturnValue(1),
  publish: jestApi.fn().mockResolvedValue(undefined),
  addDelayed: jestApi.fn(function* () {}),
  addTask: jestApi.fn(function* () {}),
  setForceSave: jestApi.fn(function* () {}),
  sendData: jestApi.fn()
}));

jestApi.mock('../../DocService/sources/wopiClient', () => ({
  parseWopiCallback: jestApi.fn().mockReturnValue(null)
}));

jestApi.mock('../../Common/sources/storage/storage-base', () => ({
  copyObject: jestApi.fn(),
  deletePath: jestApi.fn(),
  getObject: jestApi.fn(),
  getSignedUrl: jestApi.fn(),
  getSignedUrls: jestApi.fn(),
  listObjects: jestApi.fn(),
  putObject: jestApi.fn()
}));

jestApi.mock('../../Common/sources/statsdclient', () => ({
  getClient: jestApi.fn().mockReturnValue(null)
}));

const canvasService = require('../../DocService/sources/canvasservice');
const documentRecovery = require('../../DocService/sources/documentRecovery');
const taskResult = require('../../DocService/sources/taskresult');
const docsCoServer = require('../../DocService/sources/DocsCoServer');
const storage = require('../../Common/sources/storage/storage-base');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');

const DOC_ID = 'bug-81576';
const SAVE_TOKEN = 1234;

let updateIfSpy;
let updateIfCalls;
const updateIfActual = taskResult.updateIf.bind(taskResult);

function makeContext() {
  return {
    tenant: 'default',
    getCfg: jestApi.fn((_key, fallback) => fallback),
    logger: {
      debug: jestApi.fn(),
      error: jestApi.fn(),
      info: jestApi.fn(),
      warn: jestApi.fn()
    }
  };
}

function snapshotTask(task) {
  return {
    key: task.key,
    status: task.status,
    statusInfo: task.statusInfo,
    tenant: task.tenant
  };
}

async function seedTask(ctx, status = commonDefines.FileStatus.SaveVersion, statusInfo = SAVE_TOKEN, changeId = 0) {
  const task = new taskResult.TaskResultData();
  task.tenant = ctx.tenant;
  task.key = DOC_ID;
  task.status = status;
  task.statusInfo = statusInfo;
  task.userIndex = 1;
  task.changeId = changeId;
  task.callback = 'http://callback';
  task.baseurl = 'http://docservice';
  await taskResult.upsert(ctx, task);
}

async function seedChange(ctx) {
  await taskResult.insertChangesPromise(ctx, [{change: 'change-1', time: new Date()}], DOC_ID, 0, {
    id: 'user-1',
    idOriginal: 'user-1',
    username: 'User One'
  });
}

function makeSfcCommand(statusInfo = constants.CONVERT_READ_FILE) {
  const cmd = new commonDefines.InputCommand();
  cmd.setDocId(DOC_ID);
  cmd.setSaveKey('-save');
  cmd.setOutputPath('output.docx');
  cmd.setUserId('user-1');
  cmd.setStatusInfo(statusInfo);
  cmd.setStatusInfoIn(SAVE_TOKEN);
  return cmd;
}

function makeOpenCommand(format = 'docx') {
  const cmd = new commonDefines.InputCommand();
  cmd.setCommand('open');
  cmd.setDocId(DOC_ID);
  cmd.setFormat(format);
  return cmd;
}

function makeConnection() {
  return {
    baseUrl: 'http://docservice',
    editorType: 0,
    encrypted: false,
    isCloseCoAuthoring: false,
    user: {view: false}
  };
}

beforeEach(() => {
  taskResult._resetForTests();
  updateIfCalls = [];
  updateIfSpy = jestApi.spyOn(taskResult, 'updateIf').mockImplementation((ctx, task, mask) => {
    updateIfCalls.push({mask: snapshotTask(mask), task: snapshotTask(task)});
    return updateIfActual(ctx, task, mask);
  });

  docsCoServer.sendServerRequest.mockResolvedValue('{"error":1,"descr":"save uri is empty"}');
  docsCoServer.getIsShutdown.mockReturnValue(false);
  storage.listObjects.mockResolvedValue([]);
  storage.getObject.mockResolvedValue(Buffer.from('{}'));
  storage.getSignedUrl.mockResolvedValue('http://docservice/output.docx');
  storage.getSignedUrls.mockResolvedValue({});
});

afterEach(() => {
  updateIfSpy.mockRestore();
});

describe('commandSfcCallback bug 81576 recovery', () => {
  test('persists UpdateVersion -> Ok with a recovery marker and preserves pending changes', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(updateIfCalls).toHaveLength(2);
    expect(updateIfCalls[0]).toMatchObject({
      mask: {status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN},
      task: {status: commonDefines.FileStatus.UpdateVersion}
    });
    expect(updateIfCalls[1]).toMatchObject({
      mask: {status: commonDefines.FileStatus.UpdateVersion},
      task: {status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED}
    });
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(docsCoServer.cleanDocumentOnExitPromise).not.toHaveBeenCalled();
  });

  test('keeps SaveVersion and pending changes while callback retry is scheduled', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.sendServerRequest.mockRejectedValue(new Error('temporary callback failure'));

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
    expect(row.status_info).toBe(SAVE_TOKEN);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(updateIfCalls[1]).toMatchObject({
      mask: {status: commonDefines.FileStatus.UpdateVersion},
      task: {status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN}
    });
    expect(docsCoServer.addDelayed).toHaveBeenCalledTimes(1);
  });

  test('releases a row that is already in UpdateVersion', async () => {
    const ctx = makeContext();
    const updateVersionInfo = Math.floor(Date.now() / 60000);
    await seedTask(ctx, commonDefines.FileStatus.UpdateVersion, updateVersionInfo);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(updateIfCalls).toEqual([
      expect.objectContaining({
        mask: expect.objectContaining({status: commonDefines.FileStatus.UpdateVersion, statusInfo: updateVersionInfo}),
        task: expect.objectContaining({status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED})
      })
    ]);
  });

  test('releases SaveVersion when an editor appeared before the failed assembly callback', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.getEditorsCountPromise.mockResolvedValueOnce(1);

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.sendServerRequest).not.toHaveBeenCalled();
    expect(updateIfCalls).toEqual([
      expect.objectContaining({
        mask: expect.objectContaining({status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN}),
        task: expect.objectContaining({status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED})
      })
    ]);
  });

  test('uses the exact recovery marker when assembly output is missing without an original converter code', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    storage.getSignedUrl.mockResolvedValue(undefined);

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(constants.NO_ERROR), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'commandSfcCallback release SaveVersion after assembly error without output: statusInfo = %d',
      constants.NO_ERROR
    );
  });

  test('treats callback ACK of Corrupted as notification, not as a successful save', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.sendServerRequest.mockResolvedValueOnce('{"error":0}');

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.cleanDocumentOnExitPromise).not.toHaveBeenCalled();
    expect(updateIfCalls).toHaveLength(2);
    expect(updateIfCalls[1]).toMatchObject({
      mask: {status: commonDefines.FileStatus.UpdateVersion},
      task: {status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED}
    });
    expect(docsCoServer.publish).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({docId: DOC_ID, success: false, type: commonDefines.c_oPublishType.updateVersion})
    );
  });
});

function makeForgottenCommand(statusInfo = constants.NO_ERROR, token = SAVE_TOKEN) {
  const cmd = makeSfcCommand(statusInfo);
  cmd.setStatusInfoIn(token);
  cmd.setSaveToForgotten(true);
  return cmd;
}

describe('commandSfcCallback saveToForgotten', () => {
  beforeEach(() => {
    storage.copyObject.mockResolvedValue(undefined);
    storage.deletePath.mockResolvedValue(undefined);
  });

  test('parks the output in forgotten without touching the callback, then removes the row and the changes', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(docsCoServer.sendServerRequest).not.toHaveBeenCalled();
    expect(storage.copyObject).toHaveBeenCalledWith(ctx, `${DOC_ID}-save/output.docx`, `${DOC_ID}/output.docx`, undefined, expect.any(String));
    expect(updateIfCalls[0]).toMatchObject({
      mask: {status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN},
      task: {status: commonDefines.FileStatus.SaveVersion}
    });
    expect(updateIfCalls[0].task.statusInfo).toBeGreaterThan(3600000);
    expect(await taskResult.select(ctx, DOC_ID)).toHaveLength(0);
    expect(storage.deletePath).toHaveBeenCalledWith(ctx, DOC_ID);
    expect(docsCoServer.unlockWopiDoc).toHaveBeenCalledTimes(1);
  });

  test('ignores a result whose token was replaced by a later recovery', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.SaveVersion, SAVE_TOKEN + 1);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(updateIfCalls).toHaveLength(0);
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
    expect(row.status_info).toBe(SAVE_TOKEN + 1);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.publish).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'commandSfcCallback saveToForgotten result ignored: status = %s',
      commonDefines.FileStatus.SaveVersion
    );
  });

  test('ignores a result after an editor took the row back', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.NO_ERROR);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(updateIfCalls).toHaveLength(0);
    expect(await taskResult.select(ctx, DOC_ID)).toHaveLength(1);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
  });

  test('releases the row with the marker and keeps the changes when the assembly failed', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(constants.CONVERT_READ_FILE), false, false);

    expect(storage.copyObject).not.toHaveBeenCalled();
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(updateIfCalls).toEqual([
      expect.objectContaining({
        mask: expect.objectContaining({status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN}),
        task: expect.objectContaining({status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED})
      })
    ]);
  });

  test('a failed forgotten copy keeps the row and the changes and releases the row with the marker', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    storage.copyObject.mockRejectedValue(new Error('storage down'));

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.deletePath).not.toHaveBeenCalled();
    expect(docsCoServer.editorData.cleanDocumentOnExit).not.toHaveBeenCalled();
    expect(docsCoServer.unlockWopiDoc).not.toHaveBeenCalled();
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith('storeForgotten failed, changes kept: release affectedRows=%d', 1);
  });

  test('a takeover during the copy leaves the new owner state untouched', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    // an editor opened mid-copy: auth flipped SaveVersion back to Ok
    storage.copyObject.mockImplementation(async () => {
      const takeover = new taskResult.TaskResultData();
      takeover.tenant = ctx.tenant;
      takeover.key = DOC_ID;
      takeover.status = commonDefines.FileStatus.Ok;
      takeover.statusInfo = constants.NO_ERROR;
      await taskResult.update(ctx, takeover);
    });

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.deletePath).not.toHaveBeenCalled();
    expect(docsCoServer.editorData.cleanDocumentOnExit).not.toHaveBeenCalled();
    expect(docsCoServer.unlockWopiDoc).not.toHaveBeenCalled();
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.NO_ERROR);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
  });

  test('a rejected residue cleanup after a successful park only logs: the document is already parked', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.editorData.cleanDocumentOnExit.mockRejectedValueOnce(new Error('redis down'));

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.copyObject).toHaveBeenCalledTimes(1);
    expect(storage.deletePath).toHaveBeenCalledWith(ctx, DOC_ID);
    expect(docsCoServer.unlockWopiDoc).toHaveBeenCalledTimes(1);
    expect(await taskResult.select(ctx, DOC_ID)).toHaveLength(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('storeForgotten cleanup'), expect.stringContaining('redis down'));
    expect(ctx.logger.warn).not.toHaveBeenCalledWith('storeForgotten failed, changes kept: release affectedRows=%d', expect.anything());
  });

  test('a rejected WOPI unlock after a successful park only logs as well', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.unlockWopiDoc.mockRejectedValueOnce(new Error('wopi down'));

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.deletePath).toHaveBeenCalledWith(ctx, DOC_ID);
    expect(await taskResult.select(ctx, DOC_ID)).toHaveLength(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('storeForgotten cleanup'), expect.stringContaining('wopi down'));
  });

  test('a failed forgotten copy on the regular empty-callback path also keeps the changes', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    storage.copyObject.mockRejectedValue(new Error('storage down'));
    const cmd = makeSfcCommand(constants.NO_ERROR);
    cmd.setUserId(undefined);

    await canvasService.commandSfcCallback(ctx, cmd, false, false);

    expect(docsCoServer.sendServerRequest).not.toHaveBeenCalled();
    expect(storage.deletePath).not.toHaveBeenCalled();
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
  });

  test('an EDITOR_CHANGES result stays silent: no callback, no cleanup, row released with the marker', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.getIsShutdown.mockReturnValue(true);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(constants.EDITOR_CHANGES), false, false);

    expect(docsCoServer.sendServerRequest).not.toHaveBeenCalled();
    expect(docsCoServer.cleanDocumentOnExitNoChangesPromise).not.toHaveBeenCalled();
    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(docsCoServer.editorStat.removeShutdown).not.toHaveBeenCalled();
    expect(updateIfCalls).toEqual([
      expect.objectContaining({
        mask: expect.objectContaining({status: commonDefines.FileStatus.SaveVersion, statusInfo: SAVE_TOKEN}),
        task: expect.objectContaining({status: commonDefines.FileStatus.Ok, statusInfo: constants.FILE_NOT_ASSEMBLED})
      })
    ]);
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
  });

  test('a recovery result leaves the shutdown set alone even under the shutdown flag', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.getIsShutdown.mockReturnValue(true);

    await canvasService.commandSfcCallback(ctx, makeForgottenCommand(), false, false);

    expect(storage.copyObject).toHaveBeenCalledTimes(1);
    expect(docsCoServer.editorStat.removeShutdown).not.toHaveBeenCalled();
  });

  test('a regular result under the shutdown flag still removes its member', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    await seedChange(ctx);
    docsCoServer.getIsShutdown.mockReturnValue(true);

    await canvasService.commandSfcCallback(ctx, makeSfcCommand(), false, false);

    expect(docsCoServer.editorStat.removeShutdown).toHaveBeenCalledWith(expect.any(String), DOC_ID);
  });

  test('the flag survives only the trusted queue copy of the command', () => {
    const data = {id: DOC_ID, saveToForgotten: true};
    expect(new commonDefines.InputCommand(data).getSaveToForgotten()).toBeUndefined();
    expect(new commonDefines.InputCommand(data, true).getSaveToForgotten()).toBe(true);
    expect(new commonDefines.TaskQueueData({cmd: data}).getCmd().getSaveToForgotten()).toBe(true);
  });
});

describe('saveFromChanges saveToForgotten', () => {
  const wopiClient = require('../../DocService/sources/wopiClient');

  function enqueuedCmd() {
    const calls = docsCoServer.addTask.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1][0].getCmd() : null;
  }

  test('a forgotten-only task carries neither WOPI params nor a shutdown-set member', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    docsCoServer.getIsShutdown.mockReturnValue(true);

    const res = await canvasService.saveFromChanges(ctx, DOC_ID, SAVE_TOKEN, {saveToForgotten: true});

    expect(res).toBe(true);
    expect(wopiClient.parseWopiCallback).not.toHaveBeenCalled();
    expect(enqueuedCmd().getWopiParams()).toBeUndefined();
    expect(enqueuedCmd().getSaveToForgotten()).toBe(true);
    expect(enqueuedCmd().getStatusInfoIn()).toBe(SAVE_TOKEN);
    expect(docsCoServer.editorStat.addShutdown).not.toHaveBeenCalled();
  });

  test('a regular task keeps its WOPI params and its shutdown-set member', async () => {
    const ctx = makeContext();
    await seedTask(ctx);
    docsCoServer.getIsShutdown.mockReturnValue(true);
    const wopiParams = {userAuth: {wopiSrc: 'http://wopi'}};
    wopiClient.parseWopiCallback.mockReturnValueOnce(wopiParams);

    const res = await canvasService.saveFromChanges(ctx, DOC_ID, SAVE_TOKEN);

    expect(res).toBe(true);
    expect(enqueuedCmd().getWopiParams()).toBe(wopiParams);
    expect(enqueuedCmd().getSaveToForgotten()).toBeUndefined();
    expect(docsCoServer.editorStat.addShutdown).toHaveBeenCalledWith(expect.any(String), DOC_ID);
  });
});

describe('open cache validation after assembly recovery', () => {
  test('reuses Editor.bin and keeps the recovery marker for the next open', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.FILE_NOT_ASSEMBLED);
    await seedChange(ctx);
    storage.getSignedUrls.mockResolvedValue({'Editor.bin': 'http://docservice/Editor.bin'});

    await canvasService.openDocument(ctx, makeConnection(), makeOpenCommand(), {isInsert: false}, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    // The marker is not consumed on open: the warning is re-sent on every open (in endAuth).
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.addTask).not.toHaveBeenCalled();
  });

  test('rebuilds a missing cache and clears the marker via the None transition', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.FILE_NOT_ASSEMBLED);
    await seedChange(ctx);
    // Empty cache (only DB changes remain) triggers reconvert via the Object.keys length===0 check.
    storage.getSignedUrls.mockResolvedValue({});

    await canvasService.openDocument(ctx, makeConnection(), makeOpenCommand(), {isInsert: false}, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.WaitQueue);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.addTask).toHaveBeenCalledTimes(1);
  });

  test('reuses Editor.bin without scheduling a new conversion', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.NO_ERROR);
    await seedChange(ctx);
    storage.getSignedUrls.mockResolvedValue({
      'Editor.bin': 'http://docservice/Editor.bin',
      'media/image1.png': 'http://docservice/media/image1.png'
    });

    await canvasService.openDocument(ctx, makeConnection(), makeOpenCommand(), {isInsert: false}, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.addTask).not.toHaveBeenCalled();
    expect(docsCoServer.sendData).toHaveBeenCalledTimes(1);
  });

  test('does not reset DB status when listing cached files fails', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.NO_ERROR);
    await seedChange(ctx);
    storage.getSignedUrls.mockRejectedValue(new Error('storage unavailable'));

    await canvasService.openDocument(ctx, makeConnection(), makeOpenCommand(), {isInsert: false}, false);

    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(await taskResult.getChangesPromise(ctx, DOC_ID)).toHaveLength(1);
    expect(docsCoServer.addTask).not.toHaveBeenCalled();
  });
});

describe('document recovery marker', () => {
  test('isAssemblyRecovery matches only Ok + FILE_NOT_ASSEMBLED', () => {
    expect(documentRecovery.isAssemblyRecovery({status: commonDefines.FileStatus.Ok, status_info: constants.FILE_NOT_ASSEMBLED})).toBe(true);
    // An unrelated negative status_info must not be treated as the marker.
    expect(documentRecovery.isAssemblyRecovery({status: commonDefines.FileStatus.Ok, status_info: constants.CONVERT_READ_FILE})).toBe(false);
    expect(documentRecovery.isAssemblyRecovery({status: commonDefines.FileStatus.Ok, status_info: constants.NO_ERROR})).toBe(false);
    expect(documentRecovery.isAssemblyRecovery({status: commonDefines.FileStatus.SaveVersion, status_info: constants.FILE_NOT_ASSEMBLED})).toBe(
      false
    );
    expect(documentRecovery.isAssemblyRecovery(undefined)).toBe(false);
  });
});

function makeForceSaveCommand(type) {
  const cmd = new commonDefines.InputCommand();
  cmd.setDocId(DOC_ID);
  cmd.setSaveKey('-save');
  cmd.setOutputPath('output.pdf');
  cmd.setUserId('user-1');
  cmd.setUserIndex(1);
  cmd.setStatusInfo(constants.NO_ERROR);
  cmd.setStatusInfoIn(SAVE_TOKEN);
  const forceSave = new commonDefines.CForceSaveData();
  forceSave.setType(type);
  forceSave.setTime(1700000000000);
  forceSave.setIndex(0);
  forceSave.setAuthorUserId('user-1');
  forceSave.setAuthorUserIndex(1);
  cmd.setForceSave(forceSave);
  return cmd;
}

function lastCallbackData() {
  const calls = docsCoServer.sendServerRequest.mock.calls;
  return calls.length > 0 ? calls[calls.length - 1][2] : null;
}

function debugMessages(ctx) {
  return ctx.logger.debug.mock.calls.map(args => args[0]);
}

describe('forcesave callback delivery after final save', () => {
  test.each([commonDefines.FileStatus.SaveVersion, commonDefines.FileStatus.UpdateVersion])(
    'delivers a form submit while the document is in status %i',
    async status => {
      const ctx = makeContext();
      await seedTask(ctx, status);
      docsCoServer.sendServerRequest.mockResolvedValue('{"error":0}');

      await canvasService.commandSfcCallback(ctx, makeForceSaveCommand(commonDefines.c_oAscForceSaveTypes.Form), true, false);

      const outputSfc = lastCallbackData();
      expect(outputSfc).not.toBeNull();
      expect(outputSfc.getForceSaveType()).toBe(commonDefines.c_oAscForceSaveTypes.Form);
      expect(outputSfc.getStatus()).toBe(docsCoServer.c_oAscServerStatus.MustSaveForce);
      expect(debugMessages(ctx)).toContain('commandSfcCallback form submit after final save: status = %d');
    }
  );

  test('delivers a form submit in status Ok without the after-final-save marker', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.NO_ERROR);
    docsCoServer.sendServerRequest.mockResolvedValue('{"error":0}');

    await canvasService.commandSfcCallback(ctx, makeForceSaveCommand(commonDefines.c_oAscForceSaveTypes.Form), true, false);

    expect(lastCallbackData().getForceSaveType()).toBe(commonDefines.c_oAscForceSaveTypes.Form);
    expect(debugMessages(ctx)).not.toContain('commandSfcCallback form submit after final save: status = %d');
  });

  test.each([commonDefines.c_oAscForceSaveTypes.Button, commonDefines.c_oAscForceSaveTypes.Timeout])(
    'keeps dropping forcesave type %i after final save',
    async type => {
      const ctx = makeContext();
      await seedTask(ctx, commonDefines.FileStatus.SaveVersion);
      docsCoServer.sendServerRequest.mockResolvedValue('{"error":0}');

      await canvasService.commandSfcCallback(ctx, makeForceSaveCommand(type), true, false);

      expect(docsCoServer.sendServerRequest).not.toHaveBeenCalled();
      expect(debugMessages(ctx)).toContain('commandSfcCallback skip forcesave after final save: type = %d; status = %s');
    }
  );

  test('delivers a button forcesave while the document is still open', async () => {
    const ctx = makeContext();
    await seedTask(ctx, commonDefines.FileStatus.Ok, constants.NO_ERROR);
    docsCoServer.sendServerRequest.mockResolvedValue('{"error":0}');

    await canvasService.commandSfcCallback(ctx, makeForceSaveCommand(commonDefines.c_oAscForceSaveTypes.Button), true, false);

    expect(lastCallbackData().getForceSaveType()).toBe(commonDefines.c_oAscForceSaveTypes.Button);
  });
});
