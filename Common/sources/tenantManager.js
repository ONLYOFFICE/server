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
const co = require('co');
const NodeCache = require('node-cache');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const utils = require('./../../Common/sources/utils');
const {readFile, readdir, stat, writeFile} = require('fs/promises');
const path = require('path');

const cfgTenantsBaseDomain = config.get('tenants.baseDomain');
const cfgTenantsBaseDir = config.get('tenants.baseDir');
const cfgTenantsFilenameSecret = config.get('tenants.filenameSecret');
const cfgTenantsFilenameLicense = config.get('tenants.filenameLicense');
const cfgTenantsFilenameConfig = config.get('tenants.filenameConfig');
const cfgTenantsDefaultTenant = config.get('tenants.defaultTenant');
const cfgTenantsCache = config.util.cloneDeep(config.get('tenants.cache'));
// zero disables the periodic checks and leaves the cache ttl as the only refresh
const cfgTenantsLicenseRevalidateInterval =
  config.get('tenants.licenseRevalidateInterval') * 1000 > 0 ? config.get('tenants.licenseRevalidateInterval') * 1000 : Infinity;
const cfgSecretInbox = config.get('services.CoAuthoring.secret.inbox');
const cfgSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgSecretSession = config.get('services.CoAuthoring.secret.session');

let licenseInfo;
let licenseOriginal;
let licenseTuple; //to avoid array creating in getTenantLicense

const c_LM = constants.LICENSE_MODE;

const nodeCache = new NodeCache(cfgTenantsCache);
// in-flight tenant config reads by path, so a cache miss is served by one file read
const pendingTenantConfigs = new Map();
// in-flight license revalidations by path, so parallel misses share one stat-compare-read chain
const pendingTenantLicenses = new Map();

function getDefautTenant() {
  return cfgTenantsDefaultTenant;
}
function getTenant(ctx, domain) {
  let tenant = getDefautTenant();
  if (domain) {
    //remove port
    domain = domain.replace(/:.*$/, '');

    if (cfgTenantsBaseDomain && domain.endsWith('.' + cfgTenantsBaseDomain)) {
      tenant = domain.substring(0, domain.length - cfgTenantsBaseDomain.length - 1);
    } else if (cfgTenantsBaseDomain === domain) {
      tenant = getDefautTenant();
    } else {
      tenant = domain;
    }
  }
  return tenant;
}
async function getAllTenants(ctx) {
  let dirList = [];
  try {
    if (isMultitenantMode(ctx)) {
      const entitiesList = await readdir(cfgTenantsBaseDir, {withFileTypes: true});
      dirList = entitiesList.filter(direntObj => direntObj.isDirectory()).map(directory => directory.name);
    }
  } catch (error) {
    ctx.logger.error('getAllTenants error: ', error.stack);
  }
  return dirList;
}
function getTenantByConnection(ctx, conn) {
  return isMultitenantMode(ctx) ? getTenant(ctx, utils.getDomainByConnection(ctx, conn)) : getDefautTenant();
}
function getTenantByRequest(ctx, req) {
  return isMultitenantMode(ctx) ? getTenant(ctx, utils.getDomainByRequest(ctx, req)) : getDefautTenant();
}
function getTenantPathPrefix(ctx) {
  return isMultitenantMode(ctx) ? utils.removeIllegalCharacters(ctx.tenant) + '/' : '';
}
async function readTenantConfig(ctx, configPath) {
  let res = null;
  let cacheable = true;
  try {
    const cfgString = await readFile(configPath, {encoding: 'utf8'});
    res = config.util.parseString(cfgString, path.extname(configPath).substring(1));
    ctx.logger.debug('getTenantConfig from %s', configPath);
  } catch (e) {
    ctx.logger.debug('getTenantConfig error: %s', e.stack);
    // an absent file is a legitimate empty config, any other error is transient and must not blank the tenant for a whole ttl
    cacheable = 'ENOENT' === e.code;
  } finally {
    ctx.cleanTenantConfigCache(ctx.tenant);
    if (cacheable) {
      nodeCache.set(configPath, res);
    }
    pendingTenantConfigs.delete(configPath);
  }
  return res;
}
async function getTenantConfig(ctx) {
  let res = null;
  if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
    const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
    const configPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameConfig);
    res = nodeCache.get(configPath);
    // an absent config is cached as null, so only undefined means "not in cache"
    if (undefined !== res) {
      ctx.logger.debug('getTenantConfig from cache');
    } else {
      // coalesce concurrent reads so a ttl expiry on a busy tenant does not fan out into parallel file reads
      let pending = pendingTenantConfigs.get(configPath);
      if (!pending) {
        pending = readTenantConfig(ctx, configPath);
        pendingTenantConfigs.set(configPath, pending);
      }
      res = await pending;
    }
  }
  return res;
}
/**
 * Set tenant configuration for the current context
 * @param {operationContext} ctx - Operation context
 * @param {Object} config - Configuration data to save
 * @returns {Object} Saved configuration object
 */
async function setTenantConfig(ctx, config) {
  let newConfig = await getTenantConfig(ctx);
  if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
    newConfig = utils.deepMergeObjects(newConfig || {}, config);
    const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
    const configPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameConfig);
    await writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

    ctx.cleanTenantConfigCache(ctx.tenant);
    nodeCache.set(configPath, newConfig);
  }
  return newConfig;
}

/**
 * Replace tenant configuration completely (no merging)
 * @param {operationContext} ctx - Operation context
 * @param {Object} config - Configuration data to replace with
 * @returns {Object} Replaced configuration object
 */
async function replaceTenantConfig(ctx, config) {
  if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
    const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
    const configPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameConfig);
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

    ctx.cleanTenantConfigCache(ctx.tenant);
    nodeCache.set(configPath, config);
    return config;
  }
  return config;
}

// per-purpose key for the tokens Document Server both issues and verifies; it has no config element, it is computed from the session secret
async function getTenantDerivedSecret(ctx, purpose) {
  const base = await getTenantSecret(ctx, commonDefines.c_oAscSecretType.Session);
  return utils.deriveSecret(base, purpose);
}

function getTenantSecret(ctx, type) {
  return co(function* () {
    let cfgTenant;
    //check config
    const tenantConfig = yield getTenantConfig(ctx);
    if (tenantConfig) {
      switch (type) {
        case commonDefines.c_oAscSecretType.Browser:
        case commonDefines.c_oAscSecretType.Inbox:
          cfgTenant = tenantConfig?.services?.CoAuthoring?.secret?.inbox;
          break;
        case commonDefines.c_oAscSecretType.Outbox:
          cfgTenant = tenantConfig?.services?.CoAuthoring?.secret?.outbox;
          break;
        case commonDefines.c_oAscSecretType.Session:
          cfgTenant = tenantConfig?.services?.CoAuthoring?.secret?.session;
          break;
      }
    }

    if (cfgTenant) {
      return utils.getSecretByElem(cfgTenant);
    }
    let res = undefined;
    //read secret file
    if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
      const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
      const secretPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameSecret);
      res = nodeCache.get(secretPath);
      if (res) {
        ctx.logger.debug('getTenantSecret from cache');
      } else {
        try {
          const secret = yield readFile(secretPath, {encoding: 'utf8'});
          //trim whitespace plus line terminators from string (newline is common on Posix systems)
          res = secret.trim();
          if (res.length !== secret.length) {
            ctx.logger.warn('getTenantSecret secret in %s contains a leading or trailing whitespace that has been trimmed', secretPath);
          }
          ctx.logger.debug('getTenantSecret from %s', secretPath);
        } catch (e) {
          res = undefined;
          ctx.logger.warn('getTenantConfig error: %s', e.stack);
        } finally {
          nodeCache.set(secretPath, res);
        }
      }
    } else {
      switch (type) {
        case commonDefines.c_oAscSecretType.Browser:
        case commonDefines.c_oAscSecretType.Inbox:
          res = utils.getSecretByElem(cfgSecretInbox);
          break;
        case commonDefines.c_oAscSecretType.Outbox:
          res = utils.getSecretByElem(cfgSecretOutbox);
          break;
        case commonDefines.c_oAscSecretType.Session:
          res = utils.getSecretByElem(cfgSecretSession);
          break;
      }
    }
    return res;
  });
}

function setDefLicense(data, original) {
  licenseInfo = data;
  licenseOriginal = original;
  licenseTuple = [licenseInfo, licenseOriginal];
}
//todo move to license file?
function fixTenantLicense(ctx, licenseInfo, licenseInfoTenant) {
  const errors = [];
  //bitwise
  if (0 !== (licenseInfo.mode & c_LM.Limited) && 0 === (licenseInfoTenant.mode & c_LM.Limited)) {
    licenseInfoTenant.mode |= c_LM.Limited;
    errors.push('timelimited');
  }
  if (0 !== (licenseInfo.mode & c_LM.Trial) && 0 === (licenseInfoTenant.mode & c_LM.Trial)) {
    licenseInfoTenant.mode |= c_LM.Trial;
    errors.push('trial');
  }
  if (0 !== (licenseInfo.mode & c_LM.Developer) && 0 === (licenseInfoTenant.mode & c_LM.Developer)) {
    licenseInfoTenant.mode |= c_LM.Developer;
    errors.push('developer');
  }
  //can not turn on
  const flags = ['branding', 'customization'];
  flags.forEach(flag => {
    if (!licenseInfo[flag] && licenseInfoTenant[flag]) {
      licenseInfoTenant[flag] = licenseInfo[flag];
      errors.push(flag);
    }
  });
  if (!licenseInfo.advancedApi && licenseInfoTenant.advancedApi) {
    licenseInfoTenant.advancedApi = licenseInfo.advancedApi;
    errors.push('advanced_api');
  }
  //can not up limits
  // if (licenseInfo.connections < licenseInfoTenant.connections) {
  //   licenseInfoTenant.connections = licenseInfo.connections;
  //   errors.push('connections');
  // }
  // if (licenseInfo.connectionsView < licenseInfoTenant.connectionsView) {
  //   licenseInfoTenant.connectionsView = licenseInfo.connectionsView;
  //   errors.push('connections_view');
  // }
  // if (licenseInfo.usersCount < licenseInfoTenant.usersCount) {
  //   licenseInfoTenant.usersCount = licenseInfo.usersCount;
  //   errors.push('users_count');
  // }
  // if (licenseInfo.usersViewCount < licenseInfoTenant.usersViewCount) {
  //   licenseInfoTenant.usersViewCount = licenseInfo.usersViewCount;
  //   errors.push('users_view_count');
  // }
  if (licenseInfo.endDate && licenseInfoTenant.endDate && licenseInfo.endDate < licenseInfoTenant.endDate) {
    licenseInfoTenant.endDate = licenseInfo.endDate;
    errors.push('end_date');
  }
  if (errors.length > 0) {
    ctx.logger.warn('fixTenantLicense not allowed to improve these license fields: %s', errors.join(', '));
  }
}

const LICENSE_STAMP_ABSENT = {mtimeMs: -1, size: -1, ino: -1, ctimeMs: -1};
// a stable outcome is remembered, a transient one is retried instead of being cached for a whole ttl
const LICENSE_OUTCOME = {success: 1, absent: 2, transient: 3};

function isSameLicenseStamp(left, right) {
  return left.mtimeMs === right.mtimeMs && left.size === right.size && left.ino === right.ino && left.ctimeMs === right.ctimeMs;
}

async function statLicenseFile(licensePath) {
  try {
    const stats = await stat(licensePath);
    // ino and ctime catch a tmp+rename swap that keeps the same size and lands inside the mtime granularity
    return {mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, ctimeMs: stats.ctimeMs};
  } catch (e) {
    if ('ENOENT' !== e.code) {
      throw e;
    }
    // an absent file is a stable state of its own, so it is stamped and revalidated like any other
    return LICENSE_STAMP_ABSENT;
  }
}

async function readTenantLicenseEntry(ctx, licensePath, stamp) {
  let content = null;
  let outcome = LICENSE_OUTCOME.success;
  try {
    content = await readFile(licensePath, {encoding: 'utf8'});
  } catch (e) {
    // the read is done here because readLicenseTenant cannot tell an absent file from an unreadable one
    outcome = 'ENOENT' === e.code ? LICENSE_OUTCOME.absent : LICENSE_OUTCOME.transient;
    ctx.logger.warn('getTenantLicense read error: %s', e.stack);
  }
  const tuple = readLicenseTenant(ctx, content, licenseInfo);
  fixTenantLicense(ctx, licenseInfo, tuple[0]);
  if (null !== content && constants.LICENSE_RESULT.Error === tuple[0].type) {
    // content that does not parse is treated as a half written file, so it is retried instead of remembered
    outcome = LICENSE_OUTCOME.transient;
  }
  ctx.logger.debug('getTenantLicense from %s', licensePath);
  return {tuple, stamp, checkedAt: Date.now(), outcome};
}

// stat the file and re-read it only when it changed, so a replaced license is picked up without waiting for the ttl
async function revalidateTenantLicense(ctx, licensePath, cached) {
  let res = cached;
  try {
    const stamp = await statLicenseFile(licensePath);
    if (cached && isSameLicenseStamp(cached.stamp, stamp)) {
      // an unchanged file only refreshes the revalidation stamp, so the ttl keeps counting from the last real read
      cached.checkedAt = Date.now();
    } else {
      const entry = await readTenantLicenseEntry(ctx, licensePath, stamp);
      if (LICENSE_OUTCOME.transient !== entry.outcome) {
        // success and absent are both stable, so they replace whatever was cached, a deleted file included
        nodeCache.set(licensePath, entry);
        res = entry;
      } else if (cached && LICENSE_OUTCOME.success === cached.outcome) {
        // keep serving the good license and retry within the next interval instead of blanking the tenant
        ctx.logger.warn('getTenantLicense keeps the previous license after a failed read of %s', licensePath);
        cached.checkedAt = Date.now();
      } else {
        // nothing good to serve, so the failure is not cached at all and the next call reads again
        res = entry;
      }
    }
  } catch (e) {
    // a stat that fails with anything but ENOENT is transient by definition
    ctx.logger.warn('getTenantLicense revalidate error: %s', e.stack);
    if (cached) {
      if (LICENSE_OUTCOME.success === cached.outcome) {
        cached.checkedAt = Date.now();
      }
    } else {
      // read once for an answer and cache nothing, so the next call retries
      res = await readTenantLicenseEntry(ctx, licensePath, LICENSE_STAMP_ABSENT);
    }
  } finally {
    pendingTenantLicenses.delete(licensePath);
  }
  return res;
}

// a license file that exists but was not read is retried at most this often, about the file watcher poll
const LICENSE_RETRY_INTERVAL = 5000;

// read the server license only when its file stamp changed, unless forced; forced reads apply whatever they read
function createLicenseReloader(licenseFile, read, apply) {
  let loaded = null;
  let appliedSettled = false;
  let tail = Promise.resolve();
  let pending = null;
  let pendingForce = false;
  const reload = async force => {
    let stamp = null;
    try {
      stamp = await statLicenseFile(licenseFile);
    } catch {
      // an unforced call keeps the loaded license when the file cannot be stamped, a forced one still reads it
    }
    const unchanged = stamp && loaded?.stamp && isSameLicenseStamp(stamp, loaded.stamp) && Date.now() < loaded.retryAt;
    if (!force && loaded && (!stamp || unchanged)) {
      return;
    }
    // a read that throws leaves nothing remembered, so the next call reads again
    loaded = null;
    const tuple = await read();
    // hasLicense must agree with the stamp: the reader reports a failed read without it, and a file may come or go between stat and read
    const settled = (LICENSE_STAMP_ABSENT !== stamp) === !!tuple[0]?.hasLicense;
    if (force || settled || !appliedSettled) {
      apply(tuple);
      appliedSettled = settled;
    }
    loaded = {stamp, retryAt: settled ? Infinity : Date.now() + LICENSE_RETRY_INTERVAL};
  };
  return (force = false) => {
    pendingForce = pendingForce || force;
    if (!pending) {
      // calls made before a check starts share it, and each check starts only after the previous one ended
      pending = tail.then(() => {
        const runForce = pendingForce;
        pending = null;
        pendingForce = false;
        return reload(runForce);
      });
      tail = pending.catch(() => {});
    }
    return pending;
  };
}

async function getTenantLicense(ctx) {
  let res = licenseTuple;
  if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
    //todo alias is deprecated. remove one year after 8.3
    if (licenseInfo.multitenancy || licenseInfo.alias) {
      const tenantPath = utils.removeIllegalCharacters(ctx.tenant);
      const licensePath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameLicense);
      const cached = nodeCache.get(licensePath);
      let entry = cached;
      if (cached && Date.now() - cached.checkedAt < cfgTenantsLicenseRevalidateInterval) {
        ctx.logger.debug('getTenantLicense from cache');
      } else {
        // coalesce the whole stat-compare-read chain, otherwise parallel calls fan out into parallel stats
        let pending = pendingTenantLicenses.get(licensePath);
        if (!pending) {
          pending = revalidateTenantLicense(ctx, licensePath, cached);
          pendingTenantLicenses.set(licensePath, pending);
        }
        entry = await pending;
      }
      res = entry.tuple;
    } else {
      res = [...res];
      res[0] = {...res[0]};
      res.type = constants.LICENSE_RESULT.Error;
      ctx.logger.error('getTenantLicense error: missing "multitenancy" or "alias" field');
    }
  }
  return res;
}
function getServerLicense(_ctx) {
  return licenseInfo;
}
let hasBaseDir = !!cfgTenantsBaseDir;
function isMultitenantMode(_ctx) {
  return hasBaseDir;
}
function setMultitenantMode(val) {
  //for tests only!!
  return (hasBaseDir = val);
}
function isDefaultTenant(ctx) {
  return ctx.tenant === cfgTenantsDefaultTenant;
}
//todo move to license file?
function readLicenseTenant(ctx, licenseFileContent, baseVerifiedLicense) {
  const c_LR = constants.LICENSE_RESULT;
  const c_LM = constants.LICENSE_MODE;
  const res = {...baseVerifiedLicense};
  let oLicense = null;
  try {
    if (null === licenseFileContent) {
      throw new Error('license file is not readable');
    }
    res.hasLicense = true;
    oLicense = JSON.parse(licenseFileContent);
    //do not verify tenant signature. verify main lic signature.
    //delete from object to keep signature secret
    delete oLicense['signature'];
    if (oLicense['start_date']) {
      res.startDate = new Date(oLicense['start_date']);
    }
    const startDate = res.startDate;
    if (oLicense['end_date']) {
      res.endDate = new Date(oLicense['end_date']);
    } else {
      //spread copy do not copy date
      res.endDate = new Date(res.endDate);
    }

    if (oLicense['customer_id']) {
      res.customerId = oLicense['customer_id'];
    }

    if (oLicense['alias']) {
      res.alias = oLicense['alias'];
    }

    if (oLicense['multitenancy']) {
      res.multitenancy = oLicense['multitenancy'];
    }

    if (true === oLicense['timelimited']) {
      res.mode |= c_LM.Limited;
    }
    if (Object.hasOwn(oLicense, 'trial')) {
      res.mode |= true === oLicense['trial'] || 'true' === oLicense['trial'] || 'True' === oLicense['trial'] ? c_LM.Trial : c_LM.None; // Someone who likes to put json string instead of bool
    }
    if (true === oLicense['developer']) {
      res.mode |= c_LM.Developer;
    }
    if (Object.hasOwn(oLicense, 'branding')) {
      res.branding = true === oLicense['branding'] || 'true' === oLicense['branding'] || 'True' === oLicense['branding']; // Someone who likes to put json string instead of bool
    }
    if (Object.hasOwn(oLicense, 'customization')) {
      res.customization = !!oLicense['customization'];
    }
    if (Object.hasOwn(oLicense, 'advanced_api')) {
      res.advancedApi = !!oLicense['advanced_api'];
    }
    if (Object.hasOwn(oLicense, 'connections')) {
      res.connections = oLicense['connections'] >> 0;
    }
    if (Object.hasOwn(oLicense, 'connections_view')) {
      res.connectionsView = oLicense['connections_view'] >> 0;
    }
    if (Object.hasOwn(oLicense, 'users_count')) {
      res.usersCount = oLicense['users_count'] >> 0;
    }
    if (Object.hasOwn(oLicense, 'users_view_count')) {
      res.usersViewCount = oLicense['users_view_count'] >> 0;
    }
    if (Object.hasOwn(oLicense, 'users_expire')) {
      res.usersExpire = Math.max(constants.LICENSE_EXPIRE_USERS_ONE_DAY, (oLicense['users_expire'] >> 0) * constants.LICENSE_EXPIRE_USERS_ONE_DAY);
    }

    // Read grace_days setting from license file if available
    if (Object.hasOwn(oLicense, 'grace_days')) {
      res.graceDays = Math.max(0, oLicense['grace_days'] >> 0);
    }

    const timeLimited = 0 !== (res.mode & c_LM.Limited);

    const checkDate = res.mode & c_LM.Trial || timeLimited ? new Date() : licenseInfo.buildDate;
    //Calendar check of start_date allows to issue a license for old versions
    const checkStartDate = new Date();
    if (startDate <= checkStartDate && checkDate <= res.endDate) {
      res.type = c_LR.Success;
    } else if (startDate > checkStartDate) {
      res.type = c_LR.NotBefore;
      ctx.logger.warn('License: License not active before start_date:%s.', startDate.toISOString());
    } else if (timeLimited) {
      // Grace period after end license = limited mode with limited connections
      if (res.endDate.setUTCDate(res.endDate.getUTCDate() + res.graceDays) >= checkDate) {
        res.type = c_LR.SuccessLimit;
        res.connections = Math.min(res.connections, constants.LICENSE_CONNECTIONS);
        res.connectionsView = Math.min(res.connectionsView, constants.LICENSE_CONNECTIONS);
        res.usersCount = Math.min(res.usersCount, constants.LICENSE_USERS);
        res.usersViewCount = Math.min(res.usersViewCount, constants.LICENSE_USERS);
        const errStr = res.usersCount ? `${res.usersCount} unique users` : `${res.connections} concurrent connections`;
        ctx.logger.error(
          `License: License needs to be renewed.\nYour users have only ${errStr} ` +
            `available for document editing for the next ${res.graceDays} days.\nPlease renew the ` +
            'license to restore the full access'
        );
      } else {
        res.type = c_LR.ExpiredLimited;
      }
    } else if (0 !== (res.mode & c_LM.Trial)) {
      res.type = c_LR.ExpiredTrial;
    } else {
      res.type = c_LR.Expired;
    }
  } catch (e) {
    ctx.logger.warn(e);
    res.count = 1;
    res.connections = 0;
    res.connectionsView = 0;
    res.usersCount = 0;
    res.usersViewCount = 0;
    res.type = c_LR.Error;
  }
  if (res.type === c_LR.Expired || res.type === c_LR.ExpiredLimited || res.type === c_LR.ExpiredTrial) {
    res.count = 1;

    let errorMessage;
    if (res.type === c_LR.Expired) {
      errorMessage =
        'Your access to updates and support has expired.\n' +
        'Your license key can not be applied to new versions.\n' +
        'Please extend the license to get updates and support.';
    } else if (res.type === c_LR.ExpiredLimited) {
      errorMessage = 'License expired.\nYour users can not edit or view document anymore.\n' + 'Please renew the license.';
    } else {
      errorMessage = 'License Expired!!!';
    }
    ctx.logger.warn('License: ' + errorMessage);
  }

  return [res, oLicense];
}

exports.getAllTenants = getAllTenants;
exports.getDefautTenant = getDefautTenant;
exports.getTenantByConnection = getTenantByConnection;
exports.getTenantByRequest = getTenantByRequest;
exports.getTenantPathPrefix = getTenantPathPrefix;
exports.getTenantConfig = getTenantConfig;
exports.getTenantSecret = getTenantSecret;
exports.getTenantDerivedSecret = getTenantDerivedSecret;
exports.getTenantLicense = getTenantLicense;
exports.getServerLicense = getServerLicense;
exports.setDefLicense = setDefLicense;
exports.createLicenseReloader = createLicenseReloader;
exports.setTenantConfig = setTenantConfig;
exports.replaceTenantConfig = replaceTenantConfig;
exports.isMultitenantMode = isMultitenantMode;
exports.setMultitenantMode = setMultitenantMode;
exports.isDefaultTenant = isDefaultTenant;
