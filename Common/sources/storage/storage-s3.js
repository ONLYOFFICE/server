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
const {Agent: HttpsAgent} = require('https');
const {Agent: HttpAgent} = require('http');
const path = require('path');
const {S3Client, ListObjectsCommand, HeadObjectCommand} = require('@aws-sdk/client-s3');
const {GetObjectCommand, PutObjectCommand, CopyObjectCommand} = require('@aws-sdk/client-s3');
const {DeleteObjectsCommand, DeleteObjectCommand} = require('@aws-sdk/client-s3');
const {getSignedUrl} = require('@aws-sdk/s3-request-presigner');
const {NodeHttpHandler} = require('@smithy/node-http-handler');
const mime = require('mime');
const config = require('config');
const utils = require('../utils');
const ms = require('ms');
const commonDefines = require('../commondefines');

const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));
const cfgRequestDefaults = config.util.cloneDeep(config.get('services.CoAuthoring.requestDefaults'));
const cfgCacheStorage = config.get('storage');

//This operation enables you to delete multiple objects from a bucket using a single HTTP request. You may specify up to 1000 keys.
const MAX_DELETE_OBJECTS = 1000;
const clients = {};

/**
 * @param {Object} input - S3 command
 * @param {Object} storageCfg - Storage configuration
 * @param {string} commandType - putObject, copyObject, etc.
 */
function applyCommandOptions(input, storageCfg, commandType) {
  if (storageCfg.commandOptions && storageCfg.commandOptions.s3 && storageCfg.commandOptions.s3[commandType]) {
    Object.assign(input, storageCfg.commandOptions.s3[commandType]);
  }
}

// Builds a cache key from all fields passed to S3Client. \0 separator cannot appear in config values, preventing key collisions.
function buildS3ClientKey(storageCfg, rejectUnauthorized) {
  return `${storageCfg.region ?? ''}\0${storageCfg.endpoint ?? ''}\0${storageCfg.accessKeyId ?? ''}\0${storageCfg.secretAccessKey ?? ''}\0${storageCfg.sslEnabled ?? ''}\0${storageCfg.s3ForcePathStyle ?? ''}\0${rejectUnauthorized}`;
}

// Returns a cached S3Client; reads rejectUnauthorized from ctx so runtime config changes are picked up immediately.
function getS3Client(ctx, storageCfg) {
  const rejectUnauthorized = ctx.getCfg('services.CoAuthoring.requestDefaults.rejectUnauthorized', cfgRequestDefaults.rejectUnauthorized);

  const cacheKey = buildS3ClientKey(storageCfg, rejectUnauthorized);
  let client = clients[cacheKey];

  if (!client) {
    // evict stale client for the opposite TLS value
    delete clients[buildS3ClientKey(storageCfg, !rejectUnauthorized)];

    const configS3 = {
      region: storageCfg.region,
      endpoint: storageCfg.endpoint
    };
    if (storageCfg.accessKeyId && storageCfg.secretAccessKey) {
      configS3.credentials = {
        accessKeyId: storageCfg.accessKeyId,
        secretAccessKey: storageCfg.secretAccessKey
      };
    }
    if (configS3.endpoint) {
      configS3.tls = storageCfg.sslEnabled;
      configS3.forcePathStyle = storageCfg.s3ForcePathStyle;
    }
    // AWS SDK uses its own HTTP handler; only rejectUnauthorized applies from requestDefaults.
    const httpsAgent = new HttpsAgent({rejectUnauthorized});
    const httpAgent = new HttpAgent({rejectUnauthorized});
    configS3.requestHandler = new NodeHttpHandler({httpAgent, httpsAgent});
    client = new S3Client(configS3);
    clients[cacheKey] = client;
  }
  return client;
}

function getFilePath(storageCfg, strPath) {
  const storageFolderName = storageCfg.storageFolderName;
  return storageFolderName + '/' + strPath;
}
function joinListObjects(storageCfg, inputArray, outputArray) {
  if (!inputArray) {
    return;
  }
  const storageFolderName = storageCfg.storageFolderName;
  const length = inputArray.length;
  for (let i = 0; i < length; i++) {
    outputArray.push(inputArray[i].Key.substring((storageFolderName + '/').length));
  }
}
async function listObjectsExec(ctx, storageCfg, output, params) {
  applyCommandOptions(params, storageCfg, 'listObjects');

  const data = await getS3Client(ctx, storageCfg).send(new ListObjectsCommand(params));
  joinListObjects(storageCfg, data.Contents, output);
  if (data.IsTruncated && (data.NextMarker || (data.Contents && data.Contents.length > 0))) {
    params.Marker = data.NextMarker || data.Contents[data.Contents.length - 1].Key;
    return await listObjectsExec(ctx, storageCfg, output, params);
  } else {
    return output;
  }
}
async function deleteObjectsHelp(ctx, storageCfg, aKeys) {
  //By default, the operation uses verbose mode in which the response includes the result of deletion of each key in your request.
  //In quiet mode the response includes only keys where the delete operation encountered an error.
  const input = {
    Bucket: storageCfg.bucketName,
    Delete: {
      Objects: aKeys,
      Quiet: true
    }
  };
  applyCommandOptions(input, storageCfg, 'deleteObject');

  const command = new DeleteObjectsCommand(input);
  await getS3Client(ctx, storageCfg).send(command);
}

async function headObject(ctx, storageCfg, strPath) {
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath)
  };
  const command = new HeadObjectCommand(input);
  const output = await getS3Client(ctx, storageCfg).send(command);
  return {ContentLength: output.ContentLength};
}
async function getObject(ctx, storageCfg, strPath) {
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath)
  };
  applyCommandOptions(input, storageCfg, 'getObject');

  const command = new GetObjectCommand(input);
  const output = await getS3Client(ctx, storageCfg).send(command);

  return await utils.stream2Buffer(output.Body);
}
async function createReadStream(ctx, storageCfg, strPath) {
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath)
  };
  applyCommandOptions(input, storageCfg, 'getObject');

  const command = new GetObjectCommand(input);
  const output = await getS3Client(ctx, storageCfg).send(command);
  return {
    contentLength: output.ContentLength,
    readStream: output.Body
  };
}
async function putObject(ctx, storageCfg, strPath, buffer, contentLength) {
  //todo consider Expires
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath),
    Body: buffer,
    ContentLength: contentLength,
    ContentType: mime.getType(strPath)
  };
  applyCommandOptions(input, storageCfg, 'putObject');

  const command = new PutObjectCommand(input);
  await getS3Client(ctx, storageCfg).send(command);
}
async function uploadObject(ctx, storageCfg, strPath, filePath) {
  const file = fs.createReadStream(filePath);
  //todo рассмотреть Expires
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath),
    Body: file,
    ContentType: mime.getType(strPath)
  };
  applyCommandOptions(input, storageCfg, 'putObject');

  const command = new PutObjectCommand(input);
  await getS3Client(ctx, storageCfg).send(command);
}
async function copyObject(ctx, storageCfgSrc, storageCfgDst, sourceKey, destinationKey) {
  //todo source bucket
  const input = {
    Bucket: storageCfgDst.bucketName,
    Key: getFilePath(storageCfgDst, destinationKey),
    CopySource: `/${storageCfgSrc.bucketName}/${getFilePath(storageCfgSrc, sourceKey)}`
  };
  applyCommandOptions(input, storageCfgDst, 'copyObject');

  const command = new CopyObjectCommand(input);
  await getS3Client(ctx, storageCfgDst).send(command);
}
async function listObjects(ctx, storageCfg, strPath) {
  const params = {
    Bucket: storageCfg.bucketName,
    Prefix: getFilePath(storageCfg, strPath)
  };
  const output = [];
  await listObjectsExec(ctx, storageCfg, output, params);
  return output;
}
async function deleteObject(ctx, storageCfg, strPath) {
  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath)
  };
  applyCommandOptions(input, storageCfg, 'deleteObject');

  const command = new DeleteObjectCommand(input);
  await getS3Client(ctx, storageCfg).send(command);
}
async function deleteObjects(ctx, storageCfg, strPaths) {
  const aKeys = strPaths.map(currentValue => {
    return {Key: getFilePath(storageCfg, currentValue)};
  });
  for (let i = 0; i < aKeys.length; i += MAX_DELETE_OBJECTS) {
    await deleteObjectsHelp(ctx, storageCfg, aKeys.slice(i, i + MAX_DELETE_OBJECTS));
  }
}
async function deletePath(ctx, storageCfg, strPath) {
  const list = await listObjects(ctx, storageCfg, strPath);
  await deleteObjects(ctx, storageCfg, list);
}

async function getDirectSignedUrl(ctx, storageCfg, baseUrl, strPath, urlType, optFilename, _opt_creationDate) {
  const storageUrlExpires = storageCfg.fs.urlExpires;
  let expires = (commonDefines.c_oAscUrlTypes.Session === urlType ? cfgExpSessionAbsolute / 1000 : storageUrlExpires) || 31536000;
  // Signature version 4 presigned URLs must have an expiration date less than one week in the future
  expires = Math.min(expires, 604800);

  const userFriendlyName = optFilename ? optFilename.replace(/\//g, '%2f') : path.basename(strPath);
  const contentDisposition = utils.getContentDisposition(userFriendlyName, null, null);

  const input = {
    Bucket: storageCfg.bucketName,
    Key: getFilePath(storageCfg, strPath),
    ResponseContentDisposition: contentDisposition
  };
  applyCommandOptions(input, storageCfg, 'getObject');

  const command = new GetObjectCommand(input);
  //default Expires 900 seconds
  const options = {
    expiresIn: expires
  };
  return await getSignedUrl(getS3Client(ctx, storageCfg), command, options);
  //extra query params cause SignatureDoesNotMatch
  //https://stackoverflow.com/questions/55503009/amazon-s3-signature-does-not-match-when-extra-query-params-ga-added-in-url
  // return utils.changeOnlyOfficeUrl(url, strPath, optFilename);
}

function needServeStatic() {
  return !cfgCacheStorage.useDirectStorageUrls;
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
  getDirectSignedUrl,
  needServeStatic
};
