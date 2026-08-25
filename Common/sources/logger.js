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

const config = require('config');
const util = require('util');
const fs = require('fs');

const log4js = require('log4js');
const layouts = require('log4js/lib/layouts');
const {resolveConfigPath} = require('./pathUtils');
const moduleReloader = require('./moduleReloader');

// runtime.json is merged into the config module, so logger settings are taken from the base config the OS admin owns
const baseConfig = moduleReloader.getBaseConfig() || config.util.toObject();
const logConfigPath = resolveConfigPath(baseConfig?.log?.filePath);
const baseLogOptions = baseConfig?.log?.options;
const logOptions = config.get('log.options');
// a product allowlist kept in sync with the config schema, not a copy of the log4js level set
const RUNTIME_LOG_LEVELS = new Set(['ALL', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF']);

// https://stackoverflow.com/a/36643588
const dateToJSONWithTZ = function (d) {
  const timezoneOffsetInHours = -(d.getTimezoneOffset() / 60); //UTC minus local time
  const sign = timezoneOffsetInHours >= 0 ? '+' : '-';
  const leadingZero = Math.abs(timezoneOffsetInHours) < 10 ? '0' : '';

  //It's a bit unfortunate that we need to construct a new Date instance
  //(we don't want _d_ Date instance to be modified)
  const correctedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  correctedDate.setHours(d.getHours() + timezoneOffsetInHours);
  const iso = correctedDate.toISOString().replace('Z', '');
  return iso + sign + leadingZero + Math.abs(timezoneOffsetInHours).toString() + ':00';
};

log4js.addLayout('json', () => {
  return function (logEvent) {
    logEvent['startTime'] = dateToJSONWithTZ(logEvent['startTime']);
    logEvent['message'] = util.format(...logEvent['data']);
    delete logEvent['data'];
    return JSON.stringify(logEvent);
  };
});

/**
 * Custom pattern layout that supports %x{usid} using USERSESSIONID from context.
 * @param {object} cfg
 * @returns {function}
 */
log4js.addLayout('patternWithTokens', cfg => {
  const pattern = cfg && cfg.pattern ? cfg.pattern : '%m';
  const baseTokens = cfg && cfg.tokens ? cfg.tokens : {};
  const tokens = Object.assign({}, baseTokens, {
    usid(ev) {
      const id = ev && ev.context && ev.context.USERSESSIONID;
      return id ? ` [${id}]` : '';
    }
  });
  return layouts.patternLayout(pattern, tokens);
});

const cachedLogConfig = config.util.extendDeep(JSON.parse(fs.readFileSync(logConfigPath, 'utf8')), baseLogOptions || {});
let curLogConfig = cachedLogConfig;

/**
 * Keep only the log levels a runtime config may change, dropping everything else before it can reach log4js
 * Appender types are passed to require() by log4js, so runtime config must never define appenders or layouts
 * @param {Object} options - the "log.options" node of the runtime config
 * @returns {Object} an options object holding only accepted levels
 */
function pickRuntimeLogLevels(options) {
  const categories = options?.categories;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
    return {};
  }
  const baseCategories = cachedLogConfig.categories || {};
  const picked = {};
  for (const [name, category] of Object.entries(categories)) {
    // a category missing from the base config would reach log4js without appenders and break the whole configuration
    if (!Object.prototype.hasOwnProperty.call(baseCategories, name) || !category || typeof category !== 'object') {
      continue;
    }
    const level = category.level;
    if (typeof level === 'string' && RUNTIME_LOG_LEVELS.has(level.toUpperCase())) {
      picked[name] = {level};
    }
  }
  return Object.keys(picked).length > 0 ? {categories: picked} : {};
}

function configureLogger(options) {
  const mergedOptions = config.util.extendDeep({}, cachedLogConfig, pickRuntimeLogLevels(options));
  log4js.configure(mergedOptions);
  curLogConfig = mergedOptions;
}
configureLogger(logOptions);

const logger = log4js.getLogger('nodeJS');

if (baseLogOptions?.replaceConsole) {
  console.log = logger.info.bind(logger);
  console.info = logger.info.bind(logger);
  console.warn = logger.warn.bind(logger);
  console.error = logger.error.bind(logger);
  console.debug = logger.debug.bind(logger);
}
exports.getLogger = function () {
  return log4js.getLogger.apply(log4js, Array.prototype.slice.call(arguments));
};
exports.trace = function () {
  return logger.trace.apply(logger, Array.prototype.slice.call(arguments));
};
exports.debug = function () {
  return logger.debug.apply(logger, Array.prototype.slice.call(arguments));
};
exports.info = function () {
  return logger.info.apply(logger, Array.prototype.slice.call(arguments));
};
exports.warn = function () {
  return logger.warn.apply(logger, Array.prototype.slice.call(arguments));
};
exports.error = function () {
  return logger.error.apply(logger, Array.prototype.slice.call(arguments));
};
exports.fatal = function () {
  return logger.fatal.apply(logger, Array.prototype.slice.call(arguments));
};
exports.shutdown = function (callback) {
  return log4js.shutdown(callback);
};
exports.configureLogger = configureLogger;
exports.getLoggerConfig = function () {
  return config.util.extendDeep({}, curLogConfig);
};
exports.getInitialLoggerConfig = function () {
  return config.util.extendDeep({}, cachedLogConfig);
};
