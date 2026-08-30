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

const taskResult = require('../../DocService/sources/taskresult');
const canvasService = require('../../DocService/sources/canvasservice');
const commonDefines = require('../../Common/sources/commondefines');
const constants = require('../../Common/sources/constants');

const DOC_ID = 'recovery-claim';

function makeContext() {
  return {
    tenant: 'default',
    docId: DOC_ID,
    userId: undefined,
    getCfg: jestApi.fn((_key, fallback) => fallback),
    logger: {
      debug: jestApi.fn(),
      error: jestApi.fn(),
      info: jestApi.fn(),
      warn: jestApi.fn()
    }
  };
}

async function seedRow(ctx, status, statusInfo) {
  const task = new taskResult.TaskResultData();
  task.tenant = ctx.tenant;
  task.key = DOC_ID;
  task.status = status;
  task.statusInfo = statusInfo;
  await taskResult.upsert(ctx, task);
}

let saveFromChangesSpy;

beforeEach(() => {
  taskResult._resetForTests();
  saveFromChangesSpy = jestApi.spyOn(canvasService, 'saveFromChanges').mockResolvedValue(true);
});

afterEach(() => {
  saveFromChangesSpy.mockRestore();
});

describe('saveChangesToForgotten', () => {
  test('claims an Ok row with the observed pair as the mask and enqueues a forgotten-only assembly', async () => {
    const ctx = makeContext();
    await seedRow(ctx, commonDefines.FileStatus.Ok, constants.FILE_NOT_ASSEMBLED);

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.Ok, constants.FILE_NOT_ASSEMBLED, 'queue');

    expect(claimed).toBe('claimed');
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
    expect(row.status_info).toBeGreaterThanOrEqual(0);
    expect(row.status_info).toBeLessThan(3600001);
    expect(saveFromChangesSpy).toHaveBeenCalledWith(ctx, DOC_ID, row.status_info, {queue: 'queue', saveToForgotten: true});
  });

  test('takes over a stale SaveVersion row only with its exact token and never reuses that token', async () => {
    const ctx = makeContext();
    const oldToken = 1234;
    await seedRow(ctx, commonDefines.FileStatus.SaveVersion, oldToken);

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.SaveVersion, oldToken, undefined);

    expect(claimed).toBe('claimed');
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
    expect(row.status_info).not.toBe(oldToken);
  });

  test('a row whose pair changed after enumeration is left alone', async () => {
    const ctx = makeContext();
    await seedRow(ctx, commonDefines.FileStatus.SaveVersion, 99);

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.Ok, 0, undefined);

    expect(claimed).toBe('missed');
    expect(saveFromChangesSpy).not.toHaveBeenCalled();
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.SaveVersion);
    expect(row.status_info).toBe(99);
    expect(ctx.logger.debug).toHaveBeenCalledWith('saveChangesToForgotten updateIf no effect: %s', DOC_ID);
  });

  test('a row that vanished before the CAS is reported as not claimed', async () => {
    const ctx = makeContext();

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.Ok, 0, undefined);

    expect(claimed).toBe('missed');
    expect(saveFromChangesSpy).not.toHaveBeenCalled();
  });

  test('a failed enqueue releases the claim with the marker so the next run can retry', async () => {
    const ctx = makeContext();
    await seedRow(ctx, commonDefines.FileStatus.Ok, 0);
    saveFromChangesSpy.mockResolvedValue(false);

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.Ok, 0, undefined);

    expect(claimed).toBe('enqueueFailed');
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.FILE_NOT_ASSEMBLED);
    expect(ctx.logger.warn).toHaveBeenCalledWith('saveChangesToForgotten enqueue failed, changes kept: release affectedRows=%d', 1);
  });

  test('a rollback miss after a failed enqueue counts as missed, not as a queue failure', async () => {
    const ctx = makeContext();
    await seedRow(ctx, commonDefines.FileStatus.Ok, 0);
    saveFromChangesSpy.mockImplementation(async () => {
      const takeover = new taskResult.TaskResultData();
      takeover.tenant = ctx.tenant;
      takeover.key = DOC_ID;
      takeover.status = commonDefines.FileStatus.Ok;
      takeover.statusInfo = constants.NO_ERROR;
      await taskResult.update(ctx, takeover);
      return false;
    });

    const claimed = await canvasService.saveChangesToForgotten(ctx, DOC_ID, commonDefines.FileStatus.Ok, 0, undefined);

    expect(claimed).toBe('missed');
    const [row] = await taskResult.select(ctx, DOC_ID);
    expect(row.status).toBe(commonDefines.FileStatus.Ok);
    expect(row.status_info).toBe(constants.NO_ERROR);
    expect(ctx.logger.warn).toHaveBeenCalledWith('saveChangesToForgotten enqueue failed but the row was already taken over: %s', DOC_ID);
  });
});
