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

// Multipart upload middleware for the from-file and convert-to endpoints: tenant-scoped size limits, 413 on size, 400 otherwise.

'use strict';

const config = require('config');
const multer = require('multer');
const operationContext = require('../../../Common/sources/operationContext');
const {isDeclaredOversize, sendTooLarge} = require('./bodySizeLimit');

const cfgDownloadMaxBytes = config.get('FileConverter.converter.maxDownloadBytes');

const convertFieldMaxBytes = 1024 * 1024;
const convertMaxFields = 30;
// API rule: a multipart body may exceed maxDownloadBytes by this much for form fields and framing, larger is rejected unread
const multipartBodyAllowanceBytes = 32 * 1024 * 1024;

// Tenant maxDownloadBytes, an early 413 on the declared length, then multer; selectFiles picks single('file') or any().
function createConvertUpload(selectFiles) {
  return async function (req, res, next) {
    const ctx = new operationContext.Context();
    ctx.initFromRequest(req);
    let maxFileBytes = cfgDownloadMaxBytes;
    try {
      await ctx.initTenantCache();
      maxFileBytes = ctx.getCfg('FileConverter.converter.maxDownloadBytes', cfgDownloadMaxBytes);
    } catch (err) {
      ctx.logger.warn('multipart upload tenant init error, using default maxDownloadBytes: %s', err.stack);
    }
    if (isDeclaredOversize(req, maxFileBytes + multipartBodyAllowanceBytes)) {
      ctx.logger.warn('multipart upload rejected before reading: content-length %s', req.headers['content-length']);
      sendTooLarge(res);
      return;
    }
    const upload = multer({
      limits: {
        fieldSize: convertFieldMaxBytes,
        fileSize: maxFileBytes,
        files: 1,
        fields: convertMaxFields,
        parts: convertMaxFields + 2
      }
    });
    selectFiles(upload)(req, res, err => {
      if (!err) {
        return next();
      }
      if (err instanceof multer.MulterError && 'LIMIT_FILE_SIZE' === err.code) {
        ctx.logger.warn('multipart upload rejected: file exceeds maxDownloadBytes = %s', maxFileBytes);
        sendTooLarge(res);
      } else {
        ctx.logger.warn('multipart upload error: %s', err.message);
        res.sendStatus(400);
      }
    });
  };
}

const handleConvertUpload = createConvertUpload(upload => upload.single('file'));

module.exports = {handleConvertUpload, createConvertUpload, multipartBodyAllowanceBytes};
