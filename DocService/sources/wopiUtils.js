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

const crypto = require('crypto');
const util = require('util');
const config = require('config');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');

// Configuration constants
const cfgMaxDownloadBytes = config.get('FileConverter.converter.maxDownloadBytes');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiPrivateKeyOld = config.get('wopi.privateKeyOld');
const cfgWopiSendAuthorizationHeader = config.get('wopi.sendAuthorizationHeader');

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
  const buffer = Buffer.alloc(4 + accessTokenBytes.length + 4 + urlBytes.length + 4 + 8);
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
  const data = generateProofBuffer(url, accessToken, timeStamp);
  const sign = await cryptoSign('RSA-SHA256', data, privateKey);
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
  const timeStamp = utils.getDateTimeTicks(new Date());
  const tenWopiPrivateKey = ctx.getCfg('wopi.privateKey', cfgWopiPrivateKey);
  const tenWopiPrivateKeyOld = ctx.getCfg('wopi.privateKeyOld', cfgWopiPrivateKeyOld);
  if (tenWopiPrivateKey && tenWopiPrivateKeyOld) {
    headers['X-WOPI-Proof'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKey);
    headers['X-WOPI-ProofOld'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKeyOld);
  }
  headers['X-WOPI-TimeStamp'] = timeStamp;
  headers['X-WOPI-ClientVersion'] = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
  headers['X-WOPI-CorrelationId'] = crypto.randomUUID();
  headers['X-WOPI-SessionId'] = ctx.userSessionId;
  //Authorization header is optional, see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/common-headers#request-headers
  if (ctx.getCfg('wopi.sendAuthorizationHeader', cfgWopiSendAuthorizationHeader)) {
    headers['Authorization'] = `Bearer ${access_token}`;
  }
}

/**
 * Builds a caller-provided digest from the SHA256 property of CheckFileInfo.
 * SHA256 is the base64 sha-256 hash of the file contents; malformed or absent values are ignored downstream.
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo/checkfileinfo-other#sha256
 *
 * @param {Object} fileInfo - Information about the file
 * @returns {{source: string, nodeAlgorithm: string, expectedBase64: string}|undefined} Expected digest or undefined
 */
function getContentsExpectedDigest(fileInfo) {
  if ('string' !== typeof fileInfo?.SHA256 || 0 === fileInfo.SHA256.length) {
    return undefined;
  }
  return {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: fileInfo.SHA256};
}

/**
 * Gets a WOPI file URL with appropriate headers
 *
 * @param {Object} ctx - The operation context
 * @param {Object} fileInfo - Information about the file
 * @param {Object} userAuth - User authentication details
 * @returns {Object} - Object containing URL, headers and an optional expectedDigest for the file contents
 */
async function getWopiFileUrl(ctx, fileInfo, userAuth) {
  const tenMaxDownloadBytes = ctx.getCfg('FileConverter.converter.maxDownloadBytes', cfgMaxDownloadBytes);
  let url;
  let expectedDigest;
  // the three sources carry credentials differently across a redirect, so the caller is told which one this is
  let kind;
  let access_token;
  const headers = {'X-WOPI-MaxExpectedSize': tenMaxDownloadBytes};
  if (fileInfo?.FileUrl) {
    //Requests to the FileUrl can not be signed using proof keys. The FileUrl is used exactly as provided by the host, so it does not necessarily include the access token, which is required to construct the expected proof.
    url = fileInfo.FileUrl;
    kind = 'fileUrl';
    // SHA256 in CheckFileInfo describes this file, which FileUrl serves the contents of
    expectedDigest = getContentsExpectedDigest(fileInfo);
  } else if (fileInfo?.TemplateSource) {
    // TemplateSource is a separate resource, so the file SHA256 is not guaranteed to describe it
    url = fileInfo.TemplateSource;
    kind = 'templateSource';
  } else if (userAuth) {
    url = `${userAuth.wopiSrc}/contents?access_token=${encodeURIComponent(userAuth.access_token)}`;
    await fillStandardHeaders(ctx, headers, url, userAuth.access_token);
    kind = 'contents';
    access_token = userAuth.access_token;
    // The /contents endpoint returns the file this CheckFileInfo SHA256 describes
    expectedDigest = getContentsExpectedDigest(fileInfo);
  }
  ctx.logger.debug('getWopiFileUrl url=%s; headers=%j; expectedDigest=%j', url, headers, expectedDigest);
  return {url, headers, expectedDigest, kind, access_token};
}

// the headers a signed request carries are bound to its url, so a hop has to drop them before it can re-sign
const URL_BOUND_HEADERS = ['Authorization', 'X-WOPI-Proof', 'X-WOPI-ProofOld', 'X-WOPI-TimeStamp'];
function withoutUrlBoundHeaders(headers) {
  const res = {};
  const dropped = new Set(URL_BOUND_HEADERS.map(name => name.toLowerCase()));
  for (const name of Object.keys(headers ?? {})) {
    if (!dropped.has(name.toLowerCase())) {
      res[name] = headers[name];
    }
  }
  return res;
}
// a WOPI destination is only ever an http(s) URL, so reject every other scheme before egress
function isHttpScheme(url) {
  try {
    const protocol = new URL(url).protocol;
    return 'http:' === protocol || 'https:' === protocol;
  } catch {
    return false;
  }
}

/**
 * Standard beforeRedirect handler that blocks all redirects for WOPI requests
 */
function blockWopiRedirect(_options, responseDetails) {
  const err = new Error(`WOPI redirect ${responseDetails.statusCode} blocked`);
  err.statusCode = responseDetails.statusCode;
  throw err;
}

module.exports = {
  getWopiFileUrl,
  withoutUrlBoundHeaders,
  getContentsExpectedDigest,
  fillStandardHeaders,
  blockWopiRedirect,
  isHttpScheme
};
