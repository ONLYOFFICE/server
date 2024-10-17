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

const { describe, test, expect, afterAll, beforeAll } = require('@jest/globals');
const http = require('http');

const { signToken } = require('../../../DocService/sources/DocsCoServer');
const storage = require('../../../Common/sources/storage-base');
const constants = require('../../../Common/sources/commondefines');
const operationContext = require('../../../Common/sources/operationContext');
const utils = require("../../../Common/sources/utils");

const config = require('../../../Common/node_modules/config');

const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgForgottenFilesName = config.get('services.CoAuthoring.server.forgottenfilesname');
const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgTokenEnableRequestOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgStorageName = config.get('storage.name');
const cfgEndpoint = config.get('storage.endpoint');
const cfgBucketName = config.get('storage.bucketName');
const ctx = new operationContext.Context();

const testFilesNames = {
  get: 'DocService-DocsCoServer-forgottenFilesCommands-getForgotten-integration-test',
  delete1: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-integration-test',
  // delete2: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-2-integration-test',
  // delete3: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-3-integration-test',
  getList: 'DocService-DocsCoServer-forgottenFilesCommands-getForgottenList-integration-test'
};

function makeRequest(requestBody, timeout = 5000) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject('Request timeout'), timeout);

    let body = '';
    if (cfgTokenEnableRequestOutbox) {
      const secret = utils.getSecretByElem(cfgSecretOutbox);
      const token = await signToken(ctx, requestBody, cfgTokenAlgorithm, cfgTokenOutboxExpires, constants.c_oAscSecretType.Inbox, secret);
      body = JSON.stringify({ token });
    } else {
      body = JSON.stringify(requestBody);
    }

    const options = {
      port: '8000',
      path: '/coauthoring/CommandService.ashx',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const request = http.request(options, (response) => {
      response.setEncoding('utf8');

      let data = '';
      response.on('data', (chunk) => {
        data += chunk
      });
      response.on('end', () => {
        resolve(data);
        clearTimeout(timer);
      });
    });

    request.on('error', (error) => {
      reject(error);
      clearTimeout(timer);
    });

    request.write(body);
    request.end();
  });
}

function getKeysDirectories(keys) {
  return keys.map(value => value.split('/')[0]);
}

beforeAll(async function () {
  const buffer = Buffer.from('Forgotten commands test file');
  for (const index in testFilesNames) {
    await storage.putObject(ctx, `${testFilesNames[index]}/${cfgForgottenFilesName}.docx`, buffer, buffer.length, cfgForgottenFiles);
  }
});

afterAll(async function () {
  const keys = await storage.listObjects(ctx, '', cfgForgottenFiles);
  const keysDirectories = getKeysDirectories(keys);
  const deletePromises = keysDirectories.filter(key => key.includes('DocService-DocsCoServer-forgottenFilesCommands'))
    .map(filteredKey => storage.deletePath(ctx, filteredKey, cfgForgottenFiles));
  console.log(`keys:`+JSON.stringify(keys));
  console.log(`keysDirectories:`+JSON.stringify(keysDirectories));
  return Promise.allSettled(deletePromises);
});

// Assumed, that server is already up.
describe('Command service', function () {
  describe('Forgotten files commands parameters validation', function () {
    describe('Invalid key format', function () {
      const tests = ['getForgotten', 'deleteForgotten'];
      const addSpecialCases = (invalidRequests, expected, testSubject) => {
        invalidRequests.push({
          c: testSubject
        });
        expected.push({ error: 1});

        invalidRequests.push({
          c: testSubject,
          key: null
        });
        expected.push({
          key: null,
          error: 1
        });
      };

      for (const testSubject of tests) {
        test(testSubject, async function () {
          const invalidKeys = [true, [], {}, 1, 1.1];
          const invalidRequests = invalidKeys.map(key => {
            return {
              c: testSubject,
              key
            }
          });

          const expected = invalidKeys.map(key => {
            return {
              key,
              error: 1,
            };
          });

          addSpecialCases(invalidRequests, expected, testSubject);

          for (const index in invalidRequests) {
            const actualResponse = await makeRequest(invalidRequests[index]);
            const actual = JSON.parse(actualResponse);

            expect(actual).toEqual(expected[index]);
          }
        });
      }
    });
  });
  
  describe('Forgotten files commands verification', function () {
    describe('getForgotten', function () {
      const createExpected = ({ key, error }) => {
        const validKey = typeof key === 'string' && error === 0
        let urlPattern;
        if ("storage-fs" === cfgStorageName) {
          urlPattern = 'http://localhost:8000/cache/files/forgotten/--key--/output.docx/output.docx';
        } else {
          let host = cfgEndpoint.slice(0, "https://".length) + cfgBucketName + "." + cfgEndpoint.slice("https://".length);
          if (host[host.length - 1] === '/') {
            host = host.slice(0, -1);
          }
          urlPattern = host + '/files/forgotten/--key--/output.docx';
        }

        const expected = { key, error };

        if (validKey) {
          expected.url = urlPattern.replace('--key--', key);
        }

        return expected;
      };

      const testCases = {
        'Single key': { key: testFilesNames.get, error: 0 },
        'Not existed key': { key: '--not-existed--', error: 1 },
      };

      for (const testCase in testCases) {
        test(testCase, async () => {
          const requestBody = {
            c: 'getForgotten',
            key: testCases[testCase].key
          };

          const actualResponse = await makeRequest(requestBody);

          const expected = createExpected(testCases[testCase]);
          const actual = JSON.parse(actualResponse);

          if (actual.url) {
            actual.url = actual.url.split('?')[0];
          }

          expect(actual).toEqual(expected);
        });
      }
    });

    describe('deleteForgotten', function () {
      const createExpected = ({ key, error }) => {
        return {
          key,
          error
        };
      };

      const testCases = {
        'Single key': { key: testFilesNames.delete1, error: 0 },
        'Not existed key': { key: '--not-existed--', error: 1 },
      };

      for (const testCase in testCases) {
        test(testCase, async () => {
          const requestBody = {
            c: 'deleteForgotten',
            key: testCases[testCase].key
          };

          const alreadyExistedDirectories = getKeysDirectories(await storage.listObjects(ctx, '', cfgForgottenFiles));
          const directoryToBeDeleted = testCases[testCase].error !== 0 ? '--not-existed--' : testCases[testCase].key;
          const shouldExist = alreadyExistedDirectories.filter(directory => directoryToBeDeleted !== directory);

          const actualResponse = await makeRequest(requestBody);

          const expected = createExpected(testCases[testCase]);
          const actual = JSON.parse(actualResponse);

          const directoriesExistedAfterDeletion = getKeysDirectories(await storage.listObjects(ctx, '', cfgForgottenFiles));
          expect(actual).toEqual(expected);
          // Checking that files not existing on disk/cloud.
          expect(shouldExist).toEqual(directoriesExistedAfterDeletion);
        });
      }
    });
    
    describe('getForgottenList', function () {
      test('Main case', async () => {
        const requestBody = {
          c: 'getForgottenList'
        };

        const stateBeforeChanging = await makeRequest(requestBody);
        const alreadyExistedDirectories = JSON.parse(stateBeforeChanging);

        const docId = 'DocService-DocsCoServer-forgottenFilesCommands-getForgottenList-2-integration-test';
        const buffer = Buffer.from('getForgottenList test file');
        await storage.putObject(ctx, `${docId}/${cfgForgottenFilesName}.docx`, buffer, buffer.length, cfgForgottenFiles);
        alreadyExistedDirectories.keys.push(docId);

        const actualResponse = await makeRequest(requestBody);
        const actual = JSON.parse(actualResponse);
        const expected = {
          error: 0,
          keys: alreadyExistedDirectories.keys
        }

        actual.keys?.sort();
        expected.keys.sort();
        expect(actual).toEqual(expected);
      });
    });
  });
});