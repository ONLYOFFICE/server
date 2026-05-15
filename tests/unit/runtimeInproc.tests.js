/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Smoke tests for the in-process task queue and local pubsub backends used
 * by the public/community standalone runtime.
 */

'use strict';

const {describe, beforeEach, test, expect} = require('@jest/globals');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const InprocTaskQueue = require('../../Common/sources/taskqueueMemory');
const LocalPubSub = require('../../DocService/sources/pubsubMemory');

describe('InprocTaskQueue', () => {
  beforeEach(() => {
    InprocTaskQueue._resetBackendForTests();
  });

  test('shared backend delivers task from one handle to a different handle', async () => {
    const producer = new InprocTaskQueue();
    const consumer = new InprocTaskQueue();
    await producer.initPromise(true, true, false, false, false, false);
    await consumer.initPromise(false, false, true, false, false, false);

    const received = new Promise(resolve => {
      consumer.on('task', (data, ack) => {
        ack();
        resolve(data);
      });
    });

    const fakeTask = {hello: 'world', setVisibilityTimeout() {}};
    await producer.addTask(fakeTask, 0);

    const data = await received;
    expect(JSON.parse(data)).toEqual({hello: 'world'});

    await producer.close();
    await consumer.close();
  });

  test('addResponse fan-outs to response receiver in another handle', async () => {
    const responder = new InprocTaskQueue();
    const responseConsumer = new InprocTaskQueue();
    await responder.initPromise(false, true, false, false, false, false);
    await responseConsumer.initPromise(false, false, false, true, false, false);

    const received = new Promise(resolve => {
      responseConsumer.on('response', (data, ack) => {
        ack();
        resolve(data);
      });
    });

    await responder.addResponse({status: 'done'});

    const data = await received;
    expect(JSON.parse(data)).toEqual({status: 'done'});

    await responder.close();
    await responseConsumer.close();
  });

  test('higher priority task is delivered before lower priority one', async () => {
    const producer = new InprocTaskQueue();
    const consumer = new InprocTaskQueue();
    await producer.initPromise(true, false, false, false, false, false);

    await producer.addTask({order: 'low', setVisibilityTimeout() {}}, 0);
    await producer.addTask({order: 'high', setVisibilityTimeout() {}}, 5);

    const received = [];
    await consumer.initPromise(false, false, true, false, false, false);
    await new Promise(resolve => {
      consumer.on('task', (data, ack) => {
        received.push(JSON.parse(data).order);
        ack();
        if (received.length === 2) resolve();
      });
    });

    expect(received).toEqual(['high', 'low']);

    await producer.close();
    await consumer.close();
  });

  test('addDelayed emits "dead" after ttl and does NOT deliver as "task"', async () => {
    const producer = new InprocTaskQueue();
    const deadReceiver = new InprocTaskQueue();
    await producer.initPromise(false, false, false, false, false, true);
    await deadReceiver.initPromise(false, false, false, false, true, false);

    const taskDeliveries = [];
    deadReceiver.on('task', (data, ack) => {
      taskDeliveries.push(data);
      ack();
    });

    const start = Date.now();
    const deadReceived = new Promise(resolve => {
      deadReceiver.on('dead', data => resolve({elapsed: Date.now() - start, data}));
    });

    await producer.addDelayed({hello: 'delayed'}, 50);

    const result = await deadReceived;
    expect(JSON.parse(result.data)).toEqual({hello: 'delayed'});
    expect(result.elapsed).toBeGreaterThanOrEqual(40);
    expect(taskDeliveries).toHaveLength(0);

    await producer.close();
    await deadReceiver.close();
  });

  test('healthCheck reflects open/closed state', async () => {
    const queue = new InprocTaskQueue();
    await queue.initPromise(true, false, false, false, false, false);
    expect(await queue.healthCheck()).toBe(true);
    await queue.close();
    expect(await queue.healthCheck()).toBe(false);
  });

  test('backpressure: second task not delivered before first ack, then delivered after', async () => {
    const producer = new InprocTaskQueue();
    const consumer = new InprocTaskQueue();
    await producer.initPromise(true, false, false, false, false, false);
    await consumer.initPromise(false, false, true, false, false, false);

    const delivered = [];
    let firstAck = null;

    consumer.on('task', (data, ack) => {
      delivered.push(JSON.parse(data).id);
      if (delivered.length === 1) {
        firstAck = ack; // hold - do not ack yet
      } else {
        ack();
      }
    });

    await producer.addTask({id: 1, setVisibilityTimeout() {}}, 0);
    await producer.addTask({id: 2, setVisibilityTimeout() {}}, 0);

    // One dispatch cycle - only the first task should arrive
    await new Promise(r => setImmediate(r));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toBe(1);
    expect(firstAck).not.toBeNull();

    // Release backpressure, wait for the second dispatch cycle
    firstAck();
    await new Promise(r => setImmediate(r));
    expect(delivered).toHaveLength(2);
    expect(delivered[1]).toBe(2);

    await producer.close();
    await consumer.close();
  });

  test('expiring queued task emits "dead" if not delivered before expiration', async () => {
    const producer = new InprocTaskQueue();
    const deadReceiver = new InprocTaskQueue();
    // No task receiver registered - task will sit in queue until the timer fires
    await producer.initPromise(true, false, false, false, false, false);
    await deadReceiver.initPromise(false, false, false, false, true, false);

    const deadReceived = new Promise(resolve => {
      deadReceiver.on('dead', data => resolve(JSON.parse(data)));
    });

    await producer.addTask({id: 'expiring', setVisibilityTimeout() {}}, 0, 50);

    const result = await deadReceived;
    expect(result.id).toBe('expiring');

    await producer.close();
    await deadReceiver.close();
  });
});

describe('LocalPubSub', () => {
  beforeEach(() => {
    LocalPubSub._resetBackendForTests();
  });

  test('publish broadcasts to multiple subscribers', async () => {
    const a = new LocalPubSub();
    const b = new LocalPubSub();
    const publisher = new LocalPubSub();

    await a.initPromise();
    await b.initPromise();
    await publisher.initPromise();

    const onA = new Promise(resolve => a.once('message', resolve));
    const onB = new Promise(resolve => b.once('message', resolve));

    await publisher.publish('hello');

    expect(await onA).toBe('hello');
    expect(await onB).toBe('hello');

    await a.close();
    await b.close();
    await publisher.close();
  });

  test('closed subscriber stops receiving messages', async () => {
    const sub = new LocalPubSub();
    const publisher = new LocalPubSub();
    await sub.initPromise();
    await publisher.initPromise();

    let received = 0;
    sub.on('message', () => received++);

    await publisher.publish('first');
    await new Promise(r => setImmediate(r));
    expect(received).toBe(1);

    await sub.close();
    await publisher.publish('second');
    await new Promise(r => setImmediate(r));
    expect(received).toBe(1);

    await publisher.close();
  });

  test('healthCheck reflects open/closed state', async () => {
    const pubsub = new LocalPubSub();
    await pubsub.initPromise();
    expect(await pubsub.healthCheck()).toBe(true);
    await pubsub.close();
    expect(await pubsub.healthCheck()).toBe(false);
  });
});
