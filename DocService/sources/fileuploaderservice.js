/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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
const crypto = require('crypto');
var multiparty = require('multiparty');
var co = require('co');
var jwt = require('jsonwebtoken');
var taskResult = require('./taskresult');
var docsCoServer = require('./DocsCoServer');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var storageBase = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var logger = require('./../../Common/sources/logger');
const commonDefines = require('./../../Common/sources/commondefines');

var config = require('config');
var configServer = config.get('services.CoAuthoring.server');
var configUtils = config.get('services.CoAuthoring.utils');

var cfgImageSize = configServer.get('limits_image_size');
var cfgTypesUpload = configUtils.get('limits_image_types_upload');
var cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');

const PATTERN_ENCRYPTED = 'ENCRYPTED;';

exports.uploadTempFile = function(req, res) {
  return co(function* () {
    var docId = 'uploadTempFile';
    let docLogger = logger.getLogger('nodeJS');
    docLogger.addContext('docId', docId);
    try {
      let params;
      let authRes = docsCoServer.getRequestParams(docLogger, req, true);
      if(authRes.code === constants.NO_ERROR){
        params = authRes.params;
      } else {
        utils.fillResponse(req, res, undefined, authRes.code, false);
        return;
      }
      docId = params.key;
      docLogger.addContext('docId', docId);
      docLogger.debug('Start uploadTempFile');
      if (docId && req.body && Buffer.isBuffer(req.body)) {
        var task = yield* taskResult.addRandomKeyTask(docId);
        var strPath = task.key + '/' + docId + '.tmp';
        yield storageBase.putObject(strPath, req.body, req.body.length);
        var url = yield storageBase.getSignedUrl(utils.getBaseUrlByRequest(req), strPath,
                                                 commonDefines.c_oAscUrlTypes.Temporary);
        utils.fillResponse(req, res, url, constants.NO_ERROR, false);
      } else {
        utils.fillResponse(req, res, undefined, constants.UNKNOWN, false);
      }
      docLogger.debug('End uploadTempFile');
    }
    catch (e) {
      docLogger.error('Error uploadTempFile: \r\n%s', e.stack);
      utils.fillResponse(req, res, undefined, constants.UNKNOWN, false);
    }
  });
};
function checkJwtUpload(docLogger, errorName, token){
  let checkJwtRes = docsCoServer.checkJwt(docLogger, token, commonDefines.c_oAscSecretType.Session);
  return checkJwtUploadTransformRes(docLogger, errorName, checkJwtRes);
}
function checkJwtUploadTransformRes(docLogger, errorName, checkJwtRes){
  var res = {err: true, docId: null, userid: null, encrypted: null};
  if (checkJwtRes.decoded) {
    var doc = checkJwtRes.decoded.document;
    var edit = checkJwtRes.decoded.editorConfig;
    if (!edit.ds_view && !edit.ds_isCloseCoAuthoring) {
      res.err = false;
      res.docId = doc.key;
      res.encrypted = doc.ds_encrypted;
      if (edit.user) {
        res.userid = edit.user.id;
      }
    } else {
      docLogger.warn('Error %s jwt: \r\n%s', errorName, 'access deny');
    }
  } else {
    docLogger.warn('Error %s jwt: \r\n%s', errorName, checkJwtRes.description);
  }
  return res;
}
exports.uploadImageFileOld = function(req, res) {
  var docId = req.params.docid;
  let docLogger = logger.getLogger('nodeJS');
  docLogger.addContext('docId', docId);
  docLogger.debug('Start uploadImageFileOld');
  var userid = req.params.userid;
  docLogger.addContext('userId', userid);
  if (cfgTokenEnableBrowser) {
    var checkJwtRes = checkJwtUpload(docLogger, 'uploadImageFileOld', req.query['token']);
    if(!checkJwtRes.err){
      docId = checkJwtRes.docId || docId;
      docLogger.addContext('docId', docId);
      userid = checkJwtRes.userid || userid;
      docLogger.addContext('userId', userid);
    } else {
      res.sendStatus(403);
      return;
    }
  }
  var listImages = [];
  //todo userid
  if (docId) {
    var isError = false;
    var form = new multiparty.Form();
    form.on('error', function(err) {
      docLogger.error('Error parsing form: \r\n%s', err.toString());
      res.sendStatus(400);
    });
    form.on('part', function(part) {
      if (!part.filename) {
        // ignore field's content
        part.resume();
      }
      if (part.filename) {
        if (part.byteCount > cfgImageSize) {
          isError = true;
        }
        if (isError) {
          part.resume();
        } else {
          //в начале пишется хеш, чтобы избежать ошибок при параллельном upload в совместном редактировании
          var strImageName = crypto.randomBytes(16).toString("hex");
          var strPath = docId + '/media/' + strImageName + '.jpg';
          listImages.push(strPath);
          utils.stream2Buffer(part).then(function(buffer) {
            return storageBase.putObject(strPath, buffer, buffer.length);
          }).then(function() {
            part.resume();
          }).catch(function(err) {
            docLogger.error('Upload putObject: \r\n%s', err.stack);
            isError = true;
            part.resume();
          });
        }
      }
      part.on('error', function(err) {
        docLogger.error('Error parsing form part: \r\n%s', err.toString());
      });
    });
    form.on('close', function() {
      if (isError) {
        res.sendStatus(400);
      } else {
        storageBase.getSignedUrlsByArray(utils.getBaseUrlByRequest(req), listImages, docId,
                                         commonDefines.c_oAscUrlTypes.Session).then(function(urls) {
          var outputData = {'type': 0, 'error': constants.NO_ERROR, 'urls': urls, 'input': req.query};
            var output = '<html><head><script type="text/javascript">function load(){ parent.postMessage("';
            output += JSON.stringify(outputData).replace(/"/g, '\\"');
            output += '", "*"); }</script></head><body onload="load()"></body></html>';

            //res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'text/html');
            res.send(output);
            docLogger.debug('End uploadImageFileOld: %s', output);
          }
        ).catch(function(err) {
            res.sendStatus(400);
            docLogger.error('upload getSignedUrlsByArray: \r\n%s', err.stack);
          });
      }
    });
    form.parse(req);
  } else {
    docLogger.debug('Error params uploadImageFileOld');
    res.sendStatus(400);
  }
};
exports.uploadImageFile = function(req, res) {
  return co(function* () {
    var isError = true;
    var docId = 'null';
    let docLogger = logger.getLogger('nodeJS');
    docLogger.addContext('docId', docId);
    let output = {};
    let isValidJwt = true;
    try {
      docId = req.params.docid;
      docLogger.addContext('docId', docId);
      let encrypted = false;
      docLogger.debug('Start uploadImageFile');

      if (cfgTokenEnableBrowser) {
        let checkJwtRes = docsCoServer.checkJwtHeader(docLogger, req, 'Authorization', 'Bearer ', commonDefines.c_oAscSecretType.Session);
        if (!checkJwtRes) {
          //todo remove compatibility with previous versions
          checkJwtRes = docsCoServer.checkJwt(docLogger, req.query['token'], commonDefines.c_oAscSecretType.Session);
        }
        let transformedRes = checkJwtUploadTransformRes(docLogger, 'uploadImageFile', checkJwtRes);
        if (!transformedRes.err) {
          docId = transformedRes.docId || docId;
          docLogger.addContext('docId', docId);
          encrypted = transformedRes.encrypted;
        } else {
          isValidJwt = false;
        }
      }

      if (isValidJwt && docId && req.body && Buffer.isBuffer(req.body)) {
        let buffer = req.body;
        if (buffer.length <= cfgImageSize) {
          var format = formatChecker.getImageFormat(buffer, undefined);
          var formatStr = formatChecker.getStringFromFormat(format);
          if (encrypted && PATTERN_ENCRYPTED === buffer.toString('utf8', 0, PATTERN_ENCRYPTED.length)) {
            formatStr = buffer.toString('utf8', PATTERN_ENCRYPTED.length, buffer.indexOf(';', PATTERN_ENCRYPTED.length));
          }
          var supportedFormats = cfgTypesUpload || 'jpg';
          let formatLimit = formatStr && -1 !== supportedFormats.indexOf(formatStr);
          if (formatLimit) {
            //в начале пишется хеш, чтобы избежать ошибок при параллельном upload в совместном редактировании
            var strImageName = crypto.randomBytes(16).toString("hex");
            var strPathRel = 'media/' + strImageName + '.' + formatStr;
            var strPath = docId + '/' + strPathRel;
            yield storageBase.putObject(strPath, buffer, buffer.length);
            output[strPathRel] = yield storageBase.getSignedUrl(utils.getBaseUrlByRequest(req), strPath,
                                                                commonDefines.c_oAscUrlTypes.Session);
            isError = false;
          } else {
            docLogger.debug('uploadImageFile format is not supported');
          }
        } else {
          docLogger.debug('uploadImageFile size limit exceeded: buffer.length = %d', buffer.length);
        }
      }
    } catch (e) {
      isError = true;
      docLogger.error('Error uploadImageFile: \r\n%s', e.stack);
    } finally {
      try {
        if (!isError) {
          res.setHeader('Content-Type', 'application/json');
          res.send(JSON.stringify(output));
        } else {
          res.sendStatus(isValidJwt ? 400 : 403);
        }
        docLogger.debug('End uploadImageFile: isError = %s', isError);
      } catch (e) {
        docLogger.error('Error uploadImageFile: \r\n%s', e.stack);
      }
    }
  });
};
