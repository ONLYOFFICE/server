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

const { pipeline } = require('stream/promises');
const { buffer } = require('node:stream/consumers');
const config = require('config');
const utils = require('./../../../Common/sources/utils');
const operationContext = require('./../../../Common/sources/operationContext');
const commonDefines = require('./../../../Common/sources/commondefines');
const docsCoServer = require('./../DocsCoServer');

// Import the new aiEngine module
const aiEngine = require('./aiEngineWrapper');

const cfgAiApiAllowedOrigins = config.get('aiSettings.allowedCorsOrigins');
const cfgAiApiTimeout = config.get('aiSettings.timeout');
const cfgAiApiCache = config.get('aiSettings.cache');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgAiSettings = config.get('aiSettings');

const AI = aiEngine.AI;
const nodeCache = new utils.NodeCache(cfgAiApiCache);
/**
 * Helper function to set CORS headers if the request origin is allowed
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} ctx - Operation context for logging
 * @param {boolean} handleOptions - Whether to handle OPTIONS requests (default: true) 
 * @returns {boolean} - True if this was an OPTIONS request that was handled
 */
function handleCorsHeaders(req, res, ctx, handleOptions = true) {
  const requestOrigin = req.headers.origin;
  
  // If no origin in request or allowed origins list is empty, do nothing
  if (!requestOrigin || cfgAiApiAllowedOrigins.length === 0) {
    return false;
  }
  
  // If the origin is in our allowed list
  if (cfgAiApiAllowedOrigins.includes(requestOrigin)) {
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

  try {
    ctx.logger.info('Start proxyRequest');
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenAiApi = ctx.getCfg('aiSettings', cfgAiSettings);

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    if (tenTokenEnableBrowser) {
      let checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req, 'Authorization', 'Bearer ', commonDefines.c_oAscSecretType.Session);
      if (!checkJwtRes || checkJwtRes.err) {
        ctx.logger.error('checkJwtHeader error: %s', checkJwtRes?.err);
        res.sendStatus(403);
        return;
      }
    }

    let body = JSON.parse(req.body);

    // Configure timeout options for the request
    const timeoutOptions = {
      connectionAndInactivity: cfgAiApiTimeout,
      wholeCycle: cfgAiApiTimeout
    };
    
    // Get request size limit if configured
    const sizeLimit = 10 * 1024 * 1024; // Default to 10MB

    
    let providerHeaders;
    // Determine which API key to use based on the target URL
    if (body.target) {
      // Find the provider that matches the target URL
      for (let providerName in AI.Providers) {//todo try for of
        if (body.target.includes(AI.Providers[providerName].url)) {
          if (tenAiApi?.providers?.[providerName]) {
            AI.Providers[providerName].key = tenAiApi.providers[providerName].key;
            AI.Providers[providerName].url = tenAiApi.providers[providerName].url;
          }
          providerHeaders = AI._getHeaders(AI.Providers[providerName]);
          break;
        }
      }
    }
    // Merge key in headers
    const headers = { ...body.headers, ...providerHeaders };

    // Create request parameters object
    const requestParams = {
      method: body.method,
      uri: body.target,
      headers,
      body: body.data,
      timeout: timeoutOptions,
      limit: sizeLimit,
      filterPrivate: false
    };
    
    // Create a safe copy for logging without sensitive info
    const safeLogParams = { ...requestParams };
    // if (safeLogParams.headers) {
    //   safeLogParams.headers = { ...safeLogParams.headers };
    //   if (safeLogParams.headers.Authorization) {
    //     safeLogParams.headers.Authorization = '[REDACTED]';
    //   }
    // }
    
    // Log the sanitized request parameters
    ctx.logger.debug(`Proxying request: %j`, safeLogParams);
    
    // Use utils.httpRequest to make the request
    const result = await utils.httpRequest(
      ctx,                   // Operation context
      requestParams.method,  // HTTP method
      requestParams.uri,     // Target URL
      requestParams.headers, // Request headers
      requestParams.body,    // Request body
      requestParams.timeout, // Timeout configuration
      requestParams.limit,   // Size limit
      requestParams.filterPrivate // Filter private requests
    );
    
    // Set the response headers to match the target response
    res.set(result.response.headers);

    // Use pipeline to pipe the response data to the client
    await pipeline(result.stream, res);

  } catch (error) {
    ctx.logger.error(`AI API request error: %s`, error);
    if (error.response){
      // Set the response headers to match the target response
      res.set(error.response.headers);

      // Use pipeline to pipe the response data to the client
      await pipeline(error.response.data, res);
    } else {
      res.status(500).json({
        "error": {
          "message": "AI API request error",
          "code": "500"
        }
      });
    }
  } finally {
    ctx.logger.info('End proxyRequest');
  }
}

/**
 * Process a single AI provider and its models
 * 
 * @param {Object} ctx - Operation context
 * @param {Object} provider - Provider configuration
 * @returns {Promise<Object|null>} Processed provider with models or null if provider is invalid
 */
async function processProvider(ctx, provider) {
  const logger = ctx.logger;
  
  if (!provider.url) {
    return null;
  }
  let engineModels = [];
  let engineModelsUI = [];
  try {
    // Call getModels from engine.js
    if (provider.key) {
      AI.Providers[provider.name].key = provider.key;
      aiEngine.setCtx(ctx);
      await AI.getModels(provider);
      // Process result
      if (AI.TmpProviderForModels?.models) {
        engineModels = AI.TmpProviderForModels.models;
        engineModelsUI = AI.TmpProviderForModels.modelsUI;
      }
    }
  } catch (error) {
    logger.error(`Error processing provider ${provider.name}:`, error);
  }
  // Return provider with any models we were able to get from config
  return {
    name: provider.name,
    url: provider.url,
    key: "",
    models: engineModels,
    modelsUI: engineModelsUI
  };
}

/**
 * Retrieves all AI models from the configuration and dynamically from providers
 * 
 * @param {Object} ctx - Operation context
 * @returns {Promise<Object>} Object containing providers and their models along with action configurations
 */
async function getPluginSettings(ctx) {
  const logger = ctx.logger;
  logger.info('Starting getPluginSettings');
  let res = nodeCache.get(ctx.tenant);
  if (res) {
    ctx.logger.debug('getPluginSettings from cache');
    return res;
  }
  const result = {
    version: 3,
    actions: {},
    providers: {},
    models: [],
    customProviders: {}
  };
  try {
    // Get AI API configuration
    const tenAiApi = ctx.getCfg('aiSettings', cfgAiSettings);
    return tenAiApi;
    // Process providers and their models if configuration exists
    if (aiApi?.providers && typeof aiApi.providers === 'object') {
      const providers = AI.serializeProviders();
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const cfgProvider = aiApi.providers[provider.name];
        if (cfgProvider) {
          //todo clone
          provider.key = cfgProvider.key;
        }

        try {
          const providerProcessed = await processProvider(ctx, provider);
          provider.models.push(...providerProcessed.models);
        } catch (error) {
          logger.warn('Error processing provider:', error);
        }

        result.providers[provider.name] = provider;
      }
    }
    // Process AI actions
    if (aiApi?.models && typeof aiApi.models === 'object') {
      // result.actions = aiApi.actions;
      result.models = AI.Storage.serializeModels();
    }

    // Process AI actions
    if (aiApi?.actions && typeof aiApi.actions === 'object') {
      // result.actions = aiApi.actions;
      const actionSoted = AI.ActionsGetSorted();
      result.actions = {};
      for (let i = 0; i < actionSoted.length; i++) {
        const action = actionSoted[i];
        result.actions[action.id] = action;
      }
    }
    result.version = aiApi.version;
    nodeCache.set(ctx.tenant, result);
  } catch (error) {
    logger.error('Error retrieving AI models from config:', error);
  }
  finally {
    logger.info('Completed getPluginSettings');
  }
  return result;
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
    let body = JSON.parse(req.body);
    if (AI.Providers[body.name]) {
      AI.Providers[body.name].key = body.key;
      AI.Providers[body.name].url = body.url;
    }
    let getRes = await AI.getModels(body);
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
  requestSettings,
  requestModels
};
