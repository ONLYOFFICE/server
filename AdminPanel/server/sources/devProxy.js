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

const http = require('http');
const cors = require('cors');
const operationContext = require('../../../Common/sources/operationContext');

/**
 * Setup development proxy to DocService
 * @param {object} app - Express app
 * @param {object} server - HTTP server
 * @param {number} targetPort - DocService port
 */
function setupDevProxy(app, server, targetPort) {
  /**
   * Simple proxy middleware for DocService HTTP requests
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @param {Function} next - Express next
   */
  function proxyToDocService(req, res, next) {
    // Skip requests that start with /admin
    if (req.path.startsWith('/admin')) {
      return next();
    }

    const proxyReq = http.request(
      {
        hostname: req.hostname || 'localhost',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers
      },
      proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', err => {
      operationContext.global.logger.error('Proxy error: %s', err.message);
      res.status(502).send('Bad Gateway');
    });

    req.pipe(proxyReq);
  }

  app.use(proxyToDocService);

  /**
   * Proxy WebSocket upgrade requests to DocService
   */
  server.on('upgrade', (req, socket, _head) => {
    // Skip WebSocket requests that start with /admin
    if (req.url.startsWith('/admin')) {
      socket.destroy();
      return;
    }

    const proxyReq = http.request({
      hostname: req.headers.host?.split(':')[0] || 'localhost',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      // Forward upgrade response to client
      socket.write(`HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        socket.write(`${key}: ${value}\r\n`);
      });
      socket.write('\r\n');
      socket.write(proxyHead);

      // Bidirectional pipe
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on('error', err => {
      operationContext.global.logger.error('WebSocket proxy error: %s', err.message);
      socket.destroy();
    });

    proxyReq.end();
  });
}

/**
 * Get CORS middleware for development
 * @returns {Function} CORS middleware
 */
function getDevCors() {
  return cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
}

module.exports = {setupDevProxy, getDevCors};
