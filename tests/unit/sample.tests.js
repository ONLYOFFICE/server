const { describe, test, expect } = require('@jest/globals');

describe('Successful and failure tests', function () {
  test('Successful test', function () {
    expect(true).toBeTruthy();
  });

  test.skip('Failure test', function () {
    expect(true).toBeFalsy();
  });
});