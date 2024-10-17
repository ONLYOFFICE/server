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
const os = require('os');
const cluster = require('cluster');
var config = require('config');
var utils = require('./utils');

const cfgCacheStorage = config.get('storage');
const cfgPersistentStorage = utils.deepMergeObjects({}, cfgCacheStorage, config.get('persistentStorage'));

const cacheStorage = require('./' + cfgCacheStorage.name);
const persistentStorage = require('./' + cfgPersistentStorage.name);
const tenantManager = require('./tenantManager');

const HEALTH_CHECK_KEY_MAX = 10000;

function getStoragePath(ctx, strPath, opt_specialDir) {
  opt_specialDir = opt_specialDir || cfgCacheStorage.cacheFolderName;
  return opt_specialDir + '/' + tenantManager.getTenantPathPrefix(ctx) + strPath.replace(/\\/g, '/');
}
function getStorage(opt_specialDir) {
  return opt_specialDir ? persistentStorage : cacheStorage;
}
function getStorageCfg(ctx, opt_specialDir) {
  return opt_specialDir ? cfgPersistentStorage : cfgCacheStorage;
}
function canCopyBetweenStorage(storageCfgSrc, storageCfgDst) {
  return storageCfgSrc.name === storageCfgDst.name && storageCfgSrc.endpoint === storageCfgDst.endpoint;
}
function isDiffrentPersistentStorage() {
  return !canCopyBetweenStorage(cacheStorage, cfgPersistentStorage);
}

async function headObject(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.headObject(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
}
async function getObject(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.getObject(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
}
async function createReadStream(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.createReadStream(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
}
async function putObject(ctx, strPath, buffer, contentLength, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.putObject(storageCfg, getStoragePath(ctx, strPath, opt_specialDir), buffer, contentLength);
}
async function uploadObject(ctx, strPath, filePath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.uploadObject(storageCfg, getStoragePath(ctx, strPath, opt_specialDir), filePath);
}
async function copyObject(ctx, sourceKey, destinationKey, opt_specialDirSrc, opt_specialDirDst) {
  let storageSrc = getStorage(opt_specialDirSrc);
  let storagePathSrc = getStoragePath(ctx, sourceKey, opt_specialDirSrc);
  let storagePathDst = getStoragePath(ctx, destinationKey, opt_specialDirDst);
  let storageCfgSrc = getStorageCfg(ctx, opt_specialDirSrc);
  let storageCfgDst = getStorageCfg(ctx, opt_specialDirDst);
  if (canCopyBetweenStorage(storageCfgSrc, storageCfgDst)){
    return await storageSrc.copyObject(storageCfgSrc, storageCfgDst, storagePathSrc, storagePathDst);
  } else {
    let storageDst = getStorage(opt_specialDirDst);
    //todo stream
    let buffer = await storageSrc.getObject(storageCfgSrc, storagePathSrc);
    return await storageDst.putObject(storageCfgDst, storagePathDst, buffer, buffer.length);
  }
}
async function copyPath(ctx, sourcePath, destinationPath, opt_specialDirSrc, opt_specialDirDst) {
  let list = await listObjects(ctx, sourcePath, opt_specialDirSrc);
  await Promise.all(list.map(function(curValue) {
    return copyObject(ctx, curValue, destinationPath + '/' + getRelativePath(sourcePath, curValue), opt_specialDirSrc, opt_specialDirDst);
  }));
}
async function listObjects(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  let prefix = getStoragePath(ctx, "", opt_specialDir);
  try {
    let list = await storage.listObjects(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
    return list.map((currentValue) => {
      return currentValue.substring(prefix.length);
    });
  } catch (e) {
    ctx.logger.error('storage.listObjects: %s', e.stack);
    return [];
  }
}
async function deleteObject(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.deleteObject(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
}
async function deletePath(ctx, strPath, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.deletePath(storageCfg, getStoragePath(ctx, strPath, opt_specialDir));
}
async function getSignedUrl(ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate, opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  return await storage.getSignedUrl(ctx, storageCfg, baseUrl, getStoragePath(ctx, strPath, opt_specialDir), urlType, optFilename, opt_creationDate);
}
async function getSignedUrls(ctx, baseUrl, strPath, urlType, opt_creationDate, opt_specialDir) {
  let storagePathSrc = getStoragePath(ctx, strPath, opt_specialDir);
  let storage = getStorage(opt_specialDir);
  let storageCfg = getStorageCfg(ctx, opt_specialDir);
  let list = await storage.listObjects(storageCfg, storagePathSrc, storageCfg);
  let urls = await Promise.all(list.map(function(curValue) {
    return storage.getSignedUrl(ctx, storageCfg, baseUrl, curValue, urlType, undefined, opt_creationDate);
  }));
  let outputMap = {};
  for (let i = 0; i < list.length && i < urls.length; ++i) {
    outputMap[getRelativePath(storagePathSrc, list[i])] = urls[i];
  }
  return outputMap;
}
async function getSignedUrlsArrayByArray(ctx, baseUrl, list, urlType, opt_specialDir) {
  return await Promise.all(list.map(function (curValue) {
    let storage = getStorage(opt_specialDir);
    let storageCfg = getStorageCfg(ctx, opt_specialDir);
    let storagePathSrc = getStoragePath(ctx, curValue, opt_specialDir);
    return storage.getSignedUrl(ctx, storageCfg, baseUrl, storagePathSrc, urlType, undefined);
  }));
}
async function getSignedUrlsByArray(ctx, baseUrl, list, optPath, urlType, opt_specialDir) {
  let urls = await getSignedUrlsArrayByArray(ctx, baseUrl, list, urlType, opt_specialDir);
  var outputMap = {};
  for (var i = 0; i < list.length && i < urls.length; ++i) {
    if (optPath) {
      let storagePathSrc = getStoragePath(ctx, optPath, opt_specialDir);
      outputMap[getRelativePath(storagePathSrc, list[i])] = urls[i];
    } else {
      outputMap[list[i]] = urls[i];
    }
  }
  return outputMap;
}
function getRelativePath(strBase, strPath) {
  return strPath.substring(strBase.length + 1);
}
async function healthCheck(ctx, opt_specialDir) {
  const clusterId = cluster.isWorker ? cluster.worker.id : '';
  const tempName = 'hc_' + os.hostname() + '_' + clusterId + '_' + Math.round(Math.random() * HEALTH_CHECK_KEY_MAX);
  const tempBuffer = Buffer.from([1, 2, 3, 4, 5]);
  try {
    //It's proper to putObject one tempName
    await putObject(ctx, tempName, tempBuffer, tempBuffer.length, opt_specialDir);
    //try to prevent case, when another process can remove same tempName
    await deleteObject(ctx, tempName, opt_specialDir);
  } catch (err) {
    ctx.logger.warn('healthCheck storage(%s) error %s', opt_specialDir, err.stack);
  }
}
function needServeStatic(opt_specialDir) {
  let storage = getStorage(opt_specialDir);
  return storage.needServeStatic();
}

module.exports = {
  headObject,
  getObject,
  createReadStream,
  putObject,
  uploadObject,
  copyObject,
  copyPath,
  listObjects,
  deleteObject,
  deletePath,
  getSignedUrl,
  getSignedUrls,
  getSignedUrlsArrayByArray,
  getSignedUrlsByArray,
  getRelativePath,
  isDiffrentPersistentStorage,
  healthCheck,
  needServeStatic
};
