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

//Fix EPROTO error in node 8.x at some web sites(https://github.com/nodejs/node/issues/21513)
require("tls").DEFAULT_ECDH_CURVE = "auto";

const { pipeline } = require('node:stream/promises');
const { buffer } = require('node:stream/consumers');
const { Transform } = require('stream');
var config = require('config');
var fs = require('fs');
const fsPromises = require('node:fs/promises');
var path = require('path');
const crypto = require('crypto');
var url = require('url');
var axios = require('../node_modules/axios/dist/node/axios.cjs');
var co = require('co');
var URI = require("uri-js-replace");
const escapeStringRegexp = require('escape-string-regexp');
const ipaddr = require('ipaddr.js');
const getDnsCache = require('dnscache');
const jwt = require('jsonwebtoken');
const NodeCache = require( "node-cache" );
const ms = require('ms');
const constants = require('./constants');
const commonDefines = require('./commondefines');
const forwarded = require('forwarded');
const { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } = require("request-filtering-agent");
const https = require('https');
const http = require('http');
const ca = require('win-ca/api');
const util = require('util');

const contentDisposition = require('content-disposition');
const operationContext = require("./operationContext");

//Clone sealed config objects before passing to external libraries using config.util.cloneDeep
const cfgDnsCache = config.util.cloneDeep(config.get('dnscache'));
const cfgIpFilterRules = config.get('services.CoAuthoring.ipfilter.rules');
const cfgIpFilterErrorCode = config.get('services.CoAuthoring.ipfilter.errorcode');
const cfgIpFilterUseForRequest = config.get('services.CoAuthoring.ipfilter.useforrequest');
const cfgExpPemStdTtl = config.get('services.CoAuthoring.expire.pemStdTTL');
const cfgExpPemCheckPeriod = config.get('services.CoAuthoring.expire.pemCheckPeriod');
const cfgTokenOutboxHeader = config.get('services.CoAuthoring.token.outbox.header');
const cfgTokenOutboxPrefix = config.get('services.CoAuthoring.token.outbox.prefix');
const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgVisibilityTimeout = config.get('queue.visibilityTimeout');
const cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
const cfgRequestDefaults = config.util.cloneDeep(config.get('services.CoAuthoring.requestDefaults'));
const cfgTokenEnableRequestOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgTokenOutboxUrlExclusionRegex = config.get('services.CoAuthoring.token.outbox.urlExclusionRegex');
const cfgSecret = config.get('aesEncrypt.secret');
const cfgAESConfig = config.util.cloneDeep(config.get('aesEncrypt.config'));
const cfgRequesFilteringAgent = config.get('services.CoAuthoring.request-filtering-agent');
const cfgStorageExternalHost = config.get('storage.externalHost');
const cfgExternalRequestDirectIfIn = config.get('externalRequest.directIfIn');
const cfgExternalRequestAction = config.get('externalRequest.action');
const cfgWinCa = config.util.cloneDeep(config.get('win-ca'));

ca(cfgWinCa);

const minimumIterationsByteLength = 4;
const dnscache = getDnsCache(cfgDnsCache);

var ANDROID_SAFE_FILENAME = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._-+,@£$€!½§~\'=()[]{}0123456789';

//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
BigInt.prototype.toJSON = function() { return this.toString() };

var g_oIpFilterRules = new Map();
function getIpFilterRule(address) {
  let exp = g_oIpFilterRules.get(address);
  if (!exp) {
    const regExpStr = address.split('*').map(escapeStringRegexp).join('.*');
    exp = new RegExp('^' + regExpStr + '$', 'i');
    g_oIpFilterRules.set(address, exp);
  }
  return exp;
}
const pemfileCache = new NodeCache({stdTTL: ms(cfgExpPemStdTtl) / 1000, checkperiod: ms(cfgExpPemCheckPeriod) / 1000, errorOnMissing: false, useClones: true});

exports.getConvertionTimeout = function(opt_ctx) {
  if (opt_ctx) {
    const tenVisibilityTimeout = opt_ctx.getCfg('queue.visibilityTimeout', cfgVisibilityTimeout);
    const tenQueueRetentionPeriod = opt_ctx.getCfg('queue.retentionPeriod', cfgQueueRetentionPeriod);
    return 1.5 * (tenVisibilityTimeout + tenQueueRetentionPeriod) * 1000;
  } else {
    return 1.5 * (cfgVisibilityTimeout + cfgQueueRetentionPeriod) * 1000;
  }
}

exports.addSeconds = function(date, sec) {
  date.setSeconds(date.getSeconds() + sec);
};
exports.getMillisecondsOfHour = function(date) {
  return (date.getUTCMinutes() * 60 +  date.getUTCSeconds()) * 1000 + date.getUTCMilliseconds();
};
exports.encodeXml = function(value) {
	return value.replace(/[<>&'"\r\n\t\xA0]/g, (c) => {
		switch (c) {
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '&': return '&amp;';
			case '\'': return '&apos;';
			case '"': return '&quot;';
			case '\r': return '&#xD;';
			case '\n': return '&#xA;';
			case '\t': return '&#x9;';
			case '\xA0': return '&#xA0;';
		}
	});
};
function fsStat(fsPath) {
  return new Promise((resolve, reject) => {
    fs.stat(fsPath, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  });
}
exports.fsStat = fsStat;
function fsReadDir(fsPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(fsPath, (err, list) => {
      if (err) {
        return reject(err);
      } else {
        resolve(list);
      }
    });
  });
}
function* walkDir(fsPath, results, optNoSubDir, optOnlyFolders) {
  const list = yield fsReadDir(fsPath);
  for (let i = 0; i < list.length; ++i) {
    const file = path.join(fsPath, list[i]);
    let stats;
    try {
      stats = yield fsStat(file);
    } catch (e) {
      //exception if fsPath not exist
      stats = null;
    }
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
      if (optNoSubDir) {
        optOnlyFolders && results.push(file);
      } else {
        yield* walkDir(file, results, optNoSubDir, optOnlyFolders);
      }
    } else {
      !optOnlyFolders && results.push(file);
    }
  }
}
exports.listFolders = function(fsPath, optNoSubDir) {
  return co(function* () {
    let stats, list = [];
    try {
      stats = yield fsStat(fsPath);
    } catch (e) {
      //exception if fsPath not exist
      stats = null;
    }
    if (stats && stats.isDirectory()) {
        yield* walkDir(fsPath, list, optNoSubDir, true);
    }
    return list;
  });
};
exports.listObjects = function(fsPath, optNoSubDir) {
  return co(function* () {
    let stats, list = [];
    try {
      stats = yield fsStat(fsPath);
    } catch (e) {
      //exception if fsPath not exist
      stats = null;
    }
    if (stats) {
      if (stats.isDirectory()) {
        yield* walkDir(fsPath, list, optNoSubDir, false);
      } else {
        list.push(fsPath);
      }
    }
    return list;
  });
};
exports.sleep = function(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
exports.readFile = function(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
function getContentDisposition (opt_filename, opt_useragent, opt_type) {
  const type = opt_type || constants.CONTENT_DISPOSITION_ATTACHMENT;
  return contentDisposition(opt_filename, {type});
}
exports.getContentDisposition = getContentDisposition;

function isAllowDirectRequest(ctx, uri, isInJwtToken) {
  let res = false;
  const tenExternalRequestDirectIfIn = ctx.getCfg('externalRequest.directIfIn', cfgExternalRequestDirectIfIn);
  const allowList = tenExternalRequestDirectIfIn.allowList;
  if (allowList.length > 0) {
    const allowIndex = allowList.findIndex((allowPrefix) => {
      return uri.startsWith(allowPrefix);
    }, uri);
    res = -1 !== allowIndex;
    ctx.logger.debug("isAllowDirectRequest check allow list res=%s", res);
  } else if (tenExternalRequestDirectIfIn.jwtToken) {
    res = isInJwtToken;
    ctx.logger.debug("isAllowDirectRequest url in jwt token res=%s", res);
  }
  return res;
}
function addExternalRequestOptions(ctx, uri, isInJwtToken, options, httpAgentOptions, httpsAgentOptions) {
  let res = false;
  const tenExternalRequestAction = ctx.getCfg('externalRequest.action', cfgExternalRequestAction);
  const tenRequestFilteringAgent = ctx.getCfg('services.CoAuthoring.request-filtering-agent', cfgRequesFilteringAgent);
  if (isAllowDirectRequest(ctx, uri, isInJwtToken)) {
    res = true;
  } else if (tenExternalRequestAction.allow) {
    res = true;
    if (tenExternalRequestAction.blockPrivateIP) {
      options.httpsAgent = new RequestFilteringHttpsAgent({
        ...httpsAgentOptions,
        ...tenRequestFilteringAgent
      });
      options.httpAgent = new RequestFilteringHttpAgent({
        ...httpAgentOptions,
        ...tenRequestFilteringAgent
      });
    }
    if (tenExternalRequestAction.proxyUrl) {
      const proxyUrl = tenExternalRequestAction.proxyUrl;
      const parsedProxyUrl = url.parse(proxyUrl);

      options.proxy = {
        host: parsedProxyUrl.hostname,
        port: parsedProxyUrl.port,
        protocol: parsedProxyUrl.protocol
      };
    }

    if (tenExternalRequestAction.proxyUser?.username) {
      //This will set an `Proxy-Authorization` header, overwriting any existing
      //`Proxy-Authorization` custom headers you have set using `headers`.
      options.proxy.auth = tenExternalRequestAction.proxyUser;
    }
    if (tenExternalRequestAction.proxyHeaders) {
      options.headers = {
        ...options.headers,
        ...tenExternalRequestAction.proxyHeaders
      };
    }
  }
  return res;
}
/*
 * @param {object} options - The options object to modify.
 */
function changeOptionsForCompatibilityWithRequest(options, httpAgentOptions, httpsAgentOptions) {
  if (false === options.followRedirect) {
    options.maxRedirects = 0;
  }
  if (false === options.gzip) {
    options.headers = { ...options.headers, 'Accept-Encoding': 'identity' };
    delete options.gzip;
  }
  if (options.forever !== undefined) {
    httpAgentOptions.keepAlive = !!options.forever;
    httpsAgentOptions.keepAlive = !!options.forever;
  }
}
/*
 * Download a URL and return the response.
 * @param {operationContext.Context} ctx - The operation context.
 * @param {string} uri - The URL to download.
 * @param {object} optTimeout - Optional timeout configuration.
 * @param {number} optLimit - Optional limit on the size of the response.
 * @param {string} opt_Authorization - Optional authorization header.
 * @param {boolean} opt_filterPrivate - Optional flag to filter private requests.
 * @param {object} opt_headers - Optional headers to include in the request.
 * @param {boolean} opt_returnStream - Optional flag to return stream.
 * @returns {Promise<{response: axios.AxiosResponse, sha256: string|null, body: Buffer|null, stream: NodeJS.ReadableStream|null}>} - A promise that resolves to object containing response, sha256 hash, and body (null if opt_streamWriter is provided).
 */
async function downloadUrlPromise(ctx, uri, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_returnStream) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  const tenTokenOutboxHeader = ctx.getCfg('services.CoAuthoring.token.outbox.header', cfgTokenOutboxHeader);
  const tenTokenOutboxPrefix = ctx.getCfg('services.CoAuthoring.token.outbox.prefix', cfgTokenOutboxPrefix);
  const sizeLimit = optLimit || Number.MAX_VALUE;
  uri = URI.serialize(URI.parse(uri));
  const options = config.util.cloneDeep(tenTenantRequestDefaults);

  //baseRequest creates new agent(win-ca injects in globalAgent)
  const httpsAgentOptions = { ...https.globalAgent.options, ...options};
  const httpAgentOptions = { ...http.globalAgent.options, ...options};
  changeOptionsForCompatibilityWithRequest(options, httpAgentOptions, httpsAgentOptions);
  
  if (!addExternalRequestOptions(ctx, uri, opt_filterPrivate, options, httpAgentOptions, httpsAgentOptions)) {
    throw new Error('Block external request. See externalRequest config options');
  }

  if (!options.httpsAgent || !options.httpAgent) {
    options.httpsAgent = new https.Agent(httpsAgentOptions);
    options.httpAgent = new http.Agent(httpAgentOptions);
  }

  const headers = { ...options.headers };
  if (opt_Authorization) {
    headers[tenTokenOutboxHeader] = tenTokenOutboxPrefix + opt_Authorization;
  }
  if (opt_headers) {
    Object.assign(headers, opt_headers);
  }

  const axiosConfig = {
    ...options,
    url: uri,
    method: 'GET',
    responseType: 'stream',
    headers,
    signal: optTimeout?.wholeCycle && AbortSignal.timeout ? AbortSignal.timeout(ms(optTimeout.wholeCycle)) : undefined,
    timeout: optTimeout?.connectionAndInactivity ? ms(optTimeout.connectionAndInactivity) : undefined,
  };
  try {
    const response = await axios(axiosConfig);
    const { status, headers } = response;
    if (![200, 206].includes(status)) {
      const error = new Error(`Error response: statusCode:${status}; headers:${JSON.stringify(headers)};`);
      error.statusCode = status;
      error.response = response;
      throw error;
    }
  
    const contentLength = headers['content-length'];
    if (contentLength && parseInt(contentLength) > sizeLimit) {
      // Close the stream to prevent downloading
      const error = new Error('EMSGSIZE: Error response: content-length:' + contentLength);
      error.code = 'EMSGSIZE';
      response.data.destroy(error);
      throw error;
    }
    const limitedStream = new SizeLimitStream(optLimit);
    if (opt_returnStream) {
      // When returning a stream, we'll return the response for the caller to handle streaming
      // The content-length check is already done above
      return { response, sha256: null, body: null, stream: response.data.pipe(limitedStream) };
    }
    
    const body = await pipeline(response.data, limitedStream, buffer);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    return { response, sha256, body, stream: null };
  } catch (err) {
    if('ERR_CANCELED' === err.code) {
      err.code = 'ETIMEDOUT';
    } else if(['ECONNABORTED', 'ECONNRESET'].includes(err.code)) {
      err.code = 'ESOCKETTIMEDOUT';
    }
    if (err.status){
      err.statusCode = err.status;
    }
    throw err;
  }
}

async function postRequestPromise(ctx, uri, postData, postDataStream, postDataSize, optTimeout, opt_Authorization, opt_isInJwtToken, opt_headers) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  const tenTokenOutboxHeader = ctx.getCfg('services.CoAuthoring.token.outbox.header', cfgTokenOutboxHeader);
  const tenTokenOutboxPrefix = ctx.getCfg('services.CoAuthoring.token.outbox.prefix', cfgTokenOutboxPrefix);
  uri = URI.serialize(URI.parse(uri));
  const options = config.util.cloneDeep(tenTenantRequestDefaults);
  
  const httpsAgentOptions = { ...https.globalAgent.options, ...options};
  const httpAgentOptions = { ...http.globalAgent.options, ...options};
  changeOptionsForCompatibilityWithRequest(options, httpAgentOptions, httpsAgentOptions);
  
  if (!addExternalRequestOptions(ctx, uri, opt_isInJwtToken, options, httpAgentOptions, httpsAgentOptions)) {
    throw new Error('Block external request. See externalRequest config options');
  }

  if (!options.httpsAgent || !options.httpAgent) {
    options.httpsAgent = new https.Agent(httpsAgentOptions);
    options.httpAgent = new http.Agent(httpAgentOptions);
  }

  const headers = { ...options.headers };
  if (opt_Authorization) {
    headers[tenTokenOutboxHeader] = tenTokenOutboxPrefix + opt_Authorization;
  }
  if (opt_headers) {
    Object.assign(headers, opt_headers);
  }
  if (undefined !== postDataSize) {
    //If no Content-Length is set, data will automatically be encoded in HTTP Chunked transfer encoding,
    //so that server knows when the data ends. The Transfer-Encoding: chunked header is added.
    //https://nodejs.org/api/http.html#requestwritechunk-encoding-callback
    //issue with Transfer-Encoding: chunked wopi and sharepoint 2019
    //https://community.alteryx.com/t5/Dev-Space/Download-Tool-amp-Microsoft-SharePoint-Chunked-Request-Error/td-p/735824
    headers['Content-Length'] = postDataSize;
  }

  const axiosConfig = {
    ...options,
    url: uri,
    method: 'POST',
    headers,
    signal: optTimeout?.wholeCycle && AbortSignal.timeout ? AbortSignal.timeout(ms(optTimeout.wholeCycle)) : undefined,
    timeout: optTimeout?.connectionAndInactivity ? ms(optTimeout.connectionAndInactivity) : undefined,
  };

  if (postData) {
    axiosConfig.data = postData;
  } else if (postDataStream) {
    axiosConfig.data = postDataStream;
  }

  try {
    const response = await axios(axiosConfig);
    const { status, headers, data } = response;
    
    if (status === 200 || status === 204) {
      return {
        response: {
          statusCode: status,
          headers,
          body: data
        },
        body: JSON.stringify(data)
      };
    } else {
      const error = new Error(`Error response: statusCode:${status}; headers:${JSON.stringify(headers)}; body:\r\n${data}`);
      error.status = status;
      error.response = response;
      throw error;
    }
  } catch (err) {
    if ('ERR_CANCELED' === err.code) {
      err.code = 'ETIMEDOUT';
    } else if (['ECONNABORTED', 'ECONNRESET'].includes(err.code)) {
      err.code = 'ESOCKETTIMEDOUT';
    }
    if (err.status) {
      err.statusCode = err.status;
    }
    throw err;
  }
}
/**
 * Performs an HTTP request with specified method and returns the raw response with a stream.
 * @param {operationContext.Context} ctx - The operation context.
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc).
 * @param {string} uri - The URL for the request.
 * @param {object} opt_headers - Optional headers to include in the request.
 * @param {*} opt_body - Optional request body data.
 * @param {object} opt_timeout - Optional timeout configuration.
 * @param {number} opt_limit - Optional limit on the size of the response.
 * @param {boolean} opt_filterPrivate - Optional flag to filter private requests.
 * @returns {Promise<{response: axios.AxiosResponse, stream: SizeLimitStream}>} - A promise that resolves to an object containing the raw Axios response and a SizeLimitStream.
 */
async function httpRequest(ctx, method, uri, opt_headers, opt_body, opt_timeout, opt_limit, opt_filterPrivate) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  uri = URI.serialize(URI.parse(uri));
  const options = config.util.cloneDeep(tenTenantRequestDefaults);
  
  const httpsAgentOptions = { ...https.globalAgent.options, ...options};
  const httpAgentOptions = { ...http.globalAgent.options, ...options};
  changeOptionsForCompatibilityWithRequest(options, httpAgentOptions, httpsAgentOptions);
  
  if (!addExternalRequestOptions(ctx, uri, opt_filterPrivate, options, httpAgentOptions, httpsAgentOptions)) {
    throw new Error('Block external request. See externalRequest config options');
  }

  if (!options.httpsAgent || !options.httpAgent) {
    options.httpsAgent = new https.Agent(httpsAgentOptions);
    options.httpAgent = new http.Agent(httpAgentOptions);
  }

  const requestHeaders = { ...options.headers };
  if (opt_headers) {
    Object.assign(requestHeaders, opt_headers);
  }

  const axiosConfig = {
    ...options,
    url: uri,
    method,
    headers: requestHeaders,
    responseType: 'stream',
    signal: opt_timeout?.wholeCycle && AbortSignal.timeout ? AbortSignal.timeout(ms(opt_timeout.wholeCycle)) : undefined,
    timeout: opt_timeout?.connectionAndInactivity ? ms(opt_timeout.connectionAndInactivity) : undefined,
  };

  if (opt_body) {
    axiosConfig.data = opt_body;
  }

  try {
    const response = await axios(axiosConfig);
    const { status, headers, data } = response;

    const contentLength = headers['content-length'];
    if (opt_limit && contentLength && parseInt(contentLength) > opt_limit) {
      const error = new Error('EMSGSIZE: Error response: content-length:' + contentLength);
      error.code = 'EMSGSIZE';
      response.data.destroy(error);
      throw error;
    }
    
    const limitedStream = new SizeLimitStream(opt_limit || Number.MAX_VALUE);
    response.data.pipe(limitedStream);
    
    return {
      response,
      stream: limitedStream
    };
  } catch (err) {
    if ('ERR_CANCELED' === err.code) {
      err.code = 'ETIMEDOUT';
    } else if (['ECONNABORTED', 'ECONNRESET'].includes(err.code)) {
      err.code = 'ESOCKETTIMEDOUT';
    }
    if (err.status) {
      err.statusCode = err.status;
    }
    throw err;
  }
}

exports.httpRequest = httpRequest;
exports.postRequestPromise = postRequestPromise;
exports.downloadUrlPromise = downloadUrlPromise;
exports.mapAscServerErrorToOldError = function(error) {
  var res = -1;
  switch (error) {
    case constants.NO_ERROR :
    case constants.CONVERT_CELLLIMITS :
      res = 0;
      break;
    case constants.TASK_QUEUE :
    case constants.TASK_RESULT :
      res = -6;
      break;
    case constants.CONVERT_PASSWORD :
    case constants.CONVERT_DRM :
    case constants.CONVERT_DRM_UNSUPPORTED :
      res = -5;
      break;
    case constants.CONVERT_DOWNLOAD :
      res = -4;
      break;
    case constants.CONVERT_TIMEOUT :
    case constants.CONVERT_DEAD_LETTER :
      res = -2;
      break;
    case constants.CONVERT_PARAMS :
      res = -7;
      break;
    case constants.CONVERT_LIMITS :
      res = -10;
      break;
    case constants.CONVERT_NEED_PARAMS :
    case constants.CONVERT_LIBREOFFICE :
    case constants.CONVERT_CORRUPTED :
    case constants.CONVERT_UNKNOWN_FORMAT :
    case constants.CONVERT_READ_FILE :
    case constants.CONVERT_TEMPORARY :
    case constants.CONVERT :
      res = -3;
      break;
    case constants.CONVERT_DETECT :
      res = -9;
      break;
    case constants.VKEY :
    case constants.VKEY_ENCRYPT :
    case constants.VKEY_KEY_EXPIRE :
    case constants.VKEY_USER_COUNT_EXCEED :
      res = -8;
      break;
    case constants.STORAGE :
    case constants.STORAGE_FILE_NO_FOUND :
    case constants.STORAGE_READ :
    case constants.STORAGE_WRITE :
    case constants.STORAGE_REMOVE_DIR :
    case constants.STORAGE_CREATE_DIR :
    case constants.STORAGE_GET_INFO :
    case constants.UPLOAD :
    case constants.READ_REQUEST_STREAM :
    case constants.UNKNOWN :
      res = -1;
      break;
  }
  return res;
};
function fillXmlResponse(val) {
  var xml = '<?xml version="1.0" encoding="utf-8"?><FileResult>';
  if (undefined != val.error) {
    xml += '<Error>' + exports.encodeXml(val.error.toString()) + '</Error>';
  } else {
    if (val.fileUrl) {
      xml += '<FileUrl>' + exports.encodeXml(val.fileUrl) + '</FileUrl>';
    } else {
      xml += '<FileUrl/>';
    }
    if (val.fileType) {
      xml += '<FileType>' + exports.encodeXml(val.fileType) + '</FileType>';
    } else {
      xml += '<FileType/>';
    }
    xml += '<Percent>' + val.percent + '</Percent>';
    xml += '<EndConvert>' + (val.endConvert ? 'True' : 'False') + '</EndConvert>';
  }
  xml += '</FileResult>';
  return xml;
}

function fillResponseSimple(res, str, contentType) {
  const body = Buffer.from(str, 'utf-8');
  res.setHeader('Content-Type', contentType + '; charset=UTF-8');
  res.setHeader('Content-Length', body.length);
  res.send(body);
}
function _fillResponse(res, output, isJSON) {
  let data;
  let contentType;
  if (isJSON) {
    data = JSON.stringify(output);
    contentType = 'application/json';
  } else {
    data = fillXmlResponse(output);
    contentType = 'text/xml';
  }
  fillResponseSimple(res, data, contentType);
}

function fillResponse(req, res, convertStatus, isJSON) {
  let output;
  if (constants.NO_ERROR != convertStatus.err) {
    output = {error: exports.mapAscServerErrorToOldError(convertStatus.err)};
  } else {
    output = {fileUrl: convertStatus.url, fileType: convertStatus.filetype, percent: (convertStatus.end ? 100 : 0), endConvert: convertStatus.end};
  }
  const accepts = isJSON ? ['json', 'xml'] : ['xml', 'json'];
  switch (req.accepts(accepts)) {
    case 'json':
      isJSON = true;
      break;
    case 'xml':
      isJSON = false;
      break;
  }
  _fillResponse(res, output, isJSON);
}

exports.fillResponseSimple = fillResponseSimple;
exports.fillResponse = fillResponse;

function fillResponseBuilder(res, key, urls, end, error) {
  let output;
  if (constants.NO_ERROR != error) {
    output = {error: exports.mapAscServerErrorToOldError(error)};
  } else {
    output = {key, urls, end};
  }
  _fillResponse(res, output, true);
}

exports.fillResponseBuilder = fillResponseBuilder;

function promiseCreateWriteStream(strPath, optOptions) {
  return new Promise((resolve, reject) => {
    var file = fs.createWriteStream(strPath, optOptions);
    var errorCallback = function(e) {
      reject(e);
    };
    file.on('error', errorCallback);
    file.on('open', () => {
      file.removeListener('error', errorCallback);
      resolve(file);
    });
  });
};
exports.promiseCreateWriteStream = promiseCreateWriteStream;

function promiseWaitDrain(stream) {
  return new Promise((resolve, reject) => {
    stream.once('drain', resolve);
  });
}
exports.promiseWaitDrain = promiseWaitDrain;

function promiseWaitClose(stream) {
  return new Promise((resolve, reject) => {
    stream.once('close', resolve);
  });
}
exports.promiseWaitClose = promiseWaitClose;

function promiseCreateReadStream(strPath) {
  return new Promise((resolve, reject) => {
    var file = fs.createReadStream(strPath);
    var errorCallback = function(e) {
      reject(e);
    };
    file.on('error', errorCallback);
    file.on('open', () => {
      file.removeListener('error', errorCallback);
      resolve(file);
    });
  });
};
exports.promiseCreateReadStream = promiseCreateReadStream;
exports.compareStringByLength = function(x, y) {
  if (x && y) {
    if (x.length == y.length) {
      return x.localeCompare(y);
    } else {
      return x.length - y.length;
    }
  } else {
    if (null != x) {
      return 1;
    } else if (null != y) {
      return -1;
    }
  }
  return 0;
};
exports.promiseRedis = function(client, func) {
  var newArguments = Array.prototype.slice.call(arguments, 2);
  return new Promise((resolve, reject) => {
    newArguments.push((err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
    func.apply(client, newArguments);
  });
};
exports.containsAllAscii = function(str) {
  return /^[\000-\177]*$/.test(str);
};
function containsAllAsciiNP(str) {
  return /^[\040-\176]*$/.test(str);//non-printing characters
}
exports.containsAllAsciiNP = containsAllAsciiNP;
/**
 * Get domain from headers
 * @param {string} hostHeader - Host header
 * @param {string} forwardedHostHeader - X-Forwarded-Host header (may contain comma-separated values)
 * @returns {string}
 */
function getDomain(hostHeader, forwardedHostHeader) {
  if (forwardedHostHeader) {
    // Handle comma-separated values, take first value(original host per RFC 7239)
    return forwardedHostHeader.split(',')[0].trim();
  }
  if (hostHeader) {
    // Header should contain one value(RFC 7230), apply same logic for protection against malformed requests
    return hostHeader.split(',')[0].trim();
  }
  return 'localhost';
};
function getBaseUrl(protocol, hostHeader, forwardedProtoHeader, forwardedHostHeader, forwardedPrefixHeader) {
  var url = '';
  if (forwardedProtoHeader && constants.ALLOWED_PROTO.test(forwardedProtoHeader)) {
    url += forwardedProtoHeader;
  } else if (protocol && constants.ALLOWED_PROTO.test(protocol)) {
    url += protocol;
  } else {
    url += 'http';
  }
  url += '://';
  url += getDomain(hostHeader, forwardedHostHeader);
  if (forwardedPrefixHeader) {
    url += forwardedPrefixHeader;
  }
  return url;
}
function getBaseUrlByConnection(ctx, conn) {
  conn = conn.request;
  //Header names are lower-cased. https://nodejs.org/api/http.html#messageheaders
  const cloudfrontForwardedProto = conn.headers['cloudfront-forwarded-proto'];
  const forwardedProto = conn.headers['x-forwarded-proto'];
  const forwardedHost = conn.headers['x-forwarded-host'];
  const forwardedPrefix = conn.headers['x-forwarded-prefix'];
  const host = conn.headers['host'];
  const proto = cloudfrontForwardedProto || forwardedProto;
  ctx.logger.debug(`getBaseUrlByConnection host=%s x-forwarded-host=%s x-forwarded-proto=%s x-forwarded-prefix=%s cloudfront-forwarded-proto=%s `,
      host, forwardedHost, forwardedProto, forwardedPrefix, cloudfrontForwardedProto);
  return getBaseUrl('', host, proto, forwardedHost, forwardedPrefix);
}
function getBaseUrlByRequest(ctx, req) {
  //case-insensitive match. https://expressjs.com/en/api.html#req.get
  const cloudfrontForwardedProto = req.get('cloudfront-forwarded-proto');
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedPrefix = req.get('x-forwarded-prefix');
  const host = req.get('host');
  const protocol = req.protocol;
  const proto = cloudfrontForwardedProto || forwardedProto;
  ctx.logger.debug(`getBaseUrlByRequest protocol=%s host=%s x-forwarded-host=%s x-forwarded-proto=%s x-forwarded-prefix=%s cloudfront-forwarded-proto=%s `,
      protocol, host, forwardedHost, forwardedProto, forwardedPrefix, cloudfrontForwardedProto);
  return getBaseUrl(protocol, host, proto, forwardedHost, forwardedPrefix);
}
exports.getBaseUrlByConnection = getBaseUrlByConnection;
exports.getBaseUrlByRequest = getBaseUrlByRequest;
function getDomainByConnection(ctx, conn) {
  const incomingMessage = conn.request;
  const host = incomingMessage.headers['host'];
  const forwardedHost = incomingMessage.headers['x-forwarded-host'];
  ctx.logger.debug("getDomainByConnection headers['host']=%s headers['x-forwarded-host']=%s", host, forwardedHost);
  return getDomain(host, forwardedHost);
}
function getDomainByRequest(ctx, req) {
  const host = req.get('host');
  const forwardedHost = req.get('x-forwarded-host');
  ctx.logger.debug("getDomainByRequest headers['host']=%s headers['x-forwarded-host']=%s", host, forwardedHost);
  return getDomain(req.get('host'), req.get('x-forwarded-host'));
}
exports.getDomainByConnection = getDomainByConnection;
exports.getDomainByRequest = getDomainByRequest;
function getShardKeyByConnection(ctx, conn) {
  return  conn?.handshake?.query?.[constants.SHARD_KEY_API_NAME];
}
function getWopiSrcByConnection(ctx, conn) {
  return  conn?.handshake?.query?.[constants.SHARD_KEY_WOPI_NAME];
}
function getShardKeyByRequest(ctx, req) {
  return req.query?.[constants.SHARD_KEY_API_NAME];
}
function getWopiSrcByRequest(ctx, req) {
  return req.query?.[constants.SHARD_KEY_WOPI_NAME];
}
exports.getShardKeyByConnection = getShardKeyByConnection;
exports.getWopiSrcByConnection = getWopiSrcByConnection;
exports.getShardKeyByRequest = getShardKeyByRequest;
exports.getWopiSrcByRequest = getWopiSrcByRequest;
function stream2Buffer(stream) {
  return new Promise((resolve, reject) => {
    if (!stream.readable) {
      resolve(Buffer.alloc(0));
    }
    var bufs = [];
    stream.on('data', (data) => {
      bufs.push(data);
    });
    function onEnd(err) {
      if (err) {
        reject(err);
      } else {
        resolve(Buffer.concat(bufs));
      }
    }
    stream.on('end', onEnd);
    stream.on('error', onEnd);
  });
}
exports.stream2Buffer = stream2Buffer;
function changeOnlyOfficeUrl(inputUrl, strPath, optFilename) {
  //onlyoffice file server expects url end with file extension
  if (-1 == inputUrl.indexOf('?')) {
    inputUrl += '?';
  } else {
    inputUrl += '&';
  }
  return inputUrl + constants.ONLY_OFFICE_URL_PARAM + '=' + constants.OUTPUT_NAME + path.extname(optFilename || strPath);
}
exports.changeOnlyOfficeUrl = changeOnlyOfficeUrl;
function pipeStreams(from, to, isEnd) {
  return new Promise((resolve, reject) => {
    from.pipe(to, {end: isEnd});
    from.on('end', () => {
      resolve();
    });
    from.on('error', (e) => {
      reject(e);
    });
  });
}
exports.pipeStreams = pipeStreams;
function* pipeFiles(from, to) {
  var fromStream = yield promiseCreateReadStream(from);
  var toStream = yield promiseCreateWriteStream(to);
  yield pipeStreams(fromStream, toStream, true);
}
exports.pipeFiles = co.wrap(pipeFiles);
function checkIpFilter(ctx, ipString, opt_hostname) {
  const tenIpFilterRules = ctx.getCfg('services.CoAuthoring.ipfilter.rules', cfgIpFilterRules);

  var status = 0;
  var ip4;
  var ip6;
  if (ipaddr.isValid(ipString)) {
    var ip = ipaddr.parse(ipString);
    if ('ipv6' === ip.kind()) {
      if (ip.isIPv4MappedAddress()) {
        ip4 = ip.toIPv4Address().toString();
      }
      ip6 = ip.toNormalizedString();
    } else {
      ip4 = ip.toString();
      ip6 = ip.toIPv4MappedAddress().toNormalizedString();
    }
  }

  for (let i = 0; i < tenIpFilterRules.length; ++i) {
    const rule = tenIpFilterRules[i];
    const exp = getIpFilterRule(rule.address);
    if ((opt_hostname && exp.test(opt_hostname)) || (ip4 && exp.test(ip4)) || (ip6 && exp.test(ip6))) {
      if (!rule.allowed) {
        const tenIpFilterErrorCode = ctx.getCfg('services.CoAuthoring.ipfilter.errorcode', cfgIpFilterErrorCode);
        status = tenIpFilterErrorCode;
      }
      break;
    }
  }
  return status;
}
exports.checkIpFilter = checkIpFilter;
function* checkHostFilter(ctx, hostname) {
  let status = 0;
  let hostIp;
  try {
    hostIp = yield dnsLookup(hostname);
  } catch (e) {
    const tenIpFilterErrorCode = ctx.getCfg('services.CoAuthoring.ipfilter.errorcode', cfgIpFilterErrorCode);
    status = tenIpFilterErrorCode;
    ctx.logger.error('dnsLookup error: hostname = %s %s', hostname, e.stack);
  }
  if (0 === status) {
    status = checkIpFilter(ctx, hostIp, hostname);
  }
  return status;
}
exports.checkHostFilter = checkHostFilter;
function checkClientIp(req, res, next) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  const tenIpFilterUseForRequest = ctx.getCfg('services.CoAuthoring.ipfilter.useforrequest', cfgIpFilterUseForRequest);
	let status = 0;
	if (tenIpFilterUseForRequest) {
		const addresses = forwarded(req);
		const ipString = addresses[addresses.length - 1];
		status = checkIpFilter(ctx, ipString);
	}
	if (status > 0) {
		res.sendStatus(status);
	} else {
		next();
	}
}
exports.checkClientIp = checkClientIp;
function lowercaseQueryString(req, res, next) {
  for (var key in req.query) {
    if (req.query.hasOwnProperty(key) && key.toLowerCase() !== key) {
      req.query[key.toLowerCase()] = req.query[key];
      delete req.query[key];
    }
  }
  next();
}
exports.lowercaseQueryString = lowercaseQueryString;
function dnsLookup(hostname, options) {
  return new Promise((resolve, reject) => {
    dnscache.lookup(hostname, options, (err, addresses) =>{
      if (err) {
        reject(err);
      } else {
        resolve(addresses);
      }
    });
  });
}
exports.dnsLookup = dnsLookup;
function isEmptyObject(val) {
  return !(val && Object.keys(val).length);
}
exports.isEmptyObject = isEmptyObject;
function getSecretByElem(secretElem) {
  let secret;
  if (secretElem) {
    if (secretElem.string) {
      secret = secretElem.string;
    } else if (secretElem.file) {
      secret = pemfileCache.get(secretElem.file);
      if (!secret) {
        secret = fs.readFileSync(secretElem.file);
        pemfileCache.set(secretElem.file, secret);
      }
    }
  }
  return secret;
}
exports.getSecretByElem = getSecretByElem;
function fillJwtForRequest(ctx, payload, secret, opt_inBody) {
  const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
  const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
  //todo refuse prototypes in payload(they are simple getter/setter).
  //JSON.parse/stringify is more universal but Object.assign is enough for our inputs
  payload = Object.assign(Object.create(null), payload);
  let data;
  if (opt_inBody) {
    data = payload;
  } else {
    data = {payload};
  }

  const options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
  return jwt.sign(data, secret, options);
}
exports.fillJwtForRequest = fillJwtForRequest;
exports.forwarded = forwarded;
exports.getIndexFromUserId = function(userId, userIdOriginal){
  return parseInt(userId.substring(userIdOriginal.length));
};
exports.checkPathTraversal = function(ctx, docId, rootDirectory, filename) {
  if (filename.indexOf('\0') !== -1) {
    ctx.logger.warn('checkPathTraversal Poison Null Bytes filename=%s', filename);
    return false;
  }
  if (!filename.startsWith(rootDirectory)) {
    ctx.logger.warn('checkPathTraversal Path Traversal filename=%s', filename);
    return false;
  }
  return true;
};
exports.getConnectionInfo = function(conn){
    var user = conn.user;
    var data = {
      id: user.id,
      idOriginal: user.idOriginal,
      username: user.username,
      indexUser: user.indexUser,
      view: user.view,
      connectionId: conn.id,
      isCloseCoAuthoring: conn.isCloseCoAuthoring,
      isLiveViewer: exports.isLiveViewer(conn),
      encrypted: conn.encrypted
    };
    return data;
};
exports.getConnectionInfoStr = function(conn){
  return JSON.stringify(exports.getConnectionInfo(conn));
};
exports.isLiveViewer = function(conn){
  return conn.user?.view && "fast" === conn.coEditingMode;
};
exports.isLiveViewerSupport = function(licenseInfo){
  return licenseInfo.connectionsView > 0 || licenseInfo.usersViewCount > 0;
};
exports.canIncludeOutboxAuthorization = function (ctx, url) {
  const tenTokenEnableRequestOutbox = ctx.getCfg('services.CoAuthoring.token.enable.request.outbox', cfgTokenEnableRequestOutbox);
  const tenTokenOutboxUrlExclusionRegex = ctx.getCfg('services.CoAuthoring.token.outbox.urlExclusionRegex', cfgTokenOutboxUrlExclusionRegex);
  if (tenTokenEnableRequestOutbox) {
    if (!tenTokenOutboxUrlExclusionRegex) {
      return true;
    } else if (!new RegExp(escapeStringRegexp(tenTokenOutboxUrlExclusionRegex)).test(url)) {
      return true;
    } else {
      ctx.logger.debug('canIncludeOutboxAuthorization excluded by token.outbox.urlExclusionRegex url=%s', url);
    }
  }
  return false;
};
/*
  Code samples taken from here: https://gist.github.com/btxtiger/e8eaee70d6e46729d127f1e384e755d6
 */
exports.encryptPassword = async function (ctx, password) {
  const pbkdf2Promise = util.promisify(crypto.pbkdf2);
  const tenSecret = ctx.getCfg('aesEncrypt.secret', cfgSecret);
  const tenAESConfig = ctx.getCfg('aesEncrypt.config', cfgAESConfig) ?? {};
  const {
    keyByteLength = 32,
    saltByteLength = 64,
    initializationVectorByteLength = 16,
    iterationsByteLength = 5
  } = tenAESConfig;

  const salt = crypto.randomBytes(saltByteLength);
  const initializationVector = crypto.randomBytes(initializationVectorByteLength);

  const iterationsLength = iterationsByteLength < minimumIterationsByteLength ? minimumIterationsByteLength : iterationsByteLength;
  // Generate random count of iterations; 10.000 - 99.999 -> 5 bytes
  const lowerNumber = Math.pow(10, iterationsLength - 1);
  const greaterNumber = Math.pow(10, iterationsLength) - 1;
  const iterations = Math.floor(Math.random() * (greaterNumber - lowerNumber)) + lowerNumber;

  const encryptionKey = await pbkdf2Promise(tenSecret, salt, iterations, keyByteLength, 'sha512');
  //todo chacha20-poly1305 (clean db)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, initializationVector, {authTagLength:16});
  const encryptedData = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const predicate = iterations.toString(16);
  const data = Buffer.concat([salt, initializationVector, authTag, encryptedData]).toString('hex');

  return `${predicate}:${data}`;
};
exports.decryptPassword = async function (ctx, password) {
  const pbkdf2Promise = util.promisify(crypto.pbkdf2);
  const tenSecret = ctx.getCfg('aesEncrypt.secret', cfgSecret);
  const tenAESConfig = ctx.getCfg('aesEncrypt.config', cfgAESConfig) ?? {};
  const {
    keyByteLength = 32,
    saltByteLength = 64,
    initializationVectorByteLength = 16,
  } = tenAESConfig;

  const [iterations, dataHex] = password.split(':');
  const data = Buffer.from(dataHex, 'hex');
  // authTag in node.js equals 16 bytes(128 bits), see https://stackoverflow.com/questions/33976117/does-node-js-crypto-use-fixed-tag-size-with-gcm-mode
  const delta = [saltByteLength, initializationVectorByteLength, 16];
  const pointerArray = [];

  for (let byte = 0, i = 0; i < delta.length; i++) {
    const deltaValue = delta[i];
    pointerArray.push(data.subarray(byte, byte + deltaValue));
    byte += deltaValue;

    if (i === delta.length - 1) {
      pointerArray.push(data.subarray(byte));
    }
  }

  const [
    salt,
    initializationVector,
    authTag,
    encryptedData
  ] = pointerArray;

  const decryptionKey = await pbkdf2Promise(tenSecret, salt, parseInt(iterations, 16), keyByteLength, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, initializationVector, {authTagLength:16});
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedData, 'binary'), decipher.final()]).toString();
};
exports.getDateTimeTicks = function(date) {
  return BigInt(date.getTime() * 10000) + 621355968000000000n;
};
exports.convertLicenseInfoToFileParams = function(licenseInfo) {
  // todo
  // {
  // 	user_quota = 0;
  // 	portal_count = 0;
  // 	process = 2;
  // 	ssbranding = false;
  // 	whiteLabel = false;
  // }
  const license = {};
  license.start_date = licenseInfo.startDate && licenseInfo.startDate.toJSON();
  license.end_date = licenseInfo.endDate && licenseInfo.endDate.toJSON();
  license.timelimited = 0 !== (constants.LICENSE_MODE.Limited & licenseInfo.mode);
  license.trial = 0 !== (constants.LICENSE_MODE.Trial & licenseInfo.mode);
  license.developer = 0 !== (constants.LICENSE_MODE.Developer & licenseInfo.mode);
  license.branding = licenseInfo.branding;
  license.customization = licenseInfo.customization;
  license.advanced_api = licenseInfo.advancedApi;
  license.connections = licenseInfo.connections;
  license.connections_view = licenseInfo.connectionsView;
  license.users_count = licenseInfo.usersCount;
  license.users_view_count = licenseInfo.usersViewCount;
  license.users_expire = licenseInfo.usersExpire / constants.LICENSE_EXPIRE_USERS_ONE_DAY;
  license.customer_id = licenseInfo.customerId;
  license.alias = licenseInfo.alias;
  license.multitenancy = licenseInfo.multitenancy;
  license.grace_days = licenseInfo.graceDays;
  return license;
};
exports.convertLicenseInfoToServerParams = function(licenseInfo) {
  const license = {};
  license.workersCount = licenseInfo.count;
  license.resultType = licenseInfo.type;
  license.packageType = licenseInfo.packageType;
  license.buildDate = licenseInfo.buildDate && licenseInfo.buildDate.toJSON();
  license.buildVersion = commonDefines.buildVersion;
  license.buildNumber = commonDefines.buildNumber;
  return license;
};
exports.checkBaseUrl = function(ctx, baseUrl, opt_storageCfg) {
  const storageExternalHost = opt_storageCfg ? opt_storageCfg.externalHost : cfgStorageExternalHost
  const tenStorageExternalHost = ctx.getCfg('storage.externalHost', storageExternalHost);
  return tenStorageExternalHost ? tenStorageExternalHost : baseUrl;
};
exports.resolvePath = function(object, path, defaultValue) {
  return path.split('.').reduce((o, p) => o ? o[p] : defaultValue, object);
};
Date.isLeapYear = function (year) {
  return (((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0));
};

Date.getDaysInMonth = function (year, month) {
  return [31, (Date.isLeapYear(year) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
};

Date.prototype.isLeapYear = function () {
  return Date.isLeapYear(this.getUTCFullYear());
};

Date.prototype.getDaysInMonth = function () {
  return Date.getDaysInMonth(this.getUTCFullYear(), this.getUTCMonth());
};

Date.prototype.addMonths = function (value) {
  var n = this.getUTCDate();
  this.setUTCDate(1);
  this.setUTCMonth(this.getUTCMonth() + value);
  this.setUTCDate(Math.min(n, this.getDaysInMonth()));
  return this;
};
function getMonthDiff(d1, d2) {
  var months;
  months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12;
  months -= d1.getUTCMonth();
  months += d2.getUTCMonth();
  return months;
}
exports.getMonthDiff = getMonthDiff;

/**
 * A Transform stream that limits the size of data passing through it.
 * It will throw an EMSGSIZE error if the size exceeds the limit.
 * 
 * @class SizeLimitStream
 * @extends {Transform}
 */
class SizeLimitStream extends Transform {
  /**
   * Creates an instance of SizeLimitStream.
   * @param {number} sizeLimit - Maximum size in bytes that can pass through the stream
   * @memberof SizeLimitStream
   */
  constructor(sizeLimit) {
    super();
    this.sizeLimit = sizeLimit;
    this.bytesReceived = 0;
  }

  /**
   * Transform implementation that tracks the bytes received and enforces the size limit
   * 
   * @param {Buffer|string} chunk - The chunk of data to process
   * @param {string} encoding - The encoding of the chunk if it's a string
   * @param {Function} callback - Called when processing is complete
   * @memberof SizeLimitStream
   */
  _transform(chunk, encoding, callback) {
    this.bytesReceived += chunk.length;
    
    if (this.sizeLimit && this.bytesReceived > this.sizeLimit) {
      const error = new Error(`EMSGSIZE: Response too large: ${this.bytesReceived} bytes (limit: ${this.sizeLimit} bytes)`);
      error.code = 'EMSGSIZE';
      callback(error);
      return;
    }
    
    callback(null, chunk);
  }
}
exports.getLicensePeriod = function(startDate, now) {
  startDate = new Date(startDate.getTime());//clone
  startDate.addMonths(getMonthDiff(startDate, now));
  if (startDate > now) {
    startDate.addMonths(-1);
  }
  startDate.setUTCHours(0,0,0,0);
  return startDate.getTime();
};

exports.removeIllegalCharacters = function(filename) {
  return filename?.replace(/[/\\?%*:|"<>]/g, '-') || filename;
}
exports.getFunctionArguments = function(func) {
  return func.toString().
    replace(/[\r\n\s]+/g, ' ').
    match(/(?:function\s*\w*)?\s*(?:\((.*?)\)|([^\s]+))/).
    slice(1, 3).
    join('').
    split(/\s*,\s*/);
};
exports.isUselesSfc = function(row, cmd) {
  return !(row && commonDefines.FileStatus.SaveVersion === row.status && cmd.getStatusInfoIn() === row.status_info);
};
exports.getChangesFileHeader = function() {
  return `CHANGES\t${commonDefines.buildVersion}\n`;
};
exports.checksumFile = function(hashName, path) {
  //https://stackoverflow.com/a/44643479
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(hashName);
    const stream = fs.createReadStream(path);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
};

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMergeObjects(target, ...sources) {
  if (!sources.length) {
    return target;
  }

  const source = sources.shift();
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }

        deepMergeObjects(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return deepMergeObjects(target, ...sources);
}
exports.isObject = isObject;
exports.deepMergeObjects = deepMergeObjects;
exports.NodeCache = NodeCache;//todo via require

//like suggestion in https://github.com/paulmillr/chokidar/issues/242#issuecomment-76205459
const UNSAFE_MAGIC = new Set([
  0x6969,         // NFS
  0xFF534D42,     // CIFS/SMB1
  0xFE534D42,     // SMB2+
  0x517B,         // legacy SMB
  0x65735546,     // FUSE
  0x794C7630,     // overlayfs
  0x00C36400,     // CephFS
  0x73757245,     // Coda
  0x6B414653      // AFS
]);

/**
 * Gets the file system type for the given path
 * @param {operationContext} ctx - Operation context
 * @param {string} path - Path to check
 * @returns {Promise<number>} File system type
 */
async function getFsType(ctx, path) {
  try {
    const statfs = await fsPromises.statfs(path);
    const fsType = Number(statfs.type);
    ctx.logger.info(`getFsType fs type=${fsType} ${path}`);
    return fsType;
  } catch (err) {
    ctx.logger.info(`getFsType error: ${path}: ${err.message}`);
    return null;
  }
}


/**
 * File watcher with native events fallback to polling
 * @param {operationContext} ctx - Operation context
 * @param {string} dirPath - Directory path to watch
 * @param {string} filePath - File path to watch
 * @param {Function} listener - Change event callback
 * @param {Object} opts - Options
 * @returns {Promise<fs.FSWatcher|fs.StatWatcher>} Watcher instance
 */
exports.watchWithFallback = async function watchWithFallback(ctx, dirPath, filePath, listener, opts = {}) {
  const fsType = await getFsType(ctx, dirPath);
  if (null === fsType || UNSAFE_MAGIC.has(fsType)) {
    ctx.logger.info(`watchWithFallback fs type=${fsType} unsupport watch. fallback to watchFile ${filePath}`);
    return fs.watchFile(filePath, opts, listener);
  }
  
  //Try native watch
  try {
    const watcher = fs.watch(dirPath, opts, listener);
    watcher.on('error', (err) => {
      watcher.close();
      ctx.logger.info(`watchWithFallback error ${dirPath} fallback to watchFile ${filePath}: ${err.message}`);
      fs.watchFile(filePath, opts, listener);
    });
    ctx.logger.info(`watchWithFallback watch: ${dirPath}`);
    return watcher;
  } catch (err) {
    ctx.logger.info(`watchWithFallback error ${dirPath} fallback to watchFile ${filePath}: ${err.message}`);
    return fs.watchFile(filePath, opts, listener);
  }
}