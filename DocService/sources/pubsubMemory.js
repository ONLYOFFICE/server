/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * In-process pubsub for the public/community standalone runtime.
 *
 * Implements the same surface as PubsubRabbitMQ (init/initPromise/publish/
 * close/healthCheck + EventEmitter 'message' event) using a module-level
 * shared backend so multiple `new LocalPubSub()` instances inside the same
 * Node.js process see the same broadcast channel.
 *
 * No durability, no cross-process delivery.
 */

'use strict';

const events = require('events');

class LocalPubSubBackend {
  constructor() {
    /** @type {Set<events.EventEmitter>} */
    this.subscribers = new Set();
    this.closed = false;
  }

  subscribe(pubsub) {
    this.subscribers.add(pubsub);
  }

  unsubscribe(pubsub) {
    this.subscribers.delete(pubsub);
  }

  /**
   * Broadcast a message to all subscribers asynchronously to mimic broker
   * fan-out (no synchronous re-entrancy into the publisher).
   * @param {string} data
   */
  publish(data) {
    if (this.closed) return;
    const subscribers = [...this.subscribers];
    setImmediate(() => {
      for (const subscriber of subscribers) {
        try {
          subscriber.emit('message', data);
        } catch (_err) {
          // emit failures must not break delivery to other subscribers
        }
      }
    });
  }

  reset() {
    this.subscribers.clear();
    this.closed = false;
  }
}

/** @type {LocalPubSubBackend|null} */
let backendSingleton = null;

/**
 * @returns {LocalPubSubBackend}
 */
function getBackend() {
  if (!backendSingleton) backendSingleton = new LocalPubSubBackend();
  return backendSingleton;
}

function _resetBackendForTests() {
  if (backendSingleton) backendSingleton.reset();
  backendSingleton = null;
}

class LocalPubSub extends events.EventEmitter {
  constructor() {
    super();
    this.isClose = false;
    this.backend = getBackend();
    this._registered = false;
  }

  /**
   * @param {(err?: Error) => void} [callback]
   */
  init(callback) {
    if (!this._registered) {
      this.backend.subscribe(this);
      this._registered = true;
    }
    if (callback) setImmediate(() => callback(null));
  }

  initPromise() {
    return new Promise((resolve, reject) => {
      this.init(err => (err ? reject(err) : resolve()));
    });
  }

  /**
   * @param {string|Buffer} message
   */
  publish(message) {
    const data = typeof message === 'string' ? message : message.toString();
    this.backend.publish(data);
    return Promise.resolve();
  }

  close() {
    if (this.isClose) return Promise.resolve();
    this.isClose = true;
    if (this._registered) {
      this.backend.unsubscribe(this);
      this._registered = false;
    }
    this.removeAllListeners();
    return Promise.resolve();
  }

  healthCheck() {
    return Promise.resolve(!this.isClose);
  }
}

module.exports = LocalPubSub;
module.exports._resetBackendForTests = _resetBackendForTests;
