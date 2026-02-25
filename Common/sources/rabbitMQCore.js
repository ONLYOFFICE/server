/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';
const config = require('config');
const amqp = require('amqplib/callback_api');
const operationContext = require('./operationContext');

const cfgRabbitUrl = config.get('rabbitmq.url');
const cfgRabbitSocketOptions = config.util.cloneDeep(config.get('rabbitmq.socketOptions'));

const RECONNECT_TIMEOUT = 1000;

function connetPromise(closeCallback) {
  return new Promise((resolve, _reject) => {
    function startConnect() {
      amqp.connect(cfgRabbitUrl, cfgRabbitSocketOptions, (err, conn) => {
        if (null != err) {
          operationContext.global.logger.error('[AMQP] %s', err.stack);
          setTimeout(startConnect, RECONNECT_TIMEOUT);
        } else {
          conn.on('error', err => {
            operationContext.global.logger.error('[AMQP] conn error', err.stack);
          });
          const closeEventCallback = function () {
            //in some case receive multiple close events
            conn.removeListener('close', closeEventCallback);
            operationContext.global.logger.debug('[AMQP] conn close');
            closeCallback();
          };
          conn.on('close', closeEventCallback);
          operationContext.global.logger.debug('[AMQP] connected');
          resolve(conn);
        }
      });
    }
    startConnect();
  });
}
function createChannelPromise(conn) {
  return new Promise((resolve, reject) => {
    conn.createChannel((err, channel) => {
      if (null != err) {
        reject(err);
      } else {
        resolve(channel);
      }
    });
  });
}
function createConfirmChannelPromise(conn) {
  return new Promise((resolve, reject) => {
    conn.createConfirmChannel((err, channel) => {
      if (null != err) {
        reject(err);
      } else {
        resolve(channel);
      }
    });
  });
}
function assertExchangePromise(channel, exchange, type, options) {
  return new Promise((resolve, reject) => {
    channel.assertExchange(exchange, type, options, (err, ok) => {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok.exchange);
      }
    });
  });
}

/**
 * Filters queue options based on queue type to prevent RabbitMQ PRECONDITION_FAILED errors.
 * Different queue types support different parameters:
 * - Classic queues: support all parameters including maxPriority, messageTtl, deadLetterExchange
 * - Quorum queues: do NOT support maxPriority (x-max-priority)
 * - Stream queues: do NOT support maxPriority, messageTtl, deadLetterExchange
 *
 * @param {Object} options - Queue options to filter
 * @param {string} queueName - Queue name for logging
 * @returns {Object} Filtered options compatible with queue type
 */
function filterQueueOptions(options, queueName) {
  if (!options) {
    return options;
  }

  const queueType = options.arguments && options.arguments['x-queue-type'];
  const unsupportedParams = {
    quorum: ['maxPriority'],
    stream: ['maxPriority', 'messageTtl', 'deadLetterExchange']
  };

  const paramsToRemove = unsupportedParams[queueType];
  if (!paramsToRemove) {
    return options;
  }

  const filteredOptions = {...options};
  const removedParams = [];

  for (const param of paramsToRemove) {
    if (filteredOptions[param] !== undefined) {
      delete filteredOptions[param];
      removedParams.push(param === 'maxPriority' ? 'maxPriority (x-max-priority)' : param);
    }
  }

  if (removedParams.length > 0) {
    operationContext.global.logger.info(
      'RabbitMQ %s queue "%s" does not require: %s. Parameters removed (RabbitMQ 4.0+ ignores these automatically, removed for compatibility with 3.x).',
      queueType,
      queueName,
      removedParams.join(', ')
    );
  }

  return filteredOptions;
}

function assertQueuePromise(channel, queue, options) {
  return new Promise((resolve, reject) => {
    channel.assertQueue(queue, options, (err, ok) => {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok.queue);
      }
    });
  });
}
function consumePromise(channel, queue, messageCallback, options) {
  return new Promise((resolve, reject) => {
    channel.consume(queue, messageCallback, options, (err, ok) => {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok);
      }
    });
  });
}
function closePromise(conn) {
  return new Promise((resolve, reject) => {
    conn.close(err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports.connetPromise = connetPromise;
module.exports.createChannelPromise = createChannelPromise;
module.exports.createConfirmChannelPromise = createConfirmChannelPromise;
module.exports.assertExchangePromise = assertExchangePromise;
module.exports.filterQueueOptions = filterQueueOptions;
module.exports.assertQueuePromise = assertQueuePromise;
module.exports.consumePromise = consumePromise;
module.exports.closePromise = closePromise;
module.exports.RECONNECT_TIMEOUT = RECONNECT_TIMEOUT;
