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
const express = require('express');
const crypto = require('crypto');
const utils = require('../../../../../Common/sources/utils');
const runtimeConfigManager = require('../../../../../Common/sources/runtimeConfigManager');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const {validateJWT} = require('../../middleware/auth');
const {getConfig} = require('../../../../../Common/sources/runtimeConfigManager');
const cookieParser = require('cookie-parser');

const cfgWopiPublicKey = config.get('wopi.publicKey');
const cfgWopiModulus = config.get('wopi.modulus');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiExponent = config.get('wopi.exponent');

const router = express.Router();
router.use(cookieParser());

/**
 * Decode a base64url string into a Buffer (RFC 7515)
 * @param {string} b64url base64url-encoded string (no padding)
 * @returns {Buffer} decoded bytes
 */
function base64UrlToBuffer(b64url) {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Buffer.from(b64, 'base64');
}

/**
 * Convert a big-endian Buffer into a safe JavaScript Number.
 * Note: Only for small integers (like RSA public exponent). For large values use BigInt.
 * @param {Buffer} buf big-endian buffer (<= 6 bytes recommended)
 * @returns {number} numeric value
 */
function bufferBEToNumber(buf) {
  let n = 0;
  for (const byte of buf.values()) {
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

/**
 * Build a Microsoft PUBLICKEYBLOB from modulus and exponent.
 * Layout:
 *  BLOBHEADER (8 bytes):
 *    bType=0x06 (PUBLICKEYBLOB), bVersion=0x02, reserved=0x0000, aiKeyAlg=0x0000A400 (CALG_RSA_KEYX)
 *  RSAPUBKEY (12 bytes):
 *    magic='RSA1' (0x31415352 LE), bitlen=modBits (LE), pubexp (LE)
 *  modulus bytes (little-endian)
 * @param {Buffer} modulusBE Modulus big-endian, length = keySizeBytes
 * @param {number} exponent Public exponent (decimal)
 * @returns {Buffer} PUBLICKEYBLOB bytes
 */
function makeMsPublicKeyBlob(modulusBE, exponent) {
  const keySizeBytes = modulusBE.length;
  const header = Buffer.alloc(8);
  // BLOBHEADER
  header.writeUInt8(0x06, 0); // PUBLICKEYBLOB
  header.writeUInt8(0x02, 1); // version
  header.writeUInt16LE(0, 2); // reserved
  header.writeUInt32LE(0x0000a400, 4); // CALG_RSA_KEYX

  const rsapub = Buffer.alloc(12);
  // 'RSA1' magic LE
  rsapub.writeUInt32LE(0x31415352, 0);
  rsapub.writeUInt32LE(keySizeBytes * 8, 4); // bit length
  rsapub.writeUInt32LE(exponent >>> 0, 8); // exponent (fits in 32-bit)

  // modulus little-endian
  const modulusLE = Buffer.from(modulusBE);
  modulusLE.reverse();

  return Buffer.concat([header, rsapub, modulusLE]);
}

/**
 * Generates WOPI private/public key pair and extracts modulus/exponent using Microsoft PUBLICKEYBLOB format.
 * Uses JWK export for robust modulus/exponent retrieval across Node versions.
 * @returns {Object} WOPI configuration object
 */
function generateWopiKeys() {
  // Generate RSA private key (2048 bits)
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Extract modulus (n) and exponent (e) via JWK for compatibility
  const publicKeyObj = crypto.createPublicKey(publicKey);
  /** @type {{kty:string,n:string,e:string}} */
  const jwk = publicKeyObj.export({format: 'jwk'});
  const modulusBE = base64UrlToBuffer(jwk.n); // big-endian bytes
  const exponent = bufferBEToNumber(base64UrlToBuffer(jwk.e));

  // Create MS PUBLICKEYBLOB format (matches bash script behavior)
  const publicKeyBlob = makeMsPublicKeyBlob(modulusBE, exponent);

  // Convert modulus to base64 (same as bash script: xxd -r -p | openssl base64 -A)
  const modulus = modulusBE.toString('base64');

  // Convert keys to base64 for storage
  const publicKeyBase64 = publicKeyBlob.toString('base64');

  return {
    publicKey: publicKeyBase64,
    modulus,
    exponent,
    privateKey
  };
}

/**
 * Rotates WOPI keys - moves current keys to Old and generates new ones.
 */
router.post('/rotate-keys', validateJWT, express.json(), async (req, res) => {
  const ctx = req.ctx;
  try {
    ctx.initTenantCache();
    ctx.logger.info('WOPI key rotation start');

    const currentConfig = await getConfig(ctx);

    const newWopiConfig = generateWopiKeys();

    const publicKey = ctx.getCfg('wopi.publicKey', cfgWopiPublicKey);
    const modulus = ctx.getCfg('wopi.modulus', cfgWopiModulus);
    const privateKey = ctx.getCfg('wopi.privateKey', cfgWopiPrivateKey);
    const exponent = ctx.getCfg('wopi.exponent', cfgWopiExponent);

    const hasEmptyKeys = !(publicKey && modulus && privateKey && exponent);

    const configUpdate = {
      wopi: {
        publicKeyOld: hasEmptyKeys ? newWopiConfig.publicKey : publicKey,
        modulusOld: hasEmptyKeys ? newWopiConfig.modulus : modulus,
        exponentOld: hasEmptyKeys ? newWopiConfig.exponent : exponent,
        privateKeyOld: hasEmptyKeys ? newWopiConfig.privateKey : privateKey,
        publicKey: newWopiConfig.publicKey,
        modulus: newWopiConfig.modulus,
        exponent: newWopiConfig.exponent,
        privateKey: newWopiConfig.privateKey
      }
    };

    const newConfig = utils.deepMergeObjects(currentConfig, configUpdate);

    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      await tenantManager.setTenantConfig(ctx, newConfig);
    } else {
      await runtimeConfigManager.saveConfig(ctx, newConfig);
    }

    res.status(200).json(newConfig);
  } catch (error) {
    ctx.logger.error('WOPI key rotation error: %s', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to rotate WOPI keys',
      details: error.message
    });
  } finally {
    ctx.logger.info('WOPI key rotation end');
  }
});

// Export router and helper for reuse in tests or other modules
module.exports = router;
module.exports.generateWopiKeys = generateWopiKeys;
