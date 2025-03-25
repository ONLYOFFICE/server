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
var config = require('config');
var fs = require('fs');
var path = require('path');
const crypto = require('crypto');
var url = require('url');
var axios = require('axios');
var co = require('co');
var URI = require("uri-js");
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
    let regExpStr = address.split('*').map(escapeStringRegexp).join('.*');
    exp = new RegExp('^' + regExpStr + '$', 'i');
    g_oIpFilterRules.set(address, exp);
  }
  return exp;
}
const pemfileCache = new NodeCache({stdTTL: ms(cfgExpPemStdTtl) / 1000, checkperiod: ms(cfgExpPemCheckPeriod) / 1000, errorOnMissing: false, useClones: true});

function getRequestFilterAgent(url, options) {
  return url.startsWith("https") ? new RequestFilteringHttpsAgent(options) : new RequestFilteringHttpAgent(options);
}

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
	return value.replace(/[<>&'"\r\n\t\xA0]/g, function (c) {
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
  return new Promise(function(resolve, reject) {
    fs.stat(fsPath, function(err, stats) {
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
  return new Promise(function(resolve, reject) {
    fs.readdir(fsPath, function(err, list) {
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
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
};
exports.readFile = function(file) {
  return new Promise(function(resolve, reject) {
    fs.readFile(file, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
function makeAndroidSafeFileName(str) {
  for (var i = 0; i < str.length; i++) {
    if (-1 == ANDROID_SAFE_FILENAME.indexOf(str[i])) {
      str[i] = '_';
    }
  }
  return str;
}
function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str).
    // Note that although RFC3986 reserves "!", RFC5987 does not,
    // so we do not need to escape it
    replace(/['()]/g, escape). // i.e., %27 %28 %29
    replace(/\*/g, '%2A').
    // The following are not required for percent-encoding per RFC5987,
    //  so we can allow for a little better readability over the wire: |`^
    replace(/%(?:7C|60|5E)/g, unescape);
}
function getContentDisposition (opt_filename, opt_useragent, opt_type) {
  let type = opt_type || constants.CONTENT_DISPOSITION_ATTACHMENT;
  return contentDisposition(opt_filename, {type: type});
}
exports.getContentDisposition = getContentDisposition;
function raiseError(ro, code, msg) {
  ro.abort();
  let error = new Error(msg);
  error.code = code;
  ro.emit('error', error);
}
function raiseErrorObj(ro, error) {
  ro.abort();
  ro.emit('error', error);
}
function isRedirectResponse(response) {
  return response && response.status >= 300 && response.status < 400 && Object.keys(response.headers).some(key => key.toLowerCase() === 'location');
}

function isAllowDirectRequest(ctx, uri, isInJwtToken) {
  let res = false;
  const tenExternalRequestDirectIfIn = ctx.getCfg('externalRequest.directIfIn', cfgExternalRequestDirectIfIn);
  let allowList = tenExternalRequestDirectIfIn.allowList;
  if (allowList.length > 0) {
    let allowIndex = allowList.findIndex((allowPrefix) => {
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
function addExternalRequestOptions(ctx, uri, isInJwtToken, options) {
  let res = false;
  const tenExternalRequestAction = ctx.getCfg('externalRequest.action', cfgExternalRequestAction);
  const tenRequestFilteringAgent = ctx.getCfg('services.CoAuthoring.request-filtering-agent', cfgRequesFilteringAgent);
  if (isAllowDirectRequest(ctx, uri, isInJwtToken)) {
    res = true;
  } else if (tenExternalRequestAction.allow) {
    res = true;
    if (tenExternalRequestAction.blockPrivateIP) {
      const agentOptions = {
        ...https.globalAgent.options,
        ...tenRequestFilteringAgent
      };

      if (tenExternalRequestAction.proxyUrl) {
        const proxyUrl = tenExternalRequestAction.proxyUrl;
        const parsedProxyUrl = url.parse(proxyUrl);
  
        agentOptions.host = parsedProxyUrl.hostname;
        agentOptions.port = parsedProxyUrl.port;
        agentOptions.protocol = parsedProxyUrl.protocol;
      }
  
      if (uri.startsWith('https:')) {
        options.httpsAgent = new RequestFilteringHttpsAgent(agentOptions);
      } else {
        options.httpAgent = new RequestFilteringHttpAgent(agentOptions);
      }
    }
    if (tenExternalRequestAction.proxyUser?.username) {
      const user = tenExternalRequestAction.proxyUser.username;
      const pass = tenExternalRequestAction.proxyUser.password || '';
      options.headers['proxy-authorization'] = `${user}:${pass}`;
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

function downloadUrlPromise(ctx, uri, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  const maxRedirects = (undefined !== tenTenantRequestDefaults.maxRedirects) ? tenTenantRequestDefaults.maxRedirects : 10;
  const followRedirect = (undefined !== tenTenantRequestDefaults.followRedirect) ? tenTenantRequestDefaults.followRedirect : true;
  var redirectsFollowed = 0;
  const doRequest = (curUrl) => {
    return downloadUrlPromiseWithoutRedirect(ctx, curUrl, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter)
      .catch(err => {
        const response = err.response;
        if (isRedirectResponse(response)) {
          if (followRedirect && redirectsFollowed < maxRedirects) {
            let redirectTo = response.headers.location;
            if (!/^https?:/.test(redirectTo)) {
              redirectTo = url.resolve(curUrl, redirectTo);
            }

            ctx.logger.debug('downloadUrlPromise redirectsFollowed:%d redirectTo: %s', redirectsFollowed, redirectTo);
            redirectsFollowed++;
            return doRequest(redirectTo);
          }
        }
        throw err;
      });
  };
  return doRequest(uri);
}
async function downloadUrlPromiseWithoutRedirect(ctx, uri, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  const tenTokenOutboxHeader = ctx.getCfg('services.CoAuthoring.token.outbox.header', cfgTokenOutboxHeader);
  const tenTokenOutboxPrefix = ctx.getCfg('services.CoAuthoring.token.outbox.prefix', cfgTokenOutboxPrefix);
  const sizeLimit = optLimit || Number.MAX_VALUE
  uri = URI.serialize(URI.parse(uri));
  const connectionAndInactivity = optTimeout?.connectionAndInactivity ? ms(optTimeout.connectionAndInactivity) : undefined;
  const options = config.util.cloneDeep(tenTenantRequestDefaults);
  if (!exports.addExternalRequestOptions(ctx, uri, opt_filterPrivate, options)) {
    throw new Error('Block external request. See externalRequest config options');
  }

  const protocol = new URL(uri).protocol;
  if (!options.httpsAgent && !options.httpAgent) {
    const agentOptions = { ...https.globalAgent.options, rejectUnauthorized: tenTenantRequestDefaults.rejectUnauthorized === false? false : true};
    if (protocol === 'https:') {
      options.httpsAgent = new https.Agent(agentOptions);
    } else if (protocol === 'http:') {
      options.httpAgent = new http.Agent(agentOptions);
    }
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
    maxRedirects: 0,
    timeout: connectionAndInactivity,
    validateStatus: () => true,
    cancelToken: new axios.CancelToken(cancel => {
      if (optTimeout?.wholeCycle) {
        setTimeout(() => {
          cancel(`ETIMEDOUT: ${optTimeout.wholeCycle}`);
        }, ms(optTimeout.wholeCycle));
      }
    }),
  };

  try {
    const response = await axios(axiosConfig);
    const { status, headers } = response;

    if (status !== 200 && status !== 206) {
      const error = new Error(`Error response: statusCode:${status}; headers:${JSON.stringify(headers)};`);
      error.statusCode = status;
      error.response = response;
      throw error;
    }
  
    const contentLength = headers['content-length'];
    if (contentLength && parseInt(contentLength) > sizeLimit) {
      throw new Error('EMSGSIZE: Error response: content-length:' + contentLength);
    }
  
    return await processResponseStream(ctx, {
      response,
      sizeLimit,
      uri,
      opt_streamWriter,
      contentLength,
      timeout: optTimeout?.wholeCycle ? ms(optTimeout.wholeCycle) : null
    });
  } catch (err) {
    if (axios.isCancel(err)) {
      const error = new Error(err.message);
      error.code = 'ETIMEDOUT';
        throw error;
      }

      if (err.response) {
        if (opt_streamWriter && !isRedirectResponse(err.response)) {
          delete err.response.headers['set-cookie'];
          return processErrorResponseStream(err.response, {
            sizeLimit,
            opt_streamWriter,
            timeout: optTimeout?.wholeCycle ? ms(optTimeout.wholeCycle) : null
          });
        }
      }
    throw err;
  }
}

async function processResponseStream(ctx, { response, sizeLimit, uri, opt_streamWriter, contentLength, timeout }) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let buffer = [];
    let bufferLength = 0;
    let timeoutId;

    const stream = response.data;

    if (timeout) {
      timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`ETIMEDOUT: ${timeout}`));
      }, timeout);
    }

    stream.on('data', chunk => {
      hash.update(chunk);
      bufferLength += chunk.length;
      if (bufferLength > sizeLimit) {
        stream.destroy();
        throw new Error('EMSGSIZE: Error response body.length');
      }
      if (!opt_streamWriter) buffer.push(chunk);
    });

    stream.on('error', reject);

    stream.on('end', () => {
      clearTimeout(timeoutId);
      const result = {
        response,
        sha256: hash.digest('hex'),
        body: opt_streamWriter ? null : Buffer.concat(buffer)
      };
      
      if (!opt_streamWriter && contentLength && result.body?.length !== parseInt(contentLength)) {
        ctx.logger.warn('Body size mismatch: %s (expected %s, got %d)',
          uri, contentLength, result.body?.length);
      }
      
      resolve(opt_streamWriter ? undefined : result);
    });

    if (opt_streamWriter) {
      pipeline(stream, opt_streamWriter)
        .catch(reject);
    }
  });
}

async function processErrorResponseStream(response, { sizeLimit, opt_streamWriter, timeout }) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let bufferLength = 0;
    let timeoutId;

    const stream = response.data;

    if (timeout) {
      timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`ETIMEDOUT: ${timeout}`));
      }, timeout);
    }

    stream.on('data', chunk => {
      hash.update(chunk);
      bufferLength += chunk.length;
      if (bufferLength > sizeLimit) {
        stream.destroy();
        reject(new Error('EMSGSIZE'));
      }
    });

    stream.on('error', reject);

    stream.on('end', () => {
      clearTimeout(timeoutId);
      resolve({
        response,
        sha256: hash.digest('hex')
      });
    });

    pipeline(stream, opt_streamWriter)
      .catch(reject);
  });
}

async function postRequestPromise(ctx, uri, postData, postDataStream, postDataSize, optTimeout, opt_Authorization, opt_isInJwtToken, opt_headers) {
  const tenTenantRequestDefaults = ctx.getCfg('services.CoAuthoring.requestDefaults', cfgRequestDefaults);
  const tenTokenOutboxHeader = ctx.getCfg('services.CoAuthoring.token.outbox.header', cfgTokenOutboxHeader);
  const tenTokenOutboxPrefix = ctx.getCfg('services.CoAuthoring.token.outbox.prefix', cfgTokenOutboxPrefix);
  let connectionAndInactivity = optTimeout && optTimeout.connectionAndInactivity && ms(optTimeout.connectionAndInactivity);
  const wholeCycleTimeout = optTimeout?.wholeCycle ? ms(optTimeout.wholeCycle) : undefined;
  uri = URI.serialize(URI.parse(uri));
  let options = config.util.extendDeep({}, tenTenantRequestDefaults);
  Object.assign(options, {
    method: 'post',
    url: uri,
    timeout: connectionAndInactivity,
    validateStatus: (status) => status === 200 || status === 204
  });
  if (!addExternalRequestOptions(ctx, uri, opt_isInJwtToken, options)) {
    throw new Error('Block external request. See externalRequest config options')
  }
  const protocol = new URL(uri).protocol;
  if (!options.httpsAgent && !options.httpAgent) {
    const agentOptions = { ...https.globalAgent.options, rejectUnauthorized: tenTenantRequestDefaults.rejectUnauthorized === false? false : true};
    if (protocol === 'https:') {
      options.httpsAgent = new https.Agent(agentOptions);
    } else if (protocol === 'http:') {
      options.httpAgent = new http.Agent(agentOptions);
    }
  }
  if (postData) {
    options.data = postData;
  } else if (postDataStream) {
    options.data = postDataStream;
  }
  options.headers = options.headers || {};
  if (opt_Authorization) {
    //todo ctx.getCfg
    options.headers[tenTokenOutboxHeader] = `${tenTokenOutboxPrefix}${opt_Authorization}`;
  }
  if (opt_headers) {
    Object.assign(options.headers, opt_headers);
  }
  if (undefined !== postDataSize) {
      //If no Content-Length is set, data will automatically be encoded in HTTP Chunked transfer encoding,
      //so that server knows when the data ends. The Transfer-Encoding: chunked header is added.
      //https://nodejs.org/api/http.html#requestwritechunk-encoding-callback
      //issue with Transfer-Encoding: chunked wopi and sharepoint 2019
      //https://community.alteryx.com/t5/Dev-Space/Download-Tool-amp-Microsoft-SharePoint-Chunked-Request-Error/td-p/735824
    options.headers['Content-Length'] = postDataSize;
  }
  const cancelTokenSource = axios.CancelToken.source();
  if (wholeCycleTimeout) {
    setTimeout(() => {
      cancelTokenSource.cancel(`Whole request cycle timeout: ${optTimeout.wholeCycle}`);
    }, wholeCycleTimeout);
  }
  options.cancelToken = cancelTokenSource.token;
  try {
    const response = await axios(options);
    return {
      response: {
        statusCode: response.status,
        headers: response.headers,
        body: response.data
      },
      body: JSON.stringify(response.data)
    }
  } catch (error) {
    if (axios.isCancel(error)) {
      const err = new Error(error.message);
      err.code = 'ETIMEDOUT';
      throw err;
    } 
    if (error.response) {
      const { status, headers, data } = error.response;
      const err = new Error(`Error response: statusCode:${status}; headers:${JSON.stringify(headers)}; body:\r\n${data}`);
      err.statusCode = status;
      err.response = error.response;
      throw err;
    }
    throw error;
  }
}
exports.postRequestPromise = postRequestPromise;
exports.downloadUrlPromise = downloadUrlPromise;
exports.addExternalRequestOptions = addExternalRequestOptions;
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
  let body = Buffer.from(str, 'utf-8');
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
    output = {key: key, urls: urls, end: end};
  }
  _fillResponse(res, output, true);
}

exports.fillResponseBuilder = fillResponseBuilder;

function promiseCreateWriteStream(strPath, optOptions) {
  return new Promise(function(resolve, reject) {
    var file = fs.createWriteStream(strPath, optOptions);
    var errorCallback = function(e) {
      reject(e);
    };
    file.on('error', errorCallback);
    file.on('open', function() {
      file.removeListener('error', errorCallback);
      resolve(file);
    });
  });
};
exports.promiseCreateWriteStream = promiseCreateWriteStream;

function promiseWaitDrain(stream) {
  return new Promise(function(resolve, reject) {
    stream.once('drain', resolve);
  });
}
exports.promiseWaitDrain = promiseWaitDrain;

function promiseWaitClose(stream) {
  return new Promise(function(resolve, reject) {
    stream.once('close', resolve);
  });
}
exports.promiseWaitClose = promiseWaitClose;

function promiseCreateReadStream(strPath) {
  return new Promise(function(resolve, reject) {
    var file = fs.createReadStream(strPath);
    var errorCallback = function(e) {
      reject(e);
    };
    file.on('error', errorCallback);
    file.on('open', function() {
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
  return new Promise(function(resolve, reject) {
    newArguments.push(function(err, data) {
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
function getDomain(hostHeader, forwardedHostHeader) {
  return forwardedHostHeader || hostHeader || 'localhost';
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
  let cloudfrontForwardedProto = conn.headers['cloudfront-forwarded-proto'];
  let forwardedProto = conn.headers['x-forwarded-proto'];
  let forwardedHost = conn.headers['x-forwarded-host'];
  let forwardedPrefix = conn.headers['x-forwarded-prefix'];
  let host = conn.headers['host'];
  let proto = cloudfrontForwardedProto || forwardedProto;
  ctx.logger.debug(`getBaseUrlByConnection host=%s x-forwarded-host=%s x-forwarded-proto=%s x-forwarded-prefix=%s cloudfront-forwarded-proto=%s `,
      host, forwardedHost, forwardedProto, forwardedPrefix, cloudfrontForwardedProto);
  return getBaseUrl('', host, proto, forwardedHost, forwardedPrefix);
}
function getBaseUrlByRequest(ctx, req) {
  //case-insensitive match. https://expressjs.com/en/api.html#req.get
  let cloudfrontForwardedProto = req.get('cloudfront-forwarded-proto');
  let forwardedProto = req.get('x-forwarded-proto');
  let forwardedHost = req.get('x-forwarded-host');
  let forwardedPrefix = req.get('x-forwarded-prefix');
  let host = req.get('host');
  let protocol = req.protocol;
  let proto = cloudfrontForwardedProto || forwardedProto;
  ctx.logger.debug(`getBaseUrlByRequest protocol=%s host=%s x-forwarded-host=%s x-forwarded-proto=%s x-forwarded-prefix=%s cloudfront-forwarded-proto=%s `,
      protocol, host, forwardedHost, forwardedProto, forwardedPrefix, cloudfrontForwardedProto);
  return getBaseUrl(protocol, host, proto, forwardedHost, forwardedPrefix);
}
exports.getBaseUrlByConnection = getBaseUrlByConnection;
exports.getBaseUrlByRequest = getBaseUrlByRequest;
function getDomainByConnection(ctx, conn) {
  let incomingMessage = conn.request;
  let host = incomingMessage.headers['host'];
  let forwardedHost = incomingMessage.headers['x-forwarded-host'];
  ctx.logger.debug("getDomainByConnection headers['host']=%s headers['x-forwarded-host']=%s", host, forwardedHost);
  return getDomain(host, forwardedHost);
}
function getDomainByRequest(ctx, req) {
  let host = req.get('host');
  let forwardedHost = req.get('x-forwarded-host');
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
  return new Promise(function(resolve, reject) {
    if (!stream.readable) {
      resolve(Buffer.alloc(0));
    }
    var bufs = [];
    stream.on('data', function(data) {
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
  return new Promise(function(resolve, reject) {
    from.pipe(to, {end: isEnd});
    from.on('end', function() {
      resolve();
    });
    from.on('error', function(e) {
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
    let rule = tenIpFilterRules[i];
    let exp = getIpFilterRule(rule.address);
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
  let ctx = new operationContext.Context();
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
  return new Promise(function(resolve, reject) {
    dnscache.lookup(hostname, options, function(err, addresses){
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
    data = {payload: payload};
  }

  let options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
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
  let license = {};
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
  return license;
};
exports.convertLicenseInfoToServerParams = function(licenseInfo) {
  let license = {};
  license.workersCount = licenseInfo.count;
  license.resultType = licenseInfo.type;
  license.packageType = licenseInfo.packageType;
  license.buildDate = licenseInfo.buildDate && licenseInfo.buildDate.toJSON();
  license.buildVersion = commonDefines.buildVersion;
  license.buildNumber = commonDefines.buildNumber;
  return license;
};
exports.checkBaseUrl = function(ctx, baseUrl, opt_storageCfg) {
  let storageExternalHost = opt_storageCfg ? opt_storageCfg.externalHost : cfgStorageExternalHost
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
