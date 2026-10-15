/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';
const config = require('config');
const ms = require('ms');

const mailService = require('./mailService');

const cfgSmtpServerConfiguration = config.get('email.smtpServerConfiguration');
const cfgContactDefaults = config.get('email.contactDefaults');
const {editorStatStorage} = require('./../../DocService/sources/editorDataStorage');

const editorStat = editorStatStorage.EditorStat ? new editorStatStorage.EditorStat() : new editorStatStorage();
const notificationTypes = {
  LICENSE_EXPIRATION_WARNING: 'licenseExpirationWarning',
  LICENSE_EXPIRATION_ERROR: 'licenseExpirationError',
  LICENSE_LIMIT_EDIT: 'licenseLimitEdit',
  LICENSE_LIMIT_LIVE_VIEWER: 'licenseLimitLiveViewer'
};

class TransportInterface {
  async send(_ctx, _message) {}
  contentGeneration(_title, _message) {}
}

class MailTransport extends TransportInterface {
  constructor(ctx) {
    super();

    const mailServerConfig = ctx.getCfg('email.smtpServerConfiguration', cfgSmtpServerConfiguration);
    this.host = mailServerConfig.host;
    this.port = mailServerConfig.port;
    this.auth = mailServerConfig.auth;
    const cfgMailMessageDefaults = ctx.getCfg('email.contactDefaults', cfgContactDefaults);

    mailService.createTransporter(ctx, this.host, this.port, this.auth, cfgMailMessageDefaults);
  }

  async send(ctx, message) {
    ctx.logger.debug('Notification service: MailTransport send %j', message);
    return mailService.send(this.host, this.auth.user, message);
  }

  contentGeneration(title, message) {
    return {
      subject: title,
      text: message
    };
  }
}

// TODO:
class TelegramTransport extends TransportInterface {
  constructor(_ctx) {
    super();
  }
}

class Transport {
  transport = new TransportInterface();

  constructor(ctx, transportName) {
    this.name = transportName;

    switch (transportName) {
      case 'email':
        this.transport = new MailTransport(ctx);
        break;
      case 'telegram':
        this.transport = new TelegramTransport(ctx);
        break;
      default:
        ctx.logger.warn(`Notification service: error: transport method "${transportName}" not implemented`);
    }
  }
}

async function notify(ctx, notificationType, title, message, opt_cacheKey = undefined) {
  const tenRule = ctx.getCfg(`notification.rules.${notificationType}`, config.get(`notification.rules.${notificationType}`));
  if (tenRule?.enable) {
    ctx.logger.debug('Notification service: notify "%s"', notificationType);
    const checkRes = await checkRulePolicies(ctx, notificationType, tenRule, opt_cacheKey);
    if (checkRes) {
      await notifyRule(ctx, tenRule, title, message);
    }
  }
}

async function checkRulePolicies(ctx, notificationType, tenRule, opt_cacheKey) {
  const {repeatInterval} = tenRule.policies;
  //decrease repeatInterval by 1% to avoid race condition if timeout=repeatInterval
  const ttl = Math.floor((ms(repeatInterval) * 0.99) / 1000);
  let isLock = false;
  //todo for compatibility remove if after 8.2
  if (editorStat?.lockNotification) {
    isLock = await editorStat.lockNotification(ctx, opt_cacheKey || notificationType, ttl);
  }
  if (!isLock) {
    ctx.logger.debug(`Notification service: skip rule "%s" due to repeat interval = %s`, notificationType, repeatInterval);
  }
  return isLock;
}

async function notifyRule(ctx, tenRule, title, message) {
  const transportObjects = tenRule.transportType.map(transport => new Transport(ctx, transport));
  for (const transportObject of transportObjects) {
    try {
      const mail = transportObject.transport.contentGeneration(title, message);
      await transportObject.transport.send(ctx, mail);
    } catch (error) {
      ctx.logger.error('Notification service: error: %s', error.stack);
    }
  }
}

module.exports = {
  notificationTypes,
  notify
};
