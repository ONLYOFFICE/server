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

const fs = require('fs/promises');
const path = require('path');
const config = require('config');
const utils = require('./utils');
const tenantManager = require('./tenantManager');

const CUSTOM_CONFIG_DIR = path.resolve(__dirname, '../custom-config');
const DEFAULT_TENANT = config.get('tenants.defaultTenant');

// Initialize cache with 5 minute TTL and check for expired keys every minute
const configCache = new Map();

/**
 * Get the custom configuration file path for the current context
 * @param {Object} ctx - Operation context
 * @returns {String} Path to the custom configuration file
 */
function getCustomConfigPath(ctx) {
  const tenant = tenantManager.isMultitenantMode(ctx) ? ctx.tenant : DEFAULT_TENANT;
  const tenantPath = utils.removeIllegalCharacters(tenant);
  return path.join(CUSTOM_CONFIG_DIR, `${tenantPath}.json`);
}

/**
 * Get custom configuration for the current context
 * @param {Object} ctx - Operation context
 * @returns {Object} Custom configuration object
 */
async function getCustomConfig(ctx) {
  const configPath = getCustomConfigPath(ctx);
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    const parsedConfig = JSON.parse(configData);
    return parsedConfig;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create default configuration file if it doesn't exist
      const defaultConfig = {};
      await saveCustomConfig(ctx, defaultConfig);
      return defaultConfig;
    }
    throw err;
  }
}

/**
 * Save custom configuration for the current context
 * @param {Object} ctx - Operation context
 * @param {Object} config - Configuration data to save
 */
async function saveCustomConfig(ctx, config) {
  const configPath = getCustomConfigPath(ctx);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  // Update cache
  const tenant = tenantManager.isMultitenantMode(ctx) ? ctx.tenant : DEFAULT_TENANT;
  configCache.set(tenant, config);
  return config;
}

/**
 * Update specific configuration values for the current context
 * @param {Object} ctx - Operation context
 * @param {Object} updates - Object containing configuration updates
 */
async function updateCustomConfig(ctx, updatedConfig) {
  await saveCustomConfig(ctx, updatedConfig);
  return updatedConfig;
}

/**
 * Get cached configuration for the current context
 * @param {Object} ctx - Operation context
 * @returns {Object} Cached configuration object
 */
async function getCachedConfig(ctx) {
  const tenant = tenantManager.isMultitenantMode(ctx) ? ctx.tenant : DEFAULT_TENANT;
  
  let config = configCache.get(tenant);
  if (!config) {
    config = await getCustomConfig(ctx);
    configCache.set(tenant, config);
  }
  return config;
}

module.exports = {
  getCustomConfig,
  saveCustomConfig,
  updateCustomConfig,
  getCachedConfig
}; 