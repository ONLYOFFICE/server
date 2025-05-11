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
const config = require('config');
const utils = require('../../Common/sources/utils');
const operationContext = require('./../../Common/sources/operationContext');

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
    // 1. Handle CORS preflight (OPTIONS) requests if necessary
    if (handleCorsHeaders(req, res, ctx) === true) {
      return; // OPTIONS request handled, stop further processing
    }

    let body = JSON.parse(req.body);

    // Configure timeout options for the request
    const timeoutOptions = {
      connectionAndInactivity: cfgAiApiTimeout || '30s',
      wholeCycle: cfgAiApiTimeout || '30s'
    };
    
    // Get request size limit if configured
    const sizeLimit = 10 * 1024 * 1024; // Default to 10MB

    // Create a copy of the headers from the request
    const headers = { ...body.headers };
    
    // Get API key from environment or configuration
    const aiApi = config.get('ai-api');
    const apiKey = aiApi.providers[0].key;
    
    // Add authorization header if API key is available
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
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
    if (safeLogParams.headers) {
      safeLogParams.headers = { ...safeLogParams.headers };
      if (safeLogParams.headers.Authorization) {
        safeLogParams.headers.Authorization = '[REDACTED]';
      }
    }
    
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
    ctx.logger.error(`AI API request error: %s`, error.stack);
    res.status(200).json({
      "error": {
        "message": "AI API request error",
        "code": "500"
      }
    });
  } finally {
    ctx.logger.info('End proxyRequest');
  }
}


module.exports = {
  proxyRequest
};
