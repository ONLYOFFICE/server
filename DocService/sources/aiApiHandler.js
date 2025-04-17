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
const utils = require('../../Common/sources/utils');

const operationContext = require('./../../Common/sources/operationContext');

let cfgAiApiEndpoint;
let cfgAiApiTimeout;
let cfgAiApiKeyFromConfig; // Store potentially configured key
let cfgAiApiAllowedOrigins = []; // Will remain empty if CORS is disabled

try {
  // Load endpoint and timeout from config
  cfgAiApiEndpoint = config.get('services.AiApi.endpoint');
  cfgAiApiTimeout = config.get('services.AiApi.timeout');

  // Attempt to load key from config as a fallback
  if (config.has('services.AiApi.key')) {
    cfgAiApiKeyFromConfig = config.get('services.AiApi.key');
  }

  // Load CORS configuration (simplified)
  try {
    const origins = config.get('services.AiApi.allowedCorsOrigins');
    if (Array.isArray(origins) && origins.length > 0) {
      cfgAiApiAllowedOrigins = origins;
      console.info('AI API Manual CORS: Allowed origins loaded:', cfgAiApiAllowedOrigins.join(', '));
    } else {
      console.warn('AI API CORS: allowedCorsOrigins exists but is empty or not an array');
    }
  } catch (corsError) {
    // If key doesn't exist, CORS is implicitly disabled (empty array)
    console.info('AI API Manual CORS: No allowedCorsOrigins configured');
  }
} catch (e) {
  // Use console.error here as logger/context might not be fully initialized
  console.error('AI API endpoint/timeout configuration is missing or incomplete in config: %s', e.message);
}

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
 * Proxy handler for AI API requests
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<void>} - Promise resolving when the request is complete
 */
async function aiApiProxy(req, res) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  
  // Handle CORS headers if needed
  if (handleCorsHeaders(req, res, ctx) === true) {
    // If this was an OPTIONS preflight request that's been handled, we're done
    return;
  }

  try {
    // Prioritize Environment Variable, then fallback to Config
    const apiKey = process.env.AI_API_KEY || cfgAiApiKeyFromConfig;

    // Check if AI API configuration is available (API Key + Endpoint)
    if (!apiKey || !cfgAiApiEndpoint) {
      const missingConfig = [];
      if (!apiKey) missingConfig.push('AI_API_KEY environment variable OR services.AiApi.key in config');
      if (!cfgAiApiEndpoint) missingConfig.push('services.AiApi.endpoint in config');
      
      const errorMessage = `AI API configuration is incomplete. Missing: ${missingConfig.join(', ')}`;
      ctx.logger.error(errorMessage);
      return res.status(500).json({
        error: 'AI API configuration is incomplete',
        details: errorMessage
      });
    }

    // Simply extract the target endpoint from the original path and query string
    const parsedUrl = new URL(req.originalUrl, 'http://placeholder.com');
    const pathWithoutPrefix = parsedUrl.pathname.replace(/^\/ai-api\/?/, '');
    
    // Initial construction of target URL
    let targetUrl = `${cfgAiApiEndpoint}/${pathWithoutPrefix}${parsedUrl.search}`;
    
    // Create a fresh headers object with normalized keys
    const headers = {};
    
    // Copy headers with normalized keys (lowercase)
    // This prevents duplicate headers with different casing
    Object.keys(req.headers).forEach(key => {
      // Skip authorization headers - we'll set our own
      if (key.toLowerCase() !== 'authorization') {
        headers[key.toLowerCase()] = req.headers[key];
      }
    });
    
    // Configure provider-specific auth headers and URL modifications
    targetUrl = configureProviderAuth(headers, cfgAiApiEndpoint, apiKey, targetUrl, parsedUrl);
    
    // Ensure we have a Content-Type if not provided
    if (!headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    
    // Log request headers for debugging (filtering sensitive data)
    let filteredReqHeaders = {};
    Object.entries(headers).forEach(([key, value]) => {
      filteredReqHeaders[key] = key.toLowerCase().includes('key') || 
                                key.toLowerCase().includes('auth') ? 
                                '[REDACTED]' : value;
    });
    filteredReqHeaders = headers;
    ctx.logger.debug('AI API request headers: %s', JSON.stringify(filteredReqHeaders));
    
    // Remove problematic headers that could interfere with the request
    const headersToRemove = ['host', 'connection', 'referer', 'origin'];
    headersToRemove.forEach(header => {
      delete headers[header];
    });
    
    // Set a proper referer that matches the target API
    headers['referer'] = cfgAiApiEndpoint;

    // Log the request (without sensitive information)
    ctx.logger.debug('AI API proxy request to: %s', targetUrl);
    
    // Use timeout from config (loaded globally) or default
    const timeout = cfgAiApiTimeout || 30000;

    // Log request (without sensitive information)
    ctx.logger.debug('AI API proxy request: %s %s', req.method, targetUrl);

    
    // Build the request options
    const axiosOptions = {
      method: req.method,
      url: targetUrl,
      headers: headers,
      timeout: timeout,
      responseType: 'stream',
      maxBodyLength: Infinity, // Allow larger payloads
      maxContentLength: Infinity, // Allow larger responses
      // Add validateStatus to treat 4xx responses as successful promises
      // This allows handling 4xx responses in the main try block rather than catch
      validateStatus: (status) => status < 500
    };
    
    // Only include the body for non-GET requests
    // OpenAI will reject GET requests with a body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      axiosOptions.data = req.body;
    }
    
    // Forward the request to the AI API
    const response = await utils.axios(axiosOptions);
    


    // Handle CORS headers before setting response headers (prioritize our CORS settings)
    handleCorsHeaders(req, res, ctx, false);
    
    // Set status code from the response
    res.status(response.status);
    
    // Log response status and headers for debugging
    ctx.logger.debug('AI API response status: %s', response.status);
    
    // Log response headers (filtering sensitive data)
    const filteredResHeaders = {};
    Object.entries(response.headers).forEach(([key, value]) => {
      filteredResHeaders[key] = key.toLowerCase().includes('key') || 
                                key.toLowerCase().includes('auth') || 
                                key.toLowerCase().includes('cookie') ? 
                                '[REDACTED]' : value;
    });
    ctx.logger.debug('AI API response headers: %s', JSON.stringify(filteredResHeaders));
    
    // Set response headers (except those that would override CORS headers we've already set)
    Object.entries(response.headers).forEach(([key, value]) => {
      // Skip headers that would override our CORS settings
      const lowerKey = key.toLowerCase();
      if (!lowerKey.startsWith('access-control-')) {
        res.setHeader(key, value);
      }
    });
    

    // Send the response using stream pipeline for proper error handling
    await pipeline(response.data, res);
  } catch (error) {
    ctx.logger.error('AI API proxy error: %s', error.stack);
    
    // Ensure CORS headers are set on error responses too
    if (!res.headersSent) {
      handleCorsHeaders(req, res, ctx, false); // Don't handle OPTIONS here
    }

    if (error.response) {
      res.status(error.response.status).json({
        error: 'AI API request failed',
        details: error.response.data
      });
    } else if (error.request) {
      // The request was made but no response was received
      res.status(502).json({
        error: 'No response from AI API'
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      res.status(500).json({
        error: 'Failed to process AI API request',
        message: error.message
      });
    }
  }
}

/**
 * Configures authentication headers and URL for different AI API providers
 * 
 * @param {object} headers - Headers object to be modified with authentication information
 * @param {string} endpoint - The base API endpoint URL
 * @param {string} apiKey - The API key to use for authentication
 * @param {string} targetUrl - The target URL for the request
 * @param {URL} parsedUrl - The parsed original URL object
 * @returns {string} - The potentially modified target URL
 */
function configureProviderAuth(headers, endpoint, apiKey, targetUrl, parsedUrl) {
  // Try to determine the provider from different sources
  
  // Check the endpoint domain as fallback
  const lowerEndpoint = endpoint.toLowerCase();
  
  // Initialize provider detection
  let provider = null;
  
  // If still no provider detected or generic, fall back to endpoint detection
  if (!provider || provider === 'generic') {
    if (lowerEndpoint.includes('anthropic.com')) {
      provider = 'anthropic';
    } else if (lowerEndpoint.includes('claude.ai')) {
      provider = 'claude';
    } else if (lowerEndpoint.includes('api.mistral.ai')) {
      provider = 'mistral';
    } else if (lowerEndpoint.includes('api.together.xyz')) {
      provider = 'together';
    } else if (lowerEndpoint.includes('api.cohere.ai')) {
      provider = 'cohere';
    } else if (lowerEndpoint.includes('api.perplexity.ai')) {
      provider = 'perplexity';
    } else if (lowerEndpoint.includes('api.groq.com')) {
      provider = 'groq';
    } else if (lowerEndpoint.includes('api.stability.ai')) {
      provider = 'stability';
    } else if (lowerEndpoint.includes('generativelanguage.googleapis.com')) {
      provider = 'google';
    } else if (lowerEndpoint.includes('api.aleph-alpha.com')) {
      provider = 'aleph-alpha';
    } else {
      // Default to OpenAI if nothing else detected
      provider = 'openai';
    }
  }
  
  // Log detected provider
  // Using ctx would be better but we don't have access to it here
  // This will be visible in the server logs
  
  // Apply authentication based on detected provider
  switch (provider.toLowerCase()) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      // Don't override anthropic-version if it already exists in the request
      if (!headers['anthropic-version']) {
        headers['anthropic-version'] = '2023-06-01'; // Default value if not provided
      }
      break;
      
    case 'claude':
      headers['x-api-key'] = apiKey;
      break;
      
    case 'google':
      const separator = parsedUrl.search ? '&' : '?';
      return `${targetUrl}${separator}key=${apiKey}`;
      
    case 'mistral':
    case 'together':
    case 'cohere':
    case 'perplexity':
    case 'groq':
    case 'stability':
    case 'aleph-alpha':
    case 'openai':
    default:
      // Use Bearer token format for these providers
      headers['authorization'] = `Bearer ${apiKey}`;
      break;
  }
  
  return targetUrl;
}

/**
 * Express middleware to handle AI API requests
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function aiApiHandler(req, res, next) {
  aiApiProxy(req, res).catch(next);
}

module.exports = {
  aiApiHandler
};
