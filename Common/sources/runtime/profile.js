/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Runtime mode helper.
 *
 * isMemoryRuntime() returns true when the server runs fully in-process:
 *   - always when license.packageType === PACKAGE_TYPE_OS (community edition)
 *   - when queue.type === 'memory' OR sql.type === 'memory'
 *   - false otherwise (broker + SQL deployments)
 */

'use strict';

const config = require('config');
const constants = require('../constants');
const license = require('../license');

let cached = null;

function isMemoryRuntime() {
  if (cached !== null) return cached;

  if (license.packageType === constants.PACKAGE_TYPE_OS) {
    return (cached = true);
  }

  const queueType = config.has('queue.type') ? config.get('queue.type') : '';
  const sqlType = config.has('services.CoAuthoring.sql.type') ? config.get('services.CoAuthoring.sql.type') : '';

  return (cached = queueType === 'memory' || sqlType === 'memory');
}

function resetCache() {
  cached = null;
}

module.exports = {isMemoryRuntime, resetCache};
