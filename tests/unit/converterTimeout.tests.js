/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
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

const converter = require('../../FileConverter/sources/converter');

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
