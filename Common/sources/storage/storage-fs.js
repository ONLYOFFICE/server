/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
'use strict';

const {cp, rm, mkdir} = require('fs/promises');
const {stat, readFile, writeFile} = require('fs/promises');
const path = require('path');
const utils = require('../utils');
const {pipeline} = require('node:stream/promises');

function getFilePath(storageCfg, strPath) {
  const storageFolderPath = storageCfg.fs.folderPath;
  return path.join(storageFolderPath, strPath);
}
function getOutputPath(strPath) {
  return strPath.replace(/\\/g, '/');
}

async function headObject(_ctx, storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  const stats = await stat(fsPath);
  return {ContentLength: stats.size};
}

async function getObject(_ctx, storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  return await readFile(fsPath);
}

async function createReadStream(_ctx, storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  const stats = await stat(fsPath);
  const contentLength = stats.size;
  const readStream = await utils.promiseCreateReadStream(fsPath);
  return {
    contentLength,
    readStream
  };
}

async function putObject(_ctx, storageCfg, strPath, buffer, _contentLength) {
  const fsPath = getFilePath(storageCfg, strPath);
  await mkdir(path.dirname(fsPath), {recursive: true});

  if (Buffer.isBuffer(buffer)) {
    await writeFile(fsPath, buffer);
  } else {
    const writable = await utils.promiseCreateWriteStream(fsPath);
    await pipeline(buffer, writable);
  }
}

async function uploadObject(_ctx, storageCfg, strPath, filePath) {
  const fsPath = getFilePath(storageCfg, strPath);
  await cp(filePath, fsPath, {force: true, recursive: true});
}

async function copyObject(_ctx, storageCfgSrc, storageCfgDst, sourceKey, destinationKey) {
  const fsPathSource = getFilePath(storageCfgSrc, sourceKey);
  const fsPathDestination = getFilePath(storageCfgDst, destinationKey);
  await cp(fsPathSource, fsPathDestination, {force: true, recursive: true});
}

async function listObjects(_ctx, storageCfg, strPath) {
  const storageFolderPath = storageCfg.fs.folderPath;
  const fsPath = getFilePath(storageCfg, strPath);
  const values = await utils.listObjects(fsPath);
  return values.map(curvalue => {
    return getOutputPath(curvalue.substring(storageFolderPath.length + 1));
  });
}

async function deleteObject(_ctx, storageCfg, strPath) {
  const fsPath = getFilePath(storageCfg, strPath);
  return rm(fsPath, {force: true, recursive: true});
}

async function deletePath(_ctx, storageCfg, strPath) {
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
