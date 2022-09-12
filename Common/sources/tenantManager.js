/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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
const cfgTenantsDefaultTenant = config.get('tenants.defaultTenant');
const cfgTenantsCache = config.get('tenants.cache');
const cfgSecretInbox = config.get('services.CoAuthoring.secret.inbox');
const cfgSecretOutbox = config.get('services.CoAuthoring.secret.outbox');
const cfgSecretSession = config.get('services.CoAuthoring.secret.session');

let licenseInfo;
let licenseOriginal;

const nodeCache = new NodeCache(cfgTenantsCache);

function getDefautTenant() {
  return cfgTenantsDefaultTenant;
}
function getTenant(ctx, domain) {
  let tenant = getDefautTenant();
  if (domain) {
    //remove port
    domain = domain.replace(/\:.*$/, '');
    tenant = domain;
    if (cfgTenantsBaseDomain) {
      let index = domain.indexOf('.' + cfgTenantsBaseDomain);
      if (-1 !== index) {
        tenant = domain.substring(0, index);
      }
    }
  }
  return tenant;
}
function getTenantByConnection(ctx, conn) {
  return isMultitenantMode() ? getTenant(ctx, utils.getDomainByConnection(ctx, conn.request)) : getDefautTenant();
}
function getTenantByRequest(ctx, req) {
  return isMultitenantMode() ? getTenant(ctx, utils.getDomainByRequest(ctx, req)) : getDefautTenant();
}
function getTenantPathPrefix(ctx) {
  return isMultitenantMode() ? utils.removeIllegalCharacters(ctx.tenant) + '/' : '';
}
function getTenantSecret(ctx, type) {
  return co(function*() {
    let res = undefined;
    if (isMultitenantMode()) {
      let tenantPath = utils.removeIllegalCharacters(ctx.tenant);
      let secretPath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameSecret);
      res = nodeCache.get(secretPath);
      if (res) {
        ctx.logger.debug('getTenantSecret from cache');
      } else {
        res = yield readFile(secretPath, {encoding: 'utf8'});
        nodeCache.set(secretPath, res);
        ctx.logger.debug('getTenantSecret from %s', secretPath);
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
function getTenantLicense(ctx) {
  return co(function*() {
    let res = undefined;
    if (isMultitenantMode()) {
      let tenantPath = utils.removeIllegalCharacters(ctx.tenant);
      let licensePath = path.join(cfgTenantsBaseDir, tenantPath, cfgTenantsFilenameLicense);
      res = nodeCache.get(licensePath);
      if (res) {
        ctx.logger.debug('getTenantLicense from cache');
      } else {
        [res] = yield* license.readLicense(licensePath);
        nodeCache.set(licensePath, res);
        ctx.logger.debug('getTenantLicense from %s', licensePath);
      }
      if (!res.alias) {
        res.type = constants.LICENSE_RESULT.Error;
        ctx.logger.error('getTenantLicense error: missing "alias" field');
      }
    } else {
      res = licenseInfo;
    }
    return res;
  });
}
function isMultitenantMode() {
  return !!cfgTenantsBaseDir;
}

exports.getDefautTenant = getDefautTenant;
exports.getTenantByConnection = getTenantByConnection;
exports.getTenantByRequest = getTenantByRequest;
exports.getTenantPathPrefix = getTenantPathPrefix;
exports.getTenantSecret = getTenantSecret;
exports.getTenantLicense = getTenantLicense;
exports.setDefLicense = setDefLicense;
exports.isMultitenantMode = isMultitenantMode;
