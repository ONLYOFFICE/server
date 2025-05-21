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

// Import the new aiEngineWrapper module
const aiEngineWrapper = require('./aiEngineWrapper');

const cfgAiApiAllowedOrigins = config.get('ai-api.allowedCorsOrigins');
const cfgAiApiTimeout = config.get('ai-api.timeout');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');

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

    if (tenTokenEnableBrowser) {
      let checkJwtRes = await docsCoServer.checkJwtHeader(ctx, req, 'Authorization', 'Bearer ', commonDefines.c_oAscSecretType.Session);
      if (checkJwtRes.err) {
        ctx.logger.error('checkJwtHeader error: %s', checkJwtRes.err);
        res.sendStatus(403);
        return;
      }
    }

    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let body = JSON.parse(req.body);

    // Configure timeout options for the request
    const timeoutOptions = {
      connectionAndInactivity: cfgAiApiTimeout,
      wholeCycle: cfgAiApiTimeout
    };
    
    // Get request size limit if configured
    const sizeLimit = 10 * 1024 * 1024; // Default to 10MB

    // Create a copy of the headers from the request
    const headers = { ...body.headers };
    
    // Get API key based on the target URL
    const aiApi = config.get('ai-api');
    let apiKey;
    
    // Determine which API key to use based on the target URL
    if (body.target) {
      // Find the provider that matches the target URL
      const matchedProvider = aiApi.providers.find(provider => 
        body.target.includes(provider.url));
      
      if (matchedProvider) {
        apiKey = matchedProvider.key;
      }
    }
    
    // Add authorization header if API key is available
    if (apiKey) {
      if (headers['x-api-key']) {
        headers['x-api-key'] = apiKey;
      } else if (body.target.includes('key=')) {
        body.target = body.target.replace('key=', `key=${apiKey}&`);
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    } else {
      throw new Error('No API key found for the target URL');
    }
    
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
    if(error.response){
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
 * Process AI actions from configuration
 * 
 * @param {Object} ctx - Operation context
 * @param {Object} actions - The actions from configuration
 * @returns {Object} Processed actions object
 */
function processActions(ctx, actions) {
  const logger = ctx.logger;
  
  if (!actions || typeof actions !== 'object') {
    return {};
  }
  
  try {
    const processedActions = Object.entries(actions).reduce((acc, [key, value]) => {
      if (value) {
        acc[key] = {
          name: value.name || key,
          icon: value.icon || '',
          model: value.model || '',
          capabilities: Array.isArray(value.capabilities) ? value.capabilities : []
        };
      }
      return acc;
    }, {});
    
    logger.info(`Processed ${Object.keys(processedActions).length} AI actions`);
    return processedActions;
  } catch (error) {
    logger.error('Error processing AI actions:', error);
    return {};
  }
}

/**
 * Process a single AI provider and its models
 * 
 * @param {Object} ctx - Operation context
 * @param {Object} provider - Provider configuration
 * @param {boolean} includeDisabled - Whether to include disabled models
 * @returns {Promise<Object|null>} Processed provider with models or null if provider is invalid
 */
async function processProvider(ctx, provider, includeDisabled) {
  const logger = ctx.logger;
  
  if (!provider.url || !provider.key) {
    return null;
  }
  let engineModels = [];
  try {
    if (provider.url && provider.key) {
      aiEngineWrapper.setCtx(ctx);
      // logger.info("processProvider %j", AI.Providers);
      aiEngineWrapper.AI.Providers[provider.name].key = provider.key;
      // Call getModels from engine.js
      const result = await aiEngineWrapper.AI.getModels(provider);
      logger.info(`Got ${JSON.stringify(result)} from AI.getModels for ${provider.name}`);
      // Process result
      if (!result.error && Array.isArray(result.models)) {
        engineModels = result.models;
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
    models: engineModels
  };
}

/**
 * Retrieves all AI models from the configuration and dynamically from providers
 * 
 * @param {Object} ctx - Operation context
 * @param {boolean} [includeDisabled=false] - Whether to include disabled providers in the result
 * @returns {Promise<Object>} Object containing providers and their models along with action configurations
 */
async function getPluginSettings(ctx, includeDisabled = false) {
  const logger = ctx.logger;
  logger.info('Starting getPluginSettings');
  const result = {
    actions: {},
    providers: {},
    models: []
  };
  try {
    // Get AI API configuration
    const aiApi = config.get('ai-api');
    // Process providers and their models if configuration exists
    if (aiApi?.providers && Array.isArray(aiApi.providers)) {
      // Create an array of promises for each provider
      const providerPromises = aiApi.providers
        .filter(provider => includeDisabled || provider.enable !== false || !provider.key || !provider.url)
        .map(provider => processProvider(ctx, provider, includeDisabled));
      
      try {
        let providers = await Promise.allSettled(providerPromises);
        providers = providers.filter(provider => provider.status === 'fulfilled' && provider.value && provider.value.name && provider.value.models?.length > 0);

        const providerCount = providers.length;
        let totalModels = 0;
        // Convert providers array to object by provider name
        result.providers = {};
        for(let i = 0; i < providers.length; i++) {
          const provider = providers[i].value;
          totalModels += provider.models.length;
          result.providers[provider.name] = provider
          result.models.push(...provider.models);
        }
        
        logger.info(`Successfully processed ${providerCount} providers with a total of ${totalModels} models`);
      } catch (error) {
        logger.error('Error resolving provider promises:', error);
      }
    }

    // Process AI actions
    if (aiApi?.actions && typeof aiApi.actions === 'object') {
      result.actions = processActions(ctx, aiApi.actions);
    }

    logger.info('Completed getPluginSettings successfully');
  } catch (error) {
    logger.error('Error retrieving AI models from config:', error);
  }
  return result;
}

module.exports = {
  proxyRequest,
  getPluginSettings
};
