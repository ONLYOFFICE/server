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

// Unit tests for the free-only storage checksum passthrough: forward Azure's native whole-blob Content-MD5, nothing else.

'use strict';

const crypto = require('crypto');
const {describe, test, expect} = require('@jest/globals');

const storageChecksum = require('../../Common/sources/storage/storageChecksum');

const PAYLOAD = Buffer.from('onlyoffice checksum passthrough payload');
const MD5_BYTES = crypto.createHash('md5').update(PAYLOAD).digest();
const MD5_B64 = MD5_BYTES.toString('base64');
const SHA256_B64 = crypto.createHash('sha256').update(PAYLOAD).digest('base64');

describe('storageChecksum.extractAzChecksum', () => {
  test('returns the md5 digest from a full-blob contentMD5', () => {
    const response = {contentMD5: new Uint8Array(MD5_BYTES)};
    expect(storageChecksum.extractAzChecksum(response)).toEqual({algorithm: 'md5', base64: MD5_B64});
  });

  test('accepts a Buffer contentMD5', () => {
    expect(storageChecksum.extractAzChecksum({contentMD5: MD5_BYTES})).toEqual({algorithm: 'md5', base64: MD5_B64});
  });

  test('skips a ranged response where contentMD5 covers only the range', () => {
    const response = {contentMD5: MD5_BYTES, contentRange: 'bytes 0-9/100'};
    expect(storageChecksum.extractAzChecksum(response)).toBeUndefined();
  });

  test('skips when a non-identity content encoding is present', () => {
    expect(storageChecksum.extractAzChecksum({contentMD5: MD5_BYTES, contentEncoding: 'gzip'})).toBeUndefined();
  });

  test('returns undefined when the blob has no stored contentMD5', () => {
    expect(storageChecksum.extractAzChecksum({contentLength: 10})).toBeUndefined();
  });

  test('returns undefined for a contentMD5 of the wrong length', () => {
    expect(storageChecksum.extractAzChecksum({contentMD5: new Uint8Array(8)})).toBeUndefined();
  });

  test('returns undefined for a missing response', () => {
    expect(storageChecksum.extractAzChecksum(undefined)).toBeUndefined();
  });
});

describe('storageChecksum.getChecksumResponseHeaders', () => {
  test('maps md5 to the Content-MD5 header', () => {
    expect(storageChecksum.getChecksumResponseHeaders({algorithm: 'md5', base64: MD5_B64})).toEqual({'Content-MD5': MD5_B64});
  });

  test('returns an empty object for a missing checksum', () => {
    expect(storageChecksum.getChecksumResponseHeaders(undefined)).toEqual({});
  });

  test('returns an empty object for a checksum without a value', () => {
    expect(storageChecksum.getChecksumResponseHeaders({algorithm: 'md5'})).toEqual({});
  });

  test('does not forward non-md5 algorithms (S3 is not supported in the free model)', () => {
    expect(storageChecksum.getChecksumResponseHeaders({algorithm: 'sha256', base64: SHA256_B64})).toEqual({});
  });
});
