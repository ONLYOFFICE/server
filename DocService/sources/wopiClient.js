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
const logger = require('./../../Common/sources/logger');
const utils = require('./../../Common/sources/utils');
const sqlBase = require('./baseConnector');
const taskResult = require('./taskresult');
const canvasService = require('./canvasservice');

const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgSignatureSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgWopiFileInfoBlockList = config.get('wopi.fileInfoBlockList');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiPrivateKeyOld = config.get('wopi.privateKeyOld');

let fileInfoBlockList = cfgWopiFileInfoBlockList.keys();

function generateProofBuffer(url, accessToken, timeStamp) {
  const accessTokenBytes = Buffer.from(accessToken, 'utf8');
  const urlBytes = Buffer.from(url.toUpperCase(), 'utf8');

  let offset = 0;
  let buffer = Buffer.alloc(4 + accessTokenBytes.length + 4 + urlBytes.length + 4 + 8);
  buffer.writeUInt32LE(accessTokenBytes.length, offset);
  offset += 4;
  buffer.copy(accessTokenBytes, offset, 0, accessTokenBytes.length);
  offset += accessTokenBytes.length;
  buffer.writeUInt32LE(urlBytes.length, offset);
  offset += 4;
  buffer.copy(urlBytes, offset, 0, urlBytes.length);
  offset += urlBytes.length;
  buffer.writeUInt32LE(8, offset);
  offset += 4;
  buffer.writeBigUInt64BE(timeStamp, offset);
  return buffer;
};
function generateProofSign(url, accessToken, timeStamp, privateKey) {
  let signer = crypto.createSign('RSA-SHA256');
  signer.update(generateProofBuffer(url, accessToken, timeStamp));
  return signer.sign({key:privateKey}, "base64");
}

exports.discovery = function(req, res) {
  return co(function*() {
    let output = '';
    try {
      logger.info('wopiDiscovery start');
      let baseUrl = utils.getBaseUrlByRequest(req);
      output = `<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery>
	<net-zone name="external-https">
		<app name="Word" favIconUrl="https://c5-word-view-15.cdn.office.net/wv/resources/1033/FavIcon_Word.ico" bootstrapperUrl="https://c5-word-view-15.cdn.office.net/wv/s/App_Scripts/word.boot.js" applicationBaseUrl="https://FFC-word-view.officeapps.live.com" staticResourceOrigin="https://c5-word-view-15.cdn.office.net" checkLicense="true">
			<action name="view" ext="docx" default="true" urlsrc="${baseUrl}/wopi?&lt;wopiSrc=WOPI_SOURCE&amp;&gt;" />
			<action name="edit" ext="docx" requires="locks,update" urlsrc="${baseUrl}/wopi?&lt;wopiSrc=WOPI_SOURCE&amp;&gt;" />
		</app>
	</net-zone>
	<proof-key oldvalue="B2" value="B8Q1"/>
</wopi-discovery>`;

    } catch (err) {
      logger.error('wopiDiscovery error\r\n%s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/xml');
      res.send(output);
      logger.info('wopiDiscovery end');
    }
  });
};
exports.isWopiCallback = function(url) {
  return url && url.startsWith("{");
};
exports.editor = function(req, res) {
  return co(function*() {
    try {
      logger.info('wopiEditor start');
      logger.debug(`wopiEditor req.query:${JSON.stringify(req.query)}`);
      logger.debug(`wopiEditor req.body:${JSON.stringify(req.body)}`);
      let wopiSrc = req.query['WOPISrc'];
      let access_token = req.body['access_token'];
      let access_token_ttl = req.body['access_token_ttl'];

      let uri = `${wopiSrc}?access_token=${access_token}`;

      //checkFileInfo
      let checkFileInfo = undefined;
      try {
        let getRes = yield utils.downloadUrlPromise(uri);
        checkFileInfo = JSON.parse(getRes.body);
        logger.debug(`wopiEditor checkFileInfo headers=%j body=%s`, getRes.response.headers, getRes.body);
      } catch (err) {
        if (err.response) {
          logger.error('wopiEditor error checkFileInfo statusCode=%s headers=%j', err.response.statusCode, err.response.headers);
        }
        logger.error('wopiEditor error checkFileInfo:%s', err.stack);
      }

      //docId
      let docId = undefined;
      if (checkFileInfo) {
        if (checkFileInfo.SHA256) {
          docId = checkFileInfo.SHA256;
        } else if (checkFileInfo.UniqueContentId) {
          docId = checkFileInfo.UniqueContentId;
        } else {
          let fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
          docId = `${fileId}.${checkFileInfo.Version}`;
        }
      }
      logger.debug(`wopiEditor docId=%s`, docId);

      //Lock
      let lockId = undefined;
      if (checkFileInfo && checkFileInfo.SupportsLocks) {
        let isNewLock = true;
        let selectRes = yield taskResult.select(docId);
        if (selectRes.length > 0) {
          var row = selectRes[0];
          if (row.callback) {
            let callback = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, row.callback, 1);
            if (callback) {
              lockId = JSON.parse(callback).lockId;
              isNewLock = false;
            }
          }
        }

        if (isNewLock) {
          lockId = crypto.randomBytes(16).toString('base64');
        }
        try {
          let headers = {"X-WOPI-Override": "LOCK", "X-WOPI-Lock": lockId};
          exports.fillStandardHeaders(headers, uri, access_token);
          let postRes = yield utils.postRequestPromise(uri, undefined, undefined, undefined, headers);
          logger.debug('wopiEditor Lock headers=%j', postRes.response.headers);
        } catch (err) {
          lockId = undefined;
          if (err.response) {
            logger.error('wopiEditor error Lock statusCode=%s headers=%j', err.response.statusCode, err.response.headers);
          }
          logger.error('wopiEditor error Lock:%s', err.stack);
        }
        if (lockId && isNewLock) {
          let docProperties = JSON.stringify({lockId: lockId, fileInfo: checkFileInfo});
          yield canvasService.commandOpenStartPromise(docId, utils.getBaseUrlByRequest(req), true, docProperties);
        }
      }

      if (checkFileInfo && (lockId || !checkFileInfo.SupportsLocks)) {
        for (let i in fileInfoBlockList) {
          if (fileInfoBlockList.hasOwnProperty(i)) {
            delete checkFileInfo[i];
          }
        }
        let userAuth = {wopiSrc: wopiSrc, access_token: access_token, access_token_ttl: access_token_ttl};
        let params = {key: docId, fileInfo: checkFileInfo, userAuth: userAuth};
        if (cfgTokenEnableBrowser) {
          let options = {algorithm: cfgTokenOutboxAlgorithm, expiresIn: cfgTokenOutboxExpires};
          let secret = utils.getSecretByElem(cfgSignatureSecretOutbox);
          params.token = jwt.sign(params, secret, options);
        }
        res.render("editor2", params);
        logger.debug('wopiEditor render params=%j', params);
      } else {
        logger.error('wopiEditor can not open');
        res.sendStatus(400);
      }
    } catch (err) {
      logger.error('wopiEditor error\r\n%s', err.stack);
      res.sendStatus(400);
    } finally {
      logger.info('wopiEditor end');
    }
  });
};
exports.unlock = function(headers, url, access_token) {
  return co(function* () {
    try {
      logger.info('wopi Unlock start');
      let uri = 0;
      let headers = {"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": lockId};
      exports.fillStandardHeaders(headers, uri, access_token);
      let postRes = yield utils.postRequestPromise(uri, undefined, undefined, undefined, headers);
      logger.debug('wopi Unlock headers=%j', postRes.response.headers);
    } catch (err) {
      lockId = undefined;
      if (err.response) {
        logger.error('wopi error Unlock statusCode=%s headers=%j', err.response.statusCode, err.response.headers);
      }
      logger.error('wopi error Unlock:%s', err.stack);
    } finally {
      logger.info('wopi Unlock end');
    }
  });
};
exports.generateProof = function(url, accessToken, timeStamp) {
  return generateProofSign(url, accessToken, timeStamp, cfgWopiPrivateKey);
};
exports.generateProofOld = function(url, accessToken, timeStamp) {
  return generateProofSign(url, accessToken, timeStamp, cfgWopiPrivateKeyOld);
};
exports.fillStandardHeaders = function(headers, url, access_token) {
  let timeStamp = utils.getDateTimeTicks(new Date());
  headers['X-WOPI-Proof'] = exports.generateProof(url, access_token, timeStamp);
  headers['X-WOPI-ProofOld'] = exports.generateProof(url, access_token, timeStamp);
  headers['X-WOPI-TimeStamp'] = timeStamp;
};
