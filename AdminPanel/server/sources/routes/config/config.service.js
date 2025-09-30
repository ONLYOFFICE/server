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
const logger = require('../../../../../Common/sources/logger');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const supersetSchema = require('../../../../../Common/config/schemas/config.schema.json');
const {deriveSchemaForScope, X_SCOPE_KEYWORD} = require('./config.schema.utils');

// Constants
const CRON6_REGEX = /^\s*\S+(?:\s+\S+){5}\s*$/;
const AJV_CONFIG = {allErrors: true, strict: false};
const AJV_FILTER_CONFIG = {allErrors: true, strict: false, removeAdditional: true};

/**
 * Registers custom keyword and formats on an AJV instance.
 * @param {Ajv.default} instance
 */
function registerAjvExtras(instance) {
  instance.addKeyword({keyword: X_SCOPE_KEYWORD, schemaType: ['string', 'array'], errors: false});
  instance.addFormat('cron6', CRON6_REGEX);
}

/**
 * Creates and configures an AJV instance.
 * @param {Object} config - AJV configuration
 * @returns {Ajv.default}
 */
function createAjvInstance(config) {
  const instance = new Ajv(config);
  addFormats(instance);
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
 * Returns the derived per-scope schema for ctx (admin or tenant).
 * @param {operationContext} ctx
 * @returns {object}
 */
function getScopedSchema(ctx) {
  return isAdminScope(ctx) ? adminSchema : tenantSchema;
}

module.exports = {validateScoped, getScopedConfig, getScopedSchema};
