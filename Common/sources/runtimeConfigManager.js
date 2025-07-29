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
const fsWatch = require('fs');
const path = require('path');
const config = require('config');
const NodeCache = require("node-cache");
const operationContext = require('./operationContext');
const utils = require('./utils');

const cfgRuntimeConfig = config.get('runtimeConfig');
const configFilePath = cfgRuntimeConfig.filePath;
const configFileName = path.basename(configFilePath);

// Initialize cache with TTL and check for expired keys every minute
const nodeCache = new NodeCache(cfgRuntimeConfig.cache);

/**
 * Get runtime configuration for the current context
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Runtime configuration object
 */
async function getConfigFromFile(ctx) {
  if (!configFilePath) {
    return null;
  }
  try {
    const configData = await fs.readFile(configFilePath, 'utf8');
    return JSON.parse(configData);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      ctx.logger.error('getConfigFromFile error: %s', err.stack);
    }
    return null;
  }
}

/**
 * Get cached configuration for the current context
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Cached configuration object
 */
async function getConfig(ctx) {
  let config = nodeCache.get(configFileName);
  if (undefined === config) {
    config = await getConfigFromFile(ctx);
    nodeCache.set(configFileName, config);
  }
  return config;
}
/**
 * Save runtime configuration for the current context
 * @param {operationContext} ctx - Operation context
 * @param {Object} config - Configuration data to save
 * @returns {Object} Saved configuration object
 */
async function saveConfig(ctx, config) {
  if (!configFilePath) {
    throw new Error('runtimeConfig.filePath is not specified');
  }
  await fs.mkdir(path.dirname(configFilePath), { recursive: true });
  let newConfig = await getConfig(ctx);
  newConfig = utils.deepMergeObjects(newConfig || {}, config);
  await fs.writeFile(configFilePath, JSON.stringify(newConfig, null, 2), 'utf8');
  nodeCache.set(configFileName, newConfig);
  return newConfig;
}

/**
 * Handle configuration file change events
 * @param {string} eventType - Type of file system event (change, rename)
 * @param {string} filename - Name of the file that triggered the event
 */
function handleConfigFileChange(eventType, filename) {
  try {
    if (configFileName === filename) {
      nodeCache.del(configFileName);
      operationContext.global.logger.info(`handleConfigFileChange configuration ${eventType}: ${configFileName}`);
    }
  } catch (err) {
    operationContext.global.logger.error(`handleConfigFileChange error: ${err.message}`);
  }
}

/**
 * Initialize the configuration directory watcher
 */
function initRuntimeConfigWatcher(ctx) {
  if (!configFilePath) {
    ctx.logger.info(`runtimeConfig.filePath is not specified`);
    return;
  }
  try {
    const configDir = path.dirname(configFilePath);
    const watcher = fsWatch.watch(configDir, handleConfigFileChange);
    watcher.on('error', (err) => {
      ctx.logger.warn(`initRuntimeConfigWatcher error: ${err.message}`);
    });
    ctx.logger.info(`watching for runtime config changes in: ${configDir}`);
  } catch (watchErr) {
    ctx.logger.warn(`initRuntimeConfigWatcher error: ${watchErr.message}`);
  }
}
module.exports = {
  initRuntimeConfigWatcher,
  getConfig,
  saveConfig
};
