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

const os = require('os');
const util = require('util');
const config = require('config');
const locale = require('windows-locale');
const ms = require('ms');
const operationContext = require('./../../Common/sources/operationContext');

function initializeSharp() {
  let originalValues = {};
  try {
    const tmp = os.tmpdir();
    // Save original values
    originalValues = {
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      HOME: process.env.HOME
    };
    // Set temporary values for Sharp initialization
    process.env.XDG_CACHE_HOME = tmp;
    process.env.HOME = tmp;

    sharp = require('sharp');
  } catch (error) {
    operationContext.global.logger.warn('Sharp module failed to load. Image processing functionality will be limited.');
    operationContext.global.logger.warn('Sharp load error:', error.message);
  } finally {
    // Restore original values
    Object.keys(originalValues).forEach(key => {
      if (originalValues[key] !== undefined) {
        process.env[key] = originalValues[key];
      } else {
        delete process.env[key];
      }
    });
  }
  
  if (sharp) {
    // todo test.
    // Set concurrency to 2 for better performance
    sharp.concurrency(2);
    // Disable cache - not needed for one-time image conversion (writes to ./.cache dir)
    sharp.cache(false);
  }
}

// Load Sharp with graceful fallback for pkg-builds and missing dependencies
let sharp = null;
initializeSharp();

const {notificationTypes, ...notificationService} = require('../../Common/sources/notificationService');

const cfgStartNotifyFrom = ms(config.get('license.warning_license_expiration'));
const cfgNotificationRuleLicenseExpirationWarning = config.get('notification.rules.licenseExpirationWarning.template');
const cfgNotificationRuleLicenseExpirationError = config.get('notification.rules.licenseExpirationError.template');

/**
 * Determine optimal format (PNG vs JPEG) for image conversion based on image characteristics.
 * @param {operationContext} ctx Operation context for logging
 * @param {Object} metadata Image metadata from sharp
 * @returns {('png'|'jpeg')} Optimal format for conversion
 */
function determineOptimalFormat(ctx, metadata) {
  // If image has alpha channel, only PNG can preserve transparency
  if (metadata.hasAlpha) {
    return 'png';
  }

  // Analyze color characteristics
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // Small images (likely icons/logos) - prefer PNG
  // Only apply when dimensions are known (greater than zero)
  if (width > 0 && height > 0 && width <= 256 && height <= 256) {
    return 'png';
  }

  // Large photographic images - prefer JPEG
  if (width > 800 || height > 600) {
    return 'jpeg';
  }

  // Default to JPEG for general compatibility and smaller file sizes
  return 'jpeg';
}

/**
 * Process and optimize image buffer with EXIF rotation fix and modern format conversion.
 * 1. Fixes EXIF rotation and strips metadata for all images
 * 2. Converts modern/unsupported formats to optimal formats:
 *    - WebP/HEIC/HEIF/AVIF/TIFF: Convert to optimal format (PNG or JPEG) based on image characteristics
 * @param {operationContext} ctx Operation context for logging
 * @param {Buffer} buffer Source image bytes
 * @returns {Promise<Buffer>} Processed and optimally converted buffer or original buffer
 */
async function processImageOptimal(ctx, buffer) {
  if (!buffer) return buffer;

  // Check if Sharp is available
  if (!sharp) {
    ctx.logger.warn('processImageOptimal: Sharp module not available, returning original buffer. Image processing disabled.');
    return buffer;
  }

  let needsRotation = false;

  try {
    const meta = await sharp(buffer, {failOn: 'none'}).metadata();
    needsRotation = meta.orientation && meta.orientation > 1;
    const fmt = (meta.format || '').toLowerCase();

    // Handle modern formats that need conversion
    if (fmt === 'webp' || fmt === 'heic' || fmt === 'heif' || fmt === 'avif') {
      const optimalFormat = determineOptimalFormat(ctx, meta);
      ctx.logger.debug('processImageOptimal: detected %s, converting to %s%s', fmt, optimalFormat, needsRotation ? ' with EXIF rotation' : '');

      const pipeline = sharp(buffer, {failOn: 'none'}).rotate();
      if (optimalFormat === 'png') {
        return await pipeline.png({compressionLevel: 7}).toBuffer();
      } else {
        return await pipeline.jpeg({quality: 90, chromaSubsampling: '4:4:4'}).toBuffer();
      }
    }

    if (fmt === 'tiff' || fmt === 'tif') {
      const optimalFormat = determineOptimalFormat(ctx, meta);
      ctx.logger.debug('processImageOptimal: detected TIFF, converting to %s%s', optimalFormat, needsRotation ? ' with EXIF rotation' : '');

      const pipeline = sharp(buffer, {failOn: 'none'}).rotate();
      if (optimalFormat === 'png') {
        return await pipeline.png({compressionLevel: 7}).toBuffer();
      } else {
        return await pipeline.jpeg({quality: 90, chromaSubsampling: '4:4:4'}).toBuffer();
      }
    }

    // For other formats, only apply EXIF rotation if needed
    if (needsRotation) {
      ctx.logger.debug('processImageOptimal: applying EXIF rotation to %s', fmt);
      const pipeline = sharp(buffer, {failOn: 'none'}).rotate();
      if (fmt === 'jpeg' || fmt === 'jpg') {
        return await pipeline.jpeg({quality: 90, chromaSubsampling: '4:4:4'}).toBuffer();
      }
      if (fmt === 'png') {
        return await pipeline.png({compressionLevel: 7}).toBuffer();
      }
      return await pipeline.toBuffer();
    }
  } catch (e) {
    ctx.logger.debug('processImageOptimal error: %s', e.stack);
  }

  return buffer;
}

/**
 *
 * @param {string} lang
 * @returns {number | undefined}
 */
function localeToLCID(lang) {
  const elem = locale[lang && lang.toLowerCase()];
  return elem && elem.id;
}

function humanFriendlyExpirationTime(endTime) {
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return `${month[endTime.getUTCMonth()]} ${endTime.getUTCDate()}, ${endTime.getUTCFullYear()}`;
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
    const applicationName = (process.env.APPLICATION_NAME || '').toUpperCase();
    if (endDate <= currentDate) {
      const tenNotificationRuleLicenseExpirationError = ctx.getCfg(
        'notification.rules.licenseExpirationError.template',
        cfgNotificationRuleLicenseExpirationError
      );
      const title = util.format(tenNotificationRuleLicenseExpirationError.title, applicationName);
      const message = util.format(tenNotificationRuleLicenseExpirationError.body, formattedExpirationTime);
      ctx.logger.error(message);
      await notificationService.notify(ctx, notificationTypes.LICENSE_EXPIRATION_ERROR, title, message);
    } else {
      const tenNotificationRuleLicenseExpirationWarning = ctx.getCfg(
        'notification.rules.licenseExpirationWarning.template',
        cfgNotificationRuleLicenseExpirationWarning
      );
      const title = util.format(tenNotificationRuleLicenseExpirationWarning.title, applicationName);
      const message = util.format(tenNotificationRuleLicenseExpirationWarning.body, formattedExpirationTime);
      ctx.logger.warn(message);
      await notificationService.notify(ctx, notificationTypes.LICENSE_EXPIRATION_WARNING, title, message);
    }
  }
}

module.exports.processImageOptimal = processImageOptimal;
module.exports.determineOptimalFormat = determineOptimalFormat;
module.exports.localeToLCID = localeToLCID;
module.exports.notifyLicenseExpiration = notifyLicenseExpiration;
