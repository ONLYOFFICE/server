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

const fs = require('fs');
const fsPromises = require('node:fs/promises');

// Macrolanguage codes that CLDR likely-subtags will not fold to a shipped folder language.
const LANGUAGE_ALIASES = Object.freeze({
  no: 'nb',
  nn: 'nb'
});

// Replace a leading macrolanguage subtag (no/nn) with the folder language nb.
function aliasLanguage(tag) {
  const parts = String(tag).replace(/_/g, '-').split('-');
  const lang = parts[0].toLowerCase();
  if (LANGUAGE_ALIASES[lang]) {
    parts[0] = LANGUAGE_ALIASES[lang];
  }
  return parts.join('-');
}

// Parse a tag into its canonical base name plus maximized likely-subtags, or null if invalid.
function parseTag(tag) {
  if (!tag) {
    return null;
  }
  let loc;
  try {
    loc = new Intl.Locale(Intl.getCanonicalLocales(aliasLanguage(tag))[0]);
  } catch {
    return null;
  }
  let max;
  try {
    max = loc.maximize();
  } catch {
    max = loc;
  }
  return {
    baseName: loc.baseName,
    language: loc.language,
    // Maximized script/region let region-only and short tags match script-tagged folders.
    script: max.script,
    region: max.region
  };
}

// Case-insensitive equality that treats undefined as no-match.
function eq(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Build the parsed folder index once, skipping the literal "default" folder.
function buildFolderIndex(folders) {
  const index = [];
  for (const name of folders || []) {
    if (name === 'default') {
      continue;
    }
    const parsed = parseTag(name);
    if (parsed) {
      index.push({folder: name, ...parsed});
    }
  }
  // Sort by code point so ambiguous fallbacks do not depend on readdir order.
  index.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  return index;
}

// Find the best folder for a single parsed tag, or null when nothing matches.
function matchLocale(req, index) {
  // Exact tag wins outright.
  const exact = index.find(e => eq(e.baseName, req.baseName));
  if (exact) {
    return exact.folder;
  }
  // Otherwise narrow to the language and prefer the closest script/region variant.
  const sameLanguage = index.filter(e => eq(e.language, req.language));
  const match =
    // CLDR-preferred region for the language, e.g. zh -> zh-CN.
    sameLanguage.find(e => eq(e.script, req.script) && eq(e.region, req.region)) ??
    // Same script, e.g. es-MX -> es-ES, zh-Hant-TW -> zh-TW.
    sameLanguage.find(e => eq(e.script, req.script)) ??
    // Any remaining variant of the language, deterministic via the folder sort.
    sameLanguage[0];
  return match?.folder ?? null;
}

// Resolve the first matching candidate tag to an available template folder via BCP-47 fallback.
function resolveTemplateLocale(requested, folders, defaultLocale) {
  const index = buildFolderIndex(folders);
  const candidates = Array.isArray(requested) ? requested : [requested];
  for (const candidate of candidates) {
    const req = parseTag(candidate);
    if (req) {
      const match = matchLocale(req, index);
      if (match) {
        return match;
      }
    }
  }
  return defaultLocale;
}

const templateFoldersSyncCache = Object.create(null);
const templateFoldersPromiseCache = Object.create(null);

// Map readdir withFileTypes entries to immediate subdirectory names.
function toFolderNames(entries) {
  return entries.filter(item => item.isDirectory()).map(item => item.name);
}

// Cached synchronous list of template locale folders; returns [] when the root is unreadable.
function readTemplateFoldersSync(templateRoot) {
  if (!templateFoldersSyncCache[templateRoot]) {
    try {
      templateFoldersSyncCache[templateRoot] = toFolderNames(fs.readdirSync(templateRoot, {withFileTypes: true}));
    } catch {
      return [];
    }
  }
  return templateFoldersSyncCache[templateRoot];
}

// Cached asynchronous list of template locale folders; rejects when the root is unreadable.
function readTemplateFolders(templateRoot) {
  if (!templateFoldersPromiseCache[templateRoot]) {
    templateFoldersPromiseCache[templateRoot] = fsPromises
      .readdir(templateRoot, {withFileTypes: true})
      .then(toFolderNames)
      .catch(err => {
        delete templateFoldersPromiseCache[templateRoot];
        throw err;
      });
  }
  return templateFoldersPromiseCache[templateRoot];
}

module.exports = {
  resolveTemplateLocale,
  readTemplateFoldersSync,
  readTemplateFolders
};
