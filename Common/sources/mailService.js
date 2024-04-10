/*
 * (c) Copyright Ascensio System SIA 2010-2023
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

'use strict';

const config = require('config');
const ms = require('ms');
const nodemailer = require('nodemailer');

const cfgMail = config.get('mail');
const cfgMessageDefaults = config.get('mail.messageDefaults');

const smtpTransporters = new Map();
let sendMailTransporter = null;

const getSMTPSettings = (function() {
  const configParameters = cfgMail.transportList['smtp'];
  let settings = {
    pool: true,
    socketTimeout: 1000 * 60 * 2,
    connectionTimeout: 1000 * 60 * 2,
    greetingTimeout: 1000 * 30,
    dnsTimeout: 1000 * 30,
    maxConnections: 5,
    maxMessages: 100
  };

  if (configParameters !== undefined && Object.values(configParameters).length !== 0) {
    const poolConfig = configParameters.pool ?? {};
    const connectionConfig = configParameters.connection ?? {};

    const timersConvert = Object.entries(connectionConfig).map(row => [row[0], ms(row[1])]);
    settings = Object.assign({ pool: true }, poolConfig, Object.fromEntries(timersConvert));
  }

  return function() {
    return settings;
  };
})();

const getSendmailSettings = (function () {
  const configParameters = cfgMail.transportList['sendmail'];
  let settings = {
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
  };

  if(configParameters !== undefined && Object.values(configParameters).length !== 0) {
    settings = Object.assign({ sendmail: true }, configParameters);
  }

  return function () {
    return settings;
  }
})();

function createSMTPTransporter(ctx, host, port, auth, messageCommonParameters = {}) {
  const server = {
    host,
    port,
    auth,
    secure: port === 465
  };
  const transport = Object.assign({}, server, getSMTPSettings());
  const mailDefaults = Object.assign({}, cfgMessageDefaults, messageCommonParameters);

  try {
    const transporter = nodemailer.createTransport(transport, mailDefaults);
    smtpTransporters.set(`${host}:${auth.user}`, transporter);
  } catch (error) {
    ctx.logger.error('Mail service smtp transporter creation error: %o\nWith parameters: \n\thost - %s, \n\tport - %d, \n\tauth = %o', error.stack, host, port, auth);
  }
}

function createSendmailTransporter(ctx, messageCommonParameters = {}) {
  if (!sendMailTransporter) {
    const mailDefaults = Object.assign({}, cfgMessageDefaults, messageCommonParameters);
    try {
      sendMailTransporter = nodemailer.createTransport(getSendmailSettings(), mailDefaults);
    } catch (error) {
      ctx.logger.error('Mail service sendmail transporter creation error: %o', error.stack);
    }
  }
}

async function sendSMTP(ctx, host, userLogin, mailObject) {
  const transporter = smtpTransporters.get(`${host}:${userLogin}`);
  if (!transporter) {
    ctx.logger.error(`MailService getSMTPTransporter(): no transporter exists for host "${host}" and user "${userLogin}"`);
    return;
  }

  return transporter.sendMail(mailObject);
}

async function sendSendmail(ctx, mailObject) {
  if (!sendMailTransporter) {
    ctx.logger.error(`MailService getSendmailTransporter(): no sendmail transporter exists`);
    return;
  }

  return sendMailTransporter.sendMail(mailObject);
}

function deleteSMTPTransporter(host, userLogin) {
  smtpTransporters.delete(`${host}:${userLogin}`);
}

function transportersRelease() {
  smtpTransporters.forEach(transporter => transporter.close());
  smtpTransporters.clear();
  sendMailTransporter = null;
}

module.exports = {
  createSMTPTransporter,
  createSendmailTransporter,
  sendSMTP,
  sendSendmail,
  deleteSMTPTransporter,
  transportersRelease
};

