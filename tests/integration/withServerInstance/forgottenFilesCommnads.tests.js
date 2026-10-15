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

const {describe, test, expect, afterAll, beforeAll} = require('@jest/globals');

const {signToken} = require('../../../DocService/sources/DocsCoServer');
const storage = require('../../../Common/sources/storage/storage-base');
const serverConstants = require('../../../Common/sources/constants');
const operationContext = require('../../../Common/sources/operationContext');

const config = require('../../../Common/node_modules/config');

const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgForgottenFilesName = config.get('services.CoAuthoring.server.forgottenfilesname');
const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgTokenEnableRequestOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgStorageName = config.get('storage.name');
const cfgEndpoint = config.get('storage.endpoint');
const cfgBucketName = config.get('storage.bucketName');
const cfgAccessKeyId = config.get('storage.accessKeyId');
const cfgUseDirectStorageUrls = config.get('storage.useDirectStorageUrls');
const ctx = new operationContext.Context();

const testFilesNames = {
  get: 'DocService-DocsCoServer-forgottenFilesCommands-getForgotten-integration-test',
  delete1: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-integration-test',
  // delete2: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-2-integration-test',
  // delete3: 'DocService-DocsCoServer-forgottenFilesCommands-deleteForgotten-3-integration-test',
  getList: 'DocService-DocsCoServer-forgottenFilesCommands-getForgottenList-integration-test'
};

/**
 * Makes HTTP request to the command service
 * @param {Object} requestBody - Request payload
 * @param {number} timeout - Request timeout in milliseconds
 * @returns {Promise<string>} Response data
 */
async function makeRequest(requestBody, timeout = 5000) {
  let body = '';
  if (cfgTokenEnableRequestOutbox) {
    // the request goes to /command, so it is signed as a command token and the purpose picks the key
    const token = await signToken(ctx, serverConstants.JWT_PURPOSE_COMMAND, requestBody, cfgTokenAlgorithm, cfgTokenOutboxExpires);
    body = JSON.stringify({token});
  } else {
    body = JSON.stringify(requestBody);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('http://localhost:8000/coauthoring/CommandService.ashx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString()
      },
      body,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

function getKeysDirectories(keys) {
  return keys.map(value => value.split('/')[0]);
}

beforeAll(async () => {
  const buffer = Buffer.from('Forgotten commands test file');
  for (const index in testFilesNames) {
    await storage.putObject(ctx, `${testFilesNames[index]}/${cfgForgottenFilesName}.docx`, buffer, buffer.length, cfgForgottenFiles);
  }
});

afterAll(async () => {
  const keys = await storage.listObjects(ctx, '', cfgForgottenFiles);
  const keysDirectories = getKeysDirectories(keys);
  const deletePromises = keysDirectories
    .filter(key => key.includes('DocService-DocsCoServer-forgottenFilesCommands'))
    .map(filteredKey => storage.deletePath(ctx, filteredKey, cfgForgottenFiles));
  console.log(`keys:` + JSON.stringify(keys));
  console.log(`keysDirectories:` + JSON.stringify(keysDirectories));
  return Promise.allSettled(deletePromises);
});

// Assumed, that server is already up.
describe('Command service', () => {
  describe('Forgotten files commands parameters validation', () => {
    describe('Invalid key format', () => {
      const tests = ['getForgotten', 'deleteForgotten'];
      const addSpecialCases = (invalidRequests, expected, testSubject) => {
        invalidRequests.push({
          c: testSubject
        });
        expected.push({error: 1});

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
        test(testSubject, async () => {
          const invalidKeys = [true, [], {}, 1, 1.1];
          const invalidRequests = invalidKeys.map(key => {
            return {
              c: testSubject,
              key
            };
          });

          const expected = invalidKeys.map(key => {
            return {
              key,
              error: 1
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

  describe('Forgotten files commands verification', () => {
    describe('getForgotten', () => {
      const createExpected = ({key, error}) => {
        const validKey = typeof key === 'string' && error === 0;
        let urlPattern;
        if ('storage-fs' === cfgStorageName || !cfgUseDirectStorageUrls) {
          if ('storage-fs' === cfgStorageName) {
            urlPattern = 'http://localhost:8000/cache/files/forgotten/--key--/output.docx/output.docx';
          } else {
            urlPattern = 'http://localhost:8000/storage-cache/files/forgotten/--key--/output.docx/output.docx';
          }
        } else if ('storage-s3' === cfgStorageName) {
          let host = cfgEndpoint.slice(0, 'https://'.length) + cfgBucketName + '.' + cfgEndpoint.slice('https://'.length);
          if (host[host.length - 1] === '/') {
            host = host.slice(0, -1);
          }
          urlPattern = host + '/files/forgotten/--key--/output.docx';
        } else {
          let host;
          if (cfgEndpoint.includes(cfgAccessKeyId)) {
            host = cfgEndpoint.slice(0, 'https://'.length) + cfgEndpoint.slice('https://'.length) + '/' + cfgBucketName;
          } else {
            host = cfgEndpoint.slice(0, 'https://'.length) + cfgAccessKeyId + '.' + cfgEndpoint.slice('https://'.length) + '/' + cfgBucketName;
          }
          if (host[host.length - 1] === '/') {
            host = host.slice(0, -1);
          }
          urlPattern = host + '/files/forgotten/--key--/output.docx';
        }

        const expected = {key, error};

        if (validKey) {
          expected.url = urlPattern.replace('--key--', key);
        }

        return expected;
      };

      const testCases = {
        'Single key': {key: testFilesNames.get, error: 0},
        'Not existed key': {key: '--not-existed--', error: 1}
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

    describe('deleteForgotten', () => {
      const createExpected = ({key, error}) => {
        return {
          key,
          error
        };
      };

      const testCases = {
        'Single key': {key: testFilesNames.delete1, error: 0},
        'Not existed key': {key: '--not-existed--', error: 1}
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

    describe('getForgottenList', () => {
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
        };

        actual.keys?.sort();
        expected.keys.sort();
        expect(actual).toEqual(expected);
      });
    });
  });
});
