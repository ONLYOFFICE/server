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
const config = require('config');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');

// Configuration constants
const cfgMaxDownloadBytes = config.get('FileConverter.converter.maxDownloadBytes');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiPrivateKeyOld = config.get('wopi.privateKeyOld');

const cryptoSign = util.promisify(crypto.sign);

/**
 * Generates a proof buffer for WOPI requests
 * 
 * @param {string} url - The URL to generate proof for
 * @param {string} accessToken - The access token
 * @param {bigint} timeStamp - The timestamp in ticks
 * @returns {Buffer} - The proof buffer
 */
function generateProofBuffer(url, accessToken, timeStamp) {
  const accessTokenBytes = Buffer.from(accessToken, 'utf8');
  const urlBytes = Buffer.from(url.toUpperCase(), 'utf8');

  let offset = 0;
  let buffer = Buffer.alloc(4 + accessTokenBytes.length + 4 + urlBytes.length + 4 + 8);
  buffer.writeUInt32BE(accessTokenBytes.length, offset);
  offset += 4;
  accessTokenBytes.copy(buffer, offset, 0, accessTokenBytes.length);
  offset += accessTokenBytes.length;
  buffer.writeUInt32BE(urlBytes.length, offset);
  offset += 4;
  urlBytes.copy(buffer, offset, 0, urlBytes.length);
  offset += urlBytes.length;
  buffer.writeUInt32BE(8, offset);
  offset += 4;
  buffer.writeBigUInt64BE(timeStamp, offset);
  return buffer;
}

/**
 * Generates a proof signature for WOPI requests
 * 
 * @param {string} url - The URL to generate proof for
 * @param {string} accessToken - The access token
 * @param {bigint} timeStamp - The timestamp in ticks
 * @param {string} privateKey - The private key for signing
 * @returns {string} - The base64-encoded signature
 */
async function generateProofSign(url, accessToken, timeStamp, privateKey) {
  let data = generateProofBuffer(url, accessToken, timeStamp);
  let sign = await cryptoSign('RSA-SHA256', data, privateKey);
  return sign.toString('base64');
}

/**
 * Fills standard WOPI headers for requests
 * 
 * @param {Object} ctx - The operation context
 * @param {Object} headers - The headers object to fill
 * @param {string} url - The URL for the request
 * @param {string} access_token - The access token
 */
async function fillStandardHeaders(ctx, headers, url, access_token) {
  let timeStamp = utils.getDateTimeTicks(new Date());
  const tenWopiPrivateKey = ctx.getCfg('wopi.privateKey', cfgWopiPrivateKey);
  const tenWopiPrivateKeyOld = ctx.getCfg('wopi.privateKeyOld', cfgWopiPrivateKeyOld);
  if (tenWopiPrivateKey && tenWopiPrivateKeyOld) {
    headers['X-WOPI-Proof'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKey);
    headers['X-WOPI-ProofOld'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKeyOld);
  }
  headers['X-WOPI-TimeStamp'] = timeStamp;
  headers['X-WOPI-ClientVersion'] = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
  // todo
  // headers['X-WOPI-CorrelationId '] = "";
  // headers['X-WOPI-SessionId'] = "";
  //remove redundant header https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/common-headers#request-headers
  // headers['Authorization'] = `Bearer ${access_token}`;
}

/**
 * Gets a WOPI file URL with appropriate headers
 * 
 * @param {Object} ctx - The operation context
 * @param {Object} fileInfo - Information about the file
 * @param {Object} userAuth - User authentication details
 * @returns {Object} - Object containing URL and headers
 */
async function getWopiFileUrl(ctx, fileInfo, userAuth) {
  const tenMaxDownloadBytes = ctx.getCfg('FileConverter.converter.maxDownloadBytes', cfgMaxDownloadBytes);
  let url;
  let headers = {'X-WOPI-MaxExpectedSize': tenMaxDownloadBytes};
  if (fileInfo?.FileUrl) {
    //Requests to the FileUrl can not be signed using proof keys. The FileUrl is used exactly as provided by the host, so it does not necessarily include the access token, which is required to construct the expected proof.
    url = fileInfo.FileUrl;
  } else if (fileInfo?.TemplateSource) {
    url = fileInfo.TemplateSource;
  } else if (userAuth) {
    url = `${userAuth.wopiSrc}/contents?access_token=${encodeURIComponent(userAuth.access_token)}`;
    await fillStandardHeaders(ctx, headers, url, userAuth.access_token);
  }
  ctx.logger.debug('getWopiFileUrl url=%s; headers=%j', url, headers);
  return {url, headers};
}

module.exports = {
  getWopiFileUrl,
  fillStandardHeaders
};
