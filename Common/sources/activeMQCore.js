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
const container = require('rhea');
const operationContext = require('./operationContext');

const cfgRabbitSocketOptions = config.util.cloneDeep(config.get('activemq.connectOptions'));

const RECONNECT_TIMEOUT = 1000;

function connetPromise(closeCallback) {
  return new Promise((resolve, _reject) => {
    //todo use built-in reconnect logic
    function startConnect() {
      let onDisconnected = function () {
        if (isConnected) {
          closeCallback();
        } else {
          setTimeout(startConnect, RECONNECT_TIMEOUT);
        }
      };
      const conn = container.create_container().connect(cfgRabbitSocketOptions);
      let isConnected = false;
      conn.on('connection_open', _context => {
        operationContext.global.logger.debug('[AMQP] connected');
        isConnected = true;
        resolve(conn);
      });
      conn.on('connection_error', context => {
        operationContext.global.logger.debug('[AMQP] connection_error %s', context.error && context.error);
      });
      conn.on('connection_close', _context => {
        operationContext.global.logger.debug('[AMQP] conn close');
        if (onDisconnected) {
          onDisconnected();
          onDisconnected = null;
        }
      });
      conn.on('disconnected', context => {
        operationContext.global.logger.error('[AMQP] disconnected %s', context.error && context.error.stack);
        if (onDisconnected) {
          onDisconnected();
          onDisconnected = null;
        }
      });
    }

    startConnect();
  });
}
function openSenderPromise(conn, options) {
  return new Promise((resolve, _reject) => {
    resolve(conn.open_sender(options));
  });
}
function openReceiverPromise(conn, options) {
  return new Promise((resolve, _reject) => {
    resolve(conn.open_receiver(options));
  });
}
function closePromise(conn) {
  return new Promise((resolve, _reject) => {
    conn.close();
    resolve();
  });
}

module.exports.connetPromise = connetPromise;
module.exports.openSenderPromise = openSenderPromise;
module.exports.openReceiverPromise = openReceiverPromise;
module.exports.closePromise = closePromise;
module.exports.RECONNECT_TIMEOUT = RECONNECT_TIMEOUT;
