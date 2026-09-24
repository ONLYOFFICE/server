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

// Request body size guards: 413 on a declared Content-Length before the body is read, and parser error to status mapping.

'use strict';

const multer = require('multer');
const operationContext = require('../../../Common/sources/operationContext');

function isDeclaredOversize(req, limit) {
  return parseInt(req.headers['content-length'], 10) > limit;
}

// Connection: close makes node destroy the socket after the reply instead of draining the rest of the upload.
function sendTooLarge(res) {
  res.set('Connection', 'close');
  res.sendStatus(413);
}

// With type set, only requests of that content type are checked; the cheap length test runs first to skip parsing the type.
function createBodySizeLimit(limit, type) {
  return function (req, res, next) {
    if (!isDeclaredOversize(req, limit) || (type && !req.is(type))) {
      next();
      return;
    }
    const ctx = new operationContext.Context();
    ctx.initFromRequest(req);
    ctx.logger.warn('request rejected before reading the body: content-length %s exceeds limit %d', req.headers['content-length'], limit);
    sendTooLarge(res);
  };
}

function getErrorStatus(err) {
  if (err instanceof multer.MulterError) {
    return 'LIMIT_FILE_SIZE' === err.code ? 413 : 400;
  }
  return err.status >= 400 && err.status < 500 ? err.status : 500;
}

module.exports = {isDeclaredOversize, sendTooLarge, createBodySizeLimit, getErrorStatus};
