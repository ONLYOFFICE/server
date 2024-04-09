const { describe, test, expect, afterAll} = require('@jest/globals');
const config = require('../../Common/node_modules/config');
const mailService = require('../../Common/sources/mailService');
const operationContext = require('../../Common/sources/operationContext');
const fs = require('fs');

const ctx = new operationContext.Context();
const bulkTestTimeout = 1000 * 10;
const largeMailContentTestTimeout = 1000 * 7;
const testFolder = '../tests/unit'
const defaultTestSMTPServer = {
  host: 'smtp.ethereal.email',
  port: 587,
  // Account created at https://ethereal.email/, all messages in tests goes here: https://ethereal.email/messages
  // Ethereial is a special SMTP sever for mailing tests in collaboration with Nodemailer.
  auth: {
    type: 'login',
    user: 'madie.wiegand79@ethereal.email',
    pass: 'ZUSjtcbaBKQdN4BGNx'
  },
};
const expectedEnvelope = { from: 'some.mail@server.com', to: ['madie.wiegand79@ethereal.email'] };

afterAll(function () {
  mailService.transportersRelease();

})

describe('Mail service', function () {
  describe('SMTP', function () {
    const { host, port, auth } = defaultTestSMTPServer;
    const transporter = mailService.createSMTPTransporter(
      ctx,
      host,
      port,
      auth,
      { from: 'some.mail@server.com', to: 'madie.wiegand79@ethereal.email' }
    );

    test('Simple mail', async function () {
      const mailData = await transporter.sendMail({ text: 'simple test text', subject: 'simple mail test' });
      expect(mailData.envelope).toEqual(expectedEnvelope);
    });

    test('Bulk mails', async function () {
      const promises = [];
      for (let i = 1; i <= 100; i++) {
        promises.push(transporter.sendMail({ text: `bulk test text #${i}`, subject: 'bulk mails test' }));
      }

      const result = await Promise.all(promises);
      result.forEach(data => expect(data.envelope).toEqual(expectedEnvelope));
    }, bulkTestTimeout);

    test('Large mail content', async function () {
      const readStream = fs.createReadStream(`${testFolder}/resources/16MiBFile.txt`);
      const mailData = await transporter.sendMail({ text: readStream, subject: 'large mail test' });
      expect(mailData.envelope).toEqual(expectedEnvelope);
    }, largeMailContentTestTimeout);

    test('HTML mail content', async function () {
      const readStream = fs.createReadStream(`${testFolder}/resources/htmlContent.html`);
      const mailData = await transporter.sendMail({ html: readStream, subject: 'html mail test' });
      expect(mailData.envelope).toEqual(expectedEnvelope);
    });

    test('Mail with attachments content', async function () {
      const readStream = fs.createReadStream(`${testFolder}/resources/htmlContent.html`);
      const message = {
        text: 'File added below',
        subject: 'attachment mail test',
        attachments: [
          {
            filename: 'report.docx',
            // Will stream the file from this path.
            path: `${testFolder}/resources/new.docx`
          },
          {
            filename: 'page.html',
            content: readStream
          }
        ]
      };
      const mailData = await transporter.sendMail(message);
      expect(mailData.envelope).toEqual(expectedEnvelope);
    });
  });
});
