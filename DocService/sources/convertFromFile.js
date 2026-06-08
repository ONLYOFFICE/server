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

// Request layer for POST /converter/from-file: strict params/token contract parser + route handler.
'use strict';

const config = require('config');
const commonDefines = require('./../../Common/sources/commondefines');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const operationContext = require('./../../Common/sources/operationContext');
const docsCoServer = require('./DocsCoServer');
const converterService = require('./converterservice');

const cfgTokenEnableRequestInbox = config.get('services.CoAuthoring.token.enable.request.inbox');
const cfgTokenInboxHeader = config.get('services.CoAuthoring.token.inbox.header');
const cfgTokenInboxPrefix = config.get('services.CoAuthoring.token.inbox.prefix');

// The `params` part must be a single JSON-string object; a non-string is a scalar-field bypass.
function parseFromFileParams(value) {
  if (typeof value !== 'string') {
    throw new Error('params must be a single JSON string part');
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('params must be a JSON object');
  }
  return parsed;
}
// Strict contract: params from a `params` JSON part XOR a signed `token` - never both, never from
// unsigned scalar fields. badRequest=true on contract errors (handler maps to 400).
async function getRequestParamsFromFile(ctx, req) {
  const tenTokenEnableRequestInbox = ctx.getCfg('services.CoAuthoring.token.enable.request.inbox', cfgTokenEnableRequestInbox);
  const tenTokenInboxHeader = ctx.getCfg('services.CoAuthoring.token.inbox.header', cfgTokenInboxHeader);
  const tenTokenInboxPrefix = ctx.getCfg('services.CoAuthoring.token.inbox.prefix', cfgTokenInboxPrefix);

  const res = {code: constants.NO_ERROR, description: '', isDecoded: false, params: undefined, badRequest: false};
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const bodyToken = typeof body.token === 'string' && body.token.length > 0 ? body.token : undefined;
  const authorization = req.get(tenTokenInboxHeader);
  const hasHeaderToken = !!(authorization && authorization.startsWith(tenTokenInboxPrefix));
  const hasToken = !!bodyToken || hasHeaderToken;
  const hasParamsPart = undefined !== body.params && null !== body.params && '' !== body.params;

  // only `token`/`params` text parts are allowed; reject any other (unsigned) scalar field
  const extraFields = Object.keys(body).filter(name => 'token' !== name && 'params' !== name);
  if (extraFields.length > 0) {
    ctx.logger.warn('convert-from-file unexpected scalar fields: %j', extraFields);
    res.badRequest = true;
    return res;
  }

  // a present token must be exactly one non-empty string (duplicated/empty -> reject, never drop)
  if (undefined !== body.token && undefined === bodyToken) {
    ctx.logger.warn('convert-from-file malformed token part (not a single non-empty string)');
    res.badRequest = true;
    return res;
  }

  // a header token and a `token` part are two competing signed sources; require exactly one
  if (bodyToken && hasHeaderToken) {
    ctx.logger.warn('convert-from-file conflicting_parameter_sources: both header and body token present');
    res.badRequest = true;
    return res;
  }

  // token and params parts are mutually exclusive sources for this endpoint
  if (hasToken && hasParamsPart) {
    ctx.logger.warn('convert-from-file conflicting_parameter_sources: both token and params parts present');
    res.badRequest = true;
    return res;
  }

  let parsedParams;
  if (hasParamsPart) {
    try {
      parsedParams = parseFromFileParams(body.params);
    } catch (err) {
      ctx.logger.warn('convert-from-file invalid params JSON part: %s', err.message);
      res.badRequest = true;
      return res;
    }
  }

  if (tenTokenEnableRequestInbox || hasToken) {
    res.code = constants.VKEY;
    let checkJwtRes;
    if (bodyToken) {
      checkJwtRes = await docsCoServer.checkJwt(ctx, bodyToken, commonDefines.c_oAscSecretType.Inbox);
    } else {
      checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req);
    }
    if (checkJwtRes) {
      if (checkJwtRes.decoded) {
        res.code = constants.NO_ERROR;
        res.isDecoded = true;
        // token mode: only signed params, never mixed with unsigned parts or scalar fields
        res.params = {};
        Object.assign(res.params, checkJwtRes.decoded);
        if (!utils.isEmptyObject(checkJwtRes.decoded.payload)) {
          Object.assign(res.params, checkJwtRes.decoded.payload);
        }
        if (!utils.isEmptyObject(checkJwtRes.decoded.query)) {
          Object.assign(res.params, checkJwtRes.decoded.query);
        }
      } else if (constants.JWT_EXPIRED_CODE == checkJwtRes.code) {
        res.code = constants.VKEY_KEY_EXPIRE;
      }
      res.description = checkJwtRes.description;
    }
    return res;
  }

  // no token: effective params come solely from the params JSON part
  if (!hasParamsPart) {
    ctx.logger.warn('convert-from-file missing required params (no params part and no token)');
    res.badRequest = true;
    return res;
  }
  res.params = parsedParams;
  return res;
}
// Strict from-file route handler: resolve params via the strict contract, then delegate. Shared by
// /converter/from-file and /docbuilder/from-file (they differ only in the delegate).
function makeFromFileHandler(label, delegate) {
  return async function (req, res) {
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      await ctx.initTenantCache();
      ctx.logger.info('%s start', label);
      const authRes = await getRequestParamsFromFile(ctx, req);
      if (authRes.badRequest) {
        ctx.logger.warn('%s bad request %j', label, authRes);
        res.sendStatus(400);
        return;
      }
      if (authRes.code !== constants.NO_ERROR) {
        ctx.logger.warn('%s auth failed %j', label, authRes);
        res.sendStatus(403);
        return;
      }
      await delegate(req, res, authRes.params, authRes.isDecoded);
    } catch (err) {
      ctx.logger.error('%s error: %s', label, err.stack);
      if (!res.headersSent) {
        res.sendStatus(400);
      }
    } finally {
      ctx.logger.info('%s end', label);
    }
  };
}
const commandConvertFromBody = makeFromFileHandler('commandConvertFromBody', (req, res, params, isDecoded) =>
  converterService.convertFromCommandBody(req, res, params, isDecoded)
);
const builderFromFile = makeFromFileHandler('builderFromFile', (req, res, params, isDecoded) =>
  converterService.builder(req, res, params, isDecoded)
);

exports.getRequestParamsFromFile = getRequestParamsFromFile;
exports.commandConvertFromBody = commandConvertFromBody;
exports.builderFromFile = builderFromFile;
