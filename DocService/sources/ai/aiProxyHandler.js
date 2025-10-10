/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
function insertKeyToProvider(ctx, providerUrl, providerKey, uri, providerHeaders) {
  if (!providerKey) {
    return uri;
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

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let docId = '';
    let userId = '';
    let userName = '';
    let userCustomerId = '';
    const checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req, 'Authorization', 'Bearer ', commonDefines.c_oAscSecretType.Session);
    if (!checkJwtRes || checkJwtRes.err) {
      ctx.logger.error('proxyRequest: checkJwtHeader error: %s', checkJwtRes?.err);
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

    if (!tenAiApi?.providers) {
      ctx.logger.error('proxyRequest: No providers configured');
      res.status(403).json({
        error: {
          message: 'proxyRequest: No providers configured',
          code: '403'
        }
      });
      return;
    }

    const body = JSON.parse(req.body);
    let uri = body.target;

    const providerHeaders = {};
    let providerMatched = false;
    // Determine which API key to use based on the target URL
    if (uri) {
      for (const providerName in tenAiApi.providers) {
        const tenProvider = tenAiApi.providers[providerName];
        if (uri.startsWith(tenProvider.url)) {
          providerMatched = true;

          // Generate appropriate headers based on provider type
          uri = insertKeyToProvider(ctx, tenProvider.url, tenProvider.key, uri, providerHeaders);
          break;
        }
      }
    }

    // If body.target was provided but no provider was matched, return 403
    if (!providerMatched) {
      ctx.logger.warn(`proxyRequest: target '${uri}' does not match any configured AI provider. Denying access.`);
      res.status(403).json({
        error: {
          message: 'proxyRequest: target does not match any configured AI provider',
          code: '403'
        }
      });
      return;
    }

    // Merge key in headers
    const headers = {...body.headers, ...providerHeaders};

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

    // Log the sanitized request parameters
    ctx.logger.debug(`proxyRequest request: %j`, requestParams);

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

    // Set the response headers to match the target response
    res.set(result.response.headers);

    // Use pipeline to pipe the response data to the client
    await pipeline(result.stream, res);
    success = true;
  } catch (error) {
    ctx.logger.error(`proxyRequest: AI API request error: %s`, error);
    if (error.response) {
      // Set the response headers to match the target response
      res.set(error.response.headers);

      // Use pipeline to pipe the response data to the client
      await pipeline(error.response.data, res);
    } else {
      res.status(500).json({
        error: {
          message: 'proxyRequest: AI API request error',
          code: '500'
        }
      });
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
 * Retrieves all AI models from the configuration and dynamically from providers
 *
 * @param {operationContext.Context} ctx - Operation context
 * @returns {Promise<Object>} Object containing providers and their models along with action configurations
 */
async function getPluginSettings(ctx) {
  return {
    version: 3,
    actions: ctx.getCfg('aiSettings.actions', cfgAiSettings.actions),
    providers: ctx.getCfg('aiSettings.providers', cfgAiSettings.providers),
    customProviders: ctx.getCfg('aiSettings.customProviders', cfgAiSettings.customProviders),
    models: ctx.getCfg('aiSettings.models', cfgAiSettings.models)
  };
}

async function getPluginSettingsForInterface(ctx) {
  let pluginSettings = await getPluginSettings(ctx);
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
  //remove keys from providers - create deep copy to avoid modifying cached config
  if (pluginSettings?.providers) {
    for (const key in pluginSettings.providers) {
      if (pluginSettings.providers[key]?.key) {
        pluginSettings.providers[key] = JSON.parse(JSON.stringify(pluginSettings.providers[key]));
        pluginSettings.providers[key].key = '';
      }
    }
  }
  return pluginSettings;
}

module.exports = {
  proxyRequest,
  getPluginSettings,
  getPluginSettingsForInterface
};
