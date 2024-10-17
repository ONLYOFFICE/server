const { describe, test, expect, afterAll } = require('@jest/globals');
const nodemailer = require('../../Common/node_modules/nodemailer');

const operationContext = require('../../Common/sources/operationContext');
const mailService = require('../../Common/sources/mailService');

const ctx = new operationContext.Context();
const defaultTestSMTPServer = {
  host: 'smtp.ethereal.email',
  port: 587
};
const testTimeout = 1000 * 10;

afterAll(function () {
  mailService.transportersRelease();
})

describe('Mail service', function () {
  describe('SMTP', function () {
    const { host, port } = defaultTestSMTPServer;

    test('Transporters life cycle', async function () {
      // Accounts created at https://ethereal.email/, all messages in tests goes here: https://ethereal.email/messages
      // Ethereial is a special SMTP sever for mailing tests in collaboration with Nodemailer.
      const accounts = await Promise.all([nodemailer.createTestAccount(), nodemailer.createTestAccount(), nodemailer.createTestAccount()]);
      const auth = accounts.map(account => { return { user: account.user, pass: account.pass }});
      auth.forEach(credential => mailService.createTransporter(ctx, host, port, credential, { from: 'some.mail@ethereal.com' }));

      for (let i = 0; i < auth.length; i++) {
        const credentials = auth[i];
        const mail = await mailService.send(
          host,
          credentials.user,
          { to: `some.recipient@server${i + 1}.com`, text: 'simple test text', subject: 'Mail service test' }
        );

        expect(mail.envelope).toEqual({ from: 'some.mail@ethereal.com', to: [`some.recipient@server${i + 1}.com`] });
      }

      const accountToBeDeleted = auth[1];
      mailService.deleteTransporter(ctx, host, accountToBeDeleted.user);

      const errorPromise = mailService.send(
        host,
        accountToBeDeleted.user,
        { to: 'no.recipient@server.com', text: 'simple test text', subject: 'Mail service test' }
      );

      await expect(errorPromise).rejects.toThrow();
    }, testTimeout);
  });
});
