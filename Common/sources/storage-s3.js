/*
 * (c) Copyright Ascensio System SIA 2010-2018
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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
var url = require('url');
var path = require('path');
var AWS = require('aws-sdk');
var mime = require('mime');
var s3urlSigner = require('amazon-s3-url-signer');
var utils = require('./utils');

var configStorage = require('config').get('storage');
var cfgRegion = configStorage.get('region');
var cfgEndpoint = configStorage.get('endpoint');
var cfgBucketName = configStorage.get('bucketName');
var cfgStorageFolderName = configStorage.get('storageFolderName');
var cfgAccessKeyId = configStorage.get('accessKeyId');
var cfgSecretAccessKey = configStorage.get('secretAccessKey');
var cfgUseRequestToGetUrl = configStorage.get('useRequestToGetUrl');
var cfgUseSignedUrl = configStorage.get('useSignedUrl');
var cfgExternalHost = configStorage.get('externalHost');
/**
 * Don't hard-code your credentials!
 * Export the following environment variables instead:
 *
 * export AWS_ACCESS_KEY_ID='AKID'
 * export AWS_SECRET_ACCESS_KEY='SECRET'
 */
var configS3 = {
  region: cfgRegion,
  endpoint: cfgEndpoint,
  accessKeyId: cfgAccessKeyId,
  secretAccessKey: cfgSecretAccessKey
};
if (configS3.endpoint) {
  configS3.sslEnabled = false;
  configS3.s3ForcePathStyle = true;
}
AWS.config.update(configS3);
var s3Client = new AWS.S3();
if (configS3.endpoint) {
  s3Client.endpoint = new AWS.Endpoint(configS3.endpoint);
}
var cfgEndpointParsed = null;
if (cfgEndpoint) {
  cfgEndpointParsed = url.parse(cfgEndpoint);
}
//This operation enables you to delete multiple objects from a bucket using a single HTTP request. You may specify up to 1000 keys.
var MAX_DELETE_OBJECTS = 1000;

function getFilePath(strPath) {
  //todo
  return cfgStorageFolderName + '/' + strPath;
}
function joinListObjects(inputArray, outputArray) {
  var length = inputArray.length;
  for (var i = 0; i < length; i++) {
    outputArray.push(inputArray[i].Key.substring((cfgStorageFolderName + '/').length));
  }
}
function listObjectsExec(output, params, resolve, reject) {
  s3Client.listObjects(params, function(err, data) {
    if (err) {
      reject(err);
    } else {
      joinListObjects(data.Contents, output);
      if (data.IsTruncated && (data.NextMarker || data.Contents.length > 0)) {
        params.Marker = data.NextMarker || data.Contents[data.Contents.length - 1].Key;
        listObjectsExec(output, params, resolve, reject);
      } else {
        resolve(output);
      }
    }
  });
}
function mapDeleteObjects(currentValue) {
  return {Key: currentValue};
}
function deleteObjectsHelp(aKeys) {
  return new Promise(function(resolve, reject) {
    //By default, the operation uses verbose mode in which the response includes the result of deletion of each key in your request.
    //In quiet mode the response includes only keys where the delete operation encountered an error.
    var params = {Bucket: cfgBucketName, Delete: {Objects: aKeys, Quiet: true}};
    s3Client.deleteObjects(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

exports.getObject = function(strPath) {
  return new Promise(function(resolve, reject) {
    var params = {Bucket: cfgBucketName, Key: getFilePath(strPath)};
    s3Client.getObject(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data.Body);
      }
    });
  });
};
exports.putObject = function(strPath, buffer, contentLength) {
  return new Promise(function(resolve, reject) {
    //todo рассмотреть Expires
    var params = {Bucket: cfgBucketName, Key: getFilePath(strPath), Body: buffer,
      ContentLength: contentLength, ContentType: mime.getType(strPath)};
    s3Client.putObject(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
exports.uploadObject = function(strPath, filePath) {
  return new Promise(function(resolve, reject) {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  }).then(function(data) {
    return exports.putObject(strPath, data, data.length);
  });
};
exports.copyObject = function(sourceKey, destinationKey) {
  return exports.getObject(sourceKey).then(function(data) {
    return exports.putObject(destinationKey, data, data.length);
  });
};
exports.listObjects = function(strPath) {
  return new Promise(function(resolve, reject) {
    var params = {Bucket: cfgBucketName, Prefix: getFilePath(strPath)};
    var output = [];
    listObjectsExec(output, params, resolve, reject);
  });
};
exports.deleteObject = function(strPath) {
  return new Promise(function(resolve, reject) {
    var params = {Bucket: cfgBucketName, Key: getFilePath(strPath)};
    s3Client.deleteObject(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
exports.deleteObjects = function(strPaths) {
  var aKeys = strPaths.map(function (currentValue) {
    return {Key: getFilePath(currentValue)};
  });
  var deletePromises = [];
  for (var i = 0; i < aKeys.length; i += MAX_DELETE_OBJECTS) {
    deletePromises.push(deleteObjectsHelp(aKeys.slice(i, i + MAX_DELETE_OBJECTS)));
  }
  return Promise.all(deletePromises);
};
exports.getSignedUrl = function(baseUrl, strPath, urlType, optFilename, opt_type) {
  return new Promise(function(resolve, reject) {
    var expires = (commonDefines.c_oAscUrlTypes.Session === urlType ? cfgExpSessionAbsolute : cfgStorageUrlExpires) || 31536000;
    var userFriendlyName = optFilename ? optFilename.replace(/\//g, "%2f") : path.basename(strPath);
    var contentDisposition = utils.getContentDispositionS3(userFriendlyName, null, opt_type);
    if (cfgUseRequestToGetUrl) {
      //default Expires 900 seconds
      var params = {
        Bucket: cfgBucketName, Key: getFilePath(strPath), ResponseContentDisposition: contentDisposition, Expires: expires
      };
      s3Client.getSignedUrl('getObject', params, function(err, data) {
        if (err) {
          reject(err);
        } else {
          resolve(utils.changeOnlyOfficeUrl(data, strPath, optFilename));
        }
      });
    } else {
      var host;
      if (cfgRegion) {
        host = 'https://s3-'+cfgRegion+'.amazonaws.com';
      } else if (cfgEndpointParsed &&
        (cfgEndpointParsed.hostname == 'localhost' || cfgEndpointParsed.hostname == '127.0.0.1') &&
        80 == cfgEndpointParsed.port) {
        host = (cfgExternalHost ? cfgExternalHost : baseUrl) + cfgEndpointParsed.path;
      } else {
        host = cfgEndpoint;
      }
      if (host && host.length > 0 && '/' != host[host.length - 1]) {
        host += '/';
      }
      var newUrl;
      if (cfgUseSignedUrl) {
        //todo уйти от parse
        var hostParsed = url.parse(host);
        var protocol = hostParsed.protocol.substring(0, hostParsed.protocol.length - 1);
        var signerOptions = {
          host: hostParsed.hostname, port: hostParsed.port,
          protocol: protocol, useSubdomain: false
        };
        var awsUrlSigner = s3urlSigner.urlSigner(cfgAccessKeyId, cfgSecretAccessKey, signerOptions);
        newUrl = awsUrlSigner.getUrl('GET', getFilePath(strPath), cfgBucketName, expires, contentDisposition);
      } else {
        newUrl = host + cfgBucketName + '/' + cfgStorageFolderName + '/' + strPath;
      }
      resolve(utils.changeOnlyOfficeUrl(newUrl, strPath, optFilename));
    }
  });
};
