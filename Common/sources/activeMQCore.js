/*
 * (c) Copyright Ascensio System SIA 2010-2018
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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
var config = require('config');
var container = require('rhea');
var logger = require('./logger');
const operationContext = require('./operationContext');

const cfgRabbitSocketOptions = config.get('activemq.connectOptions');

var RECONNECT_TIMEOUT = 1000;

function connetPromise(reconnectOnConnectionError, closeCallback) {
  return new Promise(function(resolve, reject) {
    function startConnect() {
      let conn = container.create_container().connect(cfgRabbitSocketOptions);
      let isConnected = false;
      conn.on('connection_open', function(context) {
        operationContext.global.logger.debug('[AMQP] connected');
        isConnected = true;
        resolve(conn);
      });
      conn.on('connection_error', function(context) {
        //todo
        operationContext.global.logger.debug('[AMQP] connection_error %s', context.error);
      });
      conn.on('connection_close', function() {
        //todo
        operationContext.global.logger.debug('[AMQP] conn close');
      });
      conn.on('disconnected', function(context) {
        operationContext.global.logger.error('[AMQP] disconnected %s', context.error && context.error.stack);
        if (isConnected) {
          closeCallback();
        } else {
          if (reconnectOnConnectionError) {
            setTimeout(startConnect, RECONNECT_TIMEOUT);
          } else {
            reject(context.error);
          }
        }
      });
    }

    startConnect();
  });
}
function openSenderPromise(conn, name) {
  return new Promise(function(resolve, reject) {
    let options = {target: name};
    resolve(conn.open_sender(options));
  });
}
function openReceiverPromise(conn, name, autoaccept) {
  return new Promise(function(resolve, reject) {
    let options = {source: name};
    if (!autoaccept) {
      options.credit_window = 0;
      options.autoaccept = false;
    }
    resolve(conn.open_receiver(options));
  });
}
function closePromise(conn) {
  return new Promise(function(resolve, reject) {
    conn.close();
    resolve();
  });
}

module.exports.connetPromise = connetPromise;
module.exports.openSenderPromise = openSenderPromise;
module.exports.openReceiverPromise = openReceiverPromise;
module.exports.closePromise = closePromise;
