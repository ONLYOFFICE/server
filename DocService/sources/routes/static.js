/*
 * (c) Copyright Ascensio System SIA 2010-2023
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
const express = require('express');
const config = require("config");
const operationContext = require('./../../../Common/sources/operationContext');
const utils = require('./../../../Common/sources/utils');
const storage = require('./../../../Common/sources/storage-base');
const urlModule = require("url");
const path = require("path");
const mime = require("mime");

const cfgStaticContent = config.has('services.CoAuthoring.server.static_content') ? config.get('services.CoAuthoring.server.static_content') : {};
const cfgCacheStorage = config.get('storage');
const cfgPersistentStorage = utils.deepMergeObjects({}, cfgCacheStorage, config.get('persistentStorage'));
const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgErrorFiles = config.get('FileConverter.converter.errorfiles');

const router = express.Router();

function initCacheRouter(cfgStorage, routs) {
  const bucketName = cfgStorage.bucketName;
  const storageFolderName = cfgStorage.storageFolderName;
  const folderPath = cfgStorage.fs.folderPath;
  routs.forEach((rout) => {
    //special dirs are empty by default
    if (!rout) {
      return;
    }
    let rootPath = path.join(folderPath, rout);
    router.use(`/${bucketName}/${storageFolderName}/${rout}`, (req, res, next) => {
      const index = req.url.lastIndexOf('/');
      if ('GET' === req.method && index > 0) {
        let sendFileOptions = {
          root: rootPath, dotfiles: 'deny', headers: {
            'Content-Disposition': 'attachment'
          }
        };
        const urlParsed = urlModule.parse(req.url);
        if (urlParsed && urlParsed.pathname) {
          const filename = decodeURIComponent(path.basename(urlParsed.pathname));
          sendFileOptions.headers['Content-Type'] = mime.getType(filename);
        }
        const realUrl = decodeURI(req.url.substring(0, index));
        res.sendFile(realUrl, sendFileOptions, (err) => {
          if (err) {
            operationContext.global.logger.error(err);
            res.status(400).end();
          }
        });
      } else {
        res.sendStatus(404);
      }
    });
  });
}

for (let i in cfgStaticContent) {
  if (cfgStaticContent.hasOwnProperty(i)) {
    router.use(i, express.static(cfgStaticContent[i]['path'], cfgStaticContent[i]['options']));
  }
}
if (storage.needServeStatic()) {
  initCacheRouter(cfgCacheStorage, [cfgCacheStorage.cacheFolderName]);
}
if (storage.needServeStatic(cfgForgottenFiles)) {
  let persistentRouts = [cfgForgottenFiles, cfgErrorFiles];
  persistentRouts.filter((rout) => {return rout && rout.length > 0;});
  if (persistentRouts.length > 0) {
    initCacheRouter(cfgPersistentStorage, [cfgForgottenFiles, cfgErrorFiles]);
  }
}

module.exports = router;
