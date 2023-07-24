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
var config = require('config');
var utils = require('./utils');

var storage = require('./' + config.get('storage.name'));
var tenantManager = require('./tenantManager');

const cfgCacheFolderName = config.get('storage.cacheFolderName');

function getStoragePath(ctx, strPath, opt_specialDir) {
  opt_specialDir = opt_specialDir || cfgCacheFolderName;
  return opt_specialDir + '/' + tenantManager.getTenantPathPrefix(ctx) + strPath.replace(/\\/g, '/')
}

exports.headObject = function(ctx, strPath, opt_specialDir) {
  return storage.headObject(getStoragePath(ctx, strPath, opt_specialDir));
};
exports.getObject = function(ctx, strPath, opt_specialDir) {
  return storage.getObject(getStoragePath(ctx, strPath, opt_specialDir));
};
exports.createReadStream = function(ctx, strPath, opt_specialDir) {
  return storage.createReadStream(getStoragePath(ctx, strPath, opt_specialDir));
};
exports.putObject = function(ctx, strPath, buffer, contentLength, opt_specialDir) {
  return storage.putObject(getStoragePath(ctx, strPath, opt_specialDir), buffer, contentLength);
};
exports.uploadObject = function(ctx, strPath, filePath, opt_specialDir) {
  return storage.uploadObject(getStoragePath(ctx, strPath, opt_specialDir), filePath);
};
exports.copyObject = function(ctx, sourceKey, destinationKey, opt_specialDirSrc, opt_specialDirDst) {
  let storageSrc = getStoragePath(ctx, sourceKey, opt_specialDirSrc);
  let storageDst = getStoragePath(ctx, destinationKey, opt_specialDirDst);
  return storage.copyObject(storageSrc, storageDst);
};
exports.copyPath = function(ctx, sourcePath, destinationPath, opt_specialDirSrc, opt_specialDirDst) {
  let storageSrc = getStoragePath(ctx, sourcePath, opt_specialDirSrc);
  let storageDst = getStoragePath(ctx, destinationPath, opt_specialDirDst);
  return storage.listObjects(storageSrc).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return storage.copyObject(curValue, storageDst + '/' + exports.getRelativePath(storageSrc, curValue));
    }));
  });
};
exports.listObjects = function(ctx, strPath, opt_specialDir) {
  let prefix = getStoragePath(ctx, "", opt_specialDir);
  return storage.listObjects(getStoragePath(ctx, strPath, opt_specialDir)).then(function(list) {
    return list.map((currentValue) => {
      return currentValue.substring(prefix.length);
    });
  }).catch(function(e) {
    ctx.logger.error('storage.listObjects: %s', e.stack);
    return [];
  });
};
exports.deleteObject = function(ctx, strPath, opt_specialDir) {
  return storage.deleteObject(getStoragePath(ctx, strPath, opt_specialDir));
};
exports.deleteObjects = function(ctx, strPaths, opt_specialDir) {
  var StoragePaths = strPaths.map(function(curValue) {
    return getStoragePath(ctx, curValue, opt_specialDir);
  });
  return storage.deleteObjects(StoragePaths);
};
exports.deletePath = function(ctx, strPath, opt_specialDir) {
  let storageSrc = getStoragePath(ctx, strPath, opt_specialDir);
  return storage.listObjects(storageSrc).then(function(list) {
    return storage.deleteObjects(list);
  });
};
exports.getSignedUrl = function(ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate, opt_specialDir) {
  return storage.getSignedUrl(ctx, baseUrl, getStoragePath(ctx, strPath, opt_specialDir), urlType, optFilename, opt_creationDate);
};
exports.getSignedUrls = function(ctx, baseUrl, strPath, urlType, opt_creationDate, opt_specialDir) {
  let storageSrc = getStoragePath(ctx, strPath, opt_specialDir);
  return storage.listObjects(storageSrc).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return storage.getSignedUrl(ctx, baseUrl, curValue, urlType, undefined, opt_creationDate);
    })).then(function(urls) {
      var outputMap = {};
      for (var i = 0; i < list.length && i < urls.length; ++i) {
        outputMap[exports.getRelativePath(storageSrc, list[i])] = urls[i];
      }
      return outputMap;
    });
  });
};
exports.getSignedUrlsArrayByArray = function(ctx, baseUrl, list, urlType, opt_specialDir) {
    return Promise.all(list.map(function(curValue) {
    let storageSrc = getStoragePath(ctx, curValue, opt_specialDir);
    return storage.getSignedUrl(ctx, baseUrl, storageSrc, urlType, undefined);
  }));
};
exports.getSignedUrlsByArray = function(ctx, baseUrl, list, optPath, urlType, opt_specialDir) {
  return exports.getSignedUrlsArrayByArray(ctx, baseUrl, list, urlType, opt_specialDir).then(function(urls) {
    var outputMap = {};
    for (var i = 0; i < list.length && i < urls.length; ++i) {
      if (optPath) {
        let storageSrc = getStoragePath(ctx, optPath, opt_specialDir);
        outputMap[exports.getRelativePath(storageSrc, list[i])] = urls[i];
      } else {
        outputMap[list[i]] = urls[i];
      }
    }
    return outputMap;
  });
};
exports.getRelativePath = function(strBase, strPath) {
  return strPath.substring(strBase.length + 1);
};
