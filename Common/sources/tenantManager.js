/*
 * (c) Copyright Ascensio System SIA 2010-2023
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

const config = require('config');
const co = require('co');
const NodeCache = require( "node-cache" );
const license = require('./../../Common/sources/license');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const utils = require('./../../Common/sources/utils');
const { readFile } = require('fs/promises');
const path = require('path');

const oPackageType = config.get('license.packageType');
const cfgTenantsBaseDomain = config.get('tenants.baseDomain');
const cfgTenantsBaseDir = config.get('tenants.baseDir');
const cfgTenantsFilenameSecret = config.get('tenants.filenameSecret');
const cfgTenantsFilenameLicense = config.get('tenants.filenameLicense');
const cfgTenantsFilenameConfig = config.get('tenants.filenameConfig');
const cfgTenantsDefaultTenant = config.get('tenants.defaultTenant');
const cfgTenantsCache = config.get('tenants.cache');
const cfgSecretInbox = config.get('services.CoAuthoring.secret.inbox');
const cfgSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgSecretSession = config.get('services.CoAuthoring.secret.session');

let licenseInfo;
let licenseOriginal;

const c_LM = constants.LICENSE_MODE;

const nodeCache = new NodeCache(cfgTenantsCache);

function getDefautTenant() {
  return cfgTenantsDefaultTenant;
}
function getTenant(ctx, domain) {
  let tenant = getDefautTenant();
  if (domain) {
    //remove port
    domain = domain.replace(/\:.*$/, '');

    if (cfgTenantsBaseDomain && domain.endsWith('.' + cfgTenantsBaseDomain)) {
      tenant = domain.substring(0, domain.length - cfgTenantsBaseDomain.length - 1);
    } else if(cfgTenantsBaseDomain === domain) {
      tenant = getDefautTenant();
    } else {
      tenant = domain;
    }
  }
  return tenant;
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
async function getTenantConfig(ctx) {
  let res = null;
  if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
    let tenantPath = utils.removeIllegalCharacters(ctx.tenant);
    let configPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameConfig);
    res = nodeCache.get(configPath);
    if (res) {
      ctx.logger.debug('getTenantConfig from cache');
    } else {
      try {
        let cfgString = await readFile(configPath, {encoding: 'utf8'});
        res = config.util.parseString(cfgString, path.extname(configPath).substring(1));
        ctx.logger.debug('getTenantConfig from %s', configPath);
      } catch (e) {
        ctx.logger.debug('getTenantConfig error: %s', e.stack);
      } finally {
        nodeCache.set(configPath, res);
      }
    }
  }
  return res;
}
function getTenantSecret(ctx, type) {
  return co(function*() {
    let cfgTenant;
    //check config
    switch (type) {
      case commonDefines.c_oAscSecretType.Browser:
      case commonDefines.c_oAscSecretType.Inbox:
        cfgTenant = ctx.getCfg('services.CoAuthoring.secret.inbox', undefined);
        break;
      case commonDefines.c_oAscSecretType.Outbox:
        cfgTenant = ctx.getCfg('services.CoAuthoring.secret.outbox', undefined);
        break;
      case commonDefines.c_oAscSecretType.Session:
        cfgTenant = ctx.getCfg('services.CoAuthoring.secret.session', undefined);
        break;
    }
    if (undefined !== cfgTenant) {
      return utils.getSecretByElem(cfgTenant);
    }
    let res = undefined;
    //read secret file
    if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
      let tenantPath = utils.removeIllegalCharacters(ctx.tenant);
      let secretPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameSecret);
      res = nodeCache.get(secretPath);
      if (res) {
        ctx.logger.debug('getTenantSecret from cache');
      } else {
        try {
          let secret = yield readFile(secretPath, {encoding: 'utf8'});
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
}
//todo move to license file?
function fixTenantLicense(ctx, licenseInfo, licenseInfoTenant) {
  let errors = [];
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
  //can not turn off
  if (licenseInfo.light && !licenseInfoTenant.light) {
    licenseInfoTenant.light = licenseInfo.light;
    errors.push('light');
  }
  //can not turn on
  let flags = ['plugins', 'branding', 'customization'];
  flags.forEach((flag) => {
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
  if (licenseInfo.connections < licenseInfoTenant.connections) {
    licenseInfoTenant.connections = licenseInfo.connections;
    errors.push('connections');
  }
  if (licenseInfo.connectionsView < licenseInfoTenant.connectionsView) {
    licenseInfoTenant.connectionsView = licenseInfo.connectionsView;
    errors.push('connections_view');
  }
  if (licenseInfo.usersCount < licenseInfoTenant.usersCount) {
    licenseInfoTenant.usersCount = licenseInfo.usersCount;
    errors.push('users_count');
  }
  if (licenseInfo.usersViewCount < licenseInfoTenant.usersViewCount) {
    licenseInfoTenant.usersViewCount = licenseInfo.usersViewCount;
    errors.push('users_view_count');
  }
  if (licenseInfo.endDate && licenseInfoTenant.endDate && licenseInfo.endDate < licenseInfoTenant.endDate) {
    licenseInfoTenant.endDate = licenseInfo.endDate;
    errors.push('end_date');
  }
  if (errors.length > 0) {
    ctx.logger.warn('fixTenantLicense not allowed to improve these license fields: %s', errors.join(', '));
  }
}
function getTenantLicense(ctx) {
  return co(function*() {
    let res = licenseInfo;
    if (isMultitenantMode(ctx) && !isDefaultTenant(ctx)) {
      if (licenseInfo.alias) {
        let tenantPath = utils.removeIllegalCharacters(ctx.tenant);
        let licensePath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameLicense);
        let licenseInfoTenant = nodeCache.get(licensePath);
        if (licenseInfoTenant) {
          ctx.logger.debug('getTenantLicense from cache');
        } else {
          [licenseInfoTenant] = yield* license.readLicense(licensePath, licenseInfo);
          fixTenantLicense(ctx, licenseInfo, licenseInfoTenant);
          nodeCache.set(licensePath, licenseInfoTenant);
          ctx.logger.debug('getTenantLicense from %s', licensePath);
        }
        res = licenseInfoTenant;
      } else {
        res = {...res};
        res.type = constants.LICENSE_RESULT.Error;
        ctx.logger.error('getTenantLicense error: missing "alias" field');
      }
    }
    return res;
  });
}
function getServerLicense(ctx) {
  return licenseInfo;
}
function isMultitenantMode(ctx) {
  return !!cfgTenantsBaseDir;
}
function isDefaultTenant(ctx) {
  return ctx.tenant === cfgTenantsDefaultTenant;
}

exports.getDefautTenant = getDefautTenant;
exports.getTenantByConnection = getTenantByConnection;
exports.getTenantByRequest = getTenantByRequest;
exports.getTenantPathPrefix = getTenantPathPrefix;
exports.getTenantConfig = getTenantConfig;
exports.getTenantSecret = getTenantSecret;
exports.getTenantLicense = getTenantLicense;
exports.getServerLicense = getServerLicense;
exports.setDefLicense = setDefLicense;
exports.isMultitenantMode = isMultitenantMode;
exports.isDefaultTenant = isDefaultTenant;
