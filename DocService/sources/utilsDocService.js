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

const os = require('os');
const fs = require('fs');
const util = require('util');
const config = require('config');
const locale = require('windows-locale');
const ms = require('ms');
const decodeHeic = require('heic-decode');
const operationContext = require('./../../Common/sources/operationContext');

// Linux reports SSE3 as "pni" in /proc/cpuinfo.
const REQUIRED_X64_V2_FLAGS = ['pni', 'ssse3', 'sse4_1', 'sse4_2', 'popcnt', 'cx16', 'lahf_lm'];

function getMissingX64V2Flags(cpuInfo) {
  const processors = cpuInfo.match(/^[ \t]*processor[ \t]*:/gm) || [];
  const flagLines = cpuInfo.match(/^[ \t]*flags[ \t]*:[^\r\n]*/gm) || [];
  if (flagLines.length === 0 || (processors.length > 0 && processors.length !== flagLines.length)) return null;

  const flagSets = flagLines.map(line => {
    const flags = line.slice(line.indexOf(':') + 1).trim();
    return flags ? new Set(flags.split(/\s+/)) : null;
  });
  if (flagSets.some(flags => !flags)) return null;

  return REQUIRED_X64_V2_FLAGS.filter(flag => flagSets.some(flags => !flags.has(flag)));
}

function initializeSharp() {
  let skipReason = null;
  // todo on sharp upgrade, recheck CPU requirements; sharp 0.34 checks only SSE4.2 after loading
  if (process.platform === 'linux' && process.arch === 'x64') {
    let cpuInfo = null;
    try {
      cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    } catch (error) {
      skipReason = `unable to read /proc/cpuinfo: ${error.message}`;
    }
    if (cpuInfo !== null) {
      const missingFlags = getMissingX64V2Flags(cpuInfo);
      if (missingFlags === null) {
        skipReason = 'CPU flags unavailable in /proc/cpuinfo';
      } else if (missingFlags.length > 0) {
        skipReason = `CPU lacks x86-64-v2 flags: ${missingFlags.join(', ')}`;
      }
    }
  }
  if (skipReason) {
    operationContext.global.logger.warn('Sharp disabled: %s. Image processing functionality will be limited.', skipReason);
    return;
  }

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
    operationContext.global.logger.warn('Sharp module failed to load. Image processing functionality will be limited: %s', error.message);
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

const cfgStartNotifyFromRaw = config.get('license.warning_license_expiration');
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
 * Convert Sharp pipeline to buffer in optimal format (PNG or JPEG).
 * @param {Object} pipeline Sharp pipeline instance
 * @param {string} format Target format ('png' or 'jpeg')
 * @returns {Promise<Buffer>} Converted image buffer
 */
async function convertToFormat(pipeline, format) {
  if (format === 'png') {
    return await pipeline.png({compressionLevel: 7}).toBuffer();
  }
  return await pipeline.jpeg({quality: 90, chromaSubsampling: '4:4:4'}).toBuffer();
}

/**
 * Decode HEIC/HEIF buffer using heic-decode library and create Sharp instance.
 * @param {Buffer} buffer HEIC/HEIF image buffer
 * @returns {Promise<Object>} Sharp instance with decoded raw image data
 */
async function decodeHeicToSharp(buffer) {
  const decodedImage = await decodeHeic({buffer});
  return sharp(decodedImage.data, {
    failOn: 'none',
    raw: {
      width: decodedImage.width,
      height: decodedImage.height,
      channels: 4
    }
  });
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

  try {
    const meta = await sharp(buffer, {failOn: 'none'}).metadata();
    const fmt = (meta.format || '').toLowerCase();
    const needsRotation = meta.orientation && meta.orientation > 1;

    // Handle modern formats requiring conversion
    if (fmt === 'heic' || fmt === 'heif' || fmt === 'webp' || fmt === 'avif' || fmt === 'tiff' || fmt === 'tif') {
      const optimalFormat = determineOptimalFormat(ctx, meta);
      ctx.logger.debug('processImageOptimal: converting %s to %s%s', fmt, optimalFormat, needsRotation ? ' with rotation' : '');

      try {
        const pipeline = sharp(buffer, {failOn: 'none'}).rotate();
        return await convertToFormat(pipeline, optimalFormat);
      } catch (sharpError) {
        // Fallback to heic-decode for HEIC/HEIF when Sharp fails
        if (fmt === 'heic' || fmt === 'heif') {
          ctx.logger.debug('processImageOptimal: Sharp failed for %s, using heic-decode fallback', fmt);
          const heicPipeline = await decodeHeicToSharp(buffer);
          return await convertToFormat(heicPipeline, optimalFormat);
        }
        throw sharpError;
      }
    }

    // For standard formats, only apply EXIF rotation if needed
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
  const tenStartNotifyFrom = ms(ctx.getCfg('license.warning_license_expiration', cfgStartNotifyFromRaw));
  if (currentDate.getTime() >= endDate.getTime() - tenStartNotifyFrom) {
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
module.exports.getMissingX64V2Flags = getMissingX64V2Flags;
