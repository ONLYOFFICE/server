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

// Import the new aiEngine module
const aiEngine = require('./aiEngineWrapper');

const cfgAiApiAllowedOrigins = config.get('aiSettings.allowedCorsOrigins');
const cfgAiApiProxy = config.get('aiSettings.proxy');
const cfgAiApiTimeout = config.get('aiSettings.timeout');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgTokenEnableOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgTokenOutboxHeader = config.get('services.CoAuthoring.token.outbox.header');
const cfgTokenOutboxPrefix = config.get('services.CoAuthoring.token.outbox.prefix');
const cfgAiSettings = config.get('aiSettings');

const AI = aiEngine.AI;
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
 * Appends API key to the request URI if the provider passes it as a query parameter.
 *
 * @param {operationContext.Context} ctx - The operation context for logging.
 * @param {object} provider - The AI provider configuration.
 * @param {string} uri - The original request URI.
 * @returns {string} The updated URI with API key as a query parameter, if applicable.
 */
function appendApiKeyToQuery(ctx, provider, uri) {
  const urlWithKey = AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.Models);

  // To check if the key is part of the query, we get the URL without the key.
  const originalKey = provider.key;
  provider.key = undefined;
  const urlWithoutKey = AI._getEndpointUrl(provider, AI.Endpoints.Types.v1.Models);
  provider.key = originalKey; // Restore the key on the provider object.

  if (urlWithKey !== urlWithoutKey) {
    try {
      const parsedUrlWithKey = new URL(urlWithKey);
      if (parsedUrlWithKey.search) {
        const parsedUri = new URL(uri);
        for (const [key, value] of parsedUrlWithKey.searchParams) {
          if (originalKey === value) {
            parsedUri.searchParams.set(key, value);
            break;
          }
        }
        ctx.logger.debug(`appendApiKeyToQuery: Appended API key to URI for provider ${provider.name}`);
        return parsedUri.toString();
      }
    } catch (error) {
      ctx.logger.error(`appendApiKeyToQuery: Failed to parse provider URL for ${provider.name}: ${urlWithKey}`, error);
    }
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
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenAiApiTimeout = ctx.getCfg('aiSettings.timeout', cfgAiApiTimeout);
    const tenAiApi = ctx.getCfg('aiSettings', cfgAiSettings);
    const tenAiApiProxy = ctx.getCfg('aiSettings.proxy', cfgAiApiProxy);

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let docId = '';
    let userId = '';
    if (tenTokenEnableBrowser) {
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
        userId = checkJwtRes?.decoded?.editorConfig?.user?.id;
        docId = checkJwtRes?.decoded?.document?.key;
        ctx.setDocId(docId);
        ctx.setUserId(userId);
      }
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

    let providerHeaders;
    let providerMatched = false;
    // Determine which API key to use based on the target URL
    if (uri) {
      for (const providerName in tenAiApi.providers) {
        const tenProvider = tenAiApi.providers[providerName];
        if (uri.startsWith(tenProvider.url) && AI.Providers[tenProvider.name]) {
          providerMatched = true;
          const provider = AI.Providers[tenProvider.name];
          provider.key = tenProvider.key;
          provider.url = tenProvider.url;
          providerHeaders = AI._getHeaders(provider);

          uri = appendApiKeyToQuery(ctx, provider, uri);
          break;
        }
      }
    }
    // If body.target was provided but no provider was matched, return 403
    if (!providerHeaders) {
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
          user: userId,
          customer_id: licenseInfo.customerId
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
      requestParams.isInJwtToken // Filter private requests
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
 * Process a single AI provider and its models
 *
 * @param {operationContext.Context} ctx - Operation context
 * @param {Object} provider - Provider configuration
 * @returns {Promise<Object|null>} Processed provider with models or null if provider is invalid
 */
async function processProvider(ctx, provider) {
  const logger = ctx.logger;

  if (!provider.url) {
    return null;
  }
  const engineModels = [];
  const engineModelsUI = [];
  try {
    // Call getModels from engine.js
    if (provider.key && AI.Providers[provider.name]) {
      AI.Providers[provider.name].key = provider.key;
      // aiEngine.setCtx(ctx);
      // await AI.getModels(provider);
      // // Process result
      // if (AI.TmpProviderForModels?.models) {
      //   engineModels = AI.TmpProviderForModels.models;
      //   engineModelsUI = AI.TmpProviderForModels.modelsUI;
      // }
    }
  } catch (error) {
    logger.error(`Error processing provider ${provider.name}:`, error);
  }
  // Return provider with any models we were able to get from config
  return {
    name: provider.name,
    url: provider.url,
    key: '',
    models: engineModels,
    modelsUI: engineModelsUI
  };
}

/**
 * Retrieves all AI models from the configuration and dynamically from providers
 *
 * @param {operationContext.Context} ctx - Operation context
 * @returns {Promise<Object>} Object containing providers and their models along with action configurations
 */
async function getPluginSettings(ctx) {
  const logger = ctx.logger;
  logger.info('Starting getPluginSettings');
  const result = {
    version: 3,
    actions: {},
    providers: {},
    models: [],
    customProviders: {}
  };
  try {
    // Get AI API configuration
    const tenProviders = ctx.getCfg('aiSettings.providers', cfgAiSettings.providers);
    // Process providers and their models if configuration exists
    if (tenProviders && Object.keys(tenProviders).length > 0) {
      result.providers = tenProviders;
    } else {
      const providers = AI.serializeProviders();
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        // const cfgProvider = aiApi.providers[provider.name];
        // if (cfgProvider) {
        //   //todo clone
        //   provider.key = cfgProvider.key;
        // }

        try {
          const providerProcessed = await processProvider(ctx, provider);
          provider.models.push(...providerProcessed.models);
        } catch (error) {
          logger.warn('Error processing provider:', error);
        }

        result.providers[provider.name] = provider;
      }
    }
    const tenModels = ctx.getCfg('aiSettings.models', cfgAiSettings.models);
    // Process AI actions
    if (tenModels && tenModels.length > 0) {
      result.models = tenModels;
    } else {
      // result.actions = aiApi.actions;
      result.models = AI.Storage.serializeModels();
    }

    // Process AI actions
    const tenActions = ctx.getCfg('aiSettings.actions', cfgAiSettings.actions);
    if (tenActions && Object.keys(tenActions).length > 0) {
      result.actions = tenActions;
    } else {
      // result.actions = aiApi.actions;
      const actionSoted = AI.ActionsGetSorted();
      result.actions = {};
      for (let i = 0; i < actionSoted.length; i++) {
        const action = actionSoted[i];
        result.actions[action.id] = action;
      }
    }
    const tenVersion = ctx.getCfg('aiSettings.version', cfgAiSettings.version);
    result.version = tenVersion;
  } catch (error) {
    logger.error('Error retrieving AI models from config:', error);
  } finally {
    logger.info('Completed getPluginSettings');
  }
  return result;
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
  //remove keys from providers
  if (pluginSettings && pluginSettings.providers) {
    for (const key in pluginSettings.providers) {
      pluginSettings.providers[key].key = '';
    }
  }
  return pluginSettings;
}

async function requestSettings(req, res) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  try {
    await ctx.initTenantCache();
    const result = await getPluginSettings(ctx);
    res.json(result);
  } catch (error) {
    ctx.logger.error('getSettings error: %s', error.stack);
    res.sendStatus(400);
  }
}

async function requestModels(req, res) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  try {
    await ctx.initTenantCache();
    const body = JSON.parse(req.body);
    if (AI.Providers[body.name]) {
      AI.Providers[body.name].key = body.key;
      AI.Providers[body.name].url = body.url;
    }
    const getRes = await AI.getModels(body);
    getRes.modelsApi = AI.TmpProviderForModels?.models;
    res.json(getRes);
  } catch (error) {
    ctx.logger.error('getModels error: %s', error.stack);
    res.sendStatus(400);
  }
}

module.exports = {
  proxyRequest,
  getPluginSettings,
  getPluginSettingsForInterface,
  requestSettings,
  requestModels
};
