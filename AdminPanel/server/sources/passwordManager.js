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

const pbkdf2 = util.promisify(crypto.pbkdf2);
const PASSWORD_MIN_LENGTH = 1; // Any non-empty password allowed
const PASSWORD_MAX_LENGTH = 128; // Prevent DoS attacks
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommendation for SHA-256
const PBKDF2_KEYLEN = 32; // 32 bytes = 256 bits
const PBKDF2_DIGEST = 'sha256'; // SHA-256 algorithm

/**
 * Hash a password using PBKDF2-SHA256 in MCF format (OWASP recommended)
 * Format: $pbkdf2-sha256$iterations$salt$hash (all base64)
 *
 * OpenSSL equivalent (requires OpenSSL 3.0+):
 * I=600000; S=$(openssl rand -base64 16 | tr -d '\n'); H=$(openssl kdf -binary -keylen 32 -kdfopt digest:SHA256 -kdfopt pass:UTF8:"password" -kdfopt salt:base64:"$S" -kdfopt iter:$I PBKDF2 | base64 | tr -d '\n'); echo "$pbkdf2-sha256$$I$$S$$H"
 *
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} Hashed password in MCF format
 */
async function hashPassword(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
  }

  // Generate random salt (16 bytes = 128 bits, OWASP minimum)
  const saltBuffer = crypto.randomBytes(16);
  const saltBase64 = saltBuffer.toString('base64').replace(/\+/g, '.').replace(/=/g, '');

  // Derive key using PBKDF2-SHA256 with 600,000 iterations
  const derivedKey = await pbkdf2(password, saltBuffer, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const hashBase64 = derivedKey.toString('base64').replace(/\+/g, '.').replace(/=/g, '');

  // Return MCF format: $pbkdf2-sha256$iterations$salt$hash
  return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${saltBase64}$${hashBase64}`;
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Hashed password in MCF format
 * @returns {Promise<boolean>} True if password matches hash
 */
async function verifyPassword(password, hash) {
  if (!password || !hash) {
    return false;
  }

  try {
    // Parse MCF format: $pbkdf2-sha256$iterations$salt$hash
    if (!hash.startsWith('$pbkdf2-sha256$')) {
      return false;
    }

    const parts = hash.split('$');
    if (parts.length !== 5) {
      return false;
    }

    const [, , iterationsStr, saltBase64, expectedHashBase64] = parts;
    const iterations = parseInt(iterationsStr, 10);

    if (!iterations || !saltBase64 || !expectedHashBase64) {
      return false;
    }

    // Decode base64 salt (restore + from .)
    const saltBuffer = Buffer.from(saltBase64.replace(/\./g, '+'), 'base64');

    // Derive key from password with same parameters
    const derivedKey = await pbkdf2(password, saltBuffer, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST);

    // Decode expected hash from base64 (restore + from .)
    const expectedHashBuffer = Buffer.from(expectedHashBase64.replace(/\./g, '+'), 'base64');

    // Compare using timing-safe comparison (compare raw buffers, not base64 strings)
    return crypto.timingSafeEqual(derivedKey, expectedHashBuffer);
  } catch {
    return false;
  }
}

/**
 * Check if password hash is valid (proper MCF format)
 * @param {string} hash - Password hash to validate
 * @returns {boolean} True if hash is in valid MCF format
 */
function isValidPasswordHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return false;
  }

  // Must start with correct MCF prefix
  if (!hash.startsWith('$pbkdf2-sha256$')) {
    return false;
  }

  // Must have correct structure: $pbkdf2-sha256$iterations$salt$hash
  const parts = hash.split('$');
  if (parts.length !== 5) {
    return false;
  }

  const [, , iterationsStr, saltBase64, hashBase64] = parts;

  // Validate iterations is a number
  const iterations = parseInt(iterationsStr, 10);
  if (!iterations || iterations < 1000) {
    return false;
  }

  // Validate salt and hash are present and reasonable length
  if (!saltBase64 || saltBase64.length < 10 || !hashBase64 || hashBase64.length < 10) {
    return false;
  }

  return true;
}

/**
 * Check if AdminPanel setup is required (no password configured or invalid format)
 * Invalid or old format is treated as no password set
 * @param {import('./operationContext').Context} ctx - Operation context
 * @returns {Promise<boolean>} True if setup is required
 */
async function isSetupRequired(ctx) {
  const config = await runtimeConfigManager.getConfig(ctx);
  const passwordHash = config?.adminPanel?.passwordHash;

  // No password hash or invalid format - setup required
  if (!isValidPasswordHash(passwordHash)) {
    if (passwordHash) {
      ctx.logger.warn('Invalid password hash format detected - setup required');
    }
    return true;
  }

  return false;
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
 * Invalid or old format is treated as no password set - returns false
 * @param {import('./operationContext').Context} ctx - Operation context
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} True if password matches stored hash
 */
async function verifyAdminPassword(ctx, password) {
  const config = await runtimeConfigManager.getConfig(ctx);
  const hash = config?.adminPanel?.passwordHash;

  // No hash or invalid format - treat as no password set
  if (!isValidPasswordHash(hash)) {
    if (hash) {
      ctx.logger.warn('Invalid password hash format detected - authentication rejected, re-setup required');
    }
    return false;
  }

  return verifyPassword(password, hash);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isValidPasswordHash,
  isSetupRequired,
  saveAdminPassword,
  verifyAdminPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH
};
