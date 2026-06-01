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

const {readFile} = require('fs/promises');

const CATEGORIES = [
  'pdfView',
  'pdfEdit',
  'wordView',
  'wordEdit',
  'cellView',
  'cellEdit',
  'slideView',
  'slideEdit',
  'diagramView',
  'diagramEdit',
  'forms'
];

// Formats are global to the server; cache the parsed list for the process lifetime.
let cache = null;

/**
 * Load and parse all formats from JSON file (with caching)
 * @param {Object} ctx - operation context, used to log when the file cannot be read
 * @param {string} filePath - Full path to onlyoffice-docs-formats.json
 * @returns {Promise<Object>} Map of category -> extensions array
 */
async function getAllFormats(ctx, filePath) {
  if (cache) {
    return cache;
  }

  // Initialize empty categories
  const result = Object.fromEntries(CATEGORIES.map(key => [key, []]));

  if (!filePath) {
    ctx.logger.warn('getAllFormats: documentFormatsFile not configured');
    return result;
  }

  try {
    const formats = JSON.parse(await readFile(filePath, 'utf8'));

    if (!Array.isArray(formats)) {
      ctx.logger.warn('getAllFormats: %s is not a JSON array', filePath);
      return result;
    }

    for (const {name, type, actions} of formats) {
      if (!name || !type || !Array.isArray(actions)) {
        continue;
      }

      // 'edit' = native edit, 'lossy-edit' = edit with potential format loss
      const hasEdit = actions.includes('edit') || actions.includes('lossy-edit');
      const hasView = actions.includes('view');
      const key = type + (hasEdit ? 'Edit' : hasView ? 'View' : '');

      if (result[key]) {
        result[key].push(name);
      }

      if (type === 'pdf' && actions.includes('fill')) {
        result.forms.push(name);
      }
    }
  } catch (err) {
    // Do not cache the empty result, so a later request retries once the file is available
    ctx.logger.warn('getAllFormats error: file = %s; %s', filePath, err.message);
    return result;
  }

  // Cache only a successfully parsed result
  cache = result;
  return cache;
}

module.exports = {getAllFormats};
