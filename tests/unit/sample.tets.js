const { describe, test, expect, afterAll } = require('@jest/globals');

describe('Successful and failure tests', function () {
  test('Successful test', function () {
    expect(true).toBeTruthy();
  });

  test('Failure test', function () {
    expect(true).toBeFalsy();
  });
});