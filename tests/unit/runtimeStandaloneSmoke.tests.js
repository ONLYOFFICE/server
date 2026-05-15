/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Smoke tests for the standalone memory runtime.
 *
 * Covers:
 *   - profile.js OS guard and memory-normalisation (queue OR sql memory → standalone)
 *   - memory guards in taskqueueRabbitMQ, pubsubRabbitMQ, baseConnector, taskresult
 *   - inproc task queue and local pubsub behaviour
 *   - embedded converter start/stop
 *
 * Tests that require isolated module registries use jest.isolateModules + doMock
 * to control config/license independently of the NODE_ENV overlay.
 */

'use strict';

const {describe, beforeEach, afterEach, test, expect, jest: jestGlobals} = require('@jest/globals');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

// logger.js reads log.filePath from config as a relative path that only
// resolves correctly when the cwd is a service subdirectory (e.g. DocService/).
// Stub it out so the compatibility-dispatcher tests do not fail on file I/O.
jestGlobals.mock('../../Common/sources/logger', () => {
  const noop = () => {};
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    shutdown: _cb => _cb && _cb(),
    configureLogger: noop,
    getLogger: () => ({trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, addContext: noop}),
    getLoggerConfig: () => ({}),
    getInitialLoggerConfig: () => ({})
  };
});

const InprocTaskQueueClass = require('../../Common/sources/taskqueueMemory');
const LocalPubSubClass = require('../../DocService/sources/pubsubMemory');

const ctx = {
  tenant: 'tenant-default',
  logger: {debug() {}, info() {}, warn() {}, error() {}}
};

// Config mock factory: returns a Proxy that overrides specific config keys while
// forwarding all other accesses (get, has, util, …) to the real config module.
// Needed because connector files read config.get() directly at module-load time.
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

describe('Standalone runtime smoke (memory profile)', () => {
  beforeEach(() => {
    InprocTaskQueueClass._resetBackendForTests();
    LocalPubSubClass._resetBackendForTests();
  });

  test('taskqueueRabbitMQ routes to InprocTaskQueue when queue.type=memory', () => {
    // queue.type=memory in default.json — memory guard fires at require time.
    const Resolved = require('../../Common/sources/taskqueueRabbitMQ');
    const instance = new Resolved();
    expect(instance).toBeInstanceOf(InprocTaskQueueClass);
  });

  test('pubsubRabbitMQ routes to LocalPubSub when queue.type=memory', () => {
    const Resolved = require('../../DocService/sources/pubsubRabbitMQ');
    const instance = new Resolved();
    expect(instance).toBeInstanceOf(LocalPubSubClass);
  });

  test('baseConnector change/task helpers are routed to in-memory stores', async () => {
    // baseConnector reads profile at module load time; doMock config to force
    // memory mode regardless of the development-*.json overlay (sql.type=mysql).
    let sqlBase, memConn;
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('config', () => makeConfigMock({'services.CoAuthoring.sql.type': 'memory'}));
      memConn = require('../../DocService/sources/databaseConnectors/memoryConnector');
      memConn._resetForTests();
      sqlBase = require('../../DocService/sources/databaseConnectors/baseConnector');
    });

    // change store path
    await sqlBase.insertChangesPromise(ctx, [{change: 'c0', time: new Date()}], 'doc-smoke', 0, {id: 'u', idOriginal: 'u', username: 'u'});
    const idx = await sqlBase.getChangesIndexPromise(ctx, 'doc-smoke');
    expect(idx).toEqual([{change_id: 0}]);

    // task_result path
    await sqlBase.upsert(ctx, {tenant: 'tenant-default', key: 'doc-smoke'});
    expect(await sqlBase.getCountWithStatus(ctx, 0, 60000)).toBe(1);

    // healthCheck must not require an SQL pool
    expect(await sqlBase.healthCheck(ctx)).toBe(true);
  });

  test('taskresult routes select/update/upsert to memory store', async () => {
    let taskResult, memConn;
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('config', () => makeConfigMock({'services.CoAuthoring.sql.type': 'memory'}));
      memConn = require('../../DocService/sources/databaseConnectors/memoryConnector');
      memConn._resetForTests();
      taskResult = require('../../DocService/sources/taskresult');
    });

    await taskResult.upsert(ctx, {tenant: 'tenant-default', key: 'doc-tr'});
    const rows = await taskResult.select(ctx, 'doc-tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('doc-tr');
  });

  test('DocsCoServer-style producer and converter-style consumer share inproc backend', async () => {
    const InprocTaskQueue = InprocTaskQueueClass;

    const producer = new InprocTaskQueue();
    const consumer = new InprocTaskQueue();

    consumer.on('task', async (data, ack) => {
      const payload = JSON.parse(data);
      await consumer.addResponse({echo: payload.hello});
      ack();
    });

    await consumer.initPromise(true, true, true, false, false, false);
    await producer.initPromise(true, true, false, true, true, true);

    const responseReceived = new Promise(resolve => {
      producer.on('response', (data, ack) => {
        ack();
        resolve(JSON.parse(data));
      });
    });

    await producer.addTask({hello: 'world', setVisibilityTimeout() {}}, 0);

    expect(await responseReceived).toEqual({echo: 'world'});

    await producer.close();
    await consumer.close();
  });

  test('LocalPubSub broadcasts messages between sibling DocService nodes', async () => {
    const a = new LocalPubSubClass();
    const b = new LocalPubSubClass();

    await a.initPromise();
    await b.initPromise();

    const onA = new Promise(resolve => a.once('message', resolve));
    const onB = new Promise(resolve => b.once('message', resolve));

    await a.publish('shutdown');

    expect(await onA).toBe('shutdown');
    expect(await onB).toBe('shutdown');

    await a.close();
    await b.close();
  });
});

describe('Memory persistence startup (sql.type=memory)', () => {
  test('memory mode boots without SQL connector initialization (no pool required)', async () => {
    let sqlBase;
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('config', () => makeConfigMock({'services.CoAuthoring.sql.type': 'memory'}));
      sqlBase = require('../../DocService/sources/databaseConnectors/baseConnector');
    });
    expect(await sqlBase.healthCheck(ctx)).toBe(true);
  });

  test('getTableColumns returns synthetic schema for task_result and doc_changes in memory mode', async () => {
    let sqlBase;
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('config', () => makeConfigMock({'services.CoAuthoring.sql.type': 'memory'}));
      sqlBase = require('../../DocService/sources/databaseConnectors/baseConnector');
    });

    const trCols = await sqlBase.getTableColumns(ctx, 'task_result');
    expect(trCols.length).toBeGreaterThan(0);
    expect(trCols[0]).toHaveProperty('column_name');

    const dcCols = await sqlBase.getTableColumns(ctx, 'doc_changes');
    expect(dcCols.length).toBeGreaterThan(0);

    // Unknown tables return empty array, not an error.
    const unknownCols = await sqlBase.getTableColumns(ctx, 'nonexistent_table');
    expect(unknownCols).toEqual([]);
  });
});

describe('OS-package guard (profile.js)', () => {
  function loadProfile(packageType, configOverrides = {}) {
    let profile;
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('../../Common/sources/license', () => ({packageType}));
      jestGlobals.doMock('config', () => makeConfigMock(configOverrides));
      profile = require('../../Common/sources/runtime/profile');
    });
    return profile;
  }

  test('OS package returns isMemoryRuntime()=true regardless of config', () => {
    const profile = loadProfile(0, {'queue.type': 'rabbitmq', 'services.CoAuthoring.sql.type': 'postgres'});
    expect(profile.isMemoryRuntime()).toBe(true);
  });

  test('non-OS package with queue.type=memory returns isMemoryRuntime()=true', () => {
    const profile = loadProfile(1, {'queue.type': 'memory', 'services.CoAuthoring.sql.type': 'postgres'});
    expect(profile.isMemoryRuntime()).toBe(true);
  });

  test('non-OS package with sql.type=memory returns isMemoryRuntime()=true', () => {
    const profile = loadProfile(1, {'queue.type': 'rabbitmq', 'services.CoAuthoring.sql.type': 'memory'});
    expect(profile.isMemoryRuntime()).toBe(true);
  });

  test('non-OS package with broker config returns isMemoryRuntime()=false', () => {
    const profile = loadProfile(1, {'queue.type': 'rabbitmq', 'services.CoAuthoring.sql.type': 'postgres'});
    expect(profile.isMemoryRuntime()).toBe(false);
  });
});

describe('OS-package guard - memory guard routing in original files', () => {
  // Proves that the if/else guards in taskqueueRabbitMQ, pubsubRabbitMQ,
  // baseConnector, and taskresult route to memory implementations when
  // isMemoryRuntime() is true, without loading broker/SQL code.

  const ENTERPRISE_CONFIG_OVERRIDES = {
    'queue.type': 'rabbitmq',
    'services.CoAuthoring.sql.type': 'postgres'
  };

  test('OS package forces all connectors to memory/local despite Enterprise config overrides', async () => {
    let TaskQueueImpl, PubSubImpl, dbConnector, taskResultMod;
    let InprocTQ, LocalPS;

    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('../../Common/sources/license', () => ({packageType: 0}));
      jestGlobals.doMock('config', () => makeConfigMock(ENTERPRISE_CONFIG_OVERRIDES));

      // Capture the in-process classes from within this isolated registry so
      // instanceof comparisons use the same constructor references.
      InprocTQ = require('../../Common/sources/taskqueueMemory');
      LocalPS = require('../../DocService/sources/pubsubMemory');
      InprocTQ._resetBackendForTests();
      LocalPS._resetBackendForTests();

      TaskQueueImpl = require('../../Common/sources/taskqueueRabbitMQ');
      PubSubImpl = require('../../DocService/sources/pubsubRabbitMQ');
      dbConnector = require('../../DocService/sources/databaseConnectors/baseConnector');
      taskResultMod = require('../../DocService/sources/taskresult');
    });

    // taskqueue -> InprocTaskQueue (memory guard fired)
    expect(TaskQueueImpl).toBe(InprocTQ);

    // pubsub -> LocalPubSub (memory guard fired)
    expect(PubSubImpl).toBe(LocalPS);

    // db -> memory store: healthCheck resolves without a SQL pool
    expect(await dbConnector.healthCheck(ctx)).toBe(true);

    // taskresult -> memory store: upsert+select work without a DB connection
    await taskResultMod.upsert(ctx, {tenant: 'tenant-default', key: 'os-guard-test'});
    const rows = await taskResultMod.select(ctx, 'os-guard-test');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('os-guard-test');
  });
});

describe('convertermaster startup', () => {
  // convertermaster.js executes top-level code on require.
  // Config is pre-captured OUTSIDE isolateModules so moduleReloader can
  // return the already-initialised instance.

  const realConfig = require('config');

  function loadConvertermaster(isMemory) {
    const exitSpy = jestGlobals.spyOn(process, 'exit').mockImplementation(() => {});
    const forkSpy = jestGlobals.fn();
    const warnMessages = [];

    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('../../Common/sources/runtime/profile', () => ({
        isMemoryRuntime: () => isMemory,
        resetCache: () => {}
      }));
      jestGlobals.doMock('cluster', () => ({
        isMaster: true,
        workers: {},
        on: () => {},
        fork: forkSpy
      }));
      jestGlobals.doMock('../../Common/sources/moduleReloader', () => ({
        requireConfigWithRuntime: () => realConfig,
        finalizeConfigWithRuntime: () => {}
      }));
      jestGlobals.doMock('../../Common/sources/operationContext', () => ({
        global: {logger: {warn: (...args) => warnMessages.push(args[0]), error: () => {}, info: () => {}}}
      }));
      jestGlobals.doMock('../../Common/sources/runtimeConfigManager', () => ({
        initRuntimeConfigWatcher: () => Promise.resolve()
      }));
      jestGlobals.doMock('../../Common/sources/license', () => ({
        readLicense: () => Promise.resolve([{count: 4}]),
        packageType: 0
      }));

      require('../../FileConverter/sources/convertermaster');
    });

    return {exitSpy, forkSpy, warnMessages};
  }

  afterEach(() => {
    jestGlobals.restoreAllMocks();
  });

  test('broker mode: fork is eventually called', async () => {
    const {exitSpy, forkSpy} = loadConvertermaster(false);
    await new Promise(r => setImmediate(r));
    expect(exitSpy).not.toHaveBeenCalled();
    expect(forkSpy).toHaveBeenCalled();
  });

  test('memory mode: no fork, no exit, logs idle warning', async () => {
    const {exitSpy, forkSpy, warnMessages} = loadConvertermaster(true);
    await new Promise(r => setImmediate(r));
    expect(exitSpy).not.toHaveBeenCalled();
    expect(forkSpy).not.toHaveBeenCalled();
    expect(warnMessages.some(m => m.includes('memory runtime'))).toBe(true);
  });
});

describe('Embedded converter (profile-derived mode)', () => {
  let embeddedConverter;

  afterEach(async () => {
    if (embeddedConverter) {
      await embeddedConverter.stop();
      embeddedConverter = null;
    }
  });

  test('broker mode: start() is a no-op and FileConverter is not required', async () => {
    jestGlobals.isolateModules(() => {
      jestGlobals.doMock('../../Common/sources/runtime/profile', () => ({
        isMemoryRuntime: () => false,
        resetCache: () => {}
      }));
      // Should not throw even though FileConverter is not available in this context.
      embeddedConverter = require('../../DocService/sources/embeddedConverter');
    });

    await embeddedConverter.start();
    expect(embeddedConverter.isStarted()).toBe(false);
  });
});
