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

const path = require('path');

// In pkg builds __dirname resolves inside the virtual snapshot, which cannot
// hold native binaries.  Use the real executable location instead.
// Both DocService (docservice) and FileConverter (converter) pkg targets sit
// one level below the install root, so ../FileConverter always lands correctly.
const FC_DEFAULT_BASE = process.pkg ? path.resolve(path.dirname(process.execPath), '..', 'FileConverter') : path.resolve(__dirname, '..');

/**
 * Resolve a FileConverter path config value to an absolute path.
 *
 * - Absolute paths are returned unchanged.
 * - Falsy values or the literal string 'null' (the default.json sentinel)
 *   return an empty string.
 * - Relative paths are resolved against FC_DEFAULT_BASE (FileConverter/).
 *
 * Do NOT use this for FileConverter.converter.errorfiles: that is a storage
 * route/prefix, not a local filesystem path.
 *
 * @param {string|null|undefined} value - raw config value
 * @returns {string} absolute path, or '' if value is absent/null sentinel
 */
function resolveConverterPath(value) {
  if (!value || value === 'null') return '';
  if (path.isAbsolute(value)) return value;
  return path.resolve(FC_DEFAULT_BASE, value);
}

module.exports = {resolveConverterPath, FC_DEFAULT_BASE};
