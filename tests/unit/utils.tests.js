const { describe, test, expect } = require('@jest/globals');
const config = require('../../Common/node_modules/config');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

const ctx = new operationContext.Context();
const minimumIterationsByteLength = 4;


describe('AES encryption & decryption', function () {
  test('Iterations range', async function () {
    const configuration = config.get('aesEncrypt.config');
    const encrypted = await utils.encryptPassword(ctx, 'secretstring');
    const { iterationsByteLength = 5 } = configuration;

    const [iterationsHex] = encrypted.split(':');
    const iterations = parseInt(iterationsHex, 16);

    const iterationsLength = iterationsByteLength < minimumIterationsByteLength ? minimumIterationsByteLength : iterationsByteLength;
    expect(iterations).toBeGreaterThanOrEqual(Math.pow(10, iterationsLength - 1));
    expect(iterations).toBeLessThanOrEqual(Math.pow(10, iterationsLength) - 1);
  });

  test('Correct workflow', async function () {
      const encrypted = await utils.encryptPassword(ctx, 'secretstring');
      const decrypted = await utils.decryptPassword(ctx, encrypted);
      expect(decrypted).toEqual('secretstring');
  });
});
