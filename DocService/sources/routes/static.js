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

const { pipeline } = require('node:stream/promises');
const express = require('express');
const config = require('config');
const operationContext = require('./../../../Common/sources/operationContext');
const tenantManager = require('./../../../Common/sources/tenantManager');
const utils = require('./../../../Common/sources/utils');
const storage = require('./../../../Common/sources/storage/storage-base');
const urlModule = require("url");
const path = require("path");
const mime = require("mime");
const crypto = require('crypto');

const cfgStaticContent = config.has('services.CoAuthoring.server.static_content') ? config.util.cloneDeep(config.get('services.CoAuthoring.server.static_content')) : {};
const cfgCacheStorage = config.get('storage');
const cfgPersistentStorage = utils.deepMergeObjects({}, cfgCacheStorage, config.get('persistentStorage'));
const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgErrorFiles = config.get('FileConverter.converter.errorfiles');

const router = express.Router();

function initCacheRouter(cfgStorage, routs) {
  const { storageFolderName, fs: { folderPath, secretString: secret } } = cfgStorage;

  routs.forEach((rout) => {
    if (!rout) {return;}

    const rootPath = path.join(folderPath, rout);

    ['cache', 'storage-cache'].forEach(prefix => {
      const route = `/${prefix}/${storageFolderName}/${rout}`;
      router.use(route, createCacheMiddleware(prefix, rootPath, cfgStorage, secret, rout));
    });
  });
}

function createCacheMiddleware(prefix, rootPath, cfgStorage, secret, rout) {
  return async (req, res) => {
    const index = req.url.lastIndexOf('/');
    if (req.method !== 'GET' || index <= 0) {
      res.sendStatus(404);
      return;
    }

    try {
      const urlParsed = urlModule.parse(req.url, true);
      const { md5, expires } = urlParsed.query;
      const numericExpires = parseInt(expires);

      if (!md5 || !numericExpires) {
        res.sendStatus(403);
        return;
      }

      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime > numericExpires) {
        res.sendStatus(410);
        return;
      }

      const uri = req.url.split('?')[0];
      const fullPath = `/${prefix}/${cfgStorage.storageFolderName}/${rout}${uri}`;
      const signatureData = numericExpires + decodeURIComponent(fullPath) + secret;

      const expectedMd5 = crypto
        .createHash('md5')
        .update(signatureData)
        .digest('base64')
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      if (md5 !== expectedMd5) {
        res.sendStatus(403);
        return;
      }

      const filename = urlParsed.pathname && decodeURIComponent(path.basename(urlParsed.pathname));
      let filePath = decodeURI(req.url.substring(1, index));
      if (cfgStorage.name === 'storage-fs') {
        const sendFileOptions = {
          root: rootPath,
          dotfiles: 'deny',
          headers: {
            'Content-Disposition': 'attachment',
            ...(filename && { 'Content-Type': mime.getType(filename) })
          }
        };

        res.sendFile(filePath, sendFileOptions, (err) => {
          if (err) {
            operationContext.global.logger.error(err);
            res.status(400).end();
          }
        });
      } else if (['storage-s3', 'storage-az'].includes(cfgStorage.name)) {
        const ctx = new operationContext.Context();
        ctx.initFromRequest(req);
        await ctx.initTenantCache();
        if (tenantManager.isMultitenantMode(ctx) && filePath.startsWith(ctx.tenant + '/')) {
          filePath = filePath.substring(ctx.tenant.length + 1);
        }
        const result = await storage.createReadStream(ctx, filePath, rout);
        
        res.setHeader('Content-Type', mime.getType(filename));
        res.setHeader('Content-Length', result.contentLength);
        res.setHeader('Content-Disposition', utils.getContentDisposition(filename));
        await pipeline(result.readStream, res);
      } else {
        res.sendStatus(404);
      }
    } catch (e) {
      operationContext.global.logger.error(e);
      res.sendStatus(400);
    }
  };
}

for (const i in cfgStaticContent) {
  if (cfgStaticContent.hasOwnProperty(i)) {
    router.use(i, express.static(cfgStaticContent[i]['path'], cfgStaticContent[i]['options']));
  }
}
if (storage.needServeStatic()) {
  initCacheRouter(cfgCacheStorage, [cfgCacheStorage.cacheFolderName]);
}
if (storage.needServeStatic(cfgForgottenFiles)) {
  let persistentRouts = [cfgForgottenFiles, cfgErrorFiles];
  persistentRouts = persistentRouts.filter((rout) => {return rout && rout.length > 0;});
  if (persistentRouts.length > 0) {
    initCacheRouter(cfgPersistentStorage, persistentRouts);
  }
}

module.exports = router;
