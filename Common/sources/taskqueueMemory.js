/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * In-process task queue for the public/community standalone runtime.
 *
 * Implements the same surface as TaskQueueRabbitMQ (init/initPromise/addTask/
 * addResponse/addDelayed/close/closeOrWait/healthCheck + EventEmitter 'task'/
 * 'response'/'dead' events) using a module-level shared backend so multiple
 * `new InprocTaskQueue()` instances inside the same Node.js process see the
 * same logical queue.
 *
 * No persistence, no cross-process delivery, no broker reconnect logic.
 *
 * Backpressure contract: each registered task receiver may have at most one
 * in-flight task at a time.  The next task is dispatched only after the
 * receiver calls ack().
 *
 * addDelayed semantics: inproc has no redelivery path, so addDelayed(task, ttl)
 * emits "dead" after ttl ms rather than re-queuing the task as a normal task.
 *
 * addTask expiration: when opt_expiration > 0 the task is enqueued normally in
 * the priority queue, but if the expiration fires before the task is picked up,
 * the task is removed from the queue and "dead" is emitted.
 */

'use strict';

const events = require('events');
const config = require('config');

const cfgVisibilityTimeout = config.get('queue.visibilityTimeout');

/**
 * Shared in-process broker. One instance per Node.js process keeps task and
 * response delivery consistent across all queue handles.
 */
class InprocBackend {
  constructor() {
    /** @type {Array<{content: string, priority: number, headers: Object, expirationTimer: NodeJS.Timeout|null}>} */
    this.tasks = [];
    /** @type {Set<events.EventEmitter>} */
    this.taskReceivers = new Set();
    /** @type {Set<events.EventEmitter>} */
    this.responseReceivers = new Set();
    /** @type {Set<events.EventEmitter>} */
    this.deadReceivers = new Set();
    /** @type {Set<NodeJS.Timeout>} */
    this.delayedTimers = new Set();
    /** @type {Set<events.EventEmitter>} receivers currently processing a task */
    this.inFlight = new Set();
    this.closed = false;
    this.dispatching = false;
  }

  /**
   * Insert a task ordered by priority (higher first), FIFO inside same priority.
   * If expiration > 0 and the task is still in the queue when the timer fires,
   * it is removed and "dead" is emitted instead of being delivered.
   * @param {string} content
   * @param {number} priority
   * @param {Object} [headers]
   * @param {number} [expiration] ms before an undelivered task is expired
   */
  addTask(content, priority, headers, expiration) {
    const item = {
      content: String(content),
      priority: Number(priority) || 0,
      headers: headers || {},
      expirationTimer: null
    };
    let inserted = false;
    for (let i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i].priority < item.priority) {
        this.tasks.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.tasks.push(item);

    if (expiration && expiration > 0) {
      const timer = setTimeout(() => {
        const idx = this.tasks.indexOf(item);
        if (idx !== -1) {
          this.tasks.splice(idx, 1);
          this.emitDead(item.content);
        }
      }, expiration);
      if (typeof timer.unref === 'function') timer.unref();
      item.expirationTimer = timer;
    }

    this.scheduleDispatch();
  }

  /**
   * Schedule a dead-letter delivery after ttl milliseconds.
   * The delayed content is NOT re-queued as a task - "dead" is emitted instead.
   * (A real broker would re-deliver to the work queue; inproc has no redelivery path.)
   * @param {string} content
   * @param {number} ttl
   */
  addDelayed(content, ttl) {
    const data = String(content);
    const timer = setTimeout(
      () => {
        this.delayedTimers.delete(timer);
        if (!this.closed) this.emitDead(data);
      },
      Math.max(0, ttl)
    );
    if (typeof timer.unref === 'function') timer.unref();
    this.delayedTimers.add(timer);
  }

  /**
   * Deliver a response payload to all registered response receivers.
   * @param {string} content
   */
  addResponse(content) {
    const data = String(content);
    for (const receiver of this.responseReceivers) {
      receiver.emit('response', data, noop);
    }
  }

  /**
   * Deliver a dead-letter payload to all registered dead receivers.
   * @param {string} content
   */
  emitDead(content) {
    const data = String(content);
    for (const receiver of this.deadReceivers) {
      receiver.emit('dead', data, noop);
    }
  }

  registerTaskReceiver(queue) {
    this.taskReceivers.add(queue);
    this.scheduleDispatch();
  }
  registerResponseReceiver(queue) {
    this.responseReceivers.add(queue);
  }
  registerDeadReceiver(queue) {
    this.deadReceivers.add(queue);
  }
  unregister(queue) {
    this.taskReceivers.delete(queue);
    this.responseReceivers.delete(queue);
    this.deadReceivers.delete(queue);
    this.inFlight.delete(queue);
  }

  /**
   * Drain queued tasks to available receivers without re-entrancy.
   */
  scheduleDispatch() {
    if (this.dispatching || this.closed) return;
    if (this.tasks.length === 0 || this.taskReceivers.size === 0) return;
    this.dispatching = true;
    setImmediate(() => {
      this.dispatching = false;
      this.dispatch();
    });
  }

  /**
   * Deliver one task per free (non-in-flight) receiver.
   * A receiver is blocked from the next task until it calls ack().
   */
  dispatch() {
    for (const receiver of this.taskReceivers) {
      if (this.closed || this.tasks.length === 0) break;
      if (this.inFlight.has(receiver)) continue;
      if (receiver.listenerCount('task') === 0) continue;

      const item = this.tasks.shift();
      if (item.expirationTimer) {
        clearTimeout(item.expirationTimer);
        item.expirationTimer = null;
      }

      this.inFlight.add(receiver);
      let acked = false;
      const ack = () => {
        if (acked) return;
        acked = true;
        this.inFlight.delete(receiver);
        this.scheduleDispatch();
      };
      try {
        receiver.emit('task', item.content, ack);
      } catch (err) {
        ack();
        // rethrowing from a setImmediate callback becomes an uncaught exception - log and continue
        require('./operationContext').global.logger.error('InprocBackend dispatch error: %s', err.stack);
      }
    }
  }

  /**
   * Drop all state. Used when the last queue handle closes and tests need a
   * clean backend.
   */
  reset() {
    this.closed = true;
    for (const t of this.delayedTimers) clearTimeout(t);
    this.delayedTimers.clear();
    for (const item of this.tasks) {
      if (item.expirationTimer) clearTimeout(item.expirationTimer);
    }
    this.tasks.length = 0;
    this.inFlight.clear();
    this.taskReceivers.clear();
    this.responseReceivers.clear();
    this.deadReceivers.clear();
    this.closed = false;
  }
}

function noop() {}

/** @type {InprocBackend|null} */
let backendSingleton = null;

/**
 * @returns {InprocBackend}
 */
function getBackend() {
  if (!backendSingleton) backendSingleton = new InprocBackend();
  return backendSingleton;
}

/**
 * Test/diagnostic helper. Resets the singleton backend.
 */
function _resetBackendForTests() {
  if (backendSingleton) backendSingleton.reset();
  backendSingleton = null;
}

class InprocTaskQueue extends events.EventEmitter {
  /**
   * @param {Function} [simulateErrorResponse] - kept for API parity with
   *   TaskQueueRabbitMQ; unused in standalone (no broker redelivery).
   */
  constructor(simulateErrorResponse) {
    super();
    this.simulateErrorResponse = simulateErrorResponse;
    this.isClose = false;
    this.backend = getBackend();
    this._registered = {task: false, response: false, dead: false};
    this.on('newListener', event => {
      if (event === 'task' && this._registered.task) this.backend.scheduleDispatch();
    });
  }

  /**
   * @param {boolean} isAddTask
   * @param {boolean} isAddResponse
   * @param {boolean} isAddTaskReceive
   * @param {boolean} isAddResponseReceive
   * @param {boolean} isEmitDead
   * @param {boolean} _isAddDelayed
   * @param {(err?: Error) => void} [callback]
   */
  init(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, _isAddDelayed, callback) {
    if (isAddTaskReceive) {
      this.backend.registerTaskReceiver(this);
      this._registered.task = true;
    }
    if (isAddResponseReceive) {
      this.backend.registerResponseReceiver(this);
      this._registered.response = true;
    }
    if (isEmitDead) {
      this.backend.registerDeadReceiver(this);
      this._registered.dead = true;
    }
    void isAddTask;
    void isAddResponse;
    if (callback) setImmediate(() => callback(null));
  }

  initPromise(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed) {
    return new Promise((resolve, reject) => {
      this.init(isAddTask, isAddResponse, isAddTaskReceive, isAddResponseReceive, isEmitDead, isAddDelayed, err => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Mirrors TaskQueueRabbitMQ.addTask: applies the visibility timeout and
   * serialises with JSON.stringify.
   * When opt_expiration > 0 the task is enqueued in the priority queue but
   * emits "dead" if it is not delivered within opt_expiration ms.
   * @param {Object} task
   * @param {number} priority
   * @param {number} [opt_expiration]
   * @param {Object} [opt_headers]
   */
  addTask(task, priority, opt_expiration, opt_headers) {
    if (typeof task.setVisibilityTimeout === 'function') {
      task.setVisibilityTimeout(cfgVisibilityTimeout);
    }
    const content = JSON.stringify(task);
    this.backend.addTask(content, priority, opt_headers, opt_expiration > 0 ? opt_expiration : 0);
    return Promise.resolve();
  }

  addResponse(task) {
    this.backend.addResponse(JSON.stringify(task));
    return Promise.resolve();
  }

  /**
   * Inproc has no redelivery path: after ttl ms the task fires "dead", not "task".
   */
  addDelayed(task, ttl) {
    this.backend.addDelayed(JSON.stringify(task), ttl);
    return Promise.resolve();
  }

  close() {
    if (this.isClose) return Promise.resolve();
    this.isClose = true;
    this.backend.unregister(this);
    this._registered = {task: false, response: false, dead: false};
    this.removeAllListeners();
    return Promise.resolve();
  }

  closeOrWait() {
    return this.close();
  }

  healthCheck() {
    return Promise.resolve(!this.isClose);
  }
}

module.exports = InprocTaskQueue;
module.exports._resetBackendForTests = _resetBackendForTests;
