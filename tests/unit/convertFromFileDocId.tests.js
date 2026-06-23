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

// Hermetic tests for the content-addressed from-file docId: the poll-roundtrip invariant that a
// no-file poll carrying the same key+params reproduces the first request's docId.

'use strict';

const {describe, test, expect} = require('@jest/globals');

const {buildConvFromFileDocId} = require('../../DocService/sources/converterservice');

// outputFormat is an opaque number in the fingerprint; only stable equality matters here.
const PDF = 0x1000;

describe('buildConvFromFileDocId (content-addressed from-file docId)', () => {
  test('key path: a no-file poll reproduces the first-request docId even when filetype was filename-derived', () => {
    const params = {key: 'mykey', outputtype: 'pdf'};
    // first request: filetype resolved from the uploaded filename (e.g. sample.xlsx)
    const basicsFirst = {filetype: 'xlsx', outputFormat: PDF, oformAsPdf: false};
    // poll: no file, no params.filetype -> empty resolved filetype
    const basicsPoll = {filetype: '', outputFormat: PDF, oformAsPdf: false};
    const idFirst = buildConvFromFileDocId(params, basicsFirst, 'deadbeefbodydigest');
    const idPoll = buildConvFromFileDocId(params, basicsPoll, undefined);
    expect(idFirst).toBe(idPoll);
    expect(idFirst.startsWith('conv_')).toBe(true);
  });

  test('key path: the docId ignores the file bytes (key is the external body hash)', () => {
    const params = {key: 'mykey', filetype: 'docx', outputtype: 'pdf'};
    const basics = {filetype: 'docx', outputFormat: PDF, oformAsPdf: false};
    const idA = buildConvFromFileDocId(params, basics, 'bodyAAA');
    const idB = buildConvFromFileDocId(params, basics, 'bodyBBB');
    expect(idA).toBe(idB);
  });

  test('key path: an explicit filetype participates in the identity', () => {
    const basics = {filetype: 'ignored', outputFormat: PDF, oformAsPdf: false};
    const idTxt = buildConvFromFileDocId({key: 'k', filetype: 'txt', outputtype: 'pdf'}, basics, undefined);
    const idCsv = buildConvFromFileDocId({key: 'k', filetype: 'csv', outputtype: 'pdf'}, basics, undefined);
    expect(idTxt).not.toBe(idCsv);
  });

  test('key path: output-affecting params change the docId', () => {
    const basics = {filetype: 'xlsx', outputFormat: PDF, oformAsPdf: false};
    const idA = buildConvFromFileDocId({key: 'k', outputtype: 'pdf', region: 'en-US'}, basics, undefined);
    const idB = buildConvFromFileDocId({key: 'k', outputtype: 'pdf', region: 'de-DE'}, basics, undefined);
    expect(idA).not.toBe(idB);
  });

  test('no-key path: the docId depends on the file bytes', () => {
    const params = {outputtype: 'pdf'};
    const basics = {filetype: 'txt', outputFormat: PDF, oformAsPdf: false};
    const idA = buildConvFromFileDocId(params, basics, 'bodyAAA');
    const idB = buildConvFromFileDocId(params, basics, 'bodyBBB');
    expect(idA).not.toBe(idB);
    expect(idA.startsWith('conv_')).toBe(true);
  });

  test('no-key path: the resolved (filename-derived) filetype participates in the identity', () => {
    const idXlsx = buildConvFromFileDocId({outputtype: 'pdf'}, {filetype: 'xlsx', outputFormat: PDF, oformAsPdf: false}, 'sameBody');
    const idCsv = buildConvFromFileDocId({outputtype: 'pdf'}, {filetype: 'csv', outputFormat: PDF, oformAsPdf: false}, 'sameBody');
    expect(idXlsx).not.toBe(idCsv);
  });

  test('key and no-key namespaces do not collide for the same params', () => {
    const basics = {filetype: 'xlsx', outputFormat: PDF, oformAsPdf: false};
    const idKey = buildConvFromFileDocId({key: 'xlsx', outputtype: 'pdf'}, basics, undefined);
    const idNoKey = buildConvFromFileDocId({outputtype: 'pdf'}, basics, 'someBody');
    expect(idKey).not.toBe(idNoKey);
  });
});
