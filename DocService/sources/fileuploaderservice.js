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

'use strict';
const crypto = require('crypto');
const co = require('co');
const utilsDocService = require('./utilsDocService');
const docsCoServer = require('./DocsCoServer');
const utils = require('./../../Common/sources/utils');
const storageBase = require('./../../Common/sources/storage/storage-base');
const formatChecker = require('./../../Common/sources/formatchecker');
const commonDefines = require('./../../Common/sources/commondefines');
const constants = require('./../../Common/sources/constants');
const operationContext = require('./../../Common/sources/operationContext');
const config = require('config');

const cfgImageSize = config.get('services.CoAuthoring.server.limits_image_size');
const cfgTypesUpload = config.get('services.CoAuthoring.utils.limits_image_types_upload');

const PATTERN_ENCRYPTED = 'ENCRYPTED;';

function checkJwtUploadTransformRes(ctx, errorName, checkJwtRes) {
  const res = {err: true, docId: null, userid: null, encrypted: null};
  if (checkJwtRes.decoded) {
    const doc = checkJwtRes.decoded.document;
    const edit = checkJwtRes.decoded.editorConfig;
    //todo check view and pdf editor (temporary fix)
    if (!edit.ds_isCloseCoAuthoring) {
      res.err = false;
      res.docId = doc.key;
      res.encrypted = doc.ds_encrypted;
      if (edit.user) {
        res.userid = edit.user.id;
      }
    } else {
      ctx.logger.warn('Error %s jwt: %s', errorName, 'access deny');
    }
  } else {
    ctx.logger.warn('Error %s jwt: %s', errorName, checkJwtRes.description);
  }
  return res;
}
exports.uploadImageFile = function (req, res) {
  return co(function* () {
    let httpStatus = 200;
    let docId = 'null';
    const output = {};
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      docId = req.params.docid;
      ctx.setDocId(docId);
      let encrypted = false;
      ctx.logger.debug('Start uploadImageFile');
      const tenImageSize = ctx.getCfg('services.CoAuthoring.server.limits_image_size', cfgImageSize);
      const tenTypesUpload = ctx.getCfg('services.CoAuthoring.utils.limits_image_types_upload', cfgTypesUpload);

      let checkJwtRes = yield docsCoServer.checkJwtHeader(ctx, req, constants.JWT_PURPOSE_EDITOR_SESSION, {
        header: 'Authorization',
        prefix: 'Bearer '
      });
      if (!checkJwtRes) {
        //todo remove compatibility with previous versions
        checkJwtRes = yield docsCoServer.checkJwt(ctx, req.query['token'], constants.JWT_PURPOSE_EDITOR_SESSION);
      }
      const transformedRes = checkJwtUploadTransformRes(ctx, 'uploadImageFile', checkJwtRes);
      if (!transformedRes.err) {
        docId = transformedRes.docId || docId;
        encrypted = transformedRes.encrypted;
        ctx.setDocId(docId);
        ctx.setUserId(transformedRes.userid);
      } else {
        httpStatus = 403;
      }

      if (200 === httpStatus && docId && req.body && Buffer.isBuffer(req.body)) {
        let buffer = req.body;
        if (buffer.length <= tenImageSize) {
          // process image: fix EXIF rotation and convert unsupported formats to optimal format
          buffer = yield utilsDocService.processImageOptimal(ctx, buffer);
          const format = formatChecker.getImageFormat(ctx, buffer);
          let formatStr = formatChecker.getStringFromFormat(format);
          if (encrypted && PATTERN_ENCRYPTED === buffer.toString('utf8', 0, PATTERN_ENCRYPTED.length)) {
            formatStr = buffer.toString('utf8', PATTERN_ENCRYPTED.length, buffer.indexOf(';', PATTERN_ENCRYPTED.length));
          }
          const supportedFormats = tenTypesUpload || 'jpg';
          const formatLimit = formatStr && -1 !== supportedFormats.indexOf(formatStr);
          if (formatLimit) {
            //a hash is written at the beginning to avoid errors during parallel upload in co-editing
            const strImageName = crypto.randomBytes(16).toString('hex');
            const strPathRel = 'media/' + strImageName + '.' + formatStr;
            const strPath = docId + '/' + strPathRel;

            yield storageBase.putObject(ctx, strPath, buffer, buffer.length);
            output[strPathRel] = yield storageBase.getSignedUrl(
              ctx,
              utils.getBaseUrlByRequest(ctx, req),
              strPath,
              commonDefines.c_oAscUrlTypes.Session
            );
          } else {
            httpStatus = 415;
            ctx.logger.debug('uploadImageFile format is not supported');
          }
        } else {
          httpStatus = 413;
          ctx.logger.debug('uploadImageFile size limit exceeded: buffer.length = %d', buffer.length);
        }
      }
    } catch (e) {
      httpStatus = 400;
      ctx.logger.error('Error uploadImageFile:%s', e.stack);
    } finally {
      try {
        if (200 === httpStatus) {
          res.setHeader('Content-Type', 'application/json');
          res.send(JSON.stringify(output));
        } else {
          res.sendStatus(httpStatus);
        }
        ctx.logger.debug('End uploadImageFile: httpStatus = %d', httpStatus);
      } catch (e) {
        ctx.logger.error('Error uploadImageFile:%s', e.stack);
      }
    }
  });
};
