const {jest, describe, test, expect} = require('@jest/globals');

const operationContext = require('../../Common/sources/operationContext');
var baseConnector = require('./../../DocService/sources/baseConnector');

const ctx = operationContext.global;

describe('baseConnector test', function () {
  test("healthCheck", async () => {
    let res = await baseConnector.healthCheck(ctx);
    expect(res).toBeTruthy();
  });
});