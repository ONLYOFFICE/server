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

// Unit tests for the content-addressed conversion docId split-digest API.

'use strict';

const {describe, test, expect} = require('@jest/globals');

const {buildParamsDigest, buildBodyDigest, buildConvDocIdFromDigests} = require('../../DocService/sources/convertDocId');
const constants = require('../../Common/sources/constants');

const fp = JSON.stringify({outputFormat: 65, watermark: null});
const fp2 = JSON.stringify({outputFormat: 65, watermark: {text: 'x'}});
const bytes = Buffer.from('hello world');
const bytes2 = Buffer.from('hello world!');

describe('buildParamsDigest', () => {
  test('is a deterministic sha256 hex of the fingerprint', () => {
    expect(buildParamsDigest(fp)).toBe(buildParamsDigest(fp));
    expect(buildParamsDigest(fp)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes when the fingerprint changes', () => {
    expect(buildParamsDigest(fp)).not.toBe(buildParamsDigest(fp2));
  });
});

describe('buildBodyDigest', () => {
  test('is a deterministic sha256 hex of the bytes', () => {
    expect(buildBodyDigest(bytes)).toBe(buildBodyDigest(bytes));
    expect(buildBodyDigest(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes when the bytes change', () => {
    expect(buildBodyDigest(bytes)).not.toBe(buildBodyDigest(bytes2));
  });
});

describe('buildConvDocIdFromDigests', () => {
  const pd = buildParamsDigest(fp);
  const bd = buildBodyDigest(bytes);

  test('is deterministic for identical key + params digest + body digest', () => {
    expect(buildConvDocIdFromDigests('k1', pd, bd)).toBe(buildConvDocIdFromDigests('k1', pd, bd));
  });

  test('changes when the body digest changes (same key + params)', () => {
    expect(buildConvDocIdFromDigests('k1', pd, bd)).not.toBe(buildConvDocIdFromDigests('k1', pd, buildBodyDigest(bytes2)));
  });

  test('changes when the params digest changes (same key + body)', () => {
    expect(buildConvDocIdFromDigests('k1', pd, bd)).not.toBe(buildConvDocIdFromDigests('k1', buildParamsDigest(fp2), bd));
  });

  test('changes when the caller key changes (same params + body)', () => {
    expect(buildConvDocIdFromDigests('k1', pd, bd)).not.toBe(buildConvDocIdFromDigests('k2', pd, bd));
  });

  test('treats a missing key the same way every time', () => {
    expect(buildConvDocIdFromDigests(undefined, pd, bd)).toBe(buildConvDocIdFromDigests('', pd, bd));
  });

  test('produces a conv_ base64url id that fits DOC_ID_MAX_LENGTH and matches DOC_ID_REGEX', () => {
    const id = buildConvDocIdFromDigests('k1', pd, bd);
    expect(id).toMatch(/^conv_[A-Za-z0-9_-]{43}$/);
    expect(id.length).toBe(48);
    expect(id.length).toBeLessThanOrEqual(constants.DOC_ID_MAX_LENGTH);
    expect(constants.DOC_ID_REGEX.test(id)).toBe(true);
  });

  test('a very long caller key cannot overflow DOC_ID_MAX_LENGTH', () => {
    const id = buildConvDocIdFromDigests('a'.repeat(5000), pd, bd);
    expect(id.length).toBe(48);
    expect(id.length).toBeLessThanOrEqual(constants.DOC_ID_MAX_LENGTH);
  });
});
