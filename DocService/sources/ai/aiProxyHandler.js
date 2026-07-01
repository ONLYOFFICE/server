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
const commonDefines = require('./../../../Common/sources/commondefines');
const tenantManager = require('./../../../Common/sources/tenantManager');
const docsCoServer = require('./../DocsCoServer');
const statsDClient = require('./../../../Common/sources/statsdclient');

const cfgAiApiAllowedOrigins = config.get('aiSettings.allowedCorsOrigins');
const cfgAiApiProxy = config.get('aiSettings.proxy');
const cfgAiApiTimeout = config.get('aiSettings.timeout');
const cfgAiApiAllowBrowserProxy = config.get('aiSettings.allowBrowserProxy');
const cfgTokenEnableOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgTokenOutboxHeader = config.get('services.CoAuthoring.token.outbox.header');
const cfgTokenOutboxPrefix = config.get('services.CoAuthoring.token.outbox.prefix');
const cfgAiSettings = config.get('aiSettings');

const clientStatsD = statsDClient.getClient();
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

// HTTP methods the browser-proxy relay accepts; anything else is rejected before egress.
const RELAY_ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'HEAD'];
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

  // Prefer the auth slot the client left for us (empty header or empty key= query) over hardcoded per-provider rules.
  const authHeader = Object.keys(requestHeaders).find(h => ['authorization', 'x-api-key', 'api-key'].includes(h.toLowerCase()));
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

  try {
    ctx.logger.info('Start proxyRequest');
    await ctx.initTenantCache();
    const tenAiApiTimeout = ctx.getCfg('aiSettings.timeout', cfgAiApiTimeout);
    const tenAiApi = ctx.getCfg('aiSettings', cfgAiSettings);
    const tenAiApiProxy = ctx.getCfg('aiSettings.proxy', cfgAiApiProxy);
    const tenAllowBrowserProxy = ctx.getCfg('aiSettings.allowBrowserProxy', cfgAiApiAllowBrowserProxy);

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let docId = '';
    let userId = '';
    let userName = '';
    let userCustomerId = '';
    const checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req, 'Authorization', 'Bearer ', commonDefines.c_oAscSecretType.Session);
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
      userName = checkJwtRes?.decoded?.editorConfig?.user?.name;
      userCustomerId = checkJwtRes?.decoded?.editorConfig?.user?.customerId;

      ctx.setDocId(docId);
      ctx.setUserId(userId);
    }

    const body = JSON.parse(req.body);
    let uri = body.target;

    const providerHeaders = {};
    let providerMatched = false;
    // Determine which configured target/secret to use based on the URL.
    // Compare origins first to prevent userinfo-SSRF (e.g. https://api.x.com@evil.com)
    // and subdomain-bypass (e.g. https://api.x.com.evil.com) that startsWith alone would miss.
    const targetOrigin = uri ? safeUrlOrigin(uri) : null;
    if (targetOrigin) {
      for (const target of getAiProxyTargets(tenAiApi)) {
        if (safeUrlOrigin(target.url) === targetOrigin && uri.startsWith(target.url)) {
          providerMatched = true;
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
      ctx.logger.warn(`proxyRequest: target '${uri}' does not match any configured AI provider. Denying access.`);
      res.status(403).json({
        error: {
          message: 'proxyRequest: target does not match any configured AI provider',
          code: '403'
        }
      });
      return;
    }

    // Merge key in headers; providerHeaders (spread last) always wins - axios normalises header names case-insensitively.
    const headers = {...sanitizeProxyRequestHeaders(body.headers || {}), ...providerHeaders};

    // Preserve Accept-Encoding from original request if not explicitly provided
    if (!headers['accept-encoding'] && req.headers['accept-encoding']) {
      headers['accept-encoding'] = req.headers['accept-encoding'];
    }

    // use proxy instead of direct request
    if (tenAiApiProxy) {
      const tenTokenEnableOutbox = ctx.getCfg('services.CoAuthoring.token.enable.request.outbox', cfgTokenEnableOutbox);
      if (tenTokenEnableOutbox) {
        const tenTokenOutboxHeader = ctx.getCfg('services.CoAuthoring.token.outbox.header', cfgTokenOutboxHeader);
        const tenTokenOutboxPrefix = ctx.getCfg('services.CoAuthoring.token.outbox.prefix', cfgTokenOutboxPrefix);
        const [licenseInfo] = await tenantManager.getTenantLicense(ctx);

        const dataObject = {
          key: docId,
          user: {
            id: userId,
            name: userName,
            customerId: userCustomerId || licenseInfo.customerId
          }
        };

        const secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Outbox);
        const auth = utils.fillJwtForRequest(ctx, dataObject, secret, false);
        headers[tenTokenOutboxHeader] = tenTokenOutboxPrefix + auth;
      }
      // Replace protocol, host and port in URI with proxy URL
      const proxyUrl = new URL(tenAiApiProxy);
      const targetUrl = new URL(uri);
      targetUrl.protocol = proxyUrl.protocol;
      targetUrl.host = proxyUrl.host;
      targetUrl.port = proxyUrl.port || targetUrl.port;
      uri = targetUrl.toString();
      ctx.logger.debug(`proxyRequest: Updated URI to use proxy host: ${tenAiApiProxy}`);
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
    const result = await utils.httpRequest(
      ctx, // Operation context
      requestParams.method, // HTTP method
      requestParams.uri, // Target URL
      requestParams.headers, // Request headers
      requestParams.body, // Request body
      requestParams.timeout, // Timeout configuration
      requestParams.limit, // Size limit
      requestParams.isInJwtToken, // Filter private requests
      {
        decompress: false
      }
    );

    // Sanitize upstream headers (drop Set-Cookie/hop-by-hop) before relaying to the editor origin.
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

    const result = await utils.httpRequest(
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

// Blank secret values inside the opaque v5 plugin settings blob before sending it to the browser; the server AI proxy injects real credentials.
function stripPluginSettingsSecrets(blob) {
  if (!blob || typeof blob !== 'object') {
    return blob;
  }
  // Blank per-profile API keys.
  if (Array.isArray(blob.profiles)) {
    for (const profile of blob.profiles) {
      if (profile && profile.key) {
        profile.key = '';
      }
    }
  }
  // Blank the web search provider key.
  if (blob.webSearch && blob.webSearch.key) {
    blob.webSearch.key = '';
  }
  // Blank MCP server header values; the proxy restores them from config on use.
  if (blob.mcpServers && typeof blob.mcpServers === 'object') {
    for (const id in blob.mcpServers) {
      const server = blob.mcpServers[id];
      if (server && server.headers && typeof server.headers === 'object') {
        for (const header in server.headers) {
          server.headers[header] = '';
        }
      }
    }
  }
  return blob;
}

async function getPluginSettingsForInterface(ctx) {
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
  getPluginSettings,
  getPluginSettingsForInterface,
  sanitizeProxyRequestHeaders,
  sanitizeProxyResponseHeaders,
  describeRequestError
};
