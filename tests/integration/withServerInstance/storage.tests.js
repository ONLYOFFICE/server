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

const {jest, describe, test, expect} = require('@jest/globals');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Readable } = require('stream');

let testFileData1 = "test1";
let testFileData2 = "test22";
let testFileData3 = "test333";
let testFileData4 = testFileData3;

jest.mock("fs/promises", () => ({
  ...jest.requireActual('fs/promises'),
  cp: jest.fn().mockImplementation((from, to) => fs.writeFileSync(to, testFileData3))
}));
const { cp } = require('fs/promises');

const operationContext = require('../../../Common/sources/operationContext');
const storage = require('../../../Common/sources/storage-base');
const utils = require('../../../Common/sources/utils');
const commonDefines = require("../../../Common/sources/commondefines");
const config = require('../../../Common/node_modules/config');

const cfgStorageName = config.get('storage.name');

const ctx = operationContext.global;
const rand = Math.floor(Math.random() * 1000000);
const testDir = "DocService-DocsCoServer-storage-" + rand;
const baseUrl = "http://localhost:8000";
const urlType = commonDefines.c_oAscUrlTypes.Session;
let testFile1 = testDir + "/test1.txt";
let testFile2 = testDir + "/test2.txt";
let testFile3 = testDir + "/test3.txt";
let testFile4 = testDir + "/test4.txt";

console.debug(`testDir: ${testDir}`)

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
function runTestForDir(specialDir) {
  test("start listObjects", async () => {
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
  if ("storage-fs" === cfgStorageName) {
    test("UploadObject", async () => {
      let res = await storage.uploadObject(ctx, testFile3, "createReadStream.txt", specialDir);
      expect(res).toEqual(undefined);
      expect(cp).toHaveBeenCalled();
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());
    });
  } else {
    test("uploadObject", async () => {
      const spy = jest.spyOn(fs, 'createReadStream').mockReturnValue(testFileData3);
      let res = await storage.uploadObject(ctx, testFile3, "createReadStream.txt", specialDir);
      expect(res).toEqual(undefined);
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(spy).toHaveBeenCalled();
      expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());
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
    let url, data;
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
  });
}

// Assumed, that server is already up.
describe('storage common dir', function () {
  runTestForDir("");
});

describe('storage forgotten dir', function () {
  runTestForDir("forgotten");
});