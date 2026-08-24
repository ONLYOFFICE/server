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

/*
 * Unit tests for the receiveTaskSetTimeout timeout path in converter.js.
 *
 * Key invariant (both broker and embedded modes):
 *   After a task visibility timeout the converter calls queue.closeOrWait()
 *   and then process.exit(1) so the process is restarted by the supervisor.
 *   outParams.isAck is set to true before exit so the normal finally-block
 *   ack in receiveTask is skipped.
 */

'use strict';

const {describe, test, expect, beforeEach, afterEach, jest: jestGlobals} = require('@jest/globals');
const EventEmitter = require('events');

// logger.js reads log.filePath from config as a relative path that resolves
// correctly only when cwd is a service subdirectory.  Stub it out so the suite
// does not fail on file I/O when run from other working directories.
// (Same pattern as runtimeStandaloneSmoke.tests.js.)
jestGlobals.mock('../../Common/sources/logger', () => {
  const noop = () => {};
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    shutdown: cb => cb && cb(),
    configureLogger: noop,
    getLogger: () => ({trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, addContext: noop}),
    getLoggerConfig: () => ({}),
    getInitialLoggerConfig: () => ({})
  };
});

// Mock profile so profile-gated loaders (baseConnector, taskresult,
// taskqueueRabbitMQ) fall through to in-memory stubs, avoiding real
// service dependencies during module loading.
jestGlobals.mock('../../Common/sources/runtime/profile', () => ({
  isMemoryRuntime: jestGlobals.fn().mockReturnValue(true),
  resetCache: jestGlobals.fn()
}));

const co = require('co');
const utils = require('../../Common/sources/utils');
const commonDefines = require('../../Common/sources/commondefines');
const operationContext = require('../../Common/sources/operationContext');
const converter = require('../../FileConverter/sources/converter');

const DENIED_HOST = '127.0.0.2';

// Only an ipfilter rule naming the host lets a WOPI conversion reach a non-public address
function makeWopiCtx(rules) {
  const ctx = new operationContext.Context();
  ctx.config = {services: {CoAuthoring: {ipfilter: {rules, errorcode: 403}}}};
  return ctx;
}

// Minimal queue that satisfies the surface used by createRunner / ackTask.
class FakeQueue extends EventEmitter {
  addResponse() {
    return Promise.resolve();
  }
  closeOrWait() {
    return Promise.resolve();
  }
}

describe('receiveTaskSetTimeout', () => {
  let processExitSpy;
  let fakeCtx;
  let fakeAck;
  let fakeOutParams;
  let fakeQueue;

  beforeEach(() => {
    fakeQueue = new FakeQueue();
    // Wire the module-level `queue` inside converter.js.
    converter.createRunner(fakeQueue);

    processExitSpy = jestGlobals.spyOn(process, 'exit').mockImplementation(() => {});

    const noop = jestGlobals.fn();
    fakeCtx = {logger: {error: noop, info: noop, debug: noop, warn: noop}};
    // getCmd() returns undefined -> createErrorResponse throws inside ackTask's
    // try block; the catch handles it and ack() fires from finally regardless.
    fakeAck = jestGlobals.fn();
    fakeOutParams = {isAck: false};

    jestGlobals.useFakeTimers();
  });

  afterEach(() => {
    jestGlobals.useRealTimers();
    processExitSpy.mockRestore();
  });

  test('calls process.exit(1) after timeout', async () => {
    const fakeTask = {getVisibilityTimeout: () => 0, getCmd: jestGlobals.fn()};
    converter._receiveTaskSetTimeoutForTesting(fakeCtx, fakeTask, fakeAck, fakeOutParams);
    await jestGlobals.runAllTimersAsync();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  test('calls queue.closeOrWait() before process.exit', async () => {
    const closeOrWaitSpy = jestGlobals.spyOn(fakeQueue, 'closeOrWait');
    const fakeTask = {getVisibilityTimeout: () => 0, getCmd: jestGlobals.fn()};
    converter._receiveTaskSetTimeoutForTesting(fakeCtx, fakeTask, fakeAck, fakeOutParams);
    await jestGlobals.runAllTimersAsync();
    expect(closeOrWaitSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  test('sets outParams.isAck = true so the normal ack path is skipped', async () => {
    const fakeTask = {getVisibilityTimeout: () => 0, getCmd: jestGlobals.fn()};
    converter._receiveTaskSetTimeoutForTesting(fakeCtx, fakeTask, fakeAck, fakeOutParams);
    await jestGlobals.runAllTimersAsync();
    expect(fakeOutParams.isAck).toBe(true);
  });

  test('clears the timeout id when task completes normally (no exit)', async () => {
    // Returning a large visibility timeout means the timer would fire very late;
    // clearTimeout in receiveTask's finally should prevent it.
    const fakeTask = {getVisibilityTimeout: () => 9999, getCmd: jestGlobals.fn()};
    const id = converter._receiveTaskSetTimeoutForTesting(fakeCtx, fakeTask, fakeAck, fakeOutParams);
    // Clearing the id (as receiveTask does) must prevent process.exit.
    clearTimeout(id);
    await jestGlobals.runAllTimersAsync();
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});

describe('WOPI conversion download', () => {
  test('the download sink is reached only for a host the rules name, and never as a direct request', async () => {
    // Reject at the sink so the download fails fast before x2t is spawned; capture the args the production code passed.
    const spy = jestGlobals.spyOn(utils, 'downloadUrlPromise').mockRejectedValue(Object.assign(new Error('blocked'), {code: 'ETIMEDOUT'}));

    const ctx = makeWopiCtx([{address: DENIED_HOST, allowed: true}]);
    const fileUrl = `http://${DENIED_HOST}:1/file`;
    const cmd = new commonDefines.InputCommand();
    cmd.setDocId('wopi-download-allowed');
    cmd.setFormat('docx');
    cmd.setUrl(`http://${DENIED_HOST}:1/wopi`);
    cmd.setWithAuthorization(false);
    cmd.setWopiParams({
      commonInfo: {fileInfo: {FileUrl: fileUrl, Size: 100}},
      userAuth: {wopiSrc: `http://${DENIED_HOST}:1/wopi`, access_token: 'tok'}
    });
    const task = new commonDefines.TaskQueueData();
    task.setCtx(ctx);
    task.setCmd(cmd);
    task.setToFile('out.docx');

    try {
      await co(converter._ExecuteTaskForTesting(ctx, task));
    } catch (_err) {
      // Post-download handling is irrelevant here; the sink args are already captured.
    }

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe(fileUrl);
    expect(spy.mock.calls[0][2]).toEqual(expect.objectContaining({isInJwtToken: false, filterAllowIPs: [DENIED_HOST]}));
    spy.mockRestore();
  });

  test('a WOPI conversion to a non-public host no ipfilter rule names never reaches the download sink', async () => {
    const spy = jestGlobals.spyOn(utils, 'downloadUrlPromise').mockRejectedValue(Object.assign(new Error('blocked'), {code: 'ETIMEDOUT'}));

    const ctx = makeWopiCtx([{address: '*', allowed: true}]);
    const fileUrl = `http://${DENIED_HOST}:1/file`;
    const cmd = new commonDefines.InputCommand();
    cmd.setDocId('wopi-download-refused');
    cmd.setFormat('docx');
    cmd.setUrl(`http://${DENIED_HOST}:1/wopi`);
    cmd.setWithAuthorization(false);
    cmd.setWopiParams({
      commonInfo: {fileInfo: {FileUrl: fileUrl, Size: 100}},
      userAuth: {wopiSrc: `http://${DENIED_HOST}:1/wopi`, access_token: 'tok'}
    });
    const task = new commonDefines.TaskQueueData();
    task.setCtx(ctx);
    task.setCmd(cmd);
    task.setToFile('out.docx');

    try {
      await co(converter._ExecuteTaskForTesting(ctx, task));
    } catch (_err) {
      // the refusal happens before egress, so there is nothing to clean up here
    }

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
