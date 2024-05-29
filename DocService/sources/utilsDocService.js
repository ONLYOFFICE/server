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

const config = require('config');
const exifParser = require('exif-parser');
const Jimp = require('jimp');
const locale = require('windows-locale');
const ms = require('ms');

const utils = require('../../Common/sources/utils');
const tenantManager = require('../../Common/sources/tenantManager');
const { notificationTypes, ...notificationService } = require('../../Common/sources/notificationService');

const cfgStartNotifyFrom = ms(config.get('license.startNotifyFrom'));

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
      let image = await Jimp.read(buffer);
      //remove exif
      image.bitmap.exifBuffer = undefined;
      //set jpeg and png quality
      //https://www.imagemagick.org/script/command-line-options.php#quality
      image.quality(90);
      image.deflateLevel(7);
      buffer = await image.getBufferAsync(Jimp.AUTO);
    }
  } catch (e) {
    ctx.logger.debug('fixImageExifRotation error:%s', e.stack);
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

function humanFriendlyExpirationTime(ctx, endTime) {
  const timeWithPostfix = (timeName, value) => `${value} ${timeName}${value > 1 ? 's' : ''}`;
  const currentTime = new Date();
  const oneMinute = 1000 * 60;
  const oneHour = oneMinute * 60;
  const oneDay = oneHour * 24;
  const absoluteDiff = endTime.getTime() - currentTime.getTime();

  currentTime.setUTCSeconds(0,0);

  if (endTime.getTime() < currentTime.getTime()) {
    ctx.logger.warn(`humanFriendlyExpirationTime(): expiration date value is lesser than current date`);
    return '';
  }

  const floatResult = absoluteDiff / oneDay;
  const daysCount = floatResult < 1 ? 0 : Math.round(floatResult);
  const monthDiff = utils.getMonthDiff(currentTime, endTime);
  if (monthDiff >= 1 && daysCount >= currentTime.getDaysInMonth()) {
    return timeWithPostfix('month', monthDiff);
  }

  if (daysCount > 0) {
    return timeWithPostfix('day', daysCount);
  }

  // This time we cannot just round division operation to the nearest digit because we need minutes value and more accuracy.
  let hoursCount = 0
  for (; hoursCount * oneHour <= absoluteDiff; hoursCount++) {}

  if (hoursCount * oneHour > absoluteDiff) {
    hoursCount--;
  }

  let minutesCount = Math.round((absoluteDiff - hoursCount * oneHour) / oneMinute);
  if(minutesCount >= 60) {
    hoursCount++;
    minutesCount -= 60;
  }

  let timeString = '';
  if (hoursCount > 0) {
    timeString += timeWithPostfix('hour', hoursCount);
  }

  if (minutesCount > 0) {
    if (timeString.length !== 0) {
      timeString += ' ';
    }

    timeString += timeWithPostfix('minute', minutesCount);
  }

  return timeString;
}

/**
 * Notify server user about license expiration via configured notification transports.
 * @param {string} ctx Context.
 * @param {date} endDate Date of expiration.
 * @returns {undefined}
 */
function notifyLicenseExpiration(ctx, endDate) {
  if (!endDate) {
    ctx.logger.warn('notifyLicenseExpiration(): expiration date is not defined');
    return;
  }

  const currentDate = new Date();
  const licenseEndTime = new Date(endDate);

  if (licenseEndTime < currentDate) {
    ctx.logger.warn(`notifyLicenseExpiration(): expiration date(${licenseEndTime}) is lesser than current date(${currentDate})`);
    return;
  }

  if (currentDate.getTime() >= licenseEndTime.getTime() - cfgStartNotifyFrom) {
    const formattedTimeRemaining = humanFriendlyExpirationTime(ctx, licenseEndTime);
    let tenant = tenantManager.isDefaultTenant(ctx) ? 'server' : ctx.tenant;
    ctx.logger.warn('%s license expires in %s!!!', tenant, formattedTimeRemaining);
    notificationService.notify(ctx, notificationTypes.LICENSE_EXPIRED, [formattedTimeRemaining]);
  }
}

module.exports = {
  fixImageExifRotation,
  localeToLCID,
  notifyLicenseExpiration
};

if (process.env.NODE_APP_INSTANCE === 'tests') {
  module.exports.humanFriendlyExpirationTime = humanFriendlyExpirationTime;
}
