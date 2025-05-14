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

import { jest, describe, test, expect, beforeAll } from '@jest/globals';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { Readable } from 'stream';

let testFileData1 = "test1";
let testFileData2 = "test22";
let testFileData3 = "test333";
let testFileData4 = testFileData3;

jest.unstable_mockModule('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  cp: jest.fn().mockImplementation((src, dest) => {
    fs.writeFileSync(dest, testFileData3);
  }),
}));
import { cp } from 'fs/promises';

import * as operationContext from '../../../Common/sources/operationContext.js';
import * as tenantManager from '../../../Common/sources/tenantManager.js';
// import * as storage from '../../../Common/sources/storage/storage-base.js';
import * as utils from '../../../Common/sources/utils.js';
import * as commonDefines from "../../../Common/sources/commondefines.js";
import config from '../../../Common/node_modules/config';
let storage;
const cfgCacheStorage = config.get('storage');
const cfgPersistentStorage = utils.deepMergeObjects({}, cfgCacheStorage, config.get('persistentStorage'));

const ctx = operationContext.global;
const rand = Math.floor(Math.random() * 1000000);
const testDir = "DocService-DocsCoServer-storage-" + rand;
const baseUrl = "http://localhost:8000";
const urlType = commonDefines.c_oAscUrlTypes.Session;
let testFile1 = testDir + "/test1.txt";
let testFile2 = testDir + "/test2.txt";
let testFile3 = testDir + "/test3.txt";
let testFile4 = testDir + "/test4.txt";
let specialDirCache = "";
let specialDirForgotten = "forgotten";

console.debug(`testDir: ${testDir}`)

function getStorageCfg(specialDir) {
  return specialDir ? cfgPersistentStorage : cfgCacheStorage;
}

function request(url) {
  return new Promise(resolve => {
    let module = url.startsWith('https') ? https : http;
    module.get(url, response => {
      let data = '';
      response.on('data', _data => (data += _data));
      response.on('end', () => resolve(data));
    });
  });
}
function runTestForDir(ctx, isMultitenantMode, specialDir) {
  beforeAll(async () => {
    storage = await import('../../../Common/sources/storage/storage-base.js');
  });
  let oldMultitenantMode = tenantManager.isMultitenantMode();
  test("start listObjects", async () => {
    //todo set in all tests do not rely on test order
    tenantManager.setMultitenantMode(isMultitenantMode);

    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list).toEqual([]);
  });
  test("putObject", async () => {
    let buffer = Buffer.from(testFileData1);
    let res = await storage.putObject(ctx, testFile1, buffer, buffer.length, specialDir);
    expect(res).toEqual(undefined);
    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1].sort());
  });
  test("putObject-stream", async () => {
    let buffer = Buffer.from(testFileData2);
    const stream = Readable.from(buffer);
    let res = await storage.putObject(ctx, testFile2, stream, buffer.length, specialDir);
    expect(res).toEqual(undefined);
    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1, testFile2].sort());
  });
  if ("storage-fs" === getStorageCfg(specialDir).name) {
    test("UploadObject", async () => {
      let res = await storage.uploadObject(ctx, testFile3, "createReadStream.txt", specialDir);
      expect(res).toEqual(undefined);
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());
    });
  } else {
    test("uploadObject", async () => {
      const spy = jest.spyOn(fs, 'createReadStream').mockReturnValue(Readable.from(testFileData3));
      let res = await storage.uploadObject(ctx, testFile3, "createReadStream.txt", specialDir);
      expect(res).toEqual(undefined);
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(spy).toHaveBeenCalled();
      expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());
      spy.mockRestore();
    });

    test("uploadObject - stream error handling", async () => {
      const streamErrorMessage = "Test stream error";
      const mockStream = new Readable({
        read() {
          this.emit('error', new Error(streamErrorMessage));
        }
      });
      
      const spy = jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream);
      // Verify that the uploadObject function rejects when the stream emits an error
      await expect(storage.uploadObject(ctx, "test-error-file.txt", "nonexistent.txt", specialDir))
        .rejects.toThrow(streamErrorMessage);
      
      spy.mockRestore();
    });

    test("uploadObject - non-existent file handling", async () => {
      const nonExistentFile = 'definitely-does-not-exist-' + Date.now() + '.txt';
      // Verify the file actually doesn't exist
      expect(fs.existsSync(nonExistentFile)).toBe(false);
      // Verify that uploadObject properly handles and propagates the error
      await expect(storage.uploadObject(ctx, "test-error-file.txt", nonExistentFile, specialDir))
        .rejects.toThrow(/ENOENT/);
    });
  }
  test("copyObject", async () => {
    let res = await storage.copyObject(ctx, testFile3, testFile4, specialDir, specialDir);
    expect(res).toEqual(undefined);
    // let buffer = Buffer.from(testFileData3);
    // await storage.putObject(ctx, testFile3, buffer, buffer.length, specialDir);
    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1, testFile2, testFile3, testFile4].sort());
  });
  test("headObject", async () => {
    let output;
    output = await storage.headObject(ctx, testFile1, specialDir);
    expect(output).toMatchObject({ContentLength: testFileData1.length});

    output =  await storage.headObject(ctx, testFile2, specialDir);
    expect(output).toMatchObject({ContentLength: testFileData2.length});

    output =  await storage.headObject(ctx, testFile3, specialDir);
    expect(output).toMatchObject({ContentLength: testFileData3.length});

    output =  await storage.headObject(ctx, testFile4, specialDir);
    expect(output).toMatchObject({ContentLength: testFileData4.length});
  });
  test("getObject", async () => {
    let output;
    output = await storage.getObject(ctx, testFile1, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData1);

    output =  await storage.getObject(ctx, testFile2, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData2);

    output =  await storage.getObject(ctx, testFile3, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData3);

    output =  await storage.getObject(ctx, testFile4, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData4);
  });
  test("createReadStream", async () => {
    let output, outputText;

    output = await storage.createReadStream(ctx, testFile1, specialDir);
    await utils.sleep(100);
    expect(output.contentLength).toEqual(testFileData1.length);
    outputText = await utils.stream2Buffer(output.readStream);
    await utils.sleep(100);
    expect(outputText.toString("utf8")).toEqual(testFileData1);

    output = await storage.createReadStream(ctx, testFile2, specialDir);
    expect(output.contentLength).toEqual(testFileData2.length);
    outputText = await utils.stream2Buffer(output.readStream);
    expect(outputText.toString("utf8")).toEqual(testFileData2);

    output = await storage.createReadStream(ctx, testFile3, specialDir);
    expect(output.contentLength).toEqual(testFileData3.length);
    outputText = await utils.stream2Buffer(output.readStream);
    expect(outputText.toString("utf8")).toEqual(testFileData3);
  });
  test("getSignedUrl", async () => {
    let url, urls, data;
    url = await storage.getSignedUrl(ctx, baseUrl, testFile1, urlType, undefined, undefined, specialDir);
    data = await request(url);
    expect(data).toEqual(testFileData1);

    url = await storage.getSignedUrl(ctx, baseUrl, testFile2, urlType, undefined, undefined, specialDir);
    data = await request(url);
    expect(data).toEqual(testFileData2);

    url = await storage.getSignedUrl(ctx, baseUrl, testFile3, urlType, undefined, undefined, specialDir);
    data = await request(url);
    expect(data).toEqual(testFileData3);

    url = await storage.getSignedUrl(ctx, baseUrl, testFile4, urlType, undefined, undefined, specialDir);
    data = await request(url);
    expect(data).toEqual(testFileData4);
  });
  test("getSignedUrls", async () => {
    let urls, data;
    urls = await storage.getSignedUrls(ctx, baseUrl, testDir, urlType, undefined, specialDir);
    data = [];
    for(let i in urls) {
      data.push(await request(urls[i]));
    }
    expect(data.sort()).toEqual([testFileData1, testFileData2, testFileData3, testFileData4].sort());
  });
  test("getSignedUrlsArrayByArray", async () => {
    let urls, data;
    urls = await storage.getSignedUrlsArrayByArray(ctx, baseUrl, [testFile1, testFile2], urlType, specialDir);
    data = [];
    for(let i = 0; i < urls.length; ++i) {
      data.push(await request(urls[i]));
    }
    expect(data.sort()).toEqual([testFileData1, testFileData2].sort());
  });
  test("getSignedUrlsByArray", async () => {
    let urls, data;
    urls = await storage.getSignedUrlsByArray(ctx, baseUrl, [testFile3, testFile4], undefined, urlType, specialDir);
    data = [];
    for(let i in urls) {
      data.push(await request(urls[i]));
    }
    expect(data.sort()).toEqual([testFileData3, testFileData4].sort());
  });
  test("deleteObject", async () => {
    let list;
    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1, testFile2, testFile3, testFile4].sort());

    let res = await storage.deleteObject(ctx, testFile1, specialDir);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile2, testFile3, testFile4].sort());
  });
  test("deletePath", async () => {
    let list;
    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile2, testFile3, testFile4].sort());

    let res = await storage.deletePath(ctx, testDir, specialDir);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([].sort());

    tenantManager.setMultitenantMode(oldMultitenantMode);
  });
}

// Assumed, that server is already up.
describe('storage common dir', function () {
  runTestForDir(ctx, false, specialDirCache);
});

describe('storage forgotten dir', function () {
  runTestForDir(ctx, false, specialDirForgotten);
});

describe('storage common dir with tenants', function () {
  runTestForDir(ctx, true, specialDirCache);
});

describe('storage forgotten dir with tenants', function () {
  runTestForDir(ctx, true, specialDirForgotten);
});

describe('storage mix common and forgotten dir', function () {
  test("putObject", async () => {
    tenantManager.setMultitenantMode(false);

    let buffer = Buffer.from(testFileData1);
    let res = await storage.putObject(ctx, testFile1, buffer, buffer.length, specialDirCache);
    expect(res).toEqual(undefined);
    let list = await storage.listObjects(ctx, testDir, specialDirCache);
    expect(list.sort()).toEqual([testFile1].sort());

    buffer = Buffer.from(testFileData2);
    res = await storage.putObject(ctx, testFile2, buffer, buffer.length, specialDirForgotten);
    expect(res).toEqual(undefined);
    list = await storage.listObjects(ctx, testDir, specialDirForgotten);
    expect(list.sort()).toEqual([testFile2].sort());
  });

  test("copyPath", async () => {
    let list, res;
    res = await storage.copyPath(ctx, testDir, testDir, specialDirCache, specialDirForgotten);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDirForgotten);
    expect(list.sort()).toEqual([testFile1, testFile2].sort());
  });
  test("copyObject", async () => {
    let list, res;
    res = await storage.copyObject(ctx, testFile2, testFile2, specialDirForgotten, specialDirCache);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDirCache);
    expect(list.sort()).toEqual([testFile1, testFile2].sort());
  });

  test("deletePath", async () => {
    let list, res;
    res = await storage.deletePath(ctx, testDir, specialDirCache);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDirCache);
    expect(list.sort()).toEqual([].sort());

    res = await storage.deletePath(ctx, testDir, specialDirForgotten);
    expect(res).toEqual(undefined);

    list = await storage.listObjects(ctx, testDir, specialDirForgotten);
    expect(list.sort()).toEqual([].sort());
  });
});
