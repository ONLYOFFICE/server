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
const uuid = require('uuid');

const mailService = require('./mailService');
const operationContext = require('./operationContext');

const cfgMailServer = config.get('email.smtpServerConfiguration');
const cfgMailMessageDefaults = config.get('email.contactDefaults');

const uuidNamespace = 'e071294c-e621-4195-b453-6da9344e5c72';
const ctx = new operationContext.Context();
const defaultLicenseRepeatInterval = 1000 * 60 * 60 * 24;
const recipients = new Map();
const notificationTypes = {
  LICENSE_EXPIRED: 0,
};

class TransportInterface {
  getRecipientId(messageParams) {}
  async send(message) {}
  contentGeneration(template, messageParams) {}
}

class MailTransport extends TransportInterface {
  host = cfgMailServer.host;
  port = cfgMailServer.port;
  auth = cfgMailServer.auth;

  constructor() {
    super();

    mailService.createTransporter(this.host, this.port, this.auth, cfgMailMessageDefaults);
  }

  getRecipientId(messageParams) {
    if (!messageParams.to) {
      return uuid.NIL;
    }

    return uuid.v5(messageParams.to, uuidNamespace);
  }

  send(message) {
    ctx.logger.info('!!!!!!!!!!!!!!!!!!!!!SENDONG:', message);
    return mailService.send(this.host, this.auth.user, message);
  }

  contentGeneration(template, messageParams) {
    const messageBody = {
      subject: template.title,
      text: template.body
    };

    return Object.assign({}, messageBody, messageParams);
  }
}

// TODO:
class TelegramTransport extends TransportInterface {
  constructor() {
    super();
  }
}

class Transport {
  transport = new TransportInterface();

  constructor(transportName) {
    this.name = transportName;

    switch (transportName) {
      case 'email':
        this.transport = new MailTransport();
        break;
      case 'telegram':
        this.transport = new TelegramTransport();
        break
      default:
        ctx.logger.error(`Notification service error: transport method "${transportName}" not implemented`);
    }
  }
}

function getRecipientData(id, defaultPoliciesData) {
  if (id === uuid.NIL) {
    return;
  }

  const recipientData = recipients.get(id);
  if (!recipientData) {
    recipients.set(id, defaultPoliciesData);
    return defaultPoliciesData;
  }

  return recipientData;
}

async function notify(notificationType, messageParams) {
  ctx.logger.info('!!!!!!!!!!!!!!!!!!!!!HERE:', messageParams);
  switch (notificationType) {
    case notificationTypes.LICENSE_EXPIRED: {
      licenseExpiredNotify(messageParams);
      break;
    }
  }
}

function licenseExpiredNotify(messageParams) {
  const cfgLicenseExpired = config.get('notification.rules.licenseExpired');
  const transportObjects = cfgLicenseExpired.transportType.map(transport => new Transport(transport));
  const { repeatInterval } = cfgLicenseExpired.policies;
  const intervalMilliseconds = ms(repeatInterval) ?? defaultLicenseRepeatInterval;
  const defaultPolices = {
    repeatDate: Date.now(),
  }

  transportObjects.forEach(object => {
    const recipientId = object.transport.getRecipientId(messageParams);
    const data = getRecipientData(recipientId, defaultPolices);

    if (!data) {
      ctx.logger.error(`Notification service error, licenseExpiredNotify() transport "${object.name}": missing recipient data in message object \n${messageParams}`);
      return;
    }

    const currentDateMs = Date.now();
    if (data.repeatDate <= currentDateMs) {
      data.repeatDate = currentDateMs + intervalMilliseconds;

      const message = object.transport.contentGeneration(cfgLicenseExpired.template, messageParams);
      object.transport.send(message);
    }
  });
}

module.exports = {
  notificationTypes,
  notify
};
