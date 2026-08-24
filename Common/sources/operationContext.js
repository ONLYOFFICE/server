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

const utils = require('./utils');
const logger = require('./logger');
const constants = require('./constants');
const tenantManager = require('./tenantManager');
const runtimeConfigManager = require('./runtimeConfigManager');
const moduleReloader = require('./moduleReloader');

let configCache = null;
// bumped whenever the whole merged cache is dropped, so a merge built from sources read across that drop is not stored
let configCacheGeneration = 0;

function Context() {
  this.logger = logger.getLogger('nodeJS');
  this.initDefault();
}
Context.prototype.init = function (tenant, docId, userId, opt_shardKey, opt_WopiSrc, opt_userSessionId) {
  this.setTenant(tenant);
  this.setDocId(docId);
  this.setUserId(userId);
  this.setShardKey(opt_shardKey);
  this.setWopiSrc(opt_WopiSrc);
  this.setUserSessionId(opt_userSessionId);

  this.config = null;
  this.secret = null;
  this.license = null;
  //cache
  this.taskResultCache = null;
};
Context.prototype.initDefault = function () {
  this.init(tenantManager.getDefautTenant(), constants.DEFAULT_DOC_ID, constants.DEFAULT_USER_ID, undefined);
};
Context.prototype.initFromConnection = function (conn) {
  const tenant = tenantManager.getTenantByConnection(this, conn);
  let docId = conn.docid;
  if (!docId) {
    const handshake = conn.handshake;
    const docIdParsed = constants.DOC_ID_SOCKET_PATTERN.exec(handshake.url);
    if (docIdParsed && 1 < docIdParsed.length) {
      docId = docIdParsed[1];
    }
  }
  const userId = conn.user?.id;
  const shardKey = utils.getShardKeyByConnection(this, conn);
  const wopiSrc = utils.getWopiSrcByConnection(this, conn);
  const userSessionId = utils.getSessionIdByConnection(this, conn);
  this.init(tenant, docId || this.docId, userId || this.userId, shardKey, wopiSrc, userSessionId);
};
Context.prototype.initFromConnectionRequest = function (req) {
  this.initFromRequest(req);
  const docIdParsed = constants.DOC_ID_SOCKET_PATTERN.exec(req.url);
  if (docIdParsed && 1 < docIdParsed.length) {
    this.setDocId(docIdParsed[1]);
  }
};
Context.prototype.initFromRequest = function (req) {
  const tenant = tenantManager.getTenantByRequest(this, req);
  const shardKey = utils.getShardKeyByRequest(this, req);
  const wopiSrc = utils.getWopiSrcByRequest(this, req);
  const userSessionId = utils.getSessionIdByRequest(this, req);
  this.init(tenant, this.docId, this.userId, shardKey, wopiSrc, userSessionId);
};
Context.prototype.initFromTaskQueueData = function (task) {
  const ctx = task.getCtx();
  this.init(ctx.tenant, ctx.docId, ctx.userId, ctx.shardKey, ctx.wopiSrc, ctx.userSessionId);
};
Context.prototype.initFromPubSub = function (data) {
  const ctx = data.ctx;
  this.init(ctx.tenant, ctx.docId, ctx.userId, ctx.shardKey, ctx.wopiSrc, ctx.userSessionId);
};
Context.prototype.initTenantCache = async function () {
  let generation;
  let baseConfig;
  let runtimeConfig;
  let tenantConfig;
  // a runtime config reload can drop the whole cache between these reads, so repeat them until no reload interferes
  do {
    generation = configCacheGeneration;
    baseConfig = moduleReloader.getBaseConfig();
    runtimeConfig = await runtimeConfigManager.getConfig(this);
    tenantConfig = await tenantManager.getTenantConfig(this);
  } while (generation !== configCacheGeneration);
  if (!configCache) {
    configCache = Object.create(null);
  }
  const cached = configCache[this.tenant];
  // sources are cached with useClones false, so an unchanged source keeps its reference and the merge can be reused
  if (cached && cached.base === baseConfig && cached.runtime === runtimeConfig && cached.tenant === tenantConfig) {
    this.config = cached.config;
    return;
  }
  this.config = utils.deepMergeObjects({}, baseConfig, runtimeConfig, tenantConfig);

  // Merge persistentStorage with storage to support inheritance
  if (this.config.persistentStorage && this.config.storage) {
    this.config.persistentStorage = Context.normalizePersistentStorageCfg(this.config.storage, this.config.persistentStorage);
  }

  configCache[this.tenant] = {base: baseConfig, runtime: runtimeConfig, tenant: tenantConfig, config: this.config};

  //todo license and secret
};
Context.prototype.cleanRuntimeConfigCache = function () {
  configCache = null;
  configCacheGeneration++;
};
Context.prototype.cleanTenantConfigCache = function (tenant) {
  if (configCache) {
    configCache[tenant] = null;
  }
};

Context.prototype.setTenant = function (tenant) {
  this.tenant = tenant;
  this.logger.addContext('TENANT', tenant);
};
Context.prototype.setDocId = function (docId) {
  this.docId = docId;
  this.logger.addContext('DOCID', docId);
};
Context.prototype.setUserId = function (userId) {
  this.userId = userId;
  this.logger.addContext('USERID', userId);
};
Context.prototype.setShardKey = function (shardKey) {
  this.shardKey = shardKey;
};
Context.prototype.setWopiSrc = function (wopiSrc) {
  this.wopiSrc = wopiSrc;
};
Context.prototype.setUserSessionId = function (userSessionId) {
  if (userSessionId) {
    this.userSessionId = userSessionId;
    this.logger.addContext('USERSESSIONID', userSessionId);
  }
};
Context.prototype.toJSON = function () {
  return {
    tenant: this.tenant,
    docId: this.docId,
    userId: this.userId,
    userSessionId: this.userSessionId,
    shardKey: this.shardKey,
    wopiSrc: this.wopiSrc
  };
};
Context.prototype.getCfg = function (property, defaultValue) {
  if (this.config) {
    return utils.getImpl(this.config, property) ?? defaultValue;
  }
  return defaultValue;
};
/**
 * Get the full configuration by combining system config with context config
 * @returns {object} The merged configuration object
 */
Context.prototype.getFullCfg = function () {
  return utils.deepMergeObjects({}, moduleReloader.getBaseConfig(), this.config);
};

/**
 * Merges storage config with persistentStorage config
 * persistentStorage inherits all properties from storage and overrides them
 * @param {Object} storageCfg - Base storage configuration
 * @param {Object} persistentStorageCfg - Persistent storage overrides
 * @returns {Object} Merged persistent storage configuration
 */
Context.normalizePersistentStorageCfg = function (storageCfg, persistentStorageCfg) {
  return utils.deepMergeObjects({}, storageCfg, persistentStorageCfg);
};

exports.Context = Context;
exports.global = new Context();
exports.normalizePersistentStorageCfg = Context.normalizePersistentStorageCfg;
