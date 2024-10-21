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
const util = require('util');
const config = require('config');
const ms = require('ms');

const mailService = require('./mailService');

const cfgMailServer = config.get('email.smtpServerConfiguration');
const cfgMailMessageDefaults = config.get('email.contactDefaults');
const cfgEditorDataStorage = config.get('services.CoAuthoring.server.editorDataStorage');
const cfgEditorStatStorage = config.get('services.CoAuthoring.server.editorStatStorage');
const editorStatStorage = require('./../../DocService/sources/' + (cfgEditorStatStorage || cfgEditorDataStorage));

const editorStat = editorStatStorage.EditorStat ? new editorStatStorage.EditorStat() : new editorStatStorage();
const notificationTypes = {
  LICENSE_EXPIRATION_WARNING: 'licenseExpirationWarning',
  LICENSE_EXPIRATION_ERROR: 'licenseExpirationError',
  LICENSE_LIMIT_EDIT: 'licenseLimitEdit',
  LICENSE_LIMIT_LIVE_VIEWER: 'licenseLimitLiveViewer'
};

class TransportInterface {
  async send(ctx, message) {}
  contentGeneration(title, message) {}
}

class MailTransport extends TransportInterface {
  host = cfgMailServer.host;
  port = cfgMailServer.port;
  auth = cfgMailServer.auth;

  constructor(ctx) {
    super();

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
  constructor(ctx) {
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
        break
      default:
        ctx.logger.warn(`Notification service: error: transport method "${transportName}" not implemented`);
    }
  }
}

async function notify(ctx, notificationType, title, message, opt_cacheKey = undefined) {
  const tenRule = ctx.getCfg(`notification.rules.${notificationType}`, config.get(`notification.rules.${notificationType}`));
  if (tenRule?.enable) {
    ctx.logger.debug('Notification service: notify "%s"',  notificationType);
    let checkRes = await checkRulePolicies(ctx, notificationType, tenRule, opt_cacheKey);
    if (checkRes) {
      await notifyRule(ctx, tenRule, title, message);
    }
  }
}

async function checkRulePolicies(ctx, notificationType, tenRule, opt_cacheKey) {
  const { repeatInterval } = tenRule.policies;
  //decrease repeatInterval by 1% to avoid race condition if timeout=repeatInterval
  let ttl = Math.floor(ms(repeatInterval) * 0.99 / 1000);
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
