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
 * Supports both fs.watch (eventType, filename) and fs.watchFile (current, previous) callbacks
 */
function handleConfigFileChange(eventTypeOrCurrent, filenameOrPrevious) {
  try {
    let shouldReload = false;
    
    if (typeof eventTypeOrCurrent === 'object' && eventTypeOrCurrent.isFile) {
      shouldReload = eventTypeOrCurrent.mtime !== filenameOrPrevious.mtime;
      operationContext.global.logger.info(`handleConfigFileChange reloaded=${shouldReload} watchFile: ${configFileName}`);
    } else {
      shouldReload = configFileName === filenameOrPrevious;
      operationContext.global.logger.info(`handleConfigFileChange reloaded=${shouldReload} watch ${eventTypeOrCurrent}: ${filenameOrPrevious}`);
    }
    if (shouldReload) {
      nodeCache.del(configFileName);
    }
  } catch (err) {
    operationContext.global.logger.error(`handleConfigFileChange error: ${err.message}`);
  }
}

/**
 * Initialize the configuration directory watcher
 */
async function initRuntimeConfigWatcher(ctx) {
  if (!configFilePath) {
    ctx.logger.info(`runtimeConfig.filePath is not specified`);
    return;
  }
  const configDir = path.dirname(configFilePath);
  await utils.watchWithFallback(ctx, configDir, configFilePath, handleConfigFileChange);
}
module.exports = {
  initRuntimeConfigWatcher,
  getConfig,
  saveConfig
};
