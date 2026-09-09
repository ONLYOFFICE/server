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

const {pipeline} = require('stream/promises');
const {URL} = require('url');
const config = require('config');
const utils = require('./../../../Common/sources/utils');
const operationContext = require('./../../../Common/sources/operationContext');
const constants = require('./../../../Common/sources/constants');
const docsCoServer = require('./../DocsCoServer');
const statsDClient = require('./../../../Common/sources/statsdclient');

const cfgAiApiAllowedOrigins = config.get('aiSettings.allowedCorsOrigins');
const cfgAiApiTimeout = config.get('aiSettings.timeout');
const cfgAiApiAllowBrowserProxy = config.get('aiSettings.allowBrowserProxy');
const cfgAiEnable = config.get('aiSettings.enable');
const cfgAiSettings = config.get('aiSettings');

const clientStatsD = statsDClient.getClient();

// AI Tools config.json guids (web DD007, desktop DD777) whose presence enables /ai-proxy; lowercased for case-insensitive match.
const AI_PLUGIN_GUIDS = ['asc.{9dc93cdb-b576-4f0c-b55e-fcc9c48dd007}'];

// Placeholder sent to the browser instead of a real key so client SDKs pass their local auth checks; insertKeyToProvider swaps it for the real key on proxy egress.
const AI_KEY_PLACEHOLDER = '********';

// Server-wide (tenant-aware) AI switch: off hides AI Tools, stops shipping its settings and closes /ai-proxy.
function isAiEnabled(ctx) {
  return false !== ctx.getCfg('aiSettings.enable', cfgAiEnable);
}

/**
 * Helper function to set CORS headers if the request origin is allowed
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {operationContext.Context} ctx - Operation context for logging
 * @param {boolean} handleOptions - Whether to handle OPTIONS requests (default: true)
 * @returns {boolean} - True if this was an OPTIONS request that was handled
 */
function handleCorsHeaders(req, res, ctx, handleOptions = true) {
  const requestOrigin = req.headers.origin;

  const tenAiApiAllowedOrigins = ctx.getCfg('aiSettings.allowedCorsOrigins', cfgAiApiAllowedOrigins);

  // If no origin in request or allowed origins list is empty, do nothing
  if (!requestOrigin || tenAiApiAllowedOrigins.length === 0) {
    return false;
  }

  // If the origin is in our allowed list
  if (tenAiApiAllowedOrigins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin'); // Important when using dynamic origin

    // If debug logging is available
    if (ctx && ctx.logger) {
      ctx.logger.debug('CORS headers set for origin: %s (matched allowed list)', requestOrigin);
    }

    // Handle preflight OPTIONS requests if requested
    if (handleOptions && req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT');
      // Allow all headers with wildcard
      res.setHeader('Access-Control-Allow-Headers', '*');

      // For preflight request, we should also set non-CORS headers to match the API
      res.setHeader('Allow', 'OPTIONS, HEAD, GET, POST, PUT, DELETE, PATCH');
      res.setHeader('Content-Length', '0');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      // Return 204 which is standard for OPTIONS preflight
      res.sendStatus(204); // No Content response for OPTIONS
      return true; // Signal that we handled an OPTIONS request
    }
  }

  return false; // Not an OPTIONS request or origin not allowed
}

const safeUrlOrigin = url => (URL.canParse(url) ? new URL(url).origin : null);

// True when the normalized target is the configured base origin+path or strictly under it; component check blocks '..' escape, sibling-prefix borrow (/v1 vs /v1beta) and userinfo/host tricks.
function isUnderProviderBase(baseUrl, normalizedTarget) {
  let base;
  let target;
  try {
    base = new URL(baseUrl);
    target = new URL(normalizedTarget);
  } catch (_) {
    return false;
  }
  if (base.origin !== target.origin) {
    return false;
  }
  const basePath = base.pathname;
  // Root base path means the admin trusts the whole origin.
  if (basePath === '/') {
    return true;
  }
  if (target.pathname === basePath) {
    return true;
  }
  const boundary = basePath.endsWith('/') ? basePath : basePath + '/';
  return target.pathname.startsWith(boundary);
}

// HTTP methods the browser-proxy relay accepts; anything else is rejected before egress.
const RELAY_ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'HEAD'];
// Methods refused on the matched-provider path; a narrow denylist keeps AI/MCP verbs (GET/POST/PUT/PATCH/DELETE) working.
const MATCHED_FORBIDDEN_METHODS = ['CONNECT', 'TRACE'];
// Hop-by-hop, connection-management and proxy headers the client must not control on the outgoing request.
const STRIP_REQUEST_HEADERS = [
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
  'proxy-authorization'
];
// Hop-by-hop and cookie headers stripped from the upstream response before it reaches the editor origin.
const STRIP_RESPONSE_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'set-cookie2'
];

// Drop the client-controlled hop-by-hop request headers; the HTTP layer manages these itself.
function sanitizeProxyRequestHeaders(headers) {
  const res = {};
  for (const key in headers) {
    if (!STRIP_REQUEST_HEADERS.includes(key.toLowerCase())) {
      res[key] = headers[key];
    }
  }
  return res;
}

// Merge server-injected provider headers over client headers, dropping any client case-variant so it cannot shadow the injected value on the wire.
function mergeProviderHeaders(clientHeaders, providerHeaders) {
  const res = {...clientHeaders};
  for (const injected of Object.keys(providerHeaders)) {
    const lower = injected.toLowerCase();
    for (const existing of Object.keys(res)) {
      if (existing.toLowerCase() === lower) {
        delete res[existing];
      }
    }
    res[injected] = providerHeaders[injected];
  }
  return res;
}

// Strip hop-by-hop and cookie headers and remove control chars before relaying an upstream response.
function sanitizeProxyResponseHeaders(headers) {
  const res = {...headers};
  for (const key of Object.keys(res)) {
    if (STRIP_RESPONSE_HEADERS.includes(key.toLowerCase())) {
      delete res[key];
    }
  }
  if (res['content-disposition']) {
    res['content-disposition'] = res['content-disposition'].replace(/\p{Cc}/gu, '');
  }
  return res;
}

// Compact, secret-free error descriptor for logs; never includes the axios config/headers/body that a raw AxiosError carries.
function describeRequestError(error) {
  const status = error?.statusCode ?? error?.response?.status;
  return `message=${error?.message} code=${error?.code} status=${status}`;
}

// Release the upstream socket/stream; safe after normal completion (no-op) or on client abort.
function destroyUpstream(result) {
  result?.stream?.destroy?.();
  result?.response?.data?.destroy?.();
}

/**
 * Detects provider type and generates appropriate authentication headers based on URL patterns
 *
 * @param {operationContext.Context} ctx - Operation context for logging
 * @param {string} providerUrl - Provider base URL to detect type
 * @param {string} providerKey - API key for the provider
 * @param {string} uri - Full target request URI
 * @param {object} providerHeaders - Optional provider headers from customProviders
 * @returns {object} Headers object with authentication added
 */
function insertKeyToProvider(ctx, providerUrl, providerKey, uri, providerHeaders, requestHeaders = {}) {
  if (!providerKey) {
    return uri;
  }

  // Universal swap: wherever the client left the placeholder (any header value or the URL), substitute the real key in place and keep the client's own format.
  const clientHeaders = requestHeaders && typeof requestHeaders === 'object' ? requestHeaders : {};
  let placeholderFound = false;
  for (const name of Object.keys(clientHeaders)) {
    // Skip hop-by-hop names so the swap never resurrects a stripped header (mergeProviderHeaders re-adds injected headers after the hop-by-hop strip).
    if (STRIP_REQUEST_HEADERS.includes(name.toLowerCase())) {
      continue;
    }
    const value = clientHeaders[name];
    if (typeof value === 'string' && value.includes(AI_KEY_PLACEHOLDER)) {
      providerHeaders[name] = value.split(AI_KEY_PLACEHOLDER).join(providerKey);
      placeholderFound = true;
    }
  }
  if (typeof uri === 'string' && uri.includes(AI_KEY_PLACEHOLDER)) {
    uri = uri.split(AI_KEY_PLACEHOLDER).join(encodeURIComponent(providerKey));
    placeholderFound = true;
  }
  if (placeholderFound) {
    return uri;
  }

  // No placeholder present (legacy clients send an empty slot): prefer the auth slot the client left for us over hardcoded per-provider rules.
  const authHeader = Object.keys(clientHeaders).find(h => ['authorization', 'x-api-key', 'api-key', 'x-goog-api-key'].includes(h.toLowerCase()));
  if (authHeader) {
    providerHeaders[authHeader] = authHeader.toLowerCase() === 'authorization' ? `Bearer ${providerKey}` : providerKey;
    return uri;
  }
  if (/[?&]key=($|&)/.test(uri)) {
    return uri.replace(/([?&]key=)($|&)/, `$1${encodeURIComponent(providerKey)}$2`);
  }

  const urlLower = providerUrl.toLowerCase();
  if (urlLower.includes('anthropic.com')) {
    // Anthropic uses x-api-key header
    providerHeaders['x-api-key'] = providerKey;
  } else if (urlLower.includes('generativelanguage.googleapis.com')) {
    // Google Gemini uses API key as query parameter (already in URI)
    if (uri.includes('?')) uri += `&key=${providerKey}`;
    else uri += `?key=${providerKey}`;
  } else {
    // Default: Bearer Authorization (OpenAI, Deepseek, Groq, xAI, Mistral, Together.ai, etc.)
    providerHeaders['Authorization'] = `Bearer ${providerKey}`;
  }

  return uri;
}

// Collect every URL the proxy is allowed to forward to, with the secret to inject; spans legacy providers and the v5 plugin settings blob.
function getAiProxyTargets(tenAiApi) {
  const targets = [];
  for (const provider of Object.values(tenAiApi?.providers || {})) {
    if (provider?.url) {
      targets.push({url: provider.url, key: provider.key});
    }
  }
  const blob = tenAiApi?.pluginSettings;
  if (blob && typeof blob === 'object') {
    for (const profile of blob.profiles || []) {
      if (profile?.baseUrl) {
        targets.push({url: profile.baseUrl, key: profile.key});
      }
    }
    if (blob.webSearch?.baseUrl) {
      targets.push({url: blob.webSearch.baseUrl, key: blob.webSearch.key});
    }
    for (const server of Object.values(blob.mcpServers || {})) {
      if (server?.url) {
        targets.push({url: server.url, headers: server.headers});
      }
    }
    // customProviders are user-authored client-side code (endpoint and creds live in their source); they run in the browser and are not proxied here.
  }
  return targets;
}

/**
 * Makes an HTTP request to an AI API endpoint using the provided request and response objects
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<void>} - Promise resolving when the request is complete
 */
async function proxyRequest(req, res) {
  // Create operation context for logging
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  const startDate = new Date();
  let success = false;
  let result = null;

  try {
    ctx.logger.info('Start proxyRequest');
    await ctx.initTenantCache();
    // Server-wide switch wins over anything the client sends; it needs no token, so it also holds with jwt turned off.
    if (!isAiEnabled(ctx)) {
      ctx.logger.warn('proxyRequest: AI is disabled by aiSettings.enable');
      res.status(403).json({error: {message: 'proxyRequest: AI is disabled', code: '403'}});
      return;
    }
    // Disable the endpoint when AI Tools was removed from the distribution: no installed AI Tools guid means no legit caller.
    const installedPluginGuids = await utils.getInstalledPluginGuids();
    if (!AI_PLUGIN_GUIDS.some(guid => installedPluginGuids.has(guid))) {
      ctx.logger.warn('proxyRequest: AI Tools is not installed; endpoint disabled');
      res.status(404).json({error: {message: 'proxyRequest: AI Tools is not installed', code: '404'}});
      return;
    }
    const tenAiApiTimeout = ctx.getCfg('aiSettings.timeout', cfgAiApiTimeout);
    const tenAiApi = ctx.getCfg('aiSettings', cfgAiSettings);
    const tenAllowBrowserProxy = ctx.getCfg('aiSettings.allowBrowserProxy', cfgAiApiAllowBrowserProxy);

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let docId = '';
    let userId = '';
    const checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req, constants.JWT_PURPOSE_EDITOR_SESSION, {
      header: 'Authorization',
      prefix: 'Bearer '
    });
    if (!checkJwtRes || !checkJwtRes.decoded) {
      ctx.logger.error('proxyRequest: checkJwtHeader error: %s', checkJwtRes?.description);
      res.status(403).json({
        error: {
          message: 'proxyRequest: checkJwtHeader error',
          code: '403'
        }
      });
      return;
    } else {
      docId = checkJwtRes?.decoded?.document?.key;
      userId = checkJwtRes?.decoded?.editorConfig?.user?.id;

      ctx.setDocId(docId);
      ctx.setUserId(userId);

      //TODO: per-session enforcement only works while services.CoAuthoring.token.enable.browser is on; with jwt off the integrator flag never reaches the session token, use aiSettings.enable instead
      //reject sessions opened with customization.ai.disabled (ds_aiDisabled is set by fillJwtByConnection)
      if (true === checkJwtRes?.decoded?.editorConfig?.ds_aiDisabled) {
        ctx.logger.warn('proxyRequest: AI is disabled for this editor session');
        res.status(403).json({error: {message: 'proxyRequest: AI is disabled for this editor session', code: '403'}});
        return;
      }
    }

    let body;
    try {
      body = JSON.parse(req.body);
    } catch (_) {
      body = null;
    }
    if (!body || typeof body !== 'object') {
      ctx.logger.warn('proxyRequest: invalid request body');
      res.status(400).json({error: {message: 'proxyRequest: invalid request body', code: '400'}});
      return;
    }
    let uri = body.target;

    // Match and fetch on the same canonical bytes; a raw match lets '..' or '%2e%2e' escape the configured base path (egress re-normalizes before fetch).
    let normalizedTarget = null;
    if (typeof uri === 'string') {
      try {
        const canon = utils.normalizeExternalUri(uri);
        const parsed = new URL(canon);
        // Only http(s) targets are eligible for the trusted matched path; anything else falls through to the filtered relay.
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          normalizedTarget = canon;
        }
      } catch (_) {
        normalizedTarget = null;
      }
    }
    const targetOrigin = normalizedTarget ? safeUrlOrigin(normalizedTarget) : null;

    const providerHeaders = {};
    let providerMatched = false;
    // Determine which configured target/secret to use; match on normalized origin + path containment so the key is bound to the configured base.
    if (normalizedTarget) {
      for (const target of getAiProxyTargets(tenAiApi)) {
        if (target?.url && isUnderProviderBase(target.url, normalizedTarget)) {
          providerMatched = true;
          uri = normalizedTarget;
          if (target.headers) {
            // MCP servers carry their own auth headers; restore them verbatim from config.
            Object.assign(providerHeaders, target.headers);
          } else {
            uri = insertKeyToProvider(ctx, target.url, target.key, uri, providerHeaders, body.headers);
          }
          break;
        }
      }
    }

    // No configured provider matched: relay the client-supplied request as-is when browser-proxy is enabled, otherwise deny.
    if (!providerMatched) {
      if (tenAllowBrowserProxy) {
        await relayBrowserProxy(ctx, req, res, body, tenAiApiTimeout);
        return;
      }
      ctx.logger.warn('proxyRequest: target %s does not match any configured AI provider. Denying access.', targetOrigin || 'invalid');
      res.status(403).json({
        error: {
          message: 'proxyRequest: target does not match any configured AI provider',
          code: '403'
        }
      });
      return;
    }

    // Matched path attaches the org credential; validate the client-shaped request before egress.
    if (body.headers != null && (typeof body.headers !== 'object' || Array.isArray(body.headers))) {
      ctx.logger.warn('proxyRequest: invalid headers');
      res.status(400).json({error: {message: 'proxyRequest: invalid headers', code: '400'}});
      return;
    }
    if (typeof body.method !== 'string' || MATCHED_FORBIDDEN_METHODS.includes(body.method.toUpperCase())) {
      ctx.logger.warn('proxyRequest: method not allowed');
      res.status(400).json({error: {message: 'proxyRequest: method not allowed', code: '400'}});
      return;
    }

    // Server-injected provider headers are authoritative; drop any client case-variant so it cannot shadow them (axios does NOT dedupe header names case-insensitively).
    const headers = mergeProviderHeaders(sanitizeProxyRequestHeaders(body.headers || {}), providerHeaders);

    // Preserve Accept-Encoding from original request if not explicitly provided
    if (!headers['accept-encoding'] && req.headers['accept-encoding']) {
      headers['accept-encoding'] = req.headers['accept-encoding'];
    }

    // Configure timeout options for the request
    const timeoutOptions = {
      connectionAndInactivity: tenAiApiTimeout,
      wholeCycle: tenAiApiTimeout
    };
    // Create request parameters object
    const requestParams = {
      method: body.method,
      uri,
      headers,
      body: body.data,
      timeout: timeoutOptions,
      limit: null,
      isInJwtToken: providerMatched //true because it passed provider's filter
    };

    // Log only method and origin; headers and body carry injected provider keys and must not be logged.
    ctx.logger.debug('proxyRequest request: method=%s target=%s', requestParams.method, targetOrigin || 'invalid');

    // Use utils.httpRequest to make the request
    result = await utils.httpRequest(
      ctx, // Operation context
      requestParams.method, // HTTP method
      requestParams.uri, // Target URL
      requestParams.headers, // Request headers
      requestParams.body, // Request body
      requestParams.timeout, // Timeout configuration
      requestParams.limit, // Size limit
      requestParams.isInJwtToken, // Filter private requests
      {
        decompress: false,
        // Matched path runs with the private-IP filter off (isInJwtToken=true), so never follow a redirect to a different private/metadata host.
        maxRedirects: 0
      }
    );

    // Preserve the upstream status and sanitize upstream headers (drop Set-Cookie/hop-by-hop) before relaying.
    res.status(result.response.status);
    res.set(sanitizeProxyResponseHeaders(result.response.headers));

    // Use pipeline to pipe the response data to the client
    await pipeline(result.stream, res);
    success = true;
  } catch (error) {
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      ctx.logger.debug('proxyRequest: client disconnected');
    } else {
      ctx.logger.error('proxyRequest: AI API request error: %s', describeRequestError(error));
    }
    if (!res.headersSent) {
      try {
        if (error.response) {
          res.status(error.response.status || error.statusCode || 502);
          res.set(sanitizeProxyResponseHeaders(error.response.headers));
          await pipeline(error.response.data, res);
        } else {
          res.status(500).json({
            error: {
              message: 'proxyRequest: AI API request error',
              code: '500'
            }
          });
        }
      } catch (responseError) {
        ctx.logger.debug('proxyRequest: error sending error response: %s', responseError.stack);
      }
    }
  } finally {
    // Release the upstream socket promptly so a client abort does not hold it until the timeout.
    destroyUpstream(result);
    // Record the time taken for the proxyRequest in StatsD (skip cors requests and errors)
    if (clientStatsD && success) {
      clientStatsD.timing('coauth.aiProxy', new Date() - startDate);
    }
    ctx.logger.info('End proxyRequest');
  }
}

/**
 * Relays a fully client-supplied request (client owns its keys) to bypass browser CORS; injects no credentials.
 * Reached from proxyRequest when no configured provider matches and aiSettings.allowBrowserProxy is on. SSRF is
 * bounded by the default blockPrivateIP filter because isInJwtToken=false routes through the filtering agent.
 *
 * @param {operationContext.Context} ctx - Operation context (already authenticated)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} body - Parsed request body {target, method, headers, data}
 * @param {string} tenAiApiTimeout - AI request timeout
 * @returns {Promise<void>}
 */
async function relayBrowserProxy(ctx, req, res, body, tenAiApiTimeout) {
  const startDate = new Date();
  let success = false;
  let result = null;

  try {
    const uri = body.target;
    // Only forward absolute http(s) URLs; reject anything else before egress.
    let parsedTarget = null;
    try {
      parsedTarget = typeof uri === 'string' ? new URL(uri) : null;
    } catch (_) {
      parsedTarget = null;
    }
    if (!parsedTarget || (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:')) {
      ctx.logger.warn('proxyRequest relay: invalid target URL');
      res.status(400).json({error: {message: 'proxyRequest relay: invalid target URL', code: '400'}});
      return;
    }

    const method = (typeof body.method === 'string' ? body.method : 'GET').toUpperCase();
    if (!RELAY_ALLOWED_METHODS.includes(method)) {
      ctx.logger.warn('proxyRequest relay: method not allowed: %s', method);
      res.status(400).json({error: {message: 'proxyRequest relay: method not allowed', code: '400'}});
      return;
    }

    if (body.headers != null && (typeof body.headers !== 'object' || Array.isArray(body.headers))) {
      ctx.logger.warn('proxyRequest relay: invalid headers');
      res.status(400).json({error: {message: 'proxyRequest relay: invalid headers', code: '400'}});
      return;
    }

    // Forward only the client-supplied target headers (minus hop-by-hop); never the session JWT or an outbox token.
    const headers = sanitizeProxyRequestHeaders(body.headers || {});
    if (!headers['accept-encoding'] && req.headers['accept-encoding']) {
      headers['accept-encoding'] = req.headers['accept-encoding'];
    }

    const timeoutOptions = {connectionAndInactivity: tenAiApiTimeout, wholeCycle: tenAiApiTimeout};
    // Log only the safe origin; headers and body carry client secrets and must not be logged.
    ctx.logger.debug('proxyRequest relay: %s to %s', method, parsedTarget.origin);

    result = await utils.httpRequest(
      ctx,
      method,
      uri,
      headers,
      body.data,
      timeoutOptions,
      null,
      false, // opt_filterPrivate=false: client-controlled URL is untrusted, so blockPrivateIP applies
      {decompress: false}
    );

    res.status(result.response.status);
    res.set(sanitizeProxyResponseHeaders(result.response.headers));
    await pipeline(result.stream, res);
    success = true;
  } catch (error) {
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      ctx.logger.debug('proxyRequest relay: client disconnected');
    } else {
      ctx.logger.error('proxyRequest relay: request error: %s', describeRequestError(error));
    }
    if (!res.headersSent) {
      try {
        if (error.response) {
          res.status(error.response.status || error.statusCode || 502);
          res.set(sanitizeProxyResponseHeaders(error.response.headers));
          await pipeline(error.response.data, res);
        } else {
          res.status(500).json({error: {message: 'proxyRequest relay: request error', code: '500'}});
        }
      } catch (responseError) {
        ctx.logger.debug('proxyRequest relay: error sending error response: %s', responseError.stack);
      }
    }
  } finally {
    // Release the upstream socket promptly so a client abort does not hold it until the timeout.
    destroyUpstream(result);
    if (clientStatsD && success) {
      clientStatsD.timing('coauth.aiBrowserProxy', new Date() - startDate);
    }
  }
}

/**
 * Retrieves all AI models from the configuration and dynamically from providers
 *
 * @param {operationContext.Context} ctx - Operation context
 * @returns {Promise<Object>} Object containing providers and their models along with action configurations
 */
async function getPluginSettings(ctx) {
  return {
    version: ctx.getCfg('aiSettings.version', cfgAiSettings.version),
    actions: ctx.getCfg('aiSettings.actions', cfgAiSettings.actions),
    providers: ctx.getCfg('aiSettings.providers', cfgAiSettings.providers),
    customProviders: ctx.getCfg('aiSettings.customProviders', cfgAiSettings.customProviders),
    models: ctx.getCfg('aiSettings.models', cfgAiSettings.models)
  };
}

// Replace secret values inside the opaque v5 plugin settings blob before sending it to the browser; the server AI proxy injects real credentials.
function stripPluginSettingsSecrets(blob) {
  if (!blob || typeof blob !== 'object') {
    return blob;
  }
  // Only non-empty keys get the placeholder so unconfigured profiles still look unconfigured to the client.
  if (Array.isArray(blob.profiles)) {
    for (const profile of blob.profiles) {
      if (profile && profile.key) {
        profile.key = AI_KEY_PLACEHOLDER;
      }
    }
  }
  // Replace the web search provider key with the placeholder; its client sends the key only in auth headers, never in query.
  if (blob.webSearch && blob.webSearch.key) {
    blob.webSearch.key = AI_KEY_PLACEHOLDER;
  }
  // Replace non-empty MCP server header values with the placeholder; the proxy restores the real values verbatim from config by target.url match on use.
  if (blob.mcpServers && typeof blob.mcpServers === 'object') {
    for (const id in blob.mcpServers) {
      const server = blob.mcpServers[id];
      if (server && server.headers && typeof server.headers === 'object') {
        for (const header in server.headers) {
          if (server.headers[header]) {
            server.headers[header] = AI_KEY_PLACEHOLDER;
          }
        }
      }
    }
  }
  return blob;
}

async function getPluginSettingsForInterface(ctx) {
  // Ship no providers, models or plugin settings to the browser while AI is off.
  if (!isAiEnabled(ctx)) {
    return undefined;
  }
  // Prefer the new universal plugin settings blob when configured; strip secrets for the browser.
  const newBlob = ctx.getCfg('aiSettings.pluginSettings', cfgAiSettings.pluginSettings);
  if (newBlob && typeof newBlob === 'object' && Object.keys(newBlob).length > 0) {
    return stripPluginSettingsSecrets(JSON.parse(JSON.stringify(newBlob)));
  }

  let pluginSettings = await getPluginSettings(ctx);

  // Create deep copy to avoid modifying cached config
  if (pluginSettings) {
    pluginSettings = JSON.parse(JSON.stringify(pluginSettings));
  }

  //check empty settings
  if (pluginSettings && pluginSettings.actions) {
    let isEmptySettings = true;
    for (const key in pluginSettings.actions) {
      if (pluginSettings.actions[key].model) {
        isEmptySettings = false;
      }
    }
    if (isEmptySettings) {
      pluginSettings = undefined;
    }
  }

  //remove keys from providers
  if (pluginSettings?.providers) {
    for (const key in pluginSettings.providers) {
      if (pluginSettings.providers[key]?.key) {
        pluginSettings.providers[key].key = '';
      }
    }
  }
  return pluginSettings;
}

module.exports = {
  proxyRequest,
  isAiEnabled,
  AI_PLUGIN_GUIDS,
  getPluginSettings,
  getPluginSettingsForInterface,
  sanitizeProxyRequestHeaders,
  mergeProviderHeaders,
  sanitizeProxyResponseHeaders,
  describeRequestError,
  insertKeyToProvider,
  stripPluginSettingsSecrets,
  AI_KEY_PLACEHOLDER
};
