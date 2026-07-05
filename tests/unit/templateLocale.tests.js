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
 * Unit tests for Common/sources/templateLocale.resolveTemplateLocale.
 *
 * Mirrors the real document-templates/new folder layout: every shipped locale
 * folder is a long BCP-47 tag, while requests may arrive short, region-only,
 * script-tagged, underscored, or as legacy aliases.
 */

'use strict';

const {describe, test, expect} = require('@jest/globals');
const {resolveTemplateLocale} = require('../../Common/sources/templateLocale');

const FOLDERS = [
  'ar-SA',
  'az-Latn-AZ',
  'be-BY',
  'bg-BG',
  'ca-ES',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'default',
  'el-GR',
  'en-GB',
  'en-US',
  'es-ES',
  'eu-ES',
  'fi-FI',
  'fr-FR',
  'gl-ES',
  'he-IL',
  'hr-HR',
  'hu-HU',
  'hy-AM',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'lo-LA',
  'lv-LV',
  'ms-MY',
  'nb-NO',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'si-LK',
  'sk-SK',
  'sl-SI',
  'sq-AL',
  'sr-Cyrl-RS',
  'sr-Latn-RS',
  'sv-SE',
  'tr-TR',
  'uk-UA',
  'ur-PK',
  'vi-VN',
  'zh-CN',
  'zh-TW'
];
const DEFAULT = 'en-US';

const resolve = input => resolveTemplateLocale(input, FOLDERS, DEFAULT);

describe('resolveTemplateLocale exact and short locales', () => {
  test.each([
    ['en-US', 'en-US'],
    ['en-GB', 'en-GB'],
    ['es-ES', 'es-ES'],
    ['pt-PT', 'pt-PT'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW']
  ])('exact %s -> %s', (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });

  test.each([
    ['en', 'en-US'],
    ['es', 'es-ES'],
    ['pt', 'pt-BR'],
    ['zh', 'zh-CN'],
    ['sr', 'sr-Cyrl-RS'],
    ['ca', 'ca-ES'],
    ['ru', 'ru-RU'],
    ['ar', 'ar-SA']
  ])('short %s picks CLDR-preferred region %s', (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });
});

describe('resolveTemplateLocale regional fallback to base language', () => {
  test.each([
    ['es-MX', 'es-ES'],
    ['es-419', 'es-ES'],
    ['fr-CA', 'fr-FR'],
    ['de-AT', 'de-DE'],
    ['pt-AO', 'pt-BR'],
    ['en-AU', 'en-GB'],
    ['ar-EG', 'ar-SA']
  ])('%s falls back to %s', (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });
});

describe('resolveTemplateLocale script subtags', () => {
  test.each([
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['sr-Cyrl-RS', 'sr-Cyrl-RS'],
    ['sr-Latn-RS', 'sr-Latn-RS'],
    ['sr-RS', 'sr-Cyrl-RS'],
    ['sr-Latn', 'sr-Latn-RS'],
    ['az-Latn-AZ', 'az-Latn-AZ']
  ])('%s -> %s', (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });
});

describe('resolveTemplateLocale normalization and aliases', () => {
  test.each([
    ['en_US', 'en-US'],
    ['es_MX', 'es-ES'],
    ['pt_BR', 'pt-BR'],
    ['sr_SP', 'sr-Cyrl-RS'],
    ['PT-pt', 'pt-PT'],
    ['ZH-tw', 'zh-TW'],
    ['iw', 'he-IL'],
    ['no', 'nb-NO'],
    ['nn', 'nb-NO']
  ])('%s -> %s', (input, expected) => {
    expect(resolve(input)).toBe(expected);
  });
});

describe('resolveTemplateLocale defaults', () => {
  test.each([undefined, null, '', '   ', 'xx-YY', 'garbage_!!', 'tl', 'fil', 123, {}])('unmatched/invalid input %p -> default', input => {
    expect(resolveTemplateLocale(input, FOLDERS, DEFAULT)).toBe(DEFAULT);
  });

  test('empty folder list -> default', () => {
    expect(resolveTemplateLocale('es-MX', [], DEFAULT)).toBe(DEFAULT);
  });

  test('the literal "default" folder is never auto-selected', () => {
    expect(resolveTemplateLocale('default', FOLDERS, DEFAULT)).toBe(DEFAULT);
  });
});

describe('resolveTemplateLocale candidate ordering (lang then ui)', () => {
  test('unsupported first candidate falls through to a supported second', () => {
    expect(resolveTemplateLocale(['fil', 'fr-FR'], FOLDERS, DEFAULT)).toBe('fr-FR');
    expect(resolveTemplateLocale(['xx-YY', 'de-DE'], FOLDERS, DEFAULT)).toBe('de-DE');
  });

  test('a matched first candidate wins even when it resolves to the default', () => {
    expect(resolveTemplateLocale(['en', 'fr-FR'], FOLDERS, DEFAULT)).toBe('en-US');
  });

  test('empty first candidate is skipped, not treated as a match', () => {
    expect(resolveTemplateLocale([undefined, 'es-MX'], FOLDERS, DEFAULT)).toBe('es-ES');
    expect(resolveTemplateLocale(['', 'pt'], FOLDERS, DEFAULT)).toBe('pt-BR');
  });

  test('all candidates unsupported -> default', () => {
    expect(resolveTemplateLocale(['fil', 'tl'], FOLDERS, DEFAULT)).toBe(DEFAULT);
  });
});

describe('resolveTemplateLocale is independent of folder order', () => {
  const shuffled = [...FOLDERS].reverse();
  test.each([
    ['en-AU', 'en-GB'],
    ['zh-HK', 'zh-TW'],
    ['sr-RS', 'sr-Cyrl-RS'],
    ['pt-AO', 'pt-BR']
  ])('%s -> %s regardless of readdir order', (input, expected) => {
    expect(resolveTemplateLocale(input, FOLDERS, DEFAULT)).toBe(expected);
    expect(resolveTemplateLocale(input, shuffled, DEFAULT)).toBe(expected);
  });
});
