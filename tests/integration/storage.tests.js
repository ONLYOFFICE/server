const {jest, describe, test, expect} = require('@jest/globals');
const http = require('http');
const https = require('https');
const fs = require('fs');

const operationContext = require('../../Common/sources/operationContext');
const storage = require('../../Common/sources/storage-base');
const utils = require('../../Common/sources/utils');
const commonDefines = require("../../Common/sources/commondefines");
const config = require('../../Common/node_modules/config');

const cfgStorageName = config.get('storage.name');

const ctx = operationContext.global;
const rand = Math.floor(Math.random() * 1000000);
const testDir = "DocService-DocsCoServer-storage-" + rand;
const baseUrl = "http://localhost:8000";
const urlType = commonDefines.c_oAscUrlTypes.Session;
let testFile1 = testDir + "/test1.txt";
let testFile2 = testDir + "/test2.txt";
let testFile3 = testDir + "/test3.txt";
let testFileData1 = "test1";
let testFileData2 = "test2";
let testFileData3 = testFileData2;

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
    await storage.putObject(ctx, testFile1, buffer, buffer.length, specialDir);
    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1].sort());
  });
  if ("storage-fs" === cfgStorageName) {
    test("todo UploadObject in fs", async () => {
      let buffer = Buffer.from(testFileData2);
      await storage.putObject(ctx, testFile2, buffer, buffer.length, specialDir);
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(list.sort()).toEqual([testFile1, testFile2].sort());
    });
  } else {
    test("uploadObject", async () => {
      const spy = jest.spyOn(fs, 'createReadStream').mockReturnValue(testFileData2);
      await storage.uploadObject(ctx, testFile2, "createReadStream.txt", specialDir);
      let list = await storage.listObjects(ctx, testDir, specialDir);
      expect(spy).toHaveBeenCalled();
      expect(list.sort()).toEqual([testFile1, testFile2].sort());
    });
  }
  test("copyObject", async () => {
    await storage.copyObject(ctx, testFile2, testFile3, specialDir, specialDir);
    // let buffer = Buffer.from(testFileData3);
    // await storage.putObject(ctx, testFile3, buffer, buffer.length, specialDir);
    let list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());
  });
  test("headObject", async () => {
    let output;
    output = await storage.headObject(ctx, testFile1, specialDir);
    expect(output).toHaveProperty("ContentLength", testFileData1.length);

    output =  await storage.headObject(ctx, testFile2, specialDir);
    expect(output).toHaveProperty("ContentLength", testFileData2.length);

    output =  await storage.headObject(ctx, testFile3, specialDir);
    expect(output).toHaveProperty("ContentLength", testFileData3.length);
  });
  test("getObject", async () => {
    let output;
    output = await storage.getObject(ctx, testFile1, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData1);

    output =  await storage.getObject(ctx, testFile2, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData2);

    output =  await storage.getObject(ctx, testFile3, specialDir);
    expect(output.toString("utf8")).toEqual(testFileData3);
  });
  test("createReadStream", async () => {
    let output, outputText;

    output = await storage.createReadStream(ctx, testFile1, specialDir);
    await utils.sleep(100);
    outputText = await utils.stream2Buffer(output.readStream);
    await utils.sleep(100);
    expect(outputText.toString("utf8")).toEqual(testFileData1);

    output = await storage.createReadStream(ctx, testFile2, specialDir);
    outputText = await utils.stream2Buffer(output.readStream);
    expect(outputText.toString("utf8")).toEqual(testFileData2);

    output = await storage.createReadStream(ctx, testFile3, specialDir);
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
  });
  test("deleteObject", async () => {
    let list;
    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile1, testFile2, testFile3].sort());

    await storage.deleteObject(ctx, testFile1, specialDir);

    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile2, testFile3].sort());
  });
  test("deleteObjects", async () => {
    let list;
    list = await storage.listObjects(ctx, testDir, specialDir);
    expect(list.sort()).toEqual([testFile2, testFile3].sort());

    await storage.deleteObjects(ctx, list, specialDir);

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