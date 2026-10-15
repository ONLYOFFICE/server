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

const fs = require('fs/promises');
const path = require('path');
const config = require('config');
const NodeCache = require('node-cache');
const operationContext = require('./operationContext');
const utils = require('./utils');
const logger = require('./logger');

const {resolveConfigPath} = require('./pathUtils');
const cfgRuntimeConfig = config.get('runtimeConfig');
const configFilePath = resolveConfigPath(cfgRuntimeConfig.filePath);
const configFileName = path.basename(configFilePath);

// Initialize cache with TTL and check for expired keys every minute
const nodeCache = new NodeCache(cfgRuntimeConfig.cache);

// Debounce timer to wait for file write completion
let reloadTimer = null;
const RELOAD_DEBOUNCE_MS = 200;

// Retry timer for reload after a transient read, so a single mid-write event does not strand the process on stale config
let reloadRetryTimer = null;
// in-flight read of the config file, so a cache miss is served by one file read no matter how many requests race for it
let pendingConfigRead = null;
const RELOAD_RETRY_MS = 500;
const RELOAD_MAX_RETRIES = 5;

// Sentinel for a transient read failure (unstable read or partial JSON); callers must keep the last good cache
const READ_TRANSIENT = Symbol('runtimeConfigReadTransient');

/**
 * Read and parse the runtime config file
 * @param {operationContext} ctx - Operation context
 * @returns {Object|null|Symbol} Parsed config, null when absent (ENOENT) or no filePath, or READ_TRANSIENT on an unstable/partial read
 */
async function getConfigFromFile(ctx) {
  if (!configFilePath) {
    return null;
  }
  try {
    const configData = await utils.readFileStable(ctx, configFilePath);
    return JSON.parse(configData);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // file genuinely absent: a legitimate empty config
      return null;
    }
    // unstable read or partial/invalid JSON during a concurrent write: keep the last good cache
    ctx.logger.error('getConfigFromFile transient error: %s', err.stack);
    return READ_TRANSIENT;
  }
}

/**
 * Get cached configuration for the current context
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Cached configuration object
 */
async function readAndCacheConfig(ctx) {
  try {
    const loaded = await getConfigFromFile(ctx);
    if (READ_TRANSIENT === loaded) {
      // do not cache a transient read failure; the next call will retry
      return null;
    }
    nodeCache.set(configFileName, loaded);
    return loaded;
  } finally {
    pendingConfigRead = null;
  }
}
async function getConfig(ctx) {
  let config = nodeCache.get(configFileName);
  if (undefined === config) {
    // every request reads this cache, so coalesce the misses a ttl expiry produces into a single file read
    if (!pendingConfigRead) {
      pendingConfigRead = readAndCacheConfig(ctx);
    }
    config = await pendingConfigRead;
  }
  return config;
}

/**
 * Apply a config object to the current process immediately: refresh caches and reconfigure the logger
 * Lets the writing process pick up changes at once instead of waiting for its own watcher poll
 * @param {operationContext} ctx - Operation context
 * @param {Object} config - Configuration data to apply
 */
function applyConfig(ctx, config) {
  nodeCache.set(configFileName, config);
  ctx.cleanRuntimeConfigCache();
  logger.configureLogger(config?.log?.options);
}

/**
 * Read the currently persisted config before a write, distinguishing an absent file from a transient failure
 * @param {operationContext} ctx - Operation context
 * @returns {Object|null} Last good or absent (null) config; throws on an unstable read so a write cannot corrupt it
 */
async function readCurrentConfig(ctx) {
  const cached = nodeCache.get(configFileName);
  if (undefined !== cached) {
    return cached;
  }
  const loaded = await getConfigFromFile(ctx);
  if (READ_TRANSIENT === loaded) {
    // a transient read must not look like "no config": refuse the write instead of merging onto {}
    throw new Error(`runtime config read is unstable, aborting write: ${configFileName}`);
  }
  nodeCache.set(configFileName, loaded);
  return loaded;
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
  await fs.mkdir(path.dirname(configFilePath), {recursive: true});
  let newConfig = await readCurrentConfig(ctx);
  newConfig = utils.deepMergeObjects(newConfig || {}, config);
  await fs.writeFile(configFilePath, JSON.stringify(newConfig, null, 2), 'utf8');
  applyConfig(ctx, newConfig);
  return newConfig;
}

/**
 * Replace runtime configuration completely (no merging)
 * @param {operationContext} ctx - Operation context
 * @param {Object} config - Configuration data to replace with
 * @returns {Object} Replaced configuration object
 */
async function replaceConfig(ctx, config) {
  if (!configFilePath) {
    throw new Error('runtimeConfig.filePath is not specified');
  }
  await fs.mkdir(path.dirname(configFilePath), {recursive: true});
  await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf8');
  applyConfig(ctx, config);
  return config;
}

/**
 * Reload config from disk into the cache, keeping the last good value on a transient/unstable read
 * @param {operationContext} ctx - Operation context
 */
async function reloadConfig(ctx, retriesLeft = RELOAD_MAX_RETRIES) {
  const loaded = await getConfigFromFile(ctx);
  if (reloadRetryTimer) {
    clearTimeout(reloadRetryTimer);
    reloadRetryTimer = null;
  }
  if (READ_TRANSIENT === loaded) {
    // write in progress or invalid JSON: keep last good config and retry, since there may be no further watcher event
    if (retriesLeft > 0) {
      ctx.logger.warn(`reloadConfig unstable read, retry scheduled (${retriesLeft} left): ${configFileName}`);
      reloadRetryTimer = setTimeout(() => {
        // reloadConfig clears reloadRetryTimer at its top, which is the authoritative reset
        reloadConfig(ctx, retriesLeft - 1).catch(err => ctx.logger.error(`reloadConfig retry error: ${err.message}`));
      }, RELOAD_RETRY_MS);
    } else {
      ctx.logger.error(`reloadConfig gave up after retries, keeping last good config: ${configFileName}`);
    }
    return;
  }
  applyConfig(ctx, loaded);
}

/**
 * Handle config file change event from fs.watch or fs.watchFile
 * Debounces multiple events to prevent excessive reloads during file write
 * @param {string|fs.Stats} eventTypeOrCurrent - Event type for fs.watch or current stats for fs.watchFile
 * @param {string|fs.Stats} filenameOrPrevious - Filename for fs.watch or previous stats for fs.watchFile
 */
function handleConfigFileChange(eventTypeOrCurrent, filenameOrPrevious) {
  try {
    let shouldReload = false;

    if (typeof eventTypeOrCurrent === 'object' && eventTypeOrCurrent.isFile) {
      // fs.watchFile callback: (current, previous); compare numeric mtime/size, not Date identity
      shouldReload = eventTypeOrCurrent.mtimeMs !== filenameOrPrevious.mtimeMs || eventTypeOrCurrent.size !== filenameOrPrevious.size;
    } else {
      // fs.watch callback: (eventType, filename)
      shouldReload = configFileName === filenameOrPrevious;
    }

    if (shouldReload) {
      // Clear timer and wait for file write to complete
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }

      reloadTimer = setTimeout(async () => {
        reloadTimer = null;
        operationContext.global.logger.info(`handleConfigFileChange reloading config: ${configFileName}`);
        try {
          await reloadConfig(operationContext.global);
        } catch (err) {
          operationContext.global.logger.error(`handleConfigFileChange reload error: ${err.message}`);
        }
      }, RELOAD_DEBOUNCE_MS);
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
  reloadConfig,
  saveConfig,
  replaceConfig
};
