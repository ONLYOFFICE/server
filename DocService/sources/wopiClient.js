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

const path = require('path');
const crypto = require('crypto');
const co = require('co');
const jwt = require('jsonwebtoken');
const config = require('config');
const utf7 = require('utf7');
const mime = require('mime');
const logger = require('./../../Common/sources/logger');
const utils = require('./../../Common/sources/utils');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const sqlBase = require('./baseConnector');
const taskResult = require('./taskresult');
const canvasService = require('./canvasservice');

const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgSignatureSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgCallbackRequestTimeout = config.get('services.CoAuthoring.server.callbackRequestTimeout');
const cfgDownloadTimeout = config.get('FileConverter.converter.downloadTimeout');
const cfgWopiFileInfoBlockList = config.get('wopi.fileInfoBlockList');
const cfgWopiWopiZone = config.get('wopi.wopiZone');
const cfgWopiWordView = config.get('wopi.wordView');
const cfgWopiWordEdit = config.get('wopi.wordEdit');
const cfgWopiCellView = config.get('wopi.cellView');
const cfgWopiCellEdit = config.get('wopi.cellEdit');
const cfgWopiSlideView = config.get('wopi.slideView');
const cfgWopiSlideEdit = config.get('wopi.slideEdit');
const cfgWopiFavIconUrlWord = config.get('wopi.favIconUrlWord');
const cfgWopiFavIconUrlCell = config.get('wopi.favIconUrlCell');
const cfgWopiFavIconUrlSlide = config.get('wopi.favIconUrlSlide');
const cfgWopiPublicKey = config.get('wopi.publicKey');
const cfgWopiModulus = config.get('wopi.modulus');
const cfgWopiExponent = config.get('wopi.exponent');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiPublicKeyOld = config.get('wopi.publicKeyOld');
const cfgWopiModulusOld = config.get('wopi.modulusOld');
const cfgWopiExponentOld = config.get('wopi.exponentOld');
const cfgWopiPrivateKeyOld = config.get('wopi.privateKeyOld');

let fileInfoBlockList = cfgWopiFileInfoBlockList.keys();

function discovery(req, res) {
  return co(function*() {
    let output = '';
    try {
      logger.info('wopiDiscovery start');
      let baseUrl = utils.getBaseUrlByRequest(req);
      let names = ['Word','Excel','PowerPoint'];
      let favIconUrls = [cfgWopiFavIconUrlWord, cfgWopiFavIconUrlCell, cfgWopiFavIconUrlSlide];
      let exts = [{view: cfgWopiWordView, edit: cfgWopiWordEdit}, {view: cfgWopiCellView, edit: cfgWopiCellEdit},
        {view: cfgWopiSlideView, edit: cfgWopiSlideEdit}];
      let templateStart = `${baseUrl}/hosting/wopi?documentType=`;
      let templateEnd = `&amp;&lt;rs=DC_LLCC&amp;&gt;&lt;dchat=DISABLE_CHAT&amp;&gt;&lt;e=EMBEDDED&amp;&gt;`;
      templateEnd += `&lt;fs=FULLSCREEN&amp;&gt;&lt;hid=HOST_SESSION_ID&amp;&gt;&lt;rec=RECORDING&amp;&gt;`;
      templateEnd += `&lt;sc=SESSION_CONTEXT&amp;&gt;&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;`;
      templateEnd += `&lt;wopisrc=WOPI_SOURCE&amp;&gt;&amp;`;
      let documentTypes = [`word`, `cell`, `slide`];
      output += `<?xml version="1.0" encoding="utf-8"?><wopi-discovery><net-zone name="${cfgWopiWopiZone}">`;
      //start section for MS WOPI connectors
      for(let i = 0; i < names.length; ++i) {
        let name = names[i];
        let favIconUrl = favIconUrls[i];
        let ext = exts[i];
        let urlTemplateView = `${templateStart}${documentTypes[i]}&amp;mode=view${templateEnd}`;
        let urlTemplateEdit = `${templateStart}${documentTypes[i]}&amp;mode=edit${templateEnd}`;
        output +=`<app name="${name}" favIconUrl="${favIconUrl}">`;
        for (let j = 0; j < ext.view.length; ++j) {
          output += `<action name="view" ext="${ext.view[j]}" urlsrc="${urlTemplateView}" />`;
        }
        for (let j = 0; j < ext.edit.length; ++j) {
          output += `<action name="view" ext="${ext.edit[j]}" urlsrc="${urlTemplateView}" />`;
          output += `<action name="edit" ext="${ext.edit[j]}" default="true" requires="locks,update" urlsrc="${urlTemplateEdit}" />`;
        }
        output +=`</app>`;
      }
      //end section for MS WOPI connectors
      //start section for collabora nexcloud connectors
      for(let i = 0; i < exts.length; ++i) {
        let ext = exts[i];
        let urlTemplateView = `${templateStart}${documentTypes[i]}&amp;mode=view${templateEnd}`;
        let urlTemplateEdit = `${templateStart}${documentTypes[i]}&amp;mode=edit${templateEnd}`;
        for (let j = 0; j < ext.view.length; ++j) {
          output +=`<app name="${mime.getType(ext.view[j])}">`;
          output +=`<action name="view" ext="" default="true" urlsrc="${urlTemplateView}" />`;
          output +=`</app>`;
        }
        for (let j = 0; j < ext.edit.length; ++j) {
          output +=`<app name="${mime.getType(ext.edit[j])}">`;
          output += `<action name="edit" ext="" default="true" requires="locks,update" urlsrc="${urlTemplateEdit}" />`;
          output +=`</app>`;
        }
      }
      output += `<app name="Capabilities">`;
      output += `<action ext="" name="getinfo" urlsrc="${baseUrl}/hosting/capabilities"/>`;
      output += `</app>`;
      //end section for collabora nexcloud connectors
      let proofKey = ``;
      if (cfgWopiPublicKeyOld && cfgWopiPublicKey) {
        proofKey += `<proof-key oldvalue="${cfgWopiPublicKeyOld}" oldmodulus="${cfgWopiModulusOld}" `;
        proofKey += `oldexponent="${cfgWopiExponentOld}" value="${cfgWopiPublicKey}" modulus="${cfgWopiModulus}" `;
        proofKey += `exponent="${cfgWopiExponent}"/>`;
      }
      output += `</net-zone>${proofKey}</wopi-discovery>`;
    } catch (err) {
      logger.error('wopiDiscovery error:%s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/xml');
      res.send(output);
      logger.info('wopiDiscovery end');
    }
  });
}
function collaboraCapabilities(req, res) {
  return co(function*() {
    let output = {
      "convert-to": {"available": false}, "hasMobileSupport": true, "hasProxyPrefix": false, "hasTemplateSaveAs": false,
      "hasTemplateSource": false, "productVersion": commonDefines.buildVersion
    };
    try {
    logger.info('collaboraCapabilities start');
    } catch (err) {
      logger.error('collaboraCapabilities error:%s', err.stack);
    } finally {
      utils.fillResponseSimple(res, JSON.stringify(output), "application/json");
      logger.info('collaboraCapabilities end');
    }
  });
}
function isWopiCallback(url) {
  return url && url.startsWith("{");
}
function isWopiUnlockMarker(url) {
  return isWopiCallback(url) && !!JSON.parse(url).unlockId;
}
function getWopiUnlockMarker(wopiParams) {
  return JSON.stringify(Object.assign({unlockId: wopiParams.commonInfo.lockId}, wopiParams.userAuth));
}
function parseWopiCallback(docId, userAuthStr, url) {
  let wopiParams = null;
  if (isWopiCallback(userAuthStr)) {
    let userAuth = JSON.parse(userAuthStr);
    let commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, url, 1);
    if (isWopiCallback(commonInfoStr)) {
      let commonInfo = JSON.parse(commonInfoStr);
      wopiParams = {commonInfo: commonInfo, userAuth: userAuth};
      logger.debug('parseWopiCallback wopiParams:%j', wopiParams);
    }
  }
  return wopiParams;
}
function checkAndInvalidateCache(docId, fileInfo) {
  return co(function*() {
    let res = {success: true, lockId: undefined};
    let selectRes = yield taskResult.select(docId);
    if (selectRes.length > 0) {
      let row = selectRes[0];
      if (row.callback) {
        let commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, row.callback, 1);
        if (isWopiCallback(commonInfoStr)) {
          let commonInfo = JSON.parse(commonInfoStr);
          res.lockId = commonInfo.lockId;
          logger.debug('wopiEditor lockId from DB lockId=%s', res.lockId);
          let unlockMarkStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, row.callback);
          logger.debug('wopiEditor commonInfoStr=%s', commonInfoStr);
          logger.debug('wopiEditor unlockMarkStr=%s', unlockMarkStr);
          let hasUnlockMarker = isWopiUnlockMarker(unlockMarkStr);
          logger.debug('wopiEditor hasUnlockMarker=%s', hasUnlockMarker);
          if (hasUnlockMarker) {
            let fileInfoVersion = fileInfo.Version;
            let cacheVersion = commonInfo.fileInfo.Version;
            logger.debug('wopiEditor fileInfoVersion=%s; cacheVersion=%s', fileInfoVersion, cacheVersion);
            if (fileInfoVersion !== cacheVersion) {
              var mask = new taskResult.TaskResultData();
              mask.key = docId;
              mask.last_open_date = row.last_open_date;
              //cleanupRes can be false in case of simultaneous opening. it is OK
              let cleanupRes = yield canvasService.cleanupCacheIf(mask);
              logger.debug('wopiEditor cleanupRes=%s', cleanupRes);
              res.lockId = undefined;
            }
          } else {
            let cmd = new commonDefines.InputCommand();
            var outputData = new canvasService.OutputData(cmd.getCommand());
            yield canvasService.getOutputData(cmd, outputData, docId);
            if ('ok' !== outputData.getStatus()) {
              res.success = false;
              logger.warn('wopiEditor inappropriate DB status selectRes=%j', selectRes);
            }
          }
        } else {
          res.success = false;
          logger.warn('wopiEditor attempt to open not wopi record');
        }
      }
    }
    return res;
  });
}
function getEditorHtml(req, res) {
  return co(function*() {
    let params = {key: undefined, fileInfo: {}, userAuth: {}, queryParams: req.query, token: undefined};
    try {
      logger.info('wopiEditor start');
      logger.debug(`wopiEditor req.url:%s`, req.url);
      logger.debug(`wopiEditor req.query:%j`, req.query);
      logger.debug(`wopiEditor req.body:%j`, req.body);
      let wopiSrc = req.query['wopisrc'];
      let mode = req.query['mode'];
      let sc = req.query['sc'];
      let hostSessionId = req.query['hid'];
      let access_token = req.body['access_token'];
      let access_token_ttl = req.body['access_token_ttl'];

      let uri = `${encodeURI(wopiSrc)}?access_token=${encodeURIComponent(access_token)}`;

      let fileInfo = params.fileInfo = yield checkFileInfo(uri, access_token, sc);
      if (!fileInfo) {
        params.fileInfo = {};
        return;
      }

      if (!fileInfo.UserCanWrite) {
        mode = 'view';
        req.query['mode'] = mode;
      }
      //docId
      let docId = undefined;
      let fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      if ('edit' === mode) {
        docId = `${fileId}`;
      } else {
        //todo rename operation requires lock
        fileInfo.SupportsRename = false;
        //todo change docId to avoid empty cache after editors are gone
        docId = `view.${fileId}.${fileInfo.Version}`;
      }
      docId = docId.replace(constants.DOC_ID_REPLACE_REGEX, '_').substring(0, constants.DOC_ID_MAX_LENGTH);
      logger.debug(`wopiEditor docId=%s`, docId);
      params.key = docId;
      let userAuth = params.userAuth = {
        wopiSrc: wopiSrc, access_token: access_token, access_token_ttl: access_token_ttl,
        hostSessionId: hostSessionId, userSessionId: docId
      };

      //check and invalidate cache
      let checkRes = yield checkAndInvalidateCache(docId, fileInfo);
      let lockId = checkRes.lockId;
      if (!checkRes.success) {
        params.fileInfo = {};
        return;
      }
      //save common info
      if (undefined === lockId) {
        let fileType = fileInfo.BaseFileName ? fileInfo.BaseFileName.substr(fileInfo.BaseFileName.lastIndexOf('.') + 1) : "";
        fileType = fileInfo.FileExtension ? fileInfo.FileExtension.substr(1) : fileType;
        lockId = crypto.randomBytes(16).toString('base64');
        let commonInfo = JSON.stringify({lockId: lockId, fileInfo: fileInfo});
        yield canvasService.commandOpenStartPromise(docId, utils.getBaseUrlByRequest(req), 1, commonInfo, fileType);
      }

      //Lock
      if ('edit' === mode) {
        let lockRes = yield lock(lockId, fileInfo, userAuth);
        if (!lockRes) {
          params.fileInfo = {};
          return;
        }
      }

      for (let i in fileInfoBlockList) {
        if (fileInfoBlockList.hasOwnProperty(i)) {
          delete params.fileInfo[i];
        }
      }

      if (cfgTokenEnableBrowser) {
        let options = {algorithm: cfgTokenOutboxAlgorithm, expiresIn: cfgTokenOutboxExpires};
        let secret = utils.getSecretByElem(cfgSignatureSecretOutbox);
        params.token = jwt.sign(params, secret, options);
      }
    } catch (err) {
      logger.error('wopiEditor error:%s', err.stack);
      params.fileInfo = {};
    } finally {
      logger.debug('wopiEditor render params=%j', params);
      res.render("editor-wopi", params);
      logger.info('wopiEditor end');
    }
  });
}
function putFile(wopiParams, data, dataStream, userLastChangeId) {
  return co(function* () {
    let res = '{"error": 1}';
    try {
      logger.info('wopi PutFile start');
      let fileInfo = wopiParams.commonInfo.fileInfo;

      //collabora nexcloud connector sets only UserCanWrite=true
      if (fileInfo && (fileInfo.SupportsUpdate || fileInfo.UserCanWrite)) {
        let commonInfo = wopiParams.commonInfo;
        let userAuth = wopiParams.userAuth;
        let uri = `${userAuth.wopiSrc}/contents?access_token=${userAuth.access_token}`;
        //todo add all the users who contributed changes to the document in this PutFile request to X-WOPI-Editors
        let headers = {'X-WOPI-Override': 'PUT', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-Editors': userLastChangeId};
        fillStandardHeaders(headers, uri, userAuth.access_token);
        if (fileInfo.LastModifiedTime) {
          //collabora nexcloud connector
          headers['X-LOOL-WOPI-Timestamp'] = fileInfo.LastModifiedTime;
        }

        logger.debug('wopi PutFile request uri=%s headers=%j', uri, headers);
        let postRes = yield utils.postRequestPromise(uri, data, dataStream, cfgCallbackRequestTimeout, undefined, headers);
        logger.debug('wopi PutFile response headers=%j', postRes.response.headers);
        res = '{"error": 0}';
      } else {
        logger.warn('wopi SupportsUpdate = false or UserCanWrite = false');
      }
    } catch (err) {
      logger.error('wopi error PutFile:%s', err.stack);
    } finally {
      logger.info('wopi PutFile end');
    }
    return res;
  });
}
function renameFile(wopiParams, name) {
  return co(function* () {
    let res;
    try {
      logger.info('wopi RenameFile start');
      let fileInfo = wopiParams.commonInfo.fileInfo;

      if (fileInfo && fileInfo.SupportsRename) {
        let fileNameMaxLength = fileInfo.FileNameMaxLength || 255;
        name = name.substring(0, fileNameMaxLength);
        let commonInfo = wopiParams.commonInfo;
        let userAuth = wopiParams.userAuth;
        let uri = `${userAuth.wopiSrc}?access_token=${userAuth.access_token}`;

        let headers = {'X-WOPI-Override': 'RENAME_FILE', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-RequestedName': utf7.encode(name)};
        fillStandardHeaders(headers, uri, userAuth.access_token);

        logger.debug('wopi RenameFile request uri=%s headers=%j', uri, headers);
        let postRes = yield utils.postRequestPromise(uri, undefined, undefined, cfgCallbackRequestTimeout, undefined, headers);
        logger.debug('wopi RenameFile response headers=%j body=%s', postRes.response.headers, postRes.body);
        if (postRes.body) {
          res = JSON.parse(postRes.body);
        } else {
          //sharepoint send empty body(2016 allways, 2019 with same name)
          res = {"Name": name};
        }
      } else {
        logger.info('wopi SupportsRename = false');
      }
    } catch (err) {
      logger.error('wopi error RenameFile:%s', err.stack);
    } finally {
      logger.info('wopi RenameFile end');
    }
    return res;
  });
}
function checkFileInfo(uri, access_token, sc) {
  return co(function* () {
    let fileInfo;
    try {
      let headers = {};
      if (sc) {
        headers['X-WOPI-SessionContext'] = sc;
      }
      fillStandardHeaders(headers, uri, access_token);
      logger.debug('wopi checkFileInfo request uri=%s headers=%j', uri, headers);
      let getRes = yield utils.downloadUrlPromise(uri, cfgDownloadTimeout, undefined, undefined, headers);
      logger.debug(`wopi checkFileInfo headers=%j body=%s`, getRes.response.headers, getRes.body);
      fileInfo = JSON.parse(getRes.body);
    } catch (err) {
      logger.error('wopi error checkFileInfo:%s', err.stack);
    } finally {
      logger.info('wopi checkFileInfo end');
    }
    return fileInfo;
  });
}
function lock(lockId, fileInfo, userAuth) {
  return co(function* () {
    let res = true;
    try {
      logger.info('wopi Lock start');
      if (fileInfo && fileInfo.SupportsLocks) {
        let wopiSrc = userAuth.wopiSrc;
        let access_token = userAuth.access_token;
        let uri = `${wopiSrc}?access_token=${access_token}`;

        let headers = {"X-WOPI-Override": "LOCK", "X-WOPI-Lock": lockId};
        fillStandardHeaders(headers, uri, access_token);
        logger.debug('wopi Lock request uri=%s headers=%j', uri, headers);
        let postRes = yield utils.postRequestPromise(uri, undefined, undefined, cfgCallbackRequestTimeout, undefined, headers);
        logger.debug('wopi Lock response headers=%j', postRes.response.headers);
      } else {
        logger.info('wopi SupportsLocks = false');
      }
    } catch (err) {
      res = false;
      logger.error('wopi error Lock:%s', err.stack);
    } finally {
      logger.info('wopi Lock end');
    }
    return res;
  });
}
function unlock(wopiParams) {
  return co(function* () {
    try {
      logger.info('wopi Unlock start');
      let fileInfo = wopiParams.commonInfo.fileInfo;
      if (fileInfo && fileInfo.SupportsLocks) {
        let wopiSrc = wopiParams.userAuth.wopiSrc;
        let lockId = wopiParams.commonInfo.lockId;
        let access_token = wopiParams.userAuth.access_token;
        let uri = `${wopiSrc}?access_token=${access_token}`;

        let headers = {"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": lockId};
        fillStandardHeaders(headers, uri, access_token);
        logger.debug('wopi Unlock request uri=%s headers=%j', uri, headers);
        let postRes = yield utils.postRequestPromise(uri, undefined, undefined, cfgCallbackRequestTimeout, undefined, headers);
        logger.debug('wopi Unlock response headers=%j', postRes.response.headers);
      } else {
        logger.info('wopi SupportsLocks = false');
      }
    } catch (err) {
      logger.error('wopi error Unlock:%s', err.stack);
    } finally {
      logger.info('wopi Unlock end');
    }
  });
}
function generateProofBuffer(url, accessToken, timeStamp) {
  const accessTokenBytes = Buffer.from(accessToken, 'utf8');
  const urlBytes = Buffer.from(url.toUpperCase(), 'utf8');

  let offset = 0;
  let buffer = Buffer.alloc(4 + accessTokenBytes.length + 4 + urlBytes.length + 4 + 8);
  buffer.writeUInt32BE(accessTokenBytes.length, offset);
  offset += 4;
  accessTokenBytes.copy(buffer, offset, 0, accessTokenBytes.length);
  offset += accessTokenBytes.length;
  buffer.writeUInt32BE(urlBytes.length, offset);
  offset += 4;
  urlBytes.copy(buffer, offset, 0, urlBytes.length);
  offset += urlBytes.length;
  buffer.writeUInt32BE(8, offset);
  offset += 4;
  buffer.writeBigUInt64BE(timeStamp, offset);
  return buffer;
}
function generateProofSign(url, accessToken, timeStamp, privateKey) {
  let signer = crypto.createSign('RSA-SHA256');
  signer.update(generateProofBuffer(url, accessToken, timeStamp));
  return signer.sign({key:privateKey}, "base64");
}
function generateProof(url, accessToken, timeStamp) {
  let privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${cfgWopiPrivateKey}\n-----END RSA PRIVATE KEY-----`;
  return generateProofSign(url, accessToken, timeStamp, privateKey);
}
function generateProofOld(url, accessToken, timeStamp) {
  let privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${cfgWopiPrivateKeyOld}\n-----END RSA PRIVATE KEY-----`;
  return generateProofSign(url, accessToken, timeStamp, privateKey);
}
function fillStandardHeaders(headers, url, access_token) {
  let timeStamp = utils.getDateTimeTicks(new Date());
  if (cfgWopiPrivateKey && cfgWopiPrivateKeyOld) {
    headers['X-WOPI-Proof'] = generateProof(url, access_token, timeStamp);
    headers['X-WOPI-ProofOld'] = generateProof(url, access_token, timeStamp);
    headers['X-WOPI-TimeStamp'] = timeStamp;
    headers['X-WOPI-ClientVersion'] = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
    // todo
    // headers['X-WOPI-CorrelationId '] = "";
    // headers['X-WOPI-SessionId'] = "";
  }
  headers['Authorization'] = `Bearer ${access_token}`;
}

exports.discovery = discovery;
exports.collaboraCapabilities = collaboraCapabilities;
exports.parseWopiCallback = parseWopiCallback;
exports.getEditorHtml = getEditorHtml;
exports.putFile = putFile;
exports.renameFile = renameFile;
exports.lock = lock;
exports.unlock = unlock;
exports.generateProof = generateProof;
exports.generateProofOld = generateProofOld;
exports.fillStandardHeaders = fillStandardHeaders;
exports.getWopiUnlockMarker = getWopiUnlockMarker;

