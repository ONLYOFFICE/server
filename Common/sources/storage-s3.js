/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
const fs = require('fs');
const url = require('url');
const path = require('path');
const { S3Client, ListObjectsCommand, HeadObjectCommand} = require("@aws-sdk/client-s3");
const { GetObjectCommand, PutObjectCommand, CopyObjectCommand} = require("@aws-sdk/client-s3");
const { DeleteObjectsCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const mime = require('mime');
const utils = require('./utils');
const ms = require('ms');
const commonDefines = require('./../../Common/sources/commondefines');

const config = require('config');
const configStorage = require('config').get('storage');
const cfgRegion = configStorage.get('region');
const cfgEndpoint = configStorage.get('endpoint');
const cfgBucketName = configStorage.get('bucketName');
const cfgStorageFolderName = configStorage.get('storageFolderName');
const cfgAccessKeyId = configStorage.get('accessKeyId');
const cfgSecretAccessKey = configStorage.get('secretAccessKey');
const cfgSslEnabled = configStorage.get('sslEnabled');
const cfgS3ForcePathStyle = configStorage.get('s3ForcePathStyle');
const configFs = configStorage.get('fs');
const cfgStorageUrlExpires = configFs.get('urlExpires');
const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));

/**
 * Don't hard-code your credentials!
 * Export the following environment variables instead:
 *
 * export AWS_ACCESS_KEY_ID='AKID'
 * export AWS_SECRET_ACCESS_KEY='SECRET'
 */
let configS3 = {
  region: cfgRegion,
  endpoint: cfgEndpoint,
  credentials : {
  accessKeyId: cfgAccessKeyId,
  secretAccessKey: cfgSecretAccessKey
  }
};

if (configS3.endpoint) {
  configS3.tls = cfgSslEnabled;
  configS3.forcePathStyle = cfgS3ForcePathStyle;
}
const client  = new S3Client(configS3);

//This operation enables you to delete multiple objects from a bucket using a single HTTP request. You may specify up to 1000 keys.
const MAX_DELETE_OBJECTS = 1000;

function getFilePath(strPath) {
  //todo
  return cfgStorageFolderName + '/' + strPath;
}
function joinListObjects(inputArray, outputArray) {
  if (!inputArray) {
    return;
  }
  let length = inputArray.length;
  for (let i = 0; i < length; i++) {
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
  await client.send(command);
}

async function headObject(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new HeadObjectCommand(input);
  let output = await client.send(command);
  return {ContentLength: output.ContentLength};
}
async function getObject(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new GetObjectCommand(input);
  const output = await client.send(command);

  return await utils.stream2Buffer(output.Body);
}
async function createReadStream(strPath) {
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
}
async function putObject(strPath, buffer, contentLength) {
    //todo consider Expires
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    Body: buffer,
    ContentLength: contentLength,
    ContentType: mime.getType(strPath)
  };
  const command = new PutObjectCommand(input);
  await client.send(command);
}
async function uploadObject(strPath, filePath) {
  const file = fs.createReadStream(filePath);
  //todo рассмотреть Expires
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    Body: file,
    ContentType: mime.getType(strPath)
  };
  const command = new PutObjectCommand(input);
  await client.send(command);
}
async function copyObject(sourceKey, destinationKey) {
  //todo source bucket
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(destinationKey),
    CopySource: `/${cfgBucketName}/${getFilePath(sourceKey)}`
  };
  const command = new CopyObjectCommand(input);
  await client.send(command);
}
async function listObjects(strPath) {
  let params = {
    Bucket: cfgBucketName,
    Prefix: getFilePath(strPath)
  };
  let output = [];
  await listObjectsExec(output, params);
  return output;
}
async function deleteObject(strPath) {
  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath)
  };
  const command = new DeleteObjectCommand(input);
  await client.send(command);
};
async function deleteObjects(strPaths) {
  let aKeys = strPaths.map(function (currentValue) {
    return {Key: getFilePath(currentValue)};
  });
  for (let i = 0; i < aKeys.length; i += MAX_DELETE_OBJECTS) {
    await deleteObjectsHelp(aKeys.slice(i, i + MAX_DELETE_OBJECTS));
  }
}
async function deletePath(strPath) {
  let list = await listObjects(strPath);
  await deleteObjects(list);
}
async function getSignedUrlWrapper(ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate) {
  let expires = (commonDefines.c_oAscUrlTypes.Session === urlType ? cfgExpSessionAbsolute / 1000 : cfgStorageUrlExpires) || 31536000;
  // Signature version 4 presigned URLs must have an expiration date less than one week in the future
  expires = Math.min(expires, 604800);
    let userFriendlyName = optFilename ? optFilename.replace(/\//g, "%2f") : path.basename(strPath);
    let contentDisposition = utils.getContentDisposition(userFriendlyName, null, null);

  const input = {
    Bucket: cfgBucketName,
    Key: getFilePath(strPath),
    ResponseContentDisposition: contentDisposition
  };
  const command = new GetObjectCommand(input);
    //default Expires 900 seconds
  let options = {
    expiresIn: expires
    };
  return await getSignedUrl(client, command, options);
  //extra query params cause SignatureDoesNotMatch
  //https://stackoverflow.com/questions/55503009/amazon-s3-signature-does-not-match-when-extra-query-params-ga-added-in-url
  // return utils.changeOnlyOfficeUrl(url, strPath, optFilename);
}

module.exports = {
  headObject,
  getObject,
  createReadStream,
  putObject,
  uploadObject,
  copyObject,
  listObjects,
  deleteObject,
  deletePath,
  getSignedUrl: getSignedUrlWrapper
};
