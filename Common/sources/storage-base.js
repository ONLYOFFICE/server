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
var config = require('config');
var utils = require('./utils');

var storage = require('./' + config.get('storage.name'));

function removeIillegalCharacters(filename) {
  return filename.replace(/[/\\?%*:|"<>]/g, '-');
}
function getStoragePath(ctx, strPath) {
  return removeIillegalCharacters(ctx.tenant) + '/' + strPath.replace(/\\/g, '/');
}

exports.headObject = function(ctx, strPath) {
  return storage.headObject(getStoragePath(ctx, strPath));
};
exports.getObject = function(ctx, strPath) {
  return storage.getObject(getStoragePath(ctx, strPath));
};
exports.createReadStream = function(ctx, strPath) {
  return storage.createReadStream(getStoragePath(ctx, strPath));
};
exports.putObject = function(ctx, strPath, buffer, contentLength) {
  return storage.putObject(getStoragePath(ctx, strPath), buffer, contentLength);
};
exports.uploadObject = function(ctx, strPath, filePath) {
  return storage.uploadObject(getStoragePath(ctx, strPath), filePath);
};
exports.copyObject = function(ctx, sourceKey, destinationKey) {
  let storageSrc = getStoragePath(ctx, sourceKey);
  let storageDst = getStoragePath(ctx, destinationKey);
  return storage.copyObject(storageSrc, storageDst);
};
exports.copyPath = function(ctx, sourcePath, destinationPath) {
  let storageSrc = getStoragePath(ctx, sourcePath);
  let storageDst = getStoragePath(ctx, destinationPath);
  return storage.listObjects(storageSrc).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return storage.copyObject(curValue, storageDst + '/' + exports.getRelativePath(storageSrc, curValue));
    }));
  });
};
exports.listObjects = function(ctx, strPath) {
  return storage.listObjects(getStoragePath(ctx, strPath)).catch(function(e) {
    ctx.logger.error('storage.listObjects: %s', e.stack);
    return [];
  });
};
exports.deleteObject = function(ctx, strPath) {
  return storage.deleteObject(getStoragePath(ctx, strPath));
};
exports.deleteObjects = function(ctx, strPaths) {
  var StoragePaths = strPaths.map(function(curValue) {
    return getStoragePath(ctx, curValue);
  });
  return storage.deleteObjects(StoragePaths);
};
exports.deletePath = function(ctx, strPath) {
  let storageSrc = getStoragePath(ctx, strPath);
  return storage.listObjects(storageSrc).then(function(list) {
    return storage.deleteObjects(list);
  });
};
exports.getSignedUrl = function(baseUrl, ctx, strPath, urlType, optFilename, opt_creationDate) {
  return storage.getSignedUrl(baseUrl, getStoragePath(ctx, strPath), urlType, optFilename, opt_creationDate);
};
exports.getSignedUrls = function(baseUrl, ctx, strPath, urlType, opt_creationDate) {
  let storageSrc = getStoragePath(ctx, strPath);
  return storage.listObjects(storageSrc).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return storage.getSignedUrl(baseUrl, curValue, urlType, undefined, opt_creationDate);
    })).then(function(urls) {
      var outputMap = {};
      for (var i = 0; i < list.length && i < urls.length; ++i) {
        outputMap[exports.getRelativePath(strPath, list[i])] = urls[i];
      }
      return outputMap;
    });
  });
};
exports.getSignedUrlsArrayByArray = function(baseUrl, ctx, list, urlType) {
    return Promise.all(list.map(function(curValue) {
    let storageSrc = getStoragePath(ctx, curValue);
    return storage.getSignedUrl(baseUrl, storageSrc, urlType, undefined);
  }));
};
exports.getSignedUrlsByArray = function(baseUrl, ctx, list, optPath, urlType) {
  return exports.getSignedUrlsArrayByArray(baseUrl, ctx, list, urlType).then(function(urls) {
    var outputMap = {};
    for (var i = 0; i < list.length && i < urls.length; ++i) {
      if (optPath) {
        let storageSrc = getStoragePath(ctx, optPath);
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
