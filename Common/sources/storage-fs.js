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

var fs = require('fs');
const fse = require('fs-extra')
var path = require('path');
var mkdirp = require('mkdirp');
var utils = require("./utils");
var crypto = require('crypto');
const ms = require('ms');
const commonDefines = require('./../../Common/sources/commondefines');

var config = require('config');
var configStorage = config.get('storage');
var cfgBucketName = configStorage.get('bucketName');
var cfgStorageFolderName = configStorage.get('storageFolderName');
var configFs = configStorage.get('fs');
var cfgStorageFolderPath = configFs.get('folderPath');
var cfgStorageSecretString = configFs.get('secretString');
var cfgStorageUrlExpires = configFs.get('urlExpires');
const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));

function getFilePath(strPath) {
  return path.join(cfgStorageFolderPath, strPath);
}
function getOutputPath(strPath) {
  return strPath.replace(/\\/g, '/');
}
function removeEmptyParent(strPath, done) {
  if (cfgStorageFolderPath.length + 1 >= strPath.length) {
    done();
  } else {
    fs.readdir(strPath, function(err, list) {
      if (err) {
        //we do not react to the error, because most likely this folder was deleted in a neighboring thread
        done();
      } else {
        if (list.length > 0) {
          done();
        } else {
          fs.rmdir(strPath, function(err) {
            if (err) {
              //we do not react to the error, because most likely this folder was deleted in a neighboring thread
              done();
            } else {
              removeEmptyParent(path.dirname(strPath), function(err) {
                done(err);
              });
            }
          });
        }
      }
    });
  }
}

exports.headObject = function(strPath) {
  return utils.fsStat(getFilePath(strPath)).then(function(stats) {
    return {ContentLength: stats.size};
  });
};
exports.getObject = function(strPath) {
  return utils.readFile(getFilePath(strPath));
};
exports.createReadStream = function(strPath) {
  let fsPath = getFilePath(strPath);
  let contentLength;
  return new Promise(function(resolve, reject) {
    fs.stat(fsPath, function(err, stats) {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  }).then(function(stats){
    contentLength = stats.size;
    return utils.promiseCreateReadStream(fsPath);
  }).then(function(readStream, stats){
    return {
      contentLength: contentLength,
      readStream: readStream
    };
  });
};

exports.putObject = function(strPath, buffer, contentLength) {
  return new Promise(function(resolve, reject) {
    var fsPath = getFilePath(strPath);
    mkdirp(path.dirname(fsPath), function(err) {
      if (err) {
        reject(err);
      } else {
        //todo 0666
        if (Buffer.isBuffer(buffer)) {
          fs.writeFile(fsPath, buffer, function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } else {
          utils.promiseCreateWriteStream(fsPath).then(function(writable) {
            buffer.pipe(writable);
          }).catch(function(err) {
            reject(err);
          });
        }
      }
    });
  });
};
exports.uploadObject = function(strPath, filePath) {
  let fsPath = getFilePath(strPath);
  return fse.copy(filePath, fsPath);
};
exports.copyObject = function(sourceKey, destinationKey) {
  let fsPathSource = getFilePath(sourceKey);
  let fsPathSestination = getFilePath(destinationKey);
  return fse.copy(fsPathSource, fsPathSestination);
};
exports.listObjects = function(strPath) {
  return utils.listObjects(getFilePath(strPath)).then(function(values) {
    return values.map(function(curvalue) {
      return getOutputPath(curvalue.substring(cfgStorageFolderPath.length + 1));
    });
  });
};
exports.deleteObject = function(strPath) {
  return new Promise(function(resolve, reject) {
    const fsPath = getFilePath(strPath);
    fs.unlink(fsPath, function(err) {
      if (err) {
        reject(err);
      } else {
        //resolve();
        removeEmptyParent(path.dirname(fsPath), function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  });
};
exports.deleteObjects = function(strPaths) {
  return Promise.all(strPaths.map(exports.deleteObject));
};
exports.getSignedUrl = function(ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate) {
  return new Promise(function(resolve, reject) {
    //replace '/' with %2f before encodeURIComponent becase nginx determine %2f as '/' and get wrong system path
    var userFriendlyName = optFilename ? encodeURIComponent(optFilename.replace(/\//g, "%2f")) : path.basename(strPath);
    var uri = '/' + cfgBucketName + '/' + cfgStorageFolderName + '/' + strPath + '/' + userFriendlyName;
    //RFC 1123 does not allow underscores https://stackoverflow.com/questions/2180465/can-domain-name-subdomains-have-an-underscore-in-it
    var url = utils.checkBaseUrl(ctx, baseUrl).replace(/_/g, "%5f");
    url += uri;

    var date = Date.now();
    let creationDate = opt_creationDate || date;
    let expiredAfter = (commonDefines.c_oAscUrlTypes.Session === urlType ? (cfgExpSessionAbsolute / 1000) : cfgStorageUrlExpires) || 31536000;
    //todo creationDate can be greater because mysql CURRENT_TIMESTAMP uses local time, not UTC
    var expires = creationDate + Math.ceil(Math.abs(date - creationDate)/expiredAfter) * expiredAfter;
    expires = Math.ceil(expires / 1000);
    expires += expiredAfter;

    var md5 = crypto.createHash('md5').update(expires + decodeURIComponent(uri) + cfgStorageSecretString).digest("base64");
    md5 = md5.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    url += '?md5=' + encodeURIComponent(md5);
    url += '&expires=' + encodeURIComponent(expires);
    url += '&filename=' + userFriendlyName;
    resolve(url);
  });
};
