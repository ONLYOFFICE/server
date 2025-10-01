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
const jwt = require('jsonwebtoken');

const BOOTSTRAP_TOKEN_TTL = 1 * 60 * 60 * 1000; // 1 hour
const BOOTSTRAP_CODE_LENGTH = 8; // Short code length

// Get bootstrap secret from env or config (for cluster support)
const BOOTSTRAP_SECRET = process.env.ADMINPANEL_BOOTSTRAP_SECRET || crypto.randomBytes(32).toString('hex');

// In-memory storage for bootstrap token
let inMemoryBootstrapToken = null;

/**
 * Generate short bootstrap code (for admin to type)
 * @returns {string} Short code like "AB12CD34"
 */
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(BOOTSTRAP_CODE_LENGTH);
  for (let i = 0; i < BOOTSTRAP_CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate bootstrap token for initial setup
 * Token = short code signed with JWT (cluster-safe)
 * @param {import('../../../Common/sources/operationContext').Context} ctx - Operation context
 * @returns {Promise<{code: string, expiresAt: Date}>}
 */
async function generateBootstrapToken(ctx) {
  const code = generateShortCode();
  const expiresAt = new Date(Date.now() + BOOTSTRAP_TOKEN_TTL);

  // Sign code with JWT for cluster verification
  const jwtToken = jwt.sign({code, type: 'bootstrap'}, BOOTSTRAP_SECRET, {expiresIn: Math.floor(BOOTSTRAP_TOKEN_TTL / 1000)});

  // Store in memory
  inMemoryBootstrapToken = {
    code,
    jwtToken,
    expiresAt,
    used: false
  };

  ctx.logger.info('Bootstrap code generated (valid until %s)', expiresAt.toISOString());

  return {code, expiresAt};
}

/**
 * Verify bootstrap code from user input
 * Works in cluster - all instances can verify with shared secret
 * @param {import('../../../Common/sources/operationContext').Context} ctx - Operation context
 * @param {string} providedCode - Code provided by user (e.g. "AB12CD34")
 * @returns {Promise<boolean>} True if code is valid and not expired
 */
async function verifyBootstrapToken(ctx, providedCode) {
  if (!providedCode || !inMemoryBootstrapToken) {
    return false;
  }

  // Normalize code (remove spaces, dashes, uppercase)
  const normalizedCode = providedCode.toUpperCase().replace(/[\s-]/g, '');

  // Check if already used
  if (inMemoryBootstrapToken.used) {
    ctx.logger.warn('Bootstrap code already used');
    return false;
  }

  // Verify JWT signature (cluster-safe)
  try {
    const decoded = jwt.verify(inMemoryBootstrapToken.jwtToken, BOOTSTRAP_SECRET);

    // Check code match
    if (decoded.code !== normalizedCode) {
      return false;
    }

    // Mark as used
    inMemoryBootstrapToken.used = true;
    ctx.logger.info('Bootstrap code verified and marked as used');

    return true;
  } catch (error) {
    ctx.logger.warn('Bootstrap code verification failed: %s', error.message);
    return false;
  }
}

/**
 * Check if bootstrap code exists and is valid in memory
 * @returns {Promise<boolean>} True if valid bootstrap code exists
 */
async function hasValidBootstrapToken() {
  if (!inMemoryBootstrapToken || inMemoryBootstrapToken.used) {
    return false;
  }

  // Check expiration
  if (inMemoryBootstrapToken.expiresAt < new Date()) {
    return false;
  }

  // Verify JWT is still valid (cluster check)
  try {
    jwt.verify(inMemoryBootstrapToken.jwtToken, BOOTSTRAP_SECRET);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidate bootstrap code (for reset scenarios)
 * @param {import('../../../Common/sources/operationContext').Context} ctx - Operation context
 */
async function invalidateBootstrapToken(ctx) {
  inMemoryBootstrapToken = null;
  ctx.logger.info('Bootstrap code invalidated');
}

/**
 * Get current bootstrap code for display (if exists and valid)
 * @param {import('../../../Common/sources/operationContext').Context} ctx - Operation context
 * @returns {Promise<string|null>} Current code or null
 */
async function getCurrentBootstrapCode(ctx) {
  if (await hasValidBootstrapToken(ctx)) {
    return inMemoryBootstrapToken.code;
  }
  return null;
}

module.exports = {
  generateBootstrapToken,
  verifyBootstrapToken,
  hasValidBootstrapToken,
  invalidateBootstrapToken,
  getCurrentBootstrapCode,
  BOOTSTRAP_TOKEN_TTL
};
