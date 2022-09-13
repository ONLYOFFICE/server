/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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

var config = require('config');
var fs = require('fs');
var path = require('path');
var url = require('url');
var request = require('request');
var co = require('co');
var URI = require("uri-js");
const escapeStringRegexp = require('escape-string-regexp');
const ipaddr = require('ipaddr.js');
var configDnsCache = config.get('dnscache');
const dnscache = require('dnscache')({
                                     "enable": configDnsCache.get('enable'),
                                     "ttl": configDnsCache.get('ttl'),
                                     "cachesize": configDnsCache.get('cachesize')
                                   });
const jwt = require('jsonwebtoken');
const NodeCache = require( "node-cache" );
const ms = require('ms');
const constants = require('./constants');
const commonDefines = require('./commondefines');
const logger = require('./logger');
const forwarded = require('forwarded');
const { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } = require("request-filtering-agent");
const openpgp = require('openpgp');
require('win-ca');
const contentDisposition = require('content-disposition');

var configIpFilter = config.get('services.CoAuthoring.ipfilter');
var cfgIpFilterRules = configIpFilter.get('rules');
var cfgIpFilterErrorCode = configIpFilter.get('errorcode');
const cfgIpFilterEseForRequest = configIpFilter.get('useforrequest');
var cfgExpPemStdTtl = config.get('services.CoAuthoring.expire.pemStdTTL');
var cfgExpPemCheckPeriod = config.get('services.CoAuthoring.expire.pemCheckPeriod');
var cfgTokenOutboxHeader = config.get('services.CoAuthoring.token.outbox.header');
var cfgTokenOutboxPrefix = config.get('services.CoAuthoring.token.outbox.prefix');
var cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
var cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
var cfgVisibilityTimeout = config.get('queue.visibilityTimeout');
var cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
var cfgRequestDefaults = config.get('services.CoAuthoring.requestDefaults');
const cfgTokenEnableRequestOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgTokenOutboxUrlExclusionRegex = config.get('services.CoAuthoring.token.outbox.urlExclusionRegex');
const cfgPasswordEncrypt = config.get('openpgpjs.encrypt');
const cfgPasswordDecrypt = config.get('openpgpjs.decrypt');
const cfgPasswordConfig = config.get('openpgpjs.config');
const cfgRequesFilteringAgent = config.get('services.CoAuthoring.request-filtering-agent');
const cfgStorageExternalHost = config.get('storage.externalHost');

Object.assign(openpgp.config, cfgPasswordConfig);

var ANDROID_SAFE_FILENAME = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._-+,@£$€!½§~\'=()[]{}0123456789';

//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
BigInt.prototype.toJSON = function() { return this.toString() };

var baseRequest = request.defaults(cfgRequestDefaults);
let outboxUrlExclusionRegex = null;
if ("" !== cfgTokenOutboxUrlExclusionRegex) {
  outboxUrlExclusionRegex = new RegExp(cfgTokenOutboxUrlExclusionRegex);
}

var g_oIpFilterRules = function() {
  var res = [];
  for (var i = 0; i < cfgIpFilterRules.length; ++i) {
    var rule = cfgIpFilterRules[i];
    var regExpStr = rule['address'].split('*').map(escapeStringRegexp).join('.*');
    var exp = new RegExp('^' + regExpStr + '$', 'i');
    res.push({allow: rule['allowed'], exp: exp});
  }
  return res;
}();
const pemfileCache = new NodeCache({stdTTL: ms(cfgExpPemStdTtl) / 1000, checkperiod: ms(cfgExpPemCheckPeriod) / 1000, errorOnMissing: false, useClones: true});

function getRequestFilterAgent(url, options) {
  return url.startsWith("https") ? new RequestFilteringHttpsAgent(options) : new RequestFilteringHttpAgent(options);
}

exports.CONVERTION_TIMEOUT = 1.5 * (cfgVisibilityTimeout + cfgQueueRetentionPeriod) * 1000;

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
    const stats = yield fsStat(file);
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
  return response && response.statusCode >= 300 && response.statusCode < 400 && response.caseless.has('location');
}
function downloadUrlPromise(ctx, uri, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter) {
  //todo replace deprecated request module
  const maxRedirects = (undefined !== cfgRequestDefaults.maxRedirects) ? cfgRequestDefaults.maxRedirects : 10;
  const followRedirect = (undefined !== cfgRequestDefaults.followRedirect) ? cfgRequestDefaults.followRedirect : true;
  var redirectsFollowed = 0;
  let doRequest = function(curUrl) {
    return downloadUrlPromiseWithoutRedirect(ctx, curUrl, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter)
      .catch(function(err) {
        let response = err.response;
        if (isRedirectResponse(response)) {
          let redirectTo = response.caseless.get('location');
          if (followRedirect && redirectsFollowed < maxRedirects) {
            if (!/^https?:/.test(redirectTo) && err.request) {
              redirectTo = url.resolve(err.request.uri.href, redirectTo)
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
function downloadUrlPromiseWithoutRedirect(ctx, uri, optTimeout, optLimit, opt_Authorization, opt_filterPrivate, opt_headers, opt_streamWriter) {
  return new Promise(function (resolve, reject) {
    //IRI to URI
    uri = URI.serialize(URI.parse(uri));
    var urlParsed = url.parse(uri);
    let sizeLimit = optLimit || Number.MAX_VALUE;
    let bufferLength = 0;
    //if you expect binary data, you should set encoding: null
    let connectionAndInactivity = optTimeout && optTimeout.connectionAndInactivity && ms(optTimeout.connectionAndInactivity);
    var options = {uri: urlParsed, encoding: null, timeout: connectionAndInactivity, followRedirect: false};
    if (opt_filterPrivate) {
      options.agent = getRequestFilterAgent(uri, cfgRequesFilteringAgent);
    }
    if (opt_Authorization) {
      options.headers = {};
      options.headers[cfgTokenOutboxHeader] = cfgTokenOutboxPrefix + opt_Authorization;
    }
    if (opt_headers) {
      options.headers = opt_headers;
    }
    let fError = function(err) {
      reject(err);
    }
    if (!opt_streamWriter) {
      fError = function() {};
      let executed = false;
      options.callback = function(err, response, body) {
        if (executed) {
          return;
        }
        executed = true;
        if (err) {
          reject(err);
        } else {
          var contentLength = response.caseless.get('content-length');
          if (contentLength && body.length !== (contentLength - 0)) {
            ctx.logger.warn('downloadUrlPromise body size mismatch: uri=%s; content-length=%s; body.length=%d', uri, contentLength, body.length);
          }
          resolve({response: response, body: body});
        }
      };
    }
    let fResponse = function(response) {
      if (opt_streamWriter) {
        //Set-Cookie resets browser session
        response.caseless.del('Set-Cookie');
      }
      var contentLength = response.caseless.get('content-length');
      if (contentLength && (contentLength - 0) > sizeLimit) {
        raiseError(this, 'EMSGSIZE', 'Error response: content-length:' + contentLength);
      } else if (response.statusCode !== 200) {
        let code = response.statusCode;
        let responseHeaders = JSON.stringify(response.headers);
        let error = new Error(`Error response: statusCode:${code}; headers:${responseHeaders};`);
        error.statusCode = response.statusCode;
        error.request = this;
        error.response = response;
        if (opt_streamWriter && !isRedirectResponse(response)) {
          this.off('error', fError);
          resolve(pipeStreams(this, opt_streamWriter, true));
        } else {
          raiseErrorObj(this, error);
        }
      } else if (opt_streamWriter) {
        this.off('error', fError);
        resolve(pipeStreams(this, opt_streamWriter, true));
      }
    };
    let fData = function(chunk) {
      bufferLength += chunk.length;
      if (bufferLength > sizeLimit) {
        raiseError(this, 'EMSGSIZE', 'Error response body.length');
      }
    }

    let ro = baseRequest.get(options)
      .on('response', fResponse)
      .on('data', fData)
      .on('error', fError);
    if (optTimeout && optTimeout.wholeCycle) {
      setTimeout(function() {
        raiseError(ro, 'ETIMEDOUT', 'Error: whole request cycle timeout');
      }, ms(optTimeout.wholeCycle));
    }
  });
}
function postRequestPromise(uri, postData, postDataStream, postDataSize, optTimeout, opt_Authorization, opt_header) {
  return new Promise(function(resolve, reject) {
    //IRI to URI
    uri = URI.serialize(URI.parse(uri));
    var urlParsed = url.parse(uri);
    var headers = {'Content-Type': 'application/json'};
    if (opt_Authorization) {
      headers[cfgTokenOutboxHeader] = cfgTokenOutboxPrefix + opt_Authorization;
    }
    headers = opt_header || headers;
    if (undefined !== postDataSize) {
      //If no Content-Length is set, data will automatically be encoded in HTTP Chunked transfer encoding,
      //so that server knows when the data ends. The Transfer-Encoding: chunked header is added.
      //https://nodejs.org/api/http.html#requestwritechunk-encoding-callback
      //issue with Transfer-Encoding: chunked wopi and sharepoint 2019
      //https://community.alteryx.com/t5/Dev-Space/Download-Tool-amp-Microsoft-SharePoint-Chunked-Request-Error/td-p/735824
      headers['Content-Length'] = postDataSize;
    }
    let connectionAndInactivity = optTimeout && optTimeout.connectionAndInactivity && ms(optTimeout.connectionAndInactivity);
    var options = {uri: urlParsed, encoding: 'utf8', headers: headers, timeout: connectionAndInactivity};
    if (postData) {
      options.body = postData;
    }

    let executed = false;
    let ro = baseRequest.post(options, function(err, response, body) {
      if (executed) {
        return;
      }
      executed = true;
      if (err) {
        reject(err);
      } else {
        if (200 === response.statusCode || 204 === response.statusCode) {
          resolve({response: response, body: body});
        } else {
          let code = response.statusCode;
          let responseHeaders = JSON.stringify(response.headers);
          let error = new Error(`Error response: statusCode:${code}; headers:${responseHeaders}; body:\r\n${body}`);
          error.statusCode = response.statusCode;
          error.response = response;
          reject(error);
        }
      }
    });
    if (optTimeout && optTimeout.wholeCycle) {
      setTimeout(function() {
        raiseError(ro, 'ETIMEDOUT', 'Error whole request cycle timeout');
      }, ms(optTimeout.wholeCycle));
    }
    if (postDataStream && !postData) {
      postDataStream.pipe(ro);
    }
  });
}
exports.postRequestPromise = postRequestPromise;
exports.downloadUrlPromise = downloadUrlPromise;
exports.mapAscServerErrorToOldError = function(error) {
  var res = -1;
  switch (error) {
    case constants.NO_ERROR :
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
    case constants.CONVERT_NEED_PARAMS :
    case constants.CONVERT_LIBREOFFICE :
    case constants.CONVERT_CORRUPTED :
    case constants.CONVERT_UNKNOWN_FORMAT :
    case constants.CONVERT_READ_FILE :
    case constants.CONVERT :
      res = -3;
      break;
    case constants.UPLOAD_CONTENT_LENGTH :
      res = -9;
      break;
    case constants.UPLOAD_EXTENSION :
      res = -10;
      break;
    case constants.UPLOAD_COUNT_FILES :
      res = -11;
      break;
    case constants.VKEY :
      res = -8;
      break;
    case constants.VKEY_ENCRYPT :
      res = -20;
      break;
    case constants.VKEY_KEY_EXPIRE :
      res = -21;
      break;
    case constants.VKEY_USER_COUNT_EXCEED :
      res = -22;
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
  if (forwardedProtoHeader) {
    url += forwardedProtoHeader;
  } else if (protocol) {
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
function getBaseUrlByConnection(conn) {
  return getBaseUrl('', conn.headers['host'], conn.headers['x-forwarded-proto'], conn.headers['x-forwarded-host'], conn.headers['x-forwarded-prefix']);
}
function getBaseUrlByRequest(req) {
  return getBaseUrl(req.protocol, req.get('host'), req.get('x-forwarded-proto'), req.get('x-forwarded-host'), req.get('x-forwarded-prefix'));
}
exports.getBaseUrlByConnection = getBaseUrlByConnection;
exports.getBaseUrlByRequest = getBaseUrlByRequest;
function getDomainByConnection(ctx, conn) {
  let host = conn.headers['host'];
  let forwardedHost = conn.headers['x-forwarded-host'];
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
function checkIpFilter(ipString, opt_hostname) {
  var status = 0;
  var ip4;
  var ip6;
  if (ipaddr.isValid(ipString)) {
    var ip = ipaddr.parse(ipString);
    if ('ipv6' == ip.kind()) {
      if (ip.isIPv4MappedAddress()) {
        ip4 = ip.toIPv4Address().toString();
      }
      ip6 = ip.toNormalizedString();
    } else {
      ip4 = ip.toString();
      ip6 = ip.toIPv4MappedAddress().toNormalizedString();
    }
  }
  for (var i = 0; i < g_oIpFilterRules.length; ++i) {
    var rule = g_oIpFilterRules[i];
    if ((opt_hostname && rule.exp.test(opt_hostname)) || (ip4 && rule.exp.test(ip4)) || (ip6 && rule.exp.test(ip6))) {
      if (!rule.allow) {
        status = cfgIpFilterErrorCode;
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
    status = cfgIpFilterErrorCode;
    ctx.logger.error('dnsLookup error: hostname = %s %s', hostname, e.stack);
  }
  if (0 === status) {
    status = checkIpFilter(hostIp, hostname);
  }
  return status;
}
exports.checkHostFilter = checkHostFilter;
function checkClientIp(req, res, next) {
	let status = 0;
	if (cfgIpFilterEseForRequest) {
		const addresses = forwarded(req);
		const ipString = addresses[addresses.length - 1];
		status = checkIpFilter(ipString);
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
function fillJwtForRequest(payload, secret, opt_inBody) {
  //todo refuse prototypes in payload(they are simple getter/setter).
  //JSON.parse/stringify is more universal but Object.assign is enough for our inputs
  payload = Object.assign(Object.create(null), payload);
  let data;
  if (opt_inBody) {
    data = payload;
  } else {
    data = {payload: payload};
  }

  let options = {algorithm: cfgTokenOutboxAlgorithm, expiresIn: cfgTokenOutboxExpires};
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
exports.canIncludeOutboxAuthorization = function (ctx, url) {
  if (cfgTokenEnableRequestOutbox) {
    if (!outboxUrlExclusionRegex) {
      return true;
    } else if (!outboxUrlExclusionRegex.test(url)) {
      return true;
    } else {
      ctx.logger.debug('canIncludeOutboxAuthorization excluded by token.outbox.urlExclusionRegex url=%s', url);
    }
  }
  return false;
};
exports.encryptPassword = co.wrap(function* (password) {
  let params = {message: openpgp.message.fromText(password)};
  Object.assign(params, cfgPasswordEncrypt);
  const { data: encrypted } = yield openpgp.encrypt(params);
  return encrypted;
});
exports.decryptPassword = co.wrap(function* (password) {
  const message = yield openpgp.message.readArmored(password);
  let params = {message: message};
  Object.assign(params, cfgPasswordDecrypt);
  const { data: decrypted } = yield openpgp.decrypt(params);
  return decrypted;
});
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
  if(license.developer) {
    license.mode = 'developer';
  } else if(license.trial) {
    license.mode = 'trial';
  } else {
    license.mode = '';
  }
  license.light = licenseInfo.light;
  license.branding = licenseInfo.branding;
  license.customization = licenseInfo.customization;
  license.advanced_api = licenseInfo.advancedApi;
  license.plugins = licenseInfo.plugins;
  license.connections = licenseInfo.connections;
  license.connections_view = licenseInfo.connectionsView;
  license.users_count = licenseInfo.usersCount;
  license.users_view_count = licenseInfo.usersViewCount;
  license.users_expire = licenseInfo.usersExpire / constants.LICENSE_EXPIRE_USERS_ONE_DAY;
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
exports.checkBaseUrl = function(baseUrl) {
  return cfgStorageExternalHost ? cfgStorageExternalHost : baseUrl;
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
