/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU 
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html). 
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that 
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display 
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains 
 * relevant author attributions when distributing the software. If the display of the logo in its graphic 
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE" 
 * in every copy of the program you distribute. 
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
*/
var fs = require('fs');
var path = require('path');
var url = require('url');
var request = require('request');
var co = require('co');
var constants = require('./constants');

var ANDROID_SAFE_FILENAME = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._-+,@£$€!½§~\'=()[]{}0123456789';

exports.addSeconds = function(date, sec) {
  date.setSeconds(date.getSeconds() + sec);
};
exports.getMillisecondsOfHour = function(date) {
  return (date.getUTCMinutes() * 60 +  date.getUTCSeconds()) * 1000 + date.getUTCMilliseconds();
};
exports.encodeXml = function(value) {
  return value.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
function* walkDir(fsPath, results, optNoSubDir) {
  var list = yield fsReadDir(fsPath);
  for (var i = 0; i < list.length; ++i) {
    var fileName = list[i];
    var file = path.join(fsPath, fileName);
    var stats = yield fsStat(file);
    if (stats.isDirectory()) {
      if (optNoSubDir) {
        continue;
      } else {
        yield* walkDir(file, results);
      }
    } else {
      results.push(file);
    }
  }
}
exports.listObjects = function(fsPath, optNoSubDir) {
  return co(function* () {
    var list;
    var stats;
    try {
      stats = yield fsStat(fsPath);
    } catch (e) {
      //exception if fsPath not exist
      stats = null;
    }
    if (stats) {
      if (stats.isDirectory()) {
        list = [];
        yield* walkDir(fsPath, list, optNoSubDir);
      } else {
        list = [fsPath];
      }
    } else {
      list = [];
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
exports.fsStat = function(file) {
  return new Promise(function(resolve, reject) {
    fs.stat(file, function(err, data) {
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
function getContentDisposition (filename, useragent) {
  //from http://stackoverflow.com/questions/93551/how-to-encode-the-filename-parameter-of-content-disposition-header-in-http
  var contentDisposition = 'attachment; filename="';
  if (useragent != null && -1 != useragent.toLowerCase().indexOf('android')) {
    contentDisposition += makeAndroidSafeFileName(filename) + '"';
  } else {
    contentDisposition += filename + '"; filename*=UTF-8\'\'' + encodeRFC5987ValueChars(filename);
  }
  return contentDisposition;
}
function getContentDispositionS3 (filename, useragent) {
  var contentDisposition = 'attachment;';
  if (useragent != null && -1 != useragent.toLowerCase().indexOf('android')) {
    contentDisposition += ' filename=' + makeAndroidSafeFileName(filename);
  } else {
    if (containsAllAsciiNP(filename)) {
      contentDisposition += ' filename=' + filename;
    } else {
      contentDisposition += ' filename*=UTF-8\'\'' + encodeRFC5987ValueChars(filename);
    }
  }
  return contentDisposition;
}
exports.getContentDisposition = getContentDisposition;
exports.getContentDispositionS3 = getContentDispositionS3;
function downloadUrlPromise(uri, optTimeout, optLimit) {
  return new Promise(function (resolve, reject) {
    //todo может стоит делать url.parse, а потом с каждой частью отдельно работать
    //для ссылок с руссикими буквами приходит 404
    if (!containsAllAsciiNP(uri)) {
      uri = encodeURI(uri);
    }
    var urlParsed = url.parse(uri);
    //if you expect binary data, you should set encoding: null
    var options = {uri: urlParsed, encoding: null, timeout: optTimeout};
    if (urlParsed.protocol === 'https:') {
      //TODO: Check how to correct handle a ssl link
      urlParsed.rejectUnauthorized = false;
      options.rejectUnauthorized = false;
    }
    request.get(options, function (err, response, body) {
      if (err) {
        reject(err);
      } else {
        var correctSize = (!optLimit || body.length < optLimit);
        if (response.statusCode == 200 && correctSize) {
          resolve(body);
        } else {
          if (!correctSize) {
            var e = new Error('Error response: statusCode:' + response.statusCode + ' ;body.length:' + body.length);
            e.code = 'EMSGSIZE';
            reject(e);
          } else {
            reject(new Error('Error response: statusCode:' + response.statusCode + ' ;body:\r\n' + body));
          }
        }
      }
    })
  });
}
function postRequestPromise(uri, postData, optTimeout) {
  return new Promise(function(resolve, reject) {
    //todo может стоит делать url.parse, а потом с каждой частью отдельно работать
    //для ссылок с руссикими буквами приходит 404
    if (!containsAllAsciiNP(uri)) {
      uri = encodeURI(uri);
    }
    var urlParsed = url.parse(uri);
    var options = {uri: urlParsed, body: postData, encoding: 'utf8', headers: {'Content-Type': 'application/json'}, timeout: optTimeout};
    if (urlParsed.protocol === 'https:') {
      //TODO: Check how to correct handle a ssl link
      urlParsed.rejectUnauthorized = false;
      options.rejectUnauthorized = false;
    }
    request.post(options, function(err, response, body) {
      if (err) {
        reject(err);
      } else {
        if (200 == response.statusCode || 204 == response.statusCode) {
          resolve(body);
        } else {
          reject(new Error('Error response: statusCode:' + response.statusCode + ' ;body:\r\n' + body));
        }
      }
    })
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
    case constants.CONVERT_DOWNLOAD :
      res = -4;
      break;
    case constants.CONVERT_TIMEOUT :
      res = -2;
      break;
    case constants.CONVERT_MS_OFFCRYPTO :
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
exports.fillXmlResponse = function(res, uri, error) {
  var xml = '<?xml version="1.0" encoding="utf-8"?><FileResult>';
  if (constants.NO_ERROR != error) {
    xml += '<Error>' + exports.encodeXml(exports.mapAscServerErrorToOldError(error).toString()) + '</Error>';
  } else {
    if (uri) {
      xml += '<FileUrl>' + exports.encodeXml(uri) + '</FileUrl>';
    } else {
      xml += '<FileUrl/>';
    }
    xml += '<Percent>' + (uri ? '100' : '0') + '</Percent>';
    xml += '<EndConvert>' + (uri ? 'True' : 'False') + '</EndConvert>';
  }
  xml += '</FileResult>';
  var body = new Buffer(xml, 'utf-8');
  res.setHeader('Content-Type', 'text/xml; charset=UTF-8');
  res.setHeader('Content-Length', body.length);
  res.send(body);
};
exports.promiseCreateWriteStream = function(strPath, optOptions) {
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
exports.promiseCreateReadStream = function(strPath) {
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
function makeCRCTable() {
  var c;
  var crcTable = [];
  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  return crcTable;
}
var crcTable;
exports.crc32 = function(str) {
  var crcTable = crcTable || (crcTable = makeCRCTable());
  var crc = 0 ^ (-1);

  for (var i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
  }

  return (crc ^ (-1)) >>> 0;
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
function getBaseUrl(protocol, hostHeader, forwardedProtoHeader, forwardedHostHeader) {
  var url = '';
  if (forwardedProtoHeader) {
    url += forwardedProtoHeader;
  } else if (protocol) {
    url += protocol;
  } else {
    url += 'http';
  }
  url += '://';
  if (forwardedHostHeader) {
    url += forwardedHostHeader;
  } else if (hostHeader) {
    url += hostHeader;
  } else {
    url += 'localhost';
  }
  return url;
}
function getBaseUrlByConnection(conn) {
  return getBaseUrl('', conn.headers['host'], conn.headers['x-forwarded-proto'], conn.headers['x-forwarded-host']);
}
function getBaseUrlByRequest(req) {
  return getBaseUrl(req.protocol, req.get('host'), req.get('x-forwarded-proto'), req.get('x-forwarded-host'));
}
exports.getBaseUrlByConnection = getBaseUrlByConnection;
exports.getBaseUrlByRequest = getBaseUrlByRequest;
function stream2Buffer(stream) {
  return new Promise(function(resolve, reject) {
    if (!stream.readable) {
      resolve(new Buffer());
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
