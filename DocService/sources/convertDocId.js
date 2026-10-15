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

/*
 * Content-addressed conversion docId for the multipart endpoint.
 * docId = 'conv_' + sha256(callerKey + paramsDigest + bodyDigest): paramsDigest hashes the
 * output-affecting params fingerprint (incl. engine version), bodyDigest hashes the file bytes.
 * Fixed at 48 chars, so a long caller key can never exceed constants.DOC_ID_MAX_LENGTH.
 */

'use strict';

const crypto = require('crypto');

function buildParamsDigest(fingerprint) {
  return crypto
    .createHash('sha256')
    .update(String(fingerprint || ''), 'utf8')
    .digest('hex');
}

function buildBodyDigest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildConvDocIdFromDigests(optKey, paramsDigest, bodyDigest) {
  const hash = crypto.createHash('sha256');
  hash.update(String(optKey || ''), 'utf8');
  hash.update('\0', 'utf8');
  hash.update(String(paramsDigest || ''), 'utf8');
  hash.update('\0', 'utf8');
  hash.update(String(bodyDigest || ''), 'utf8');
  return 'conv_' + hash.digest('base64url');
}

module.exports = {buildParamsDigest, buildBodyDigest, buildConvDocIdFromDigests};
