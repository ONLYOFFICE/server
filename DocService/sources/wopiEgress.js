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
const ms = require('ms');
const utils = require('./../../Common/sources/utils');
const wopiUtils = require('./wopiUtils');

const cfgWopiRequireIpFilterRule = config.get('wopi.requireIpFilterRule');
const cfgIpFilterErrorCode = config.get('services.CoAuthoring.ipfilter.errorcode');
const cfgRequestFilteringAgent = config.get('services.CoAuthoring.request-filtering-agent');

const MAX_REDIRECTS = 5;
// these are never reachable whatever the rules say, and the ranges cover the metadata addresses of every cloud that uses one
const HARD_DENY_RANGES = new Set(['linkLocal', 'unspecified', 'broadcast', 'multicast']);
const HARD_DENY_ADDRESSES = toNormalizedAddressSet(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254']);

// a rule that matches every destination can not stand as an admin decision about this host
function isExplicitAllowRule(rule) {
  return true === rule?.allowed && 0 !== rule.address.replace(/[*.:]/g, '').length;
}

// a refusal is reported the same way whatever the operation was, so no caller has to pre-check the destination itself
function destinationError(uri, status) {
  const err = new Error(`WOPI destination refused: ${uri}`);
  err.statusCode = status;
  err.isWopiDestinationRefused = true;
  return err;
}

// CheckFileInfo redirects name a new WOPISrc, whose requests still need the access_token the old url carried
function hopUri(kind, next, access_token) {
  if ('checkFileInfo' !== kind || !access_token) {
    return next.toString();
  }
  const rUrl = new URL(next.toString());
  rUrl.search = '';
  return `${rUrl.toString()}?access_token=${encodeURIComponent(access_token)}`;
}

// FileUrl and TemplateSource are plain downloads, and the contents credential belongs to the WOPI host rather than to whatever it redirected to
async function hopHeaders(ctx, kind, origin, next, uri, headers, access_token) {
  const base = wopiUtils.withoutUrlBoundHeaders(headers);
  if (!access_token || 'fileUrl' === kind || 'templateSource' === kind) {
    return base;
  }
  // once the chain leaves the origin the credential was issued for, it never comes back, however the later hops are shaped
  if ('contents' === kind && origin !== next.origin) {
    ctx.logger.debug('wopi redirect drops the contents credential: issued for %s, hop goes to %s', origin, next.origin);
    return base;
  }
  await wopiUtils.fillStandardHeaders(ctx, base, uri, access_token);
  return base;
}

// an administrator writes addresses in whatever form they like, so compare them in one normalized form
function toNormalizedAddressSet(addresses) {
  return new Set((addresses ?? []).map(address => utils.classifyAddress(address)?.normalized ?? address));
}

/**
 * Judge a WOPI destination before anything is sent to it.
 * The network filter cannot be the decision point: it inspects the proxy rather than the target when one is
 * configured, and it is not built at all when externalRequest.action.blockPrivateIP is off. It stays in place
 * afterwards as the second line against a re-resolution between this check and the connection.
 *
 * @param {Object} ctx - The operation context
 * @param {string} uri - The destination to judge
 * @returns {Promise<{status: number, filterAllowIPs: Array<string>|undefined}>} 0 and the addresses to lift, or an error code
 */
function evaluateDestination(ctx, uri) {
  return co(function* () {
    if (!wopiUtils.isHttpScheme(uri)) {
      ctx.logger.warn('wopi egress unsupported scheme: url = %s', uri);
      return {status: 403, filterAllowIPs: undefined};
    }
    const tenIpFilterErrorCode = ctx.getCfg('services.CoAuthoring.ipfilter.errorcode', cfgIpFilterErrorCode);
    const tenRequestFilteringAgent = ctx.getCfg('services.CoAuthoring.request-filtering-agent', cfgRequestFilteringAgent);
    const tenRequireIpFilterRule = ctx.getCfg('wopi.requireIpFilterRule', cfgWopiRequireIpFilterRule);
    const hostname = new URL(uri).hostname;
    const refuse = reason => {
      ctx.logger.warn('wopi egress refuses %s: %s', hostname, reason);
      return {status: tenIpFilterErrorCode, filterAllowIPs: undefined};
    };
    let answer;
    try {
      answer = yield utils.dnsLookup(hostname, {all: true});
    } catch (e) {
      ctx.logger.error('wopi egress dnsLookup error: hostname = %s %s', hostname, e.stack);
      return {status: tenIpFilterErrorCode, filterAllowIPs: undefined};
    }
    answer = Array.isArray(answer) ? answer : [answer];
    // a security evaluator fails closed, so an empty or partly unparseable answer is a refusal rather than an empty verdict
    if (0 === answer.length) {
      return refuse('the dns answer is empty');
    }
    const denied = toNormalizedAddressSet(tenRequestFilteringAgent.denyIPAddressList);
    const lift = [];
    for (const item of answer) {
      const info = utils.classifyAddress(item?.address ?? item);
      if (!info) {
        return refuse(`the dns answer contains an address that could not be parsed: ${item?.address ?? item}`);
      }
      // an administrative deny outranks every allow, and it has to be applied here because a proxied request never reaches the agent
      if (HARD_DENY_RANGES.has(info.range) || HARD_DENY_ADDRESSES.has(info.normalized) || denied.has(info.normalized)) {
        return refuse(`address ${info.normalized} is never a permitted destination`);
      }
      // one denied address is enough, a rebinding host must not pass on its friendly record alone
      const rule = utils.checkIpFilterDetailed(ctx, info.normalized, hostname);
      if (0 !== rule.status) {
        return refuse(`address ${info.normalized} is denied by services.CoAuthoring.ipfilter.rules`);
      }
      // a wopi source is attacker-supplied, so every address needs a rule naming it, public ones included
      if (tenRequireIpFilterRule && !isExplicitAllowRule(rule.matchedRule)) {
        return refuse(`address ${info.normalized} is not named by services.CoAuthoring.ipfilter.rules, add a rule for it`);
      }
      // only the non-public addresses need lifting, the public ones pass the network filter on their own
      if (!info.isPublic) {
        lift.push(info.normalized);
      }
    }
    return {status: 0, filterAllowIPs: lift.length > 0 ? lift : undefined};
  });
}

// beforeRedirect is synchronous, so it can only stop the automatic hop and report where it pointed
function collectRedirect(state) {
  return function (options) {
    state.uri = options.href || `${options.protocol}//${options.host}${options.path || ''}`;
    const err = new Error(`WOPI redirect to ${state.uri} intercepted`);
    err.isWopiRedirect = true;
    throw err;
  };
}

// the whole operation gets one budget, so a chain of hops cannot multiply the configured timeout
function remainingTimeout(timeout, deadline) {
  if (!timeout?.wholeCycle) {
    return timeout;
  }
  const left = deadline - Date.now();
  if (left <= 0) {
    throw new Error('WOPI request refused: the redirect chain ran out of time');
  }
  return {...timeout, wholeCycle: `${left}ms`};
}

/**
 * Download a WOPI resource, following its redirects by hand so that every hop is judged like the first one.
 *
 * @param {Object} ctx - The operation context
 * @param {string} uri - The destination, not yet judged
 * @param {Object} opts - Request options passed on to downloadUrlPromise
 * @param {string} [opts.kind] - Which WOPI resource this is: `checkFileInfo`, `contents`, `fileUrl` or `templateSource`
 * @param {string} [opts.access_token] - Token of a signed resource, re-applied per hop according to `kind`
 * @returns {Promise<*>} whatever downloadUrlPromise resolves to for the final hop
 * @throws {Error} when the destination or a hop is refused, the chain loops, or the whole operation runs out of time
 */
async function download(ctx, uri, {kind, access_token, headers, timeout, ...rest} = {}) {
  const first = await evaluateDestination(ctx, uri);
  if (0 !== first.status) {
    throw destinationError(uri, first.status);
  }
  const deadline = timeout?.wholeCycle ? Date.now() + ms(timeout.wholeCycle) : Infinity;
  const credentialOrigin = new URL(uri).origin;
  let current = {uri, filterAllowIPs: first.filterAllowIPs, headers};
  const seen = new Set([uri]);
  for (let hop = 0; ; ++hop) {
    const state = {uri: null};
    try {
      const res = await utils.downloadUrlPromise(ctx, current.uri, {
        ...rest,
        // a wopi url is attacker-supplied whether or not we signed it, so it never becomes a direct request
        isInJwtToken: false,
        filterAllowIPs: current.filterAllowIPs,
        headers: current.headers,
        timeout: remainingTimeout(timeout, deadline),
        beforeRedirect: collectRedirect(state)
      });
      // callers that have to follow the host, like CheckFileInfo, need to know where the chain ended
      res.wopiFinalUri = current.uri;
      return res;
    } catch (err) {
      if (!state.uri) {
        throw err;
      }
    }
    const previous = new URL(current.uri);
    let next;
    try {
      next = new URL(state.uri, current.uri);
    } catch {
      throw new Error(`WOPI redirect to an unparseable location: ${state.uri}`);
    }
    if ('http:' !== next.protocol && 'https:' !== next.protocol) {
      throw new Error(`WOPI redirect refused: unsupported scheme ${next.protocol}`);
    }
    // compare the hop with the one it came from, so https to http is refused anywhere in the chain
    if ('https:' === previous.protocol && 'http:' === next.protocol) {
      throw new Error(`WOPI redirect refused: https to http downgrade at ${next.toString()}`);
    }
    if (hop >= MAX_REDIRECTS || seen.has(next.toString())) {
      throw new Error(`WOPI redirect refused: too many hops or a loop at ${next.toString()}`);
    }
    seen.add(next.toString());
    const target = hopUri(kind, next, access_token);
    const policy = await evaluateDestination(ctx, target);
    if (0 !== policy.status) {
      throw new Error(`WOPI redirect refused: ${next.hostname} is not an allowed destination`);
    }
    ctx.logger.debug('wopi redirect accepted: %s -> %s', current.uri, target);
    current = {
      uri: target,
      filterAllowIPs: policy.filterAllowIPs,
      headers: await hopHeaders(ctx, kind, credentialOrigin, next, target, current.headers, access_token)
    };
  }
}

/**
 * Post to a WOPI host, judging the destination first and refusing to follow any redirect.
 * A redirected POST would replay the body and hand the token to another origin.
 *
 * @param {Object} ctx - The operation context
 * @param {string} uri - The destination, not yet judged
 * @param {Object} opts - Request options passed on to postRequestPromise
 * @returns {Promise<*>} the response
 * @throws {Error} when the destination is refused, carrying the refusal status code
 */
async function post(ctx, uri, opts = {}) {
  const policy = await evaluateDestination(ctx, uri);
  if (0 !== policy.status) {
    throw destinationError(uri, policy.status);
  }
  return utils.postRequestPromise(ctx, uri, {
    ...opts,
    isInJwtToken: false,
    filterAllowIPs: policy.filterAllowIPs,
    beforeRedirect: wopiUtils.blockWopiRedirect
  });
}

module.exports = {
  evaluateDestination,
  download,
  post
};
