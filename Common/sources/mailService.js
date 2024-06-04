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
const nodemailer = require('nodemailer');

const cfgConnection = config.get('email.connectionConfiguration');

const connectionDefaultSettings = {
  pool: true,
  socketTimeout: 1000 * 60 * 2,
  connectionTimeout: 1000 * 60 * 2,
  maxConnections: 10
};
// Connection settings could be overridden by config, so user can configure transporter anyhow.
const settings = Object.assign(connectionDefaultSettings, cfgConnection);
const smtpTransporters = new Map();

function createTransporter(ctx, host, port, auth, messageCommonParameters = {}) {
  const server = {
    host,
    port,
    auth,
    secure: port === 465
  };
  const transport = Object.assign({}, server, settings);

  try {
    if (smtpTransporters.has(`${host}:${auth.user}`)) {
      return;
    }

    const transporter = nodemailer.createTransport(transport, messageCommonParameters);
    smtpTransporters.set(`${host}:${auth.user}`, transporter);
  } catch (error) {
    ctx.logger.error('Mail service smtp transporter creation error: %o\nWith parameters: \n\thost - %s, \n\tport - %d, \n\tauth = %o', error.stack, host, port, auth);
  }
}

async function send(host, userLogin, mailObject) {
  const transporter = smtpTransporters.get(`${host}:${userLogin}`);
  if (!transporter) {
    throw new Error(`MailService: no transporter exists for host "${host}" and user "${userLogin}"`);
  }

  return transporter.sendMail(mailObject);
}

function deleteTransporter(ctx, host, userLogin) {
  const transporter = smtpTransporters.get(`${host}:${userLogin}`);
  if (!transporter) {
    ctx.logger.error(`MailService: no transporter exists for host "${host}" and user "${userLogin}"`);
    return;
  }

  transporter.close();
  smtpTransporters.delete(`${host}:${userLogin}`);
}

function transportersRelease() {
  smtpTransporters.forEach(transporter => transporter.close());
  smtpTransporters.clear();
}

module.exports = {
  createTransporter,
  send,
  deleteTransporter,
  transportersRelease
};

