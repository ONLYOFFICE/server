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
var logger = require('./logger');

var storage = require('./' + config.get('storage.name'));
function getStoragePath(strPath) {
  return strPath.replace(/\\/g, '/');
}
exports.headObject = function(strPath) {
  return storage.headObject(getStoragePath(strPath));
};
exports.getObject = function(strPath) {
  return storage.getObject(getStoragePath(strPath));
};
exports.createReadStream = function(strPath) {
  return storage.createReadStream(getStoragePath(strPath));
};
exports.putObject = function(strPath, buffer, contentLength) {
  return storage.putObject(getStoragePath(strPath), buffer, contentLength);
};
exports.uploadObject = function(strPath, filePath) {
  return storage.uploadObject(strPath, filePath);
};
exports.copyObject = function(sourceKey, destinationKey) {
  return storage.copyObject(sourceKey, destinationKey);
};
exports.copyPath = function(sourcePath, destinationPath) {
  return exports.listObjects(getStoragePath(sourcePath)).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return exports.copyObject(curValue, destinationPath + '/' + exports.getRelativePath(sourcePath, curValue));
    }));
  });
};
exports.listObjects = function(strPath) {
  return storage.listObjects(getStoragePath(strPath)).catch(function(e) {
    logger.error('storage.listObjects:\r\n%s', e.stack);
    return [];
  });
};
exports.deleteObject = function(strPath) {
  return storage.deleteObject(getStoragePath(strPath));
};
exports.deleteObjects = function(strPaths) {
  var StoragePaths = strPaths.map(function(curValue) {
    return getStoragePath(curValue);
  });
  return storage.deleteObjects(StoragePaths);
};
exports.deletePath = function(strPath) {
  return exports.listObjects(getStoragePath(strPath)).then(function(list) {
    return exports.deleteObjects(list);
  });
};
exports.getSignedUrl = function(baseUrl, strPath, urlType, optFilename, opt_creationDate) {
  return storage.getSignedUrl(baseUrl, getStoragePath(strPath), urlType, optFilename, opt_creationDate);
};
exports.getSignedUrls = function(baseUrl, strPath, urlType, opt_creationDate) {
  return exports.listObjects(getStoragePath(strPath)).then(function(list) {
    return Promise.all(list.map(function(curValue) {
      return exports.getSignedUrl(baseUrl, curValue, urlType, undefined, opt_creationDate);
    })).then(function(urls) {
      var outputMap = {};
      for (var i = 0; i < list.length && i < urls.length; ++i) {
        outputMap[exports.getRelativePath(strPath, list[i])] = urls[i];
      }
      return outputMap;
    });
  });
};
exports.getSignedUrlsArrayByArray = function(baseUrl, list, urlType) {
  return Promise.all(list.map(function(curValue) {
    return exports.getSignedUrl(baseUrl, curValue, urlType, undefined);
  }));
};
exports.getSignedUrlsByArray = function(baseUrl, list, optPath, urlType) {
  return exports.getSignedUrlsArrayByArray(baseUrl, list, urlType).then(function(urls) {
    var outputMap = {};
    for (var i = 0; i < list.length && i < urls.length; ++i) {
      if (optPath) {
        outputMap[exports.getRelativePath(optPath, list[i])] = urls[i];
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
