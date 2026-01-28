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
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const addErrors = require('ajv-errors');
const config = require('config');
const logger = require('../../../../../Common/sources/logger');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const moduleReloader = require('../../../../../Common/sources/moduleReloader');
const utils = require('../../../../../Common/sources/utils');
const supersetSchema = require('../../../../../Common/config/schemas/config.schema.json');
const {deriveSchemaForScope, X_SCOPE_KEYWORD} = require('./config.schema.utils');

// Constants
const AJV_CONFIG = {allErrors: true, strict: false};
const AJV_FILTER_CONFIG = {allErrors: true, strict: false, removeAdditional: true};

/**
 * Registers custom keyword and formats on an AJV instance.
 * @param {Ajv.default} instance
 */
function registerAjvExtras(instance) {
  instance.addKeyword({keyword: X_SCOPE_KEYWORD, schemaType: ['string', 'array'], errors: false});
}

/**
 * Creates and configures an AJV instance.
 * @param {Object} ajvConfig - AJV configuration
 * @returns {Ajv.default}
 */
function createAjvInstance(ajvConfig) {
  const instance = new Ajv(ajvConfig);
  addFormats(instance);
  addErrors(instance);
  registerAjvExtras(instance);
  return instance;
}

const ajvValidator = createAjvInstance(AJV_CONFIG);
const ajvFilter = createAjvInstance(AJV_FILTER_CONFIG);

// Derive and compile per-scope schemas
const adminSchema = deriveSchemaForScope(supersetSchema, 'admin');
const tenantSchema = deriveSchemaForScope(supersetSchema, 'tenant');
const validateAdmin = ajvValidator.compile(adminSchema);
const validateTenant = ajvValidator.compile(tenantSchema);
const filterAdmin = ajvFilter.compile(adminSchema);
const filterTenant = ajvFilter.compile(tenantSchema);

/**
 * Recursively removes empty objects from the given object.
 * @param {*} obj - Object to clean up
 * @returns {*} Cleaned object with empty nested objects removed
 */
function removeEmptyObjects(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const cleaned = removeEmptyObjects(value);
    if (!(cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length)) {
      result[key] = cleaned;
    }
  }
  return result;
}

/**
 * Merges current runtime config with incoming config and returns only differences from base config.
 * @param {operationContext} ctx - Operation context
 * @param {Object} currentConfig - Current runtime/tenant config
 * @param {Object} incomingConfig - Incoming config data to merge
 * @returns {Object} Configuration object containing only values that differ from base config
 */
function getDiffFromBase(_ctx, currentConfig, incomingConfig) {
  const baseConfig = moduleReloader.getBaseConfig();
  const mergedConfig = utils.deepMergeObjects({}, currentConfig, incomingConfig);
  const diff = config.util.diffDeep(baseConfig, mergedConfig);
  return removeEmptyObjects(diff);
}

function isAdminScope(ctx) {
  return tenantManager.isDefaultTenant(ctx);
}

/**
 * Validates updateData against the derived per-scope schema selected by ctx.
 * @param {operationContext} ctx
 * @param {Object} updateData
 * @returns {{ value?: Object, errors?: any, errorsText?: string }}
 */
function validateScoped(ctx, updateData) {
  const validator = isAdminScope(ctx) ? validateAdmin : validateTenant;
  const valid = validator(updateData);

  return valid
    ? {value: updateData, errors: null, errorsText: null}
    : {value: null, errors: validator.errors, errorsText: ajvValidator.errorsText(validator.errors)};
}

/**
 * Filters configuration to include only fields defined in the appropriate schema
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Filtered configuration object
 */
function getScopedConfig(ctx) {
  const cfg = ctx.getFullCfg();
  const configCopy = JSON.parse(JSON.stringify(cfg));

  // Add log config. getLoggerConfig return merged config
  if (!configCopy.log) {
    configCopy.log = {};
  }
  configCopy.log.options = logger.getLoggerConfig();

  const filter = isAdminScope(ctx) ? filterAdmin : filterTenant;
  filter(configCopy);
  return configCopy;
}

/**
 * Filters base configuration to include only fields defined in the appropriate schema
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Filtered base configuration object
 */
function getScopedBaseConfig(ctx) {
  const baseConfig = utils.deepMergeObjects({}, moduleReloader.getBaseConfig());

  if (!baseConfig.log) {
    baseConfig.log = {};
  }
  baseConfig.log.options = logger.getInitialLoggerConfig();

  const filter = isAdminScope(ctx) ? filterAdmin : filterTenant;
  filter(baseConfig);
  return baseConfig;
}

const SENSITIVE_PARAM_PATHS = [
  'adminPanel.passwordHash',
  'adminPanel.secret',
  'email.smtpServerConfiguration.auth.pass',
  'externalRequest.action.proxyUser.password',
  'services.CoAuthoring.secret.browser.string',
  'services.CoAuthoring.secret.browser.file',
  'services.CoAuthoring.secret.inbox.string',
  'services.CoAuthoring.secret.inbox.file',
  'services.CoAuthoring.secret.outbox.string',
  'services.CoAuthoring.secret.outbox.file',
  'services.CoAuthoring.secret.session.string',
  'services.CoAuthoring.secret.session.file',
  'services.CoAuthoring.sql.dbPass',
  'storage.fs.secretString',
  'storage.accessKeyId',
  'storage.secretAccessKey',
  'openpgpjs.encrypt.passwords',
  'openpgpjs.decrypt.passwords',
  'aesEncrypt.secret',
  'rabbitmq.url',
  'wopi.privateKey',
  'wopi.modulus',
  'wopi.privateKeyOld',
  'wopi.publicKeyOld',
  'wopi.modulusOld',
  'wopi.exponentOld'
];

/**
 * Redacts sensitive values in configuration object by replacing them with 'REDACTED'
 * @param {Object} config - Configuration object to redact
 * @param {string[]} sensitivePaths - Array of dot-separated paths to redact
 */
function redactSensitiveParams(config, sensitivePaths) {
  if (!config || typeof config !== 'object') return config;

  const configCopy = JSON.parse(JSON.stringify(config));

  sensitivePaths.forEach(path => {
    const pathParts = path.split('.');
    let current = configCopy;

    for (let i = 0; i < pathParts.length - 1; i++) {
      if (current && typeof current === 'object' && current[pathParts[i]] !== undefined) {
        current = current[pathParts[i]];
      } else {
        return;
      }
    }
    const lastKey = pathParts[pathParts.length - 1];
    if (current && typeof current === 'object' && current[lastKey] !== undefined) {
      current[lastKey] = 'REDACTED';
    }
  });

  return configCopy;
}

/**
 * Gets full configuration without schema filtering, but with sensitive parameters redacted
 * @param {operationContext} ctx - Operation context
 * @returns {Object} Full configuration object with sensitive values redacted
 */
function getFullConfigRedacted(ctx) {
  const cfg = ctx.getFullCfg();
  return redactSensitiveParams(cfg, SENSITIVE_PARAM_PATHS);
}

module.exports = {validateScoped, getScopedBaseConfig, filterAdmin, getDiffFromBase, getFullConfigRedacted, getScopedConfig};
