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
const canvasService = require('./canvasservice');
const logger = require('./../../Common/sources/logger');
const utils = require('./../../Common/sources/utils');


exports.discovery = function(req, res) {
  return co(function*() {
    let output = '';
    try {
      logger.debug('wopiDiscovery start');
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
      logger.debug('wopiDiscovery end');
    } catch (err) {
      logger.error('wopiDiscovery error\r\n%s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/xml');
      res.send(output);
    }
  });
};
exports.isWopiCallback = function(url) {
  return url.startsWith("{");
};
exports.editor = function(req, res) {
  return co(function*() {
    let output = '';
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
        } else {
          logger.error('wopiEditor error checkFileInfo');
        }
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
          docId = fileId + checkFileInfo.Version;
        }
      }
      logger.debug(`wopiEditor docId=%s`, docId);

      //Lock
      let lockId = undefined;
      if (checkFileInfo && checkFileInfo.SupportsLocks) {
        lockId = crypto.randomBytes(16).toString('base64');
        try {
          let headers = {"X-WOPI-Override": "LOCK", "X-WOPI-Lock": lockId};
          let postRes = yield utils.postRequestPromise(uri, undefined, undefined, undefined, headers);
          logger.error('wopiEditor Lock headers=%j', postRes.response.headers);
        } catch (err) {
          lockId = undefined;
          if(err.response) {
            logger.error('wopiEditor error Lock statusCode=%s headers=%j', err.response.statusCode, err.response.headers);
          } else {
            logger.error('wopiEditor error Lock', err.response.headers);
          }
        }
      }

      if(checkFileInfo && (lockId || !checkFileInfo.SupportsLocks)) {
        let docProperties = JSON.stringify({wopiSrc: wopiSrc, lockId: lockId, fileUrl: checkFileInfo.FileUrl});
        let upsertRes = yield canvasService.commandOpenStartPromise(docId, utils.getBaseUrlByRequest(req), true, docProperties);
        let callback = JSON.stringify({access_token: access_token, access_token_ttl: access_token_ttl});
        let argss = {
          "apiUrl": "http://127.0.0.1:8001/web-apps/apps/api/documents/api.js",
          "file": {
            "name": checkFileInfo.BaseFileName,
            "ext": path.extname(checkFileInfo.BaseFileName).substr(1),
            "uri": "",
            "version": checkFileInfo.Version,
            "created": "Thu Nov 05 2020",
            "favorite": "null"
          },
          "editor": {
            "type": "desktop",
            "documentType": "text",
            "key": docId,
            "token": "",
            "callbackUrl": callback.replace(/"/g, '\\"'),
            "isEdit": true,
            "review": true,
            "comment": true,
            "fillForms": true,
            "modifyFilter": true,
            "modifyContentControl": true,
            "mode": "edit",
            "canBackToFolder": true,
            "backUrl": "http://localhost/",
            "curUserHostAddress": "__1",
            "lang": "en",
            "userid": checkFileInfo.UserId,
            "name": checkFileInfo.UserFriendlyName,
            "reviewGroups": JSON.stringify([]),
            "fileChoiceUrl": "",
            "submitForm": false,
            "plugins": "{\"pluginsData\":[]}",
            "actionData": "null"
          },
          "history": [
            {
              "changes": null,
              "key": "__1http___localhost_files___1_new_20_133_.docx1604574058324",
              "version": 1,
              "created": "2020-11-5 14:00:58",
              "user": {
                "id": "uid-1",
                "name": "John Smith"
              }
            }
          ],
          "historyData": [
            {
              "version": 1,
              "key": "__1http___localhost_files___1_new_20_133_.docx1604574058324",
              "url": "http://localhost/files/__1/new%20(133).docx"
            }
          ],
          "dataInsertImage": {
          },
          "dataCompareFile": {
          },
          "dataMailMergeRecipients": {
          }
        };
        res.render("editor", argss);
      }
      logger.debug('wopiEditor end');
    } catch (err) {
      logger.error('wopiEditor error\r\n%s', err.stack);
    } finally {
    }
  });
};
