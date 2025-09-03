'use strict';
const Joi = require('joi');
const validation = require('./validation');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const utils = require('../../../../../Common/sources/utils');

const tenantReadableFields = ['services.CoAuthoring.expire', 'FileConverter.converter.maxDownloadBytes'];

const adminReadableFields = ['services.CoAuthoring.expire', 'FileConverter.converter.maxDownloadBytes', 'FileConverter.converter.inputLimits'];

function createSchema(isAdmin) {
  const baseSchema = {
    services: Joi.object({
      CoAuthoring: Joi.object({
        expire: Joi.object({
          ...(isAdmin && {filesCron: validation.cronSchema}),
          ...(isAdmin && {documentsCron: validation.cronSchema}),
          ...(isAdmin && {files: Joi.number().min(0)}),
          ...(isAdmin && {filesremovedatonce: Joi.number().min(0)})
        }).unknown(false),
        autoAssembly: Joi.object({
          step: Joi.any().valid('1m', '5m', '10m', '15m', '30m')
        }).unknown(false)
      }).unknown(false)
    }).unknown(false),
    FileConverter: Joi.object({
      converter: Joi.object({
        maxDownloadBytes: Joi.number().min(0).max(104857600),
        ...(isAdmin && {
          inputLimits: Joi.array().items(
            Joi.object({
              type: Joi.string().required(),
              zip: Joi.object({
                uncompressed: Joi.string().pattern(/^\d+[KMGT]?B$/i).required(),
                template: Joi.string().optional(),
                compressed: Joi.string().pattern(/^\d+[KMGT]?B$/i).optional()
              }).unknown(false)
            }).unknown(false)
          )
        })
      }).unknown(false)
    }).unknown(false)
  };
  return baseSchema;
}

function getReadableFields(ctx) {
  return tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx) ? tenantReadableFields : adminReadableFields;
}

function getValidationSchema(ctx) {
  const isAdmin = !tenantManager.isMultitenantMode(ctx) || tenantManager.isDefaultTenant(ctx);
  return createSchema(isAdmin);
}

function validate(updateData, ctx) {
  const schema = getValidationSchema(ctx);
  return Joi.object(schema).validate(updateData, {abortEarly: false});
}

function getFilteredConfig(ctx) {
  const cfg = ctx.getFullCfg();
  const readableFields = getReadableFields(ctx);
  const filteredConfig = {};
  readableFields.forEach(field => {
    const value = utils.getImpl(cfg, field);
    if (value !== undefined) {
      set(filteredConfig, field, value);
    }
  });
  return filteredConfig;
}

function set(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return obj;
}

module.exports = {validate, getFilteredConfig};
