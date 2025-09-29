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

const fs = require('fs');

/**
 * Reloads an NPM module by clearing it from require.cache and re-requiring it
 * @param {string} moduleName - Name of the module to reload
 * @returns {Object} The freshly loaded module
 */
function reloadNpmModule(moduleName) {
  try {
    const moduleId = require.resolve(moduleName);
    delete require.cache[moduleId];
    return require(moduleName);
  } catch (error) {
    console.error(`Failed to reload module ${moduleName}:`, error.message);
    throw error;
  }
}

// Backup original NODE_CONFIG to avoid growing environment
const prevNodeConfig = process.env.NODE_CONFIG;
let nodeConfigOverridden = false;

/**
 * Requires config module with runtime configuration support.
 * Temporarily sets NODE_CONFIG for reload, then restores environment to prevent E2BIG.
 * @param {Object} opt_additionalConfig - Additional configuration to merge
 * @returns {Object} config module
 */
function requireConfigWithRuntime(opt_additionalConfig) {
  let config = require('config');

  try {
    const configFilePath = config.get('runtimeConfig.filePath');
    if (configFilePath) {
      const configData = fs.readFileSync(configFilePath, 'utf8');

      // Parse existing NODE_CONFIG or start with empty object
      let curNodeConfig = JSON.parse(process.env.NODE_CONFIG ?? '{}');
      const fileConfig = JSON.parse(configData);

      // Merge configurations: NODE_CONFIG -> runtime -> additional
      curNodeConfig = config.util.extendDeep(curNodeConfig, fileConfig);
      if (opt_additionalConfig) {
        curNodeConfig = config.util.extendDeep(curNodeConfig, opt_additionalConfig);
      }

      // Temporarily set NODE_CONFIG only to reload the config module
      process.env.NODE_CONFIG = JSON.stringify(curNodeConfig);
      nodeConfigOverridden = true;

      config = reloadNpmModule('config');
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to load runtime config: %s', err.stack);
    }
  }
  return config;
}

function finalizeConfigWithRuntime() {
  // Restore original NODE_CONFIG to keep env small and avoid E2BIG on Windows/pkg
  if (nodeConfigOverridden) {
    if (typeof prevNodeConfig === 'undefined') {
      delete process.env.NODE_CONFIG;
    } else {
      process.env.NODE_CONFIG = prevNodeConfig;
    }
  }
}

module.exports = {
  reloadNpmModule,
  requireConfigWithRuntime,
  finalizeConfigWithRuntime
};
