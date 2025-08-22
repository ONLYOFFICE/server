'use strict';
const Joi = require('joi');

const cronSchema = Joi.string().pattern(
  /^(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)\s+(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)\s+(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)\s+(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)\s+(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)\s+(\*|(\d+|\*\/\d+)(,(\d+|\*\/\d+))*)$/,
  'cron expression'
).message('Invalid cron expression format. Must have 6 space-separated components.');

module.exports = { cronSchema };


