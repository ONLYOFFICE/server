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

// Forward a checksum to the client only when the storage provider already returned it for free on a normal read.
// Nothing is hashed, buffered, validated or fetched with an extra request here; ETag is never used.
// Only Azure qualifies today: its full-blob download exposes the stored Content-MD5 at no extra cost.

// Byte length of a raw MD5 digest, used to reject values that are not a full MD5.
const MD5_BYTE_LENGTH = 16;

// A non-identity content coding means the streamed bytes are not the plain representation the digest describes.
function hasNonIdentityEncoding(contentEncoding) {
  const value = String(contentEncoding || '')
    .trim()
    .toLowerCase();
  return '' !== value && 'identity' !== value;
}

/**
 * Extract the whole-blob MD5 that Azure already returned on a full download.
 * contentMD5 is the whole-blob MD5 only on a full (non-range) read, and only when it was stored at upload time.
 *
 * @param {object} [response] - Azure BlobDownloadResponseParsed
 * @returns {{algorithm: string, base64: string}|undefined} Normalized checksum or undefined
 */
function extractAzChecksum(response) {
  if (!response || response.contentRange || hasNonIdentityEncoding(response.contentEncoding)) {
    return undefined;
  }
  const contentMD5 = response.contentMD5;
  if (!contentMD5 || contentMD5.length !== MD5_BYTE_LENGTH) {
    return undefined;
  }
  return {algorithm: 'md5', base64: Buffer.from(contentMD5).toString('base64')};
}

/**
 * Map a normalized checksum to the response headers to forward to the client.
 * Returns an empty object when there is nothing safe to forward, so callers can spread it unconditionally.
 *
 * @param {{algorithm: string, base64: string}} [checksum] - Result of extractAzChecksum
 * @returns {Object<string, string>} Header name to value map
 */
function getChecksumResponseHeaders(checksum) {
  // Only a whole-object MD5 the provider returned natively is forwarded; nothing here is computed.
  if (!checksum || 'md5' !== checksum.algorithm || !checksum.base64) {
    return {};
  }
  return {'Content-MD5': checksum.base64};
}

exports.extractAzChecksum = extractAzChecksum;
exports.getChecksumResponseHeaders = getChecksumResponseHeaders;
