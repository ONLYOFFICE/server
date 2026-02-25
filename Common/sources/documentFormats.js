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

let cache = null;

/**
 * Load and parse all formats from JSON file (with caching)
 * @param {string} filePath - Full path to onlyoffice-docs-formats.json
 * @returns {Promise<Object>} Map of category -> extensions array
 */
async function getAllFormats(filePath) {
  if (cache) {
    return cache;
  }

  // Initialize empty categories
  cache = Object.fromEntries(CATEGORIES.map(key => [key, []]));

  if (!filePath) {
    return cache;
  }

  try {
    const formats = JSON.parse(await readFile(filePath, 'utf8'));

    if (!Array.isArray(formats)) {
      return cache;
    }

    for (const {name, type, actions} of formats) {
      if (!name || !type || !Array.isArray(actions)) {
        continue;
      }

      // 'edit' = native edit, 'lossy-edit' = edit with potential format loss
      const hasEdit = actions.includes('edit') || actions.includes('lossy-edit');
      const hasView = actions.includes('view');
      const key = type + (hasEdit ? 'Edit' : hasView ? 'View' : '');

      if (cache[key]) {
        cache[key].push(name);
      }

      if (type === 'pdf' && actions.includes('fill')) {
        cache.forms.push(name);
      }
    }
  } catch {
    // Return empty categories on error
  }

  return cache;
}

module.exports = {getAllFormats};
