/*
 * (c) Copyright Ascensio System SIA 2010-2024
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

const util = require("util");
const config = require('config');
const exifParser = require('exif-parser');
//set global window to fix issue https://github.com/photopea/UTIF.js/issues/130
if (!global.window) {
  global.window = global;
}
const Jimp = require('jimp');
const locale = require('windows-locale');
const ms = require('ms');

const tenantManager = require('../../Common/sources/tenantManager');
const { notificationTypes, ...notificationService } = require('../../Common/sources/notificationService');

const cfgStartNotifyFrom = ms(config.get('license.warning_license_expiration'));
const cfgNotificationRuleLicenseExpirationWarning = config.get('notification.rules.licenseExpirationWarning.template');
const cfgNotificationRuleLicenseExpirationError = config.get('notification.rules.licenseExpirationError.template');

async function fixImageExifRotation(ctx, buffer) {
  if (!buffer) {
    return buffer;
  }
  //todo move to DocService dir common
  try {
    let parser = exifParser.create(buffer);
    let exif = parser.parse();
    if (exif.tags?.Orientation > 1) {
      ctx.logger.debug('fixImageExifRotation remove exif and rotate:%j', exif);
      buffer = convertImageTo(ctx, buffer, Jimp.AUTO);
    }
  } catch (e) {
    ctx.logger.debug('fixImageExifRotation error:%s', e.stack);
  }
  return buffer;
}
async function convertImageToPng(ctx, buffer) {
  return await convertImageTo(ctx, buffer, Jimp.MIME_PNG);
}
async function convertImageTo(ctx, buffer, mime) {
  try {
    ctx.logger.debug('convertImageTo %s', mime);
    let image = await Jimp.read(buffer);
    //remove exif
    image.bitmap.exifBuffer = undefined;
    //set jpeg and png quality
    //https://www.imagemagick.org/script/command-line-options.php#quality
    image.quality(90);
    image.deflateLevel(7);
    buffer = await image.getBufferAsync(mime);
  } catch (e) {
    ctx.logger.debug('convertImageTo error:%s', e.stack);
  }
  return buffer;
}
/**
 *
 * @param {string} lang
 * @returns {number | undefined}
 */
function localeToLCID(lang) {
  let elem = locale[lang && lang.toLowerCase()];
  return elem && elem.id;
}

function humanFriendlyExpirationTime(endTime) {
  const month = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];

  return `${month[endTime.getUTCMonth()]} ${endTime.getUTCDate()}, ${endTime.getUTCFullYear()}`
}

/**
 * Notify server user about license expiration via configured notification transports.
 * @param {Context} ctx Context.
 * @param {Date} endDate Date of expiration.
 * @returns {undefined}
 */
async function notifyLicenseExpiration(ctx, endDate) {
  if (!endDate) {
    ctx.logger.warn('notifyLicenseExpiration(): expiration date is not defined');
    return;
  }

  const currentDate = new Date();
  if (currentDate.getTime() >= endDate.getTime() - cfgStartNotifyFrom) {
    //todo remove stub for "new Date(1)" and "setMonth + 1" in license.js; bug 70676
    if (endDate.getUTCFullYear() < 2000) {
      endDate = currentDate;
    }
    const formattedExpirationTime = humanFriendlyExpirationTime(endDate);
    const applicationName = (process.env.APPLICATION_NAME || "").toUpperCase();
    if (endDate <= currentDate) {
      const tenNotificationRuleLicenseExpirationError = ctx.getCfg('notification.rules.licenseExpirationError.template', cfgNotificationRuleLicenseExpirationError);
      const title = util.format(tenNotificationRuleLicenseExpirationError.title, applicationName);
      const message = util.format(tenNotificationRuleLicenseExpirationError.body, formattedExpirationTime);
      ctx.logger.error(message);
      await notificationService.notify(ctx, notificationTypes.LICENSE_EXPIRATION_ERROR, title, message);
    } else {
      const tenNotificationRuleLicenseExpirationWarning = ctx.getCfg('notification.rules.licenseExpirationWarning.template', cfgNotificationRuleLicenseExpirationWarning);
      const title = util.format(tenNotificationRuleLicenseExpirationWarning.title, applicationName);
      const message = util.format(tenNotificationRuleLicenseExpirationWarning.body, formattedExpirationTime);
      ctx.logger.warn(message);
      await notificationService.notify(ctx, notificationTypes.LICENSE_EXPIRATION_WARNING, title, message);
    }
  }
}

module.exports.fixImageExifRotation = fixImageExifRotation;
module.exports.convertImageToPng = convertImageToPng;
module.exports.localeToLCID = localeToLCID;
module.exports.notifyLicenseExpiration = notifyLicenseExpiration;
