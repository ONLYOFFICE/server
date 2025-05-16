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

const { cp, rm, mkdir } = require('fs/promises');
const { stat, readFile, writeFile } = require('fs/promises');
var path = require('path');
var utils = require("../utils");


function getFilePath(storageCfg, strPath) {
  const storageFolderPath = storageCfg.fs.folderPath;
  return path.join(storageFolderPath, strPath);
}
function getOutputPath(strPath) {
  return strPath.replace(/\\/g, '/');
}

async function headObject(storageCfg, strPath) {
  let fsPath = getFilePath(storageCfg, strPath);
  let stats = await stat(fsPath);
  return {ContentLength: stats.size};
}

async function getObject(storageCfg, strPath) {
  let fsPath = getFilePath(storageCfg, strPath);
  return await readFile(fsPath);
}

async function createReadStream(storageCfg, strPath) {
  let fsPath = getFilePath(storageCfg, strPath);
  let stats = await stat(fsPath);
  let contentLength = stats.size;
  let readStream = await utils.promiseCreateReadStream(fsPath);
  return {
    contentLength: contentLength,
    readStream: readStream
  };
}

async function putObject(storageCfg, strPath, buffer, contentLength) {
  var fsPath = getFilePath(storageCfg, strPath);
  await mkdir(path.dirname(fsPath), {recursive: true});

  if (Buffer.isBuffer(buffer)) {
    await writeFile(fsPath, buffer);
  } else {
    let writable = await utils.promiseCreateWriteStream(fsPath);
    await utils.pipeStreams(buffer, writable, true);
  }
}

async function uploadObject(storageCfg, strPath, filePath) {
  let fsPath = getFilePath(storageCfg, strPath);
  await cp(filePath, fsPath, {force: true, recursive: true});
}

async function copyObject(storageCfgSrc, storageCfgDst, sourceKey, destinationKey) {
  let fsPathSource = getFilePath(storageCfgSrc, sourceKey);
  let fsPathDestination = getFilePath(storageCfgDst, destinationKey);
  await cp(fsPathSource, fsPathDestination, {force: true, recursive: true});
}

async function listObjects(storageCfg, strPath) {
  const storageFolderPath = storageCfg.fs.folderPath;
  let fsPath = getFilePath(storageCfg, strPath);
  let values = await utils.listObjects(fsPath);
  return values.map(function(curvalue) {
    return getOutputPath(curvalue.substring(storageFolderPath.length + 1));
  });
}

async function deleteObject(storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  return rm(fsPath, {force: true, recursive: true});
}

async function deletePath(storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  return rm(fsPath, {force: true, recursive: true, maxRetries: 3});
}

function needServeStatic() {
  return true;
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
  needServeStatic
};
