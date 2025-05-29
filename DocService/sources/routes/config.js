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

const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const config = require('config');
const operationContext = require('../../../Common/sources/operationContext');
const tenantManager = require('../../../Common/sources/tenantManager');
const utils = require('../../../Common/sources/utils');
const bodyParser = require("body-parser");

const router = express.Router();
const jsonParser = bodyParser.json();

const ALLOWED_CONFIG_PATHS = [
  'FileConverter.converter.inputLimits'
];

// Load default configuration
const defaultConfig = require('../../../Common/config/default.json');

/**
 * Validate multiple property paths against allowed paths
 * @param {Array<String>} paths - Array of paths to validate
 * @returns {Boolean}
 */
const isEveryPathValid = (paths) => {
  const check = path => ALLOWED_CONFIG_PATHS.includes(path);
  return paths.every(check)
}

/**
 * Helper function to get a nested property from an object
 * @param {Object} obj - Object to extract property from
 * @param {String} path - Dot-notation path to the property
 * @returns {*} The property value or undefined
 */
const getNestedProperty = (obj, path) => 
  path.split('.').reduce((acc, part) => acc?.[part], obj);

/**
 * Helper function to set a nested property in an object
 * @param {Object} obj - Object to set property in
 * @param {String} path - Dot-notation path to the property
 * @param {*} value - Value to set
 * @returns {Object} The modified object
 */
const setNestedProperty = (obj, path, value) => {
  const [last, ...parts] = path.split('.').reverse();
  parts.reverse().reduce((acc, part) => 
    acc[part] = (typeof acc[part] === 'object' && acc[part] || {}),
    obj
  )[last] = value;
  return obj;
};

/**
 * Filter configuration to only include allowed paths
 * @param {Object} config - The configuration object
 * @returns {Object} Filtered configuration
 */
const filterAllowedConfig = (configObj) => {
  const result = {};
  
  for (const allowedPath of ALLOWED_CONFIG_PATHS) {
    const value = getNestedProperty(configObj, allowedPath);
    if (value !== undefined) {
      setNestedProperty(result, allowedPath, value);
    }
  }
  
  return result;
};

/**
 * Helper function to flatten a nested object into key-value pairs
 * where keys are dot-notation paths and values are the leaf values
 * @param {Object} obj - Object to flatten
 * @param {String} prefix - Prefix for the keys (used for recursion)
 * @returns {Object} Flattened object with path keys and values
 */
const flattenObject = (obj, prefix = '') => {
  const result = {};
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        // Recursively flatten nested objects
        Object.assign(result, flattenObject(obj[key], newKey));
      } else {
        // Add leaf values to result
        result[newKey] = obj[key];
      }
    }
  }
  
  return result;
};

/**
 * Get the configuration file path for the current context
 * @param {Object} ctx - Operation context
 * @returns {String} Path to the configuration file
 */
const getConfigPath = (ctx) => {
  if (tenantManager.isMultitenantMode(ctx)) {
    const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
    const tenantsBaseDir = config.get('tenants.baseDir');
    const filenameConfig = config.get('tenants.filenameConfig');
    return path.join(tenantsBaseDir, tenantPath, filenameConfig);
  }

  const configDir = path.resolve(__dirname, '../../../Common/config');
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv) {
    const localEnvConfigPath = path.join(configDir, `local-${nodeEnv}.json`);
    try {
      if (fsSync.existsSync(localEnvConfigPath)) {
        return localEnvConfigPath;
      }
    } catch (err) {
    }
  }

  const localConfigPath = path.join(configDir, 'local.json');
  try {
    if (fsSync.existsSync(localConfigPath)) {
      return localConfigPath;
    }
  } catch (err) {
  }

  if (nodeEnv) {
    const envConfigPath = path.join(configDir, `${nodeEnv}.json`);
    try {
      if (fsSync.existsSync(envConfigPath)) {
        return envConfigPath;
      }
    } catch (err) {
    }
  }

  throw new Error(`Configuration file not found`);
};

/**
 * Get configuration by merging default and custom settings
 * @param {Object} ctx - Operation context
 * @returns {Object} Merged configuration
 */
const getConfig = (ctx) => {
  try {
    const configPath = getConfigPath(ctx);
    const customConfig = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    // Merge default config with custom config
    return utils.deepMergeObjects({}, defaultConfig, customConfig);
  } catch (err) {
    throw new Error(`Configuration not found`);
  }
};

// Get the configuration from the context or file system
// Supports property filtering with query param props=prop1,prop2,prop3
router.get('/', async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  await ctx.initTenantCache();

  try {
    const configJson = getConfig(ctx);
    
    // Filter to only include allowed paths
    const allowedConfig = filterAllowedConfig(configJson);
    
    // Flatten the filtered config into key-value pairs
    const flattenedConfig = flattenObject(allowedConfig);
    
    // Return the flattened config
    res.json(flattenedConfig);
  } catch (err) {
    ctx.logger.error('Error getting configuration: %s', err.stack);
    res.status(500).json({ error: 'Failed to retrieve configuration' });
  }
});

router.patch('/', jsonParser, async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  ctx.logger.debug('Updating configuration: %j', req.body);
  try {
    
    // Validate that the request body is a valid object of key-value pairs
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object with property paths as keys and values to set' });
    }
    
    // Validate all paths in the request body
    const paths = Object.keys(req.body);
    if (!isEveryPathValid(paths)) {
      return res.status(400).json({
        error: 'Access denied to some configuration paths',
        invalidPaths: paths.filter(path => !isEveryPathValid([path]))
      });
    }
    
    // Get the config file path
    const configPath = getConfigPath(ctx);
    
    // Read the current configuration
    const configData = await fs.readFile(configPath, 'utf8');
    const configJson = JSON.parse(configData);
    
    // Update each property in the request body
    for (const [propPath, value] of Object.entries(req.body)) {
      setNestedProperty(configJson, propPath, value);
      
      // If this is the current context's tenant, update the context as well
      if (ctx.config) {
        setNestedProperty(ctx.config, propPath, value);
      }
    }
    
    // Write the updated configuration back to the file
    await fs.writeFile(configPath, JSON.stringify(configJson, null, '\t'), 'utf8');
    
    res.json({ 
      success: true, 
      message: 'Configuration updated successfully',
      updatedProperties: Object.keys(req.body)
    });
  } catch (err) {
    ctx.logger.error('Error updating configuration: %s', err.stack);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

module.exports = router;