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

const crypto = require('crypto');
const util = require('util');
const runtimeConfigManager = require('../../../Common/sources/runtimeConfigManager');

const scrypt = util.promisify(crypto.scrypt);
const PASSWORD_MIN_LENGTH = 1; // Any non-empty password allowed
const PASSWORD_MAX_LENGTH = 128; // Prevent DoS attacks on scrypt
const SCRYPT_KEYLEN = 64; // 64 bytes = 512 bits

/**
 * Hash a password using scrypt (built-in Node.js crypto)
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} Hashed password in format: salt:hash
 */
async function hashPassword(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
  }

  // Generate random salt
  const salt = crypto.randomBytes(16).toString('hex');

  // Derive key using scrypt
  const derivedKey = await scrypt(password, salt, SCRYPT_KEYLEN);

  // Return salt:hash format
  return salt + ':' + derivedKey.toString('hex');
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Hashed password in format: salt:hash
 * @returns {Promise<boolean>} True if password matches hash
 */
async function verifyPassword(password, hash) {
  if (!password || !hash) {
    return false;
  }

  try {
    // Split salt and hash
    const [salt, key] = hash.split(':');
    if (!salt || !key) {
      return false;
    }

    // Derive key from password with same salt
    const derivedKey = await scrypt(password, salt, SCRYPT_KEYLEN);

    // Compare using timing-safe comparison
    const keyBuffer = Buffer.from(key, 'hex');
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Check if AdminPanel setup is required (no password configured)
 * @param {import('./operationContext').Context} ctx - Operation context
 * @returns {Promise<boolean>} True if setup is required
 */
async function isSetupRequired(ctx) {
  const config = await runtimeConfigManager.getConfig(ctx);
  return !config?.adminPanel?.passwordHash;
}

/**
 * Save admin password hash to runtime config
 * @param {import('./operationContext').Context} ctx - Operation context
 * @param {string} password - Plain text password to hash and save
 * @returns {Promise<void>}
 */
async function saveAdminPassword(ctx, password) {
  const hash = await hashPassword(password);
  await runtimeConfigManager.saveConfig(ctx, {
    adminPanel: {
      passwordHash: hash
    }
  });
}

/**
 * Verify admin password against stored hash
 * @param {import('./operationContext').Context} ctx - Operation context
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} True if password matches stored hash
 */
async function verifyAdminPassword(ctx, password) {
  const config = await runtimeConfigManager.getConfig(ctx);
  const hash = config?.adminPanel?.passwordHash;
  if (!hash) {
    return false;
  }
  return verifyPassword(password, hash);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isSetupRequired,
  saveAdminPassword,
  verifyAdminPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH
};
