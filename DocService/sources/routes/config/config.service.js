const Joi = require('joi');
const _ = require('lodash');
const validation = require('./validation');
const tenantManager = require('../../../../Common/sources/tenantManager');


const tenantSchema = {
  services: Joi.object({
      CoAuthoring: Joi.object({
          expire: Joi.object({
              filesCron: validation.cronSchema
          }).unknown(false)
      }).unknown(false)
  }).unknown(false)
};

const tenantReadableFields = [
  'services.CoAuthoring.expire.documentsCron',
]

const adminSchema = Object.assign({}, tenantSchema);
const adminReadableFields = [
  'services.CoAuthoring.expire',
];

function getReadableFields(ctx) {
  return tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)
    ? tenantReadableFields
    : adminReadableFields;
}

function getValidationSchema(ctx) {
  return tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)
    ? tenantSchema
    : adminSchema;
}

function validate(updateData, ctx) {
    const schema = getValidationSchema(ctx);
    return Joi.object(schema).validate(updateData, { abortEarly: false });
}

function getFilteredConfig(ctx) {
  const cfg = ctx.getFullCfg();
  const readableFields = getReadableFields(ctx);
  const filteredConfig = {};
  
  readableFields.forEach(field => {
    const value = _.get(cfg, field);
    if (value !== undefined) {
      _.set(filteredConfig, field, value);
    }
  });
  
  return filteredConfig;
}

module.exports = {
  validate,
  getFilteredConfig
};