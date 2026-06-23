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
const cfgTokenRequiredParams = config.get('services.CoAuthoring.server.tokenRequiredParams');
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
// Params come from `params`; token may be a part, `params.token`, or the inbox header.
// Body token wins over header; a `token` part may accompany a `params` part (3-part layout).
async function getRequestParamsFromFile(ctx, req) {
  const tenTokenEnableRequestInbox = ctx.getCfg('services.CoAuthoring.token.enable.request.inbox', cfgTokenEnableRequestInbox);
  const tenTokenRequiredParams = ctx.getCfg('services.CoAuthoring.server.tokenRequiredParams', cfgTokenRequiredParams);
  const tenTokenInboxHeader = ctx.getCfg('services.CoAuthoring.token.inbox.header', cfgTokenInboxHeader);
  const tenTokenInboxPrefix = ctx.getCfg('services.CoAuthoring.token.inbox.prefix', cfgTokenInboxPrefix);

  const res = {code: constants.NO_ERROR, description: '', isDecoded: false, params: undefined, badRequest: false};
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const partToken = typeof body.token === 'string' && body.token.length > 0 ? body.token : undefined;
  const authorization = req.get(tenTokenInboxHeader);
  const hasHeaderToken = !!(authorization && authorization.startsWith(tenTokenInboxPrefix));
  const hasParamsPart = undefined !== body.params && null !== body.params && '' !== body.params;

  // Repeated multipart fields become arrays in multer/append-field.
  for (const name of ['token', 'params']) {
    if (Array.isArray(body[name])) {
      ctx.logger.warn('convert-from-file duplicate %s field (sent more than once)', name);
      res.badRequest = true;
      return res;
    }
  }

  // No unsigned scalar fields outside `params`.
  const extraFields = Object.keys(body).filter(name => 'token' !== name && 'params' !== name);
  if (extraFields.length > 0) {
    ctx.logger.warn('convert-from-file unexpected scalar fields: %j', extraFields);
    res.badRequest = true;
    return res;
  }

  // A `token` part must be a single non-empty string.
  if (undefined !== body.token && undefined === partToken) {
    ctx.logger.warn('convert-from-file malformed token part (not a single non-empty string)');
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

  // Match classic truthiness: malformed truthy `params.token` must fail JWT verification.
  const paramsToken = parsedParams && parsedParams.token ? parsedParams.token : undefined;
  const bodyToken = partToken || paramsToken;

  const hasToken = !!bodyToken || hasHeaderToken;
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
        // Match classic tokenRequiredParams merge/discard behavior.
        res.params = !tenTokenRequiredParams && parsedParams ? parsedParams : {};
        utils.mergeJwtDecodedParams(res.params, checkJwtRes.decoded);
      } else if (constants.JWT_EXPIRED_CODE == checkJwtRes.code) {
        res.code = constants.VKEY_KEY_EXPIRE;
      }
      res.description = checkJwtRes.description;
    }
    return res;
  }

  // No token: params come from the params part only.
  if (!hasParamsPart) {
    ctx.logger.warn('convert-from-file missing required params (no params part and no token)');
    res.badRequest = true;
    return res;
  }
  res.params = parsedParams;
  return res;
}
// Shared from-file route handler: parse the strict contract, then delegate.
// Pre-delegate failures answer with the delegate's legacy JSON error body, not a bare 400/403.
function makeFromFileHandler(label, delegate, sendError, badRequestCode) {
  return async function (req, res) {
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      await ctx.initTenantCache();
      ctx.logger.info('%s start', label);
      const authRes = await getRequestParamsFromFile(ctx, req);
      if (authRes.badRequest) {
        ctx.logger.warn('%s bad request %j', label, authRes);
        sendError(req, res, badRequestCode);
        return;
      }
      if (authRes.code !== constants.NO_ERROR) {
        ctx.logger.warn('%s auth failed %j', label, authRes);
        sendError(req, res, authRes.code);
        return;
      }
      await delegate(req, res, authRes.params, authRes.isDecoded);
    } catch (err) {
      ctx.logger.error('%s error: %s', label, err.stack);
      if (!res.headersSent) {
        sendError(req, res, constants.UNKNOWN);
      }
    } finally {
      ctx.logger.info('%s end', label);
    }
  };
}
// Legacy convert JSON: {error: <oldCode>}.
const sendConvertError = (req, res, code) => utils.fillResponse(req, res, new commonDefines.ConvertStatus(code), true);
// Legacy builder JSON: {error: <oldCode>}.
const sendBuilderError = (req, res, code) => utils.fillResponseBuilder(res, undefined, undefined, false, code);
const commandConvertFromBody = makeFromFileHandler(
  'commandConvertFromBody',
  (req, res, params, isDecoded) => converterService.convertFromCommandBody(req, res, params, isDecoded),
  sendConvertError,
  constants.CONVERT_PARAMS
);
const builderFromFile = makeFromFileHandler(
  'builderFromFile',
  (req, res, params, isDecoded) => converterService.builder(req, res, params, isDecoded),
  sendBuilderError,
  constants.UNKNOWN
);

exports.getRequestParamsFromFile = getRequestParamsFromFile;
exports.commandConvertFromBody = commandConvertFromBody;
exports.builderFromFile = builderFromFile;
