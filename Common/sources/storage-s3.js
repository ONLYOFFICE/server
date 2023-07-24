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
var url = require('url');
var path = require('path');
const { S3Client, ListObjectsCommand, HeadObjectCommand} = require("@aws-sdk/client-s3");
const { GetObjectCommand, PutObjectCommand, CopyObjectCommand} = require("@aws-sdk/client-s3");
const { DeleteObjectsCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
var mime = require('mime');
var utils = require('./utils');
const ms = require('ms');
const commonDefines = require('./../../Common/sources/commondefines');

var config = require('config');
var configStorage = require('config').get('storage');
var cfgRegion = configStorage.get('region');
var cfgEndpoint = configStorage.get('endpoint');
var cfgBucketName = configStorage.get('bucketName');
var cfgStorageFolderName = configStorage.get('storageFolderName');
var cfgAccessKeyId = configStorage.get('accessKeyId');
var cfgSecretAccessKey = configStorage.get('secretAccessKey');
var cfgSslEnabled = configStorage.get('sslEnabled');
var cfgS3ForcePathStyle = configStorage.get('s3ForcePathStyle');
var configFs = configStorage.get('fs');
var cfgStorageUrlExpires = configFs.get('urlExpires');
const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));

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
  credentials : {
  accessKeyId: cfgAccessKeyId,
  secretAccessKey: cfgSecretAccessKey
  }
};

if (configS3.endpoint) {
  configS3.sslEnabled = cfgSslEnabled;
  configS3.s3ForcePathStyle = cfgS3ForcePathStyle;
}
const client  = new S3Client(configS3);

//This operation enables you to delete multiple objects from a bucket using a single HTTP request. You may specify up to 1000 keys.
var MAX_DELETE_OBJECTS = 1000;

function getFilePath(strPath) {
  //todo
  return cfgStorageFolderName + '/' + strPath;
}
function joinListObjects(inputArray, outputArray) {
  if (!inputArray) {
    return;
  }
  var length = inputArray.length;
  for (var i = 0; i < length; i++) {
    outputArray.push(inputArray[i].Key.substring((cfgStorageFolderName + '/').length));
  }
}
async function listObjectsExec(output, params) {
  const data = await client.send(new ListObjectsCommand(params));
      joinListObjects(data.Contents, output);
  if (data.IsTruncated && (data.NextMarker || (data.Contents && data.Contents.length > 0))) {
        params.Marker = data.NextMarker || data.Contents[data.Contents.length - 1].Key;
    return await listObjectsExec(output, params);
      } else {
    return output;
      }
}
async function deleteObjectsHelp(aKeys) {
    //By default, the operation uses verbose mode in which the response includes the result of deletion of each key in your request.
    //In quiet mode the response includes only keys where the delete operation encountered an error.
  const input = {
    Bucket: cfgBucketName,
    Delete: {
      Objects: aKeys,
      Quiet: true
      }
  };
  const command = new DeleteObjectsCommand(input);
  return await client.send(command);
}

exports.headObject = async function(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new HeadObjectCommand(input);
  return await client.send(command);
};
exports.getObject = async function(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new GetObjectCommand(input);
  const output = await client.send(command);

  return await utils.stream2Buffer(output.Body);
};
exports.createReadStream = async function(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
          };
  const command = new GetObjectCommand(input);
  const output = await client.send(command);
  return {
    contentLength: output.ContentLength,
    readStream: output.Body
  };
};
exports.putObject = async function(strPath, buffer, contentLength) {
    //todo consider Expires
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    Body: buffer,
    ContentLength: contentLength,
    ContentType: mime.getType(strPath)
  };
  const command = new PutObjectCommand(input);
  return await client.send(command);
};
exports.uploadObject = async function(strPath, filePath) {
  const file = fs.createReadStream(filePath);
  //todo рассмотреть Expires
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    Body: file,
    ContentType: mime.getType(strPath)
  };
  const command = new PutObjectCommand(input);
  return await client.send(command);
};
exports.copyObject = function(sourceKey, destinationKey) {
  //todo source bucket
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(destinationKey),
    CopySource: `/${cfgBucketName}/${getFilePath(sourceKey)}`
  };
  const command = new CopyObjectCommand(input);
  return client.send(command);
};
exports.listObjects = async function(strPath) {
    var params = {Bucket: cfgBucketName, Prefix: getFilePath(strPath)};
    var output = [];
  return await listObjectsExec(output, params);
};
exports.deleteObject = function(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new DeleteObjectCommand(input);
  return client.send(command);
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
exports.getSignedUrl = async function (ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate) {
    var expires = (commonDefines.c_oAscUrlTypes.Session === urlType ? cfgExpSessionAbsolute / 1000 : cfgStorageUrlExpires) || 31536000;
  // Signature version 4 presigned URLs must have an expiration date less than one week in the future
  expires = Math.min(expires, 604800);
    var userFriendlyName = optFilename ? optFilename.replace(/\//g, "%2f") : path.basename(strPath);
    var contentDisposition = utils.getContentDisposition(userFriendlyName, null, null);

  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    ResponseContentDisposition: contentDisposition
  };
  const command = new GetObjectCommand(input);
    //default Expires 900 seconds
  var options = {
    expiresIn: expires
    };
  return await getSignedUrl(client, command, options);
  //extra query params cause SignatureDoesNotMatch
  //https://stackoverflow.com/questions/55503009/amazon-s3-signature-does-not-match-when-extra-query-params-ga-added-in-url
  // return utils.changeOnlyOfficeUrl(url, strPath, optFilename);
};
