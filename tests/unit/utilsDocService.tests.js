const { describe, test, expect } = require('@jest/globals');

const utilsDocService = require('../../DocService/sources/utilsDocService');
const operationContext = require('../../Common/sources/operationContext');

const ctx = new operationContext.Context();

function createEndTime(day, month, year, hours, minutes) {
  const date = new Date();
  date.setUTCFullYear(year);
  date.setUTCMonth(month);
  date.setUTCDate(day);
  date.setUTCHours(hours, minutes, 0,0);

  return date;
}

describe('DocService utils', function () {
  describe('humanFriendlyExpirationTime() format', function () {
    const currentDate = new Date();
    currentDate.setUTCSeconds(0, 0);

    const day = currentDate.getUTCDate();
    const month = currentDate.getUTCMonth();
    const year = currentDate.getUTCFullYear();
    const hours = currentDate.getUTCHours();
    const minutes = currentDate.getUTCMinutes();

    const testSuite = {
      '12 months': createEndTime(day, month, year + 1, hours, minutes),
      '15 months': createEndTime(day, month + 3, year + 1, hours, minutes),
      '6 months': createEndTime(day, month + 6, year, hours, minutes),
      '1 month': createEndTime(day, month + 1, year, hours, minutes),
      '10 days': createEndTime(day + 10, month, year, hours, minutes),
      '2 days': createEndTime(day + 2, month, year, hours, minutes),
      // '24 hours': createEndTime(day + 1, month, year, hours, minutes),
      // '23 hours': createEndTime(day, month, year, hours + 23, minutes),
      // '16 minutes': createEndTime(day, month, year, hours, minutes + 16),
      // '1 hour 15 minutes': createEndTime(day, month, year, hours + 1, minutes + 15),
      '': createEndTime(day, month, year - 1, hours, minutes),
    };

    for (const testCase in testSuite) {
      test(testCase === '' ? 'wrong end date' : testCase, function () {
        const result = utilsDocService.humanFriendlyExpirationTime(ctx, testSuite[testCase]);

        expect(result).toEqual(testCase);
      });
    }
  });
});
