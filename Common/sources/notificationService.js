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

const defaultRepeatInterval = 1000 * 60 * 60 * 24;
const repeatIntervalsExpired = new Map();
const notificationTypes = {
  LICENSE_EXPIRED: "licenseExpired",
  LICENSE_LIMIT: "licenseLimit"
};

class TransportInterface {
  async send(ctx, message) {}
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

  async send(ctx, message) {
    ctx.logger.info('Notification service: MailTransport send %j', message);
    return mailService.send(this.host, this.auth.user, message);
  }

  contentGeneration(template, messageParams) {
    let text = util.format(template.body, ...messageParams);
    return {
      subject: template.title,
      text: text
    };
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

  constructor(ctx, transportName) {
    this.name = transportName;

    switch (transportName) {
      case 'email':
        this.transport = new MailTransport();
        break;
      case 'telegram':
        this.transport = new TelegramTransport();
        break
      default:
        ctx.logger.warn(`Notification service: error: transport method "${transportName}" not implemented`);
    }
  }
}

async function notify(ctx, notificationType, messageParams) {
  ctx.logger.debug('Notification service: notify "%s"',  notificationType);
  let tenRule;
  tenRule = ctx.getCfg('notification.rules.' + notificationType, config.get('notification.rules.' + notificationType));

  if (tenRule && checkRulePolicies(ctx, notificationType, tenRule)) {
    await notifyRule(ctx, tenRule, messageParams);
  }
}
function checkRulePolicies(ctx, notificationType, tenRule) {
  const {repeatInterval} = tenRule.policies;
  const intervalMilliseconds = ms(repeatInterval) ?? defaultRepeatInterval;
  let expired = repeatIntervalsExpired.get(notificationType);
  if (!expired || expired <= Date.now()) {
    repeatIntervalsExpired.set(notificationType, Date.now() + intervalMilliseconds);
    return true;
  }
  ctx.logger.debug(`Notification service: skip rule "%s" due to repeat interval %s`, notificationType, repeatInterval);
  return false;
}

async function notifyRule(ctx, tenRule, messageParams) {
  const transportObjects = tenRule.transportType.map(transport => new Transport(ctx, transport));
  for (const transportObject of transportObjects) {
    const message = transportObject.transport.contentGeneration(tenRule.template, messageParams);
    await transportObject.transport.send(ctx, message);
  }
}

module.exports = {
  notificationTypes,
  notify
};
