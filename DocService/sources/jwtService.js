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

// Single JWT layer for DocService: signing, verification, the inbound purpose gate and the tokens Document Server issues to itself.
'use strict';

const jwt = require('jsonwebtoken');
const config = require('config');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const tenantManager = require('./../../Common/sources/tenantManager');

const cfgTokenInboxHeader = config.get('services.CoAuthoring.token.inbox.header');
const cfgTokenInboxPrefix = config.get('services.CoAuthoring.token.inbox.prefix');
const cfgTokenVerifyOptions = config.util.cloneDeep(config.get('services.CoAuthoring.token.verifyOptions'));
const cfgTokenPurposeCheck = config.get('services.CoAuthoring.token.purposeCheck');

// Reject browser/session token shapes on converter and command: Browser and Inbox share secret.inbox, so they verify identically. Docbuilder has a closed field set of its own instead.
function validateJwtPayloadForOperation(decoded) {
  if (!isPlainPayload(decoded)) {
    return true;
  }
  for (const layer of jwtPayloadLayers(decoded)) {
    if (hasBrowserMarker(layer)) {
      return false;
    }
  }
  // converter and command: markers already rejected above, downstream checks handle required fields
  return true;
}
// What every signed payload may carry regardless of the sink: the wrappers fillJwtByUrl builds, the claim, the RFC 7519 registered claims, and the inert `token` an integrator leaves behind when it signs the object it later attaches the token to.
const ENVELOPE_FIELDS = ['payload', 'query', 'token', constants.JWT_CLAIM_OPERATION, 'iat', 'exp', 'nbf', 'iss', 'aud', 'sub', 'jti'];
// the fields builderRequest reads; the from-file twin drops `url`, because there the script is the file part
const DOCBUILDER_FIELDS = new Set(['key', 'url', 'argument', 'async', ...ENVELOPE_FIELDS]);
// the fields commandHandle reads
const COMMAND_FIELDS = new Set(['c', 'key', 'callback', 'conv', 'meta', 'status', 'userdata', 'users', ...ENVELOPE_FIELDS]);
function withinFieldSet(decoded, fields) {
  if (!isPlainPayload(decoded)) {
    return true;
  }
  for (const layer of jwtPayloadLayers(decoded)) {
    for (const field of Object.keys(layer)) {
      if (!fields.has(field)) {
        return false;
      }
    }
  }
  return true;
}
// the from-file routes take their source from the file part, so a token naming a url was minted for the body endpoint and replaying it here would swap the file under a signed key
function hasNoSourceUrl(decoded) {
  return !isPlainPayload(decoded) || jwtPayloadLayers(decoded).every(layer => undefined === layer.url);
}
// docbuilder and command take a closed field set on top of the marker rule; a matching claim is stronger evidence than any field name, so it lifts the field set but never the marker rule and never the from-file url ban.
function guardDocbuilder(decoded, claimMatched) {
  return validateJwtPayloadForOperation(decoded) && (claimMatched || withinFieldSet(decoded, DOCBUILDER_FIELDS));
}
// the from-file source is the file part, so naming a url is an endpoint mismatch rather than a compatibility question; it belongs to validate, which no setting relaxes
function acceptFromFilePayload(decoded) {
  return acceptLegacyPartialInboxPayload(decoded) && hasNoSourceUrl(decoded);
}
function guardCommand(decoded, claimMatched) {
  return validateJwtPayloadForOperation(decoded) && (claimMatched || withinFieldSet(decoded, COMMAND_FIELDS));
}
// marker keys only browser/session/open tokens carry; legit inbox tokens never do
function hasBrowserMarker(layer) {
  return (
    (layer.document && 'object' === typeof layer.document) ||
    undefined !== layer.editorConfig ||
    undefined !== layer.version ||
    undefined !== layer.changesUrl ||
    undefined !== layer.previous ||
    undefined !== layer.images ||
    undefined !== layer.ds_tokenType ||
    undefined !== layer.ds_sessionTimeConnect ||
    undefined !== layer.fileInfo ||
    // docId marks the WOPI convert-and-edit browser token; legit inbox tokens use key
    undefined !== layer.docId
  );
}
// the layers utils.mergeJwtDecodedParams later folds into one, kept apart here because merging lets a nested null erase a marker the layer above declared
function jwtPayloadLayers(decoded) {
  return [decoded, decoded.payload, decoded.query].filter(isPlainPayload);
}
// jwt.verify hands back a string for a non-JSON payload and no consumer can read that, so anything but a plain object is not a payload
function isPlainPayload(value) {
  return !!value && 'object' === typeof value && !Array.isArray(value);
}
// only the printfile sink may accept a token carrying ds_tokenType
function rejectPrintFileToken(decoded) {
  return isPlainPayload(decoded) && jwtPayloadLayers(decoded).every(layer => undefined === layer.ds_tokenType);
}
// printFile reads document.key and ds_tokenType at the top level, so a nested copy must not satisfy the policy
function isPrintFileToken(decoded) {
  return 'printfile' === (decoded && decoded.ds_tokenType) && isNonEmptyString(decoded.document && decoded.document.key);
}
// the status handler reads both as top-level strings, so a nested or empty value must not satisfy the policy
function isWopiConvertToken(decoded) {
  return isNonEmptyString(decoded && decoded.docId) && isNonEmptyString(decoded && decoded.wopiSrc);
}
function isNonEmptyString(value) {
  return 'string' === typeof value && value.length > 0;
}
// downloadAs reads exactly these two and then acts on an unsigned docId, so an empty signed token must not authorize it
function isDownloadAsToken(decoded) {
  return isNonEmptyString(decoded && decoded.url) && isNonEmptyString(decoded && decoded.fileType);
}
// commandImgurls branches on truthy images and only then maps it, so the rule must branch the same way or a truthy non-array would reach .map()
function isImgUrlsToken(decoded) {
  if (!decoded || 'object' !== typeof decoded) {
    return false;
  }
  if (decoded.images) {
    return Array.isArray(decoded.images) && decoded.images.length > 0 && decoded.images.every(image => isNonEmptyString(image && image.url));
  }
  return isNonEmptyString(decoded.url);
}
// saveRelativeFromChanges takes the document key from the token and nothing else
function isSaveRelativeToken(decoded) {
  return isNonEmptyString(decoded && decoded.key);
}
// These two sinks accept a partially signed token by design: with tokenRequiredParams:false the integrator may sign a subset and pass the rest unsigned, and the open token additionally covers the WOPI, version-history and reconnect shapes. They insist on a payload the merge can read and nothing more, so every token they take is purpose-unbound.
function acceptLegacyPartialOpen(decoded) {
  return isPlainPayload(decoded);
}
function acceptLegacyPartialDownload(decoded) {
  return isPlainPayload(decoded);
}
// the inbox operations state their required fields downstream - converterservice, builderRequest and commandFromServer each refuse an incomplete request there - so the gate only insists on a payload the merge can read at all
function acceptLegacyPartialInboxPayload(decoded) {
  return isPlainPayload(decoded);
}
// fillJwtByConnection is the only producer of a session token, and ds_sessionTimeConnect is what separates it from an integrator open config of the same shape: the connection stamps it before any message is handled, so the field is always there. The auth handler already discriminates on exactly this field, so the gate is only agreeing with the consumer.
function isEditorSessionToken(decoded) {
  if (!isPlainPayload(decoded) || !isPlainPayload(decoded.editorConfig) || !isPlainPayload(decoded.editorConfig.user)) {
    return false;
  }
  const connectedAt = decoded.editorConfig.ds_sessionTimeConnect;
  if (!Number.isFinite(connectedAt) || connectedAt <= 0) {
    return false;
  }
  return isNonEmptyString(decoded.document && decoded.document.key) && rejectPrintFileToken(decoded);
}
// One registry for every token sink: the key, the payload rule and the operation the token must claim; an unlisted purpose fails closed.
const SECRET = commonDefines.c_oAscSecretType;
// the secret types with a configured element of their own; Browser is deliberately absent, because getTenantSecret resolves it to secret.inbox and naming it would state a separation that does not exist.
const CONFIGURED_SECRET_TYPES = new Set([SECRET.Inbox, SECRET.Outbox, SECRET.Session]);
// validate is the structural rule of the consumer and is always applied; legacyGuard is the compatibility heuristic that token.purposeCheck can switch off.
const TOKEN_POLICIES = Object.assign(Object.create(null), {
  // inbox operations that must never accept a browser/session token shape
  [constants.JWT_PURPOSE_CONVERTER]: {
    secretType: SECRET.Inbox,
    validate: acceptLegacyPartialInboxPayload,
    legacyGuard: validateJwtPayloadForOperation,
    operation: constants.JWT_PURPOSE_CONVERTER
  },
  [constants.JWT_PURPOSE_DOCBUILDER]: {
    secretType: SECRET.Inbox,
    validate: acceptLegacyPartialInboxPayload,
    legacyGuard: guardDocbuilder,
    operation: constants.JWT_PURPOSE_DOCBUILDER
  },
  // the from-file routes serve the same two operations, so they expect the same claim value and merely insist on it
  [constants.JWT_PURPOSE_CONVERTER_FROM_FILE]: {
    secretType: SECRET.Inbox,
    validate: acceptFromFilePayload,
    legacyGuard: validateJwtPayloadForOperation,
    operation: constants.JWT_PURPOSE_CONVERTER,
    operationRequired: true
  },
  [constants.JWT_PURPOSE_DOCBUILDER_FROM_FILE]: {
    secretType: SECRET.Inbox,
    validate: acceptFromFilePayload,
    legacyGuard: guardDocbuilder,
    operation: constants.JWT_PURPOSE_DOCBUILDER,
    operationRequired: true
  },
  [constants.JWT_PURPOSE_COMMAND]: {
    secretType: SECRET.Inbox,
    validate: acceptLegacyPartialInboxPayload,
    legacyGuard: guardCommand,
    operation: constants.JWT_PURPOSE_COMMAND
  },
  // download consumes the same token the editor gets at open, so it can demand neither an operation of its own nor a single shape
  [constants.JWT_PURPOSE_DOWNLOAD]: {secretType: SECRET.Inbox, validate: acceptLegacyPartialDownload},
  // the browser-carried family names Inbox because one token has to verify across the boundary: wopiEditor signs the editor params here and /downloadfile verifies that same token under the download policy
  [constants.JWT_PURPOSE_BROWSER_OPEN]: {secretType: SECRET.Inbox, validate: acceptLegacyPartialOpen},
  // these three sinks read a fixed, small set of fields, so the token can be required to carry them
  [constants.JWT_PURPOSE_BROWSER_IMGURLS]: {secretType: SECRET.Inbox, validate: isImgUrlsToken},
  [constants.JWT_PURPOSE_BROWSER_DOWNLOADAS]: {secretType: SECRET.Inbox, validate: isDownloadAsToken},
  [constants.JWT_PURPOSE_BROWSER_SAVE_RELATIVE]: {secretType: SECRET.Inbox, validate: isSaveRelativeToken},
  // fillJwtByConnection issues one token per open document, so every session sink shares this policy, and the key is derived so the family stays separate from inbox even where both read one secret file
  [constants.JWT_PURPOSE_EDITOR_SESSION]: {derived: true, validate: isEditorSessionToken},
  // tokens Document Server issues to itself: the key is derived from the purpose, so they carry no secretType
  [constants.JWT_PURPOSE_PRINT_FILE]: {derived: true, validate: isPrintFileToken},
  [constants.JWT_PURPOSE_WOPI_CONVERT]: {derived: true, validate: isWopiConvertToken}
});
// the wire vocabulary is a closed set: every other purpose is an internal label and must never appear inside a token
const WIRE_OPERATIONS = new Set([constants.JWT_PURPOSE_CONVERTER, constants.JWT_PURPOSE_DOCBUILDER, constants.JWT_PURPOSE_COMMAND]);
// the values reserved for our own outgoing tokens, refused at every sink so an outgoing token cannot be replayed here
const OUTBOUND_OPERATIONS = new Set(constants.JWT_OUTBOUND_OPERATIONS);
// the complete set of fields a policy may declare; an unlisted one is a typo, and a typo like operationRequried would silently drop a requirement
const POLICY_FIELDS = new Set(['secretType', 'derived', 'validate', 'legacyGuard', 'operation', 'operationRequired']);
// Every way a policy can be wrong is a code defect that silently widens a sink, so the registry is checked once at load and the process refuses to start rather than fail at the first request.
for (const [purpose, policy] of Object.entries(TOKEN_POLICIES)) {
  for (const field of Object.keys(policy)) {
    if (!POLICY_FIELDS.has(field)) {
      throw new Error(`token policy ${purpose} declares an unknown field ${field}`);
    }
  }
  if ('function' !== typeof policy.validate) {
    throw new Error(`token policy ${purpose} declares no payload rule`);
  }
  // every field is checked by exact type, because a truthy near-miss (derived: 'yes', legacyGuard: true) would pass a loose check and then widen the sink or throw on a live request
  const isDerived = undefined === policy.derived ? false : policy.derived;
  if (true !== isDerived && false !== isDerived) {
    throw new Error(`token policy ${purpose} declares a non-boolean derived`);
  }
  // a derived policy names its key by purpose, a plain one by config element; having both or neither means the key is a guess
  if (isDerived === CONFIGURED_SECRET_TYPES.has(policy.secretType)) {
    throw new Error(`token policy ${purpose} must declare either derived:true or a configured secretType, not both and not neither`);
  }
  if (
    isDerived &&
    (undefined !== policy.secretType || undefined !== policy.operation || undefined !== policy.operationRequired || undefined !== policy.legacyGuard)
  ) {
    throw new Error(`token policy ${purpose} is derived-key and cannot take a secretType, an operation claim or the legacy heuristic`);
  }
  if (undefined !== policy.legacyGuard && 'function' !== typeof policy.legacyGuard) {
    throw new Error(`token policy ${purpose} declares a legacyGuard that is not a function`);
  }
  if (undefined !== policy.operationRequired && 'boolean' !== typeof policy.operationRequired) {
    throw new Error(`token policy ${purpose} declares a non-boolean operationRequired`);
  }
  if (policy.operationRequired && !policy.operation) {
    throw new Error(`token policy ${purpose} requires an operation claim without naming one`);
  }
  if (undefined !== policy.operation && !WIRE_OPERATIONS.has(policy.operation)) {
    throw new Error(`token policy ${purpose} names an operation that is not part of the wire vocabulary`);
  }
}
// a reserved outbound value can never be served by a sink, so it must stay out of the wire vocabulary
for (const operation of OUTBOUND_OPERATIONS) {
  if (WIRE_OPERATIONS.has(operation)) {
    throw new Error(`outbound operation ${operation} is also part of the wire vocabulary`);
  }
}
// token.purposeCheck governs only the marker heuristic and the operation claim: off leaves the structural rules alone, validate adds the heuristic and makes a present claim match, strict makes the claim mandatory wherever a sink names an operation.
const PURPOSE_CHECK_OFF = 'off';
const PURPOSE_CHECK_VALIDATE = 'validate';
const PURPOSE_CHECK_STRICT = 'strict';
const PURPOSE_CHECK_MODES = new Set([PURPOSE_CHECK_OFF, PURPOSE_CHECK_VALIDATE, PURPOSE_CHECK_STRICT]);
// One short code per refusal. The gate never explains itself in prose and never echoes a value from the token, so a stand run or a support dump can be read and grepped at the shipped WARN level.
const REASON = {
  unknownPurpose: 'unknown-purpose',
  invalidMode: 'invalid-mode',
  claimNotServedHere: 'claim-not-served-here',
  claimNested: 'claim-nested',
  claimOutbound: 'claim-outbound',
  claimMissing: 'claim-missing',
  claimMismatch: 'claim-mismatch',
  payloadShape: 'payload-shape',
  markerHeuristic: 'marker-heuristic'
};
// the mode reported on the verdict line; a token Document Server issued to itself is checked strictly whatever the tenant configured, so it is never reported under a tenant mode
const PURPOSE_MODE_INTERNAL = 'internal';
function getPurposeMode(ctx, purpose) {
  const policy = TOKEN_POLICIES[purpose];
  return policy && policy.derived ? PURPOSE_MODE_INTERNAL : ctx.getCfg('services.CoAuthoring.token.purposeCheck', cfgTokenPurposeCheck);
}
// The positive half of the gate: the integrator states what the token is for and the sink compares it with the operation it is serving. Returns a refusal code, or null when the claim is acceptable.
function checkOperationClaim(decoded, policy, mode) {
  const isObject = isPlainPayload(decoded);
  const claimed = isObject ? decoded[constants.JWT_CLAIM_OPERATION] : undefined;
  const nested = isObject && hasNestedOperationClaim(decoded);
  // a nested copy is never legitimate and is fatal in every mode, off included: the merge flattens it into the signed view,
  // where a rule outside this gate - the unsigned-source one - would read it as a top-level claim
  if (nested) {
    return REASON.claimNested;
  }
  // fatal in every mode, off included: no token that predates the claim carries an outbound value, so off has nothing to keep working
  if (OUTBOUND_OPERATIONS.has(claimed)) {
    return REASON.claimOutbound;
  }
  // a sink with no legacy callers demands the claim whatever the mode says; otherwise off is the escape hatch
  if (PURPOSE_CHECK_OFF === mode && !policy.operationRequired) {
    return null;
  }
  // a sink that serves no named operation still must not accept a token typed for another one
  if (!policy.operation) {
    return undefined === claimed ? null : REASON.claimNotServedHere;
  }
  if (undefined === claimed) {
    return policy.operationRequired || PURPOSE_CHECK_STRICT === mode ? REASON.claimMissing : null;
  }
  return claimed === policy.operation ? null : REASON.claimMismatch;
}
// the wrappers are checked one by one, because a later one can otherwise overwrite a conflicting copy in an earlier one and hide it
function hasNestedOperationClaim(decoded) {
  for (const wrapper of [decoded.payload, decoded.query]) {
    if (isPlainPayload(wrapper) && undefined !== wrapper[constants.JWT_CLAIM_OPERATION]) {
      return true;
    }
  }
  return false;
}
// Inbound purpose gate. A token Document Server issued to itself is always checked strictly; an integrator token is governed by token.purposeCheck, where an unknown mode is an invalid security setting that fails closed. Returns a refusal code, or null when the token may pass.
function classifyJwtPurpose(ctx, decoded, expectedPurpose) {
  const policy = TOKEN_POLICIES[expectedPurpose];
  if (!policy) {
    // a mistyped constant reads as undefined, so a falsy purpose is a code defect and fails closed like an unknown one
    return REASON.unknownPurpose;
  }
  // a token Document Server issues to itself has no legacy callers, so it is checked by its payload rule alone and no tenant setting reaches it
  if (policy.derived) {
    return policy.validate(decoded, expectedPurpose) ? null : REASON.payloadShape;
  }
  const mode = getPurposeMode(ctx, expectedPurpose);
  if (!PURPOSE_CHECK_MODES.has(mode)) {
    return REASON.invalidMode;
  }
  const claimReason = checkOperationClaim(decoded, policy, mode);
  if (claimReason) {
    return claimReason;
  }
  // a claim that matched names the token positively, which is better evidence than any field name the heuristic could read
  const claimMatched = !!policy.operation && isPlainPayload(decoded) && decoded[constants.JWT_CLAIM_OPERATION] === policy.operation;
  // the structural rule states what the consumer actually reads, so it is not something an operator can switch off
  if (!policy.validate(decoded)) {
    return REASON.payloadShape;
  }
  if (PURPOSE_CHECK_OFF === mode || !policy.legacyGuard) {
    return null;
  }
  // the guard belongs to the operation, so a from-file purpose gets the same treatment as its body counterpart
  return policy.legacyGuard(decoded, claimMatched) ? null : REASON.markerHeuristic;
}
function checkJwtPurpose(ctx, decoded, expectedPurpose) {
  return null === classifyJwtPurpose(ctx, decoded, expectedPurpose);
}
// a sink that accepts more than one purpose probes them in turn, so a single refusal there is a detail and only the caller knows the verdict
function logJwtRefusal(ctx, quiet, format, ...args) {
  if (quiet) {
    ctx.logger.debug(format, ...args);
  } else {
    ctx.logger.warn(format, ...args);
  }
}
// a purpose mismatch must look exactly like a bad token to every caller
function applyJwtPurpose(ctx, res, purpose, verified, quiet) {
  // a payload of `false` or `0` verifies but is falsy, so the signature outcome cannot be read off decoded
  if (!verified) {
    return;
  }
  const reason = classifyJwtPurpose(ctx, res.decoded, purpose);
  if (!reason) {
    ctx.logger.debug('checkJwt accepted: purpose=%s mode=%s', purpose, getPurposeMode(ctx, purpose));
    return;
  }
  rejectForPurpose(ctx, res, purpose, reason, getPurposeMode(ctx, purpose), quiet);
}
// one line carries the whole verdict: which sink refused, under which mode, and why. It never carries a value out of the token.
function rejectForPurpose(ctx, res, purpose, reason, mode, quiet) {
  logJwtRefusal(ctx, quiet, 'checkJwt purpose rejected: purpose=%s mode=%s reason=%s', purpose, mode, reason);
  res.decoded = null;
  res.code = constants.JWT_ERROR_CODE;
  res.description = constants.JWT_ERROR_REASON + 'purpose';
  return res;
}
// Shared verification core so type-based and purpose-derived keys produce one error contract.
function verifyJwtWithSecret(ctx, token, secret, quiet) {
  const tenTokenVerifyOptions = ctx.getCfg('services.CoAuthoring.token.verifyOptions', cfgTokenVerifyOptions);

  // the raw token is deliberately not carried on the result so a %j dump of it cannot leak a credential
  const res = {decoded: null, description: null, code: null};
  let verified = false;
  // a missing secret is a refusal, not a warning, so a tenant without key material can never verify anything
  if (!utils.isJwtHsKeyMaterial(secret)) {
    logJwtRefusal(ctx, quiet, 'checkJwt error: missing or invalid secret');
    res.code = constants.JWT_ERROR_CODE;
    res.description = constants.JWT_ERROR_REASON + 'secret';
    return {res, verified};
  }
  try {
    res.decoded = jwt.verify(token, utils.getJwtHsKey(secret), tenTokenVerifyOptions);
    verified = true;
  } catch (err) {
    // never log the token itself
    logJwtRefusal(ctx, quiet, 'checkJwt error: name = %s message = %s', err.name, err.message);
    if ('TokenExpiredError' === err.name) {
      res.code = constants.JWT_EXPIRED_CODE;
      res.description = constants.JWT_EXPIRED_REASON + err.message;
    } else if ('JsonWebTokenError' === err.name) {
      res.code = constants.JWT_ERROR_CODE;
      res.description = constants.JWT_ERROR_REASON + err.message;
    }
  }
  return {res, verified};
}
// the key a purpose is signed and verified with: derived from the purpose, or the configured element the policy names
async function resolveSecret(ctx, purpose, policy) {
  return policy.derived ? await tenantManager.getTenantDerivedSecret(ctx, purpose) : await tenantManager.getTenantSecret(ctx, policy.secretType);
}
// One signer for every token Document Server issues. The purpose names the key, so a caller cannot pair the wrong secret with the wrong flow.
async function signToken(ctx, purpose, payload, algorithm, expiresIn) {
  const policy = TOKEN_POLICIES[purpose];
  if (!policy) {
    throw new Error(`no token policy for purpose ${purpose}`);
  }
  const secret = await resolveSecret(ctx, purpose, policy);
  //signing without usable key material is a configuration failure, never something to paper over with a fallback key
  if (!utils.isJwtHsKeyMaterial(secret)) {
    throw new Error(`signToken: missing or invalid secret for purpose ${purpose}`);
  }
  return jwt.sign(payload, utils.getJwtHsKey(secret), {algorithm, expiresIn});
}
// One verifier for every token. The policy names the key, the payload rule and the expected operation, so a caller can neither pair the wrong secret with a purpose nor verify a token without saying what it is for.
async function checkJwt(ctx, token, purpose, opt_quiet) {
  const policy = TOKEN_POLICIES[purpose];
  if (!policy) {
    // a mistyped constant reads as undefined, so a falsy purpose is a code defect and fails closed
    return rejectForPurpose(ctx, {decoded: null, description: null, code: null}, purpose, REASON.unknownPurpose, PURPOSE_MODE_INTERNAL);
  }
  // quiet only moves a refusal from warn to debug: what is verified, and how, does not change
  const quiet = true === opt_quiet;
  const secret = await resolveSecret(ctx, purpose, policy);
  const {res, verified} = verifyJwtWithSecret(ctx, token, secret, quiet);
  applyJwtPurpose(ctx, res, purpose, verified, quiet);
  return res;
}
// named so a call site reads as a flag instead of a bare true, and unlike an options object it allocates nothing per connection
const QUIET = true;
// Presenter View opens a second window on the same document and gets the session token through docInfo, so sdkjs sends it as jwtOpen and it lands in the open slot instead of auth.session
// the slot is client-chosen and never was a trust boundary, so this sink names both families it accepts and the token still names neither its purpose nor its key
async function checkJwtForConnection(ctx, token, isSessionSlot) {
  if (isSessionSlot) {
    return checkJwt(ctx, token, constants.JWT_PURPOSE_EDITOR_SESSION);
  }
  // one family refusing is the normal case here, so both attempts stay quiet and the refusal is reported once below
  const openRes = await checkJwt(ctx, token, constants.JWT_PURPOSE_BROWSER_OPEN, QUIET);
  if (openRes.decoded) {
    return openRes;
  }
  // the session key is derived, so this second attempt can only pass for a token this server issued to an open document
  const sessionRes = await checkJwt(ctx, token, constants.JWT_PURPOSE_EDITOR_SESSION, QUIET);
  if (sessionRes.decoded) {
    return sessionRes;
  }
  // an expired session token must keep its own code, otherwise the client is told the signature is bad and never asks for a new one
  const res = constants.JWT_EXPIRED_CODE === sessionRes.code ? sessionRes : openRes;
  ctx.logger.warn('checkJwtForConnection refused: open=%s session=%s', openRes.description, sessionRes.description);
  return res;
}
// A body script carries no signature of its own, so a matching claim is the only positive evidence that the caller minted this token for this work.
function hasOperationClaim(authRes, purpose) {
  // compared with the operation the policy serves, not with the purpose label, so an alias purpose matches and an unregistered one never reads as a match against undefined
  const operation = TOKEN_POLICIES[purpose]?.operation;
  const signed = authRes && authRes.signedParams;
  return !!operation && isPlainPayload(signed) && operation === signed[constants.JWT_CLAIM_OPERATION];
}
async function checkJwtHeader(ctx, req, purpose, opt_carrier) {
  const tenTokenInboxHeader = ctx.getCfg('services.CoAuthoring.token.inbox.header', cfgTokenInboxHeader);
  const tenTokenInboxPrefix = ctx.getCfg('services.CoAuthoring.token.inbox.prefix', cfgTokenInboxPrefix);

  const header = opt_carrier?.header || tenTokenInboxHeader;
  const prefix = opt_carrier?.prefix || tenTokenInboxPrefix;
  const authorization = req.get(header);
  if (authorization && authorization.startsWith(prefix)) {
    return await checkJwt(ctx, authorization.substring(prefix.length), purpose);
  }
  return null;
}

// test-only surface: production code reaches both of these through checkJwt
exports.validateJwtPayloadForOperation = validateJwtPayloadForOperation;
exports.checkJwtPurpose = checkJwtPurpose;
exports.signToken = signToken;
exports.checkJwt = checkJwt;
exports.checkJwtForConnection = checkJwtForConnection;
exports.checkJwtHeader = checkJwtHeader;
exports.hasOperationClaim = hasOperationClaim;
