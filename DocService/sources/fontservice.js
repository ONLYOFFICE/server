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
var util = require('util');
var transform = require('stream').Transform;
var base64 = require('base64-stream');
var mime = require('mime');
var co = require('co');
var utils = require('./../../Common/sources/utils');
var logger = require('./../../Common/sources/logger');
var statsDClient = require('./../../Common/sources/statsdclient');
var config = require('config').get('services.CoAuthoring.utils');

var cfgFontDir = config.get('utils_common_fontdir');
var cfgSearchPatterns = config.get('utils_fonts_search_patterns');
var cfgResourceExpires = config.get('resource_expires');

var JS_EXTENTION = '.js';
var BYTE_MAX_VALUE = 255;
var GUID_ODTTF = [0xA0, 0x66, 0xD6, 0x20, 0x14, 0x96, 0x47, 0xfa, 0x95, 0x69, 0xB8, 0x50, 0xB0, 0x41, 0x49, 0x48];

var fontNameToFullPath = {};
var clientStatsD = statsDClient.getClient();

function ZBase32Encoder() {
  this.encodingTable = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  this.decodingTable = new Uint8Array(128);
  var i;
  for (i = 0; i < this.decodingTable.length; ++i) {
    this.decodingTable[i] = BYTE_MAX_VALUE;
  }
  for (i = 0; i < this.encodingTable.length; ++i) {
    this.decodingTable[this.encodingTable.charCodeAt(i)] = i;
  }
}
ZBase32Encoder.prototype = {
  decode: function(data) {
    if (!data) {
      return '';
    }
    var result = new Buffer(Math.floor(data.length * 5.0 / 8.0));
    var resultIndex = 0;
    var index = new Int8Array(8);
    var dataContainer = {data: data};
    for (var i = 0; i < data.length;) {

      i = this.createIndexByOctetAndMovePosition(dataContainer, i, index);

      var shortByteCount = 0;
      //avoid Bitwise Operators because buffer became (2^40)
      //JavaScript converts operands to 32-bit signed ints before doing bitwise operations
      var buffer = 0;
      for (var j = 0; j < 8 && index[j] != -1; ++j) {
        buffer = (buffer * 32) + (this.decodingTable[index[j]] & 0x1f);
        shortByteCount++;
      }
      var bitCount = shortByteCount * 5;
      while (bitCount >= 8) {
        result[resultIndex++] = (buffer / Math.pow(2, bitCount - 8)) & 0xff;
        bitCount -= 8;
      }
    }
    return result.toString('utf8', 0, resultIndex);
  },
  createIndexByOctetAndMovePosition: function(container, currentPosition, index) {
    var j = 0;
    while (j < 8) {
      if (currentPosition >= container.data.length) {
        index[j++] = -1;
        continue;
      }

      if (this.ignoredSymbol(container.data.charCodeAt(currentPosition))) {
        currentPosition++;
        continue;
      }

      index[j] = container.data.charCodeAt(currentPosition);
      j++;
      currentPosition++;
    }

    return currentPosition;
  },
  ignoredSymbol: function(checkedSymbol) {
    return checkedSymbol >= this.decodingTable.length || this.decodingTable[checkedSymbol] == BYTE_MAX_VALUE;
  }
};

function OdttfProtocol(options, fileSize) {
  if (!(this instanceof OdttfProtocol)) {
    return new OdttfProtocol(options);
  }
  transform.call(this, options);
  this._inBody = false;
  this._rawHeaderLength = 0;
  this._rawHeader = [];
  this._threshold = Math.min(2 * GUID_ODTTF.length, fileSize);
}
util.inherits(OdttfProtocol, transform);
OdttfProtocol.prototype._transform = function(chunk, encoding, done) {
  if (!this._inBody) {
    this._rawHeaderLength += chunk.length;
    if (this._rawHeaderLength >= this._threshold) {
      var data;
      if (this._rawHeader.length > 0) {
        this._rawHeader.push(chunk);
        data = Buffer.concat(this._rawHeader);
      } else {
        data = chunk;
      }
      for (var i = 0; i < this._threshold; ++i) {
        data[i] ^= GUID_ODTTF[i % 16];
      }
      this.push(data);
      this._inBody = true;
    } else {
      this._rawHeader.push(chunk);
    }
  } else {
    this.push(chunk);
  }
  done();
};

function* initFontMapByFolder(fontDir, patterns) {
  //todo remove replace
  patterns = patterns.replace(/\*/g, '');
  var searchPatterns = patterns.split(/[|,;]/);
  var files = yield utils.listObjects(fontDir);
  for (var i = 0; i < files.length; ++i) {
    var file = files[i];
    if (-1 != searchPatterns.indexOf(path.extname(file).toLowerCase())) {
      fontNameToFullPath[path.basename(file).toLowerCase()] = file;
    }
  }
}
function getJsContent(res, fileStream, fileSize, filename) {
  return new Promise(function(resolve, reject) {
    res.write(new Buffer('window["' + filename + '"] = "' + fileSize + ';', 'utf8'));
    var tmpStream = fileStream.pipe(base64.encode());
    fileStream.on('error', function(e) {
      reject(e);
    });
    tmpStream.pipe(res, {end: false});
    tmpStream.on('end', function() {
      res.write(new Buffer('";', 'utf8'));
      resolve();
    });
    tmpStream.on('error', function(e) {
      reject(e);
    });
  });
}
function getObfuscateContent(res, fileStream, fileSize) {
  return new Promise(function(resolve, reject) {
    var tmpStream = fileStream.pipe(new OdttfProtocol(undefined, fileSize));
    fileStream.on('error', function(e) {
      reject(e);
    });
    tmpStream.pipe(res, {end: false});
    tmpStream.on('end', function() {
      resolve();
    });
    tmpStream.on('error', function(e) {
      reject(e);
    });
  });
}
function init() {
  return co(function* () {
    try {
      if (cfgFontDir) {
        yield* initFontMapByFolder(cfgFontDir, cfgSearchPatterns || '*.ttf;*.ttc;*.otf');
      } else {
        logger.error('empty font dir');
        //initFontMapBySysFont();
      }
    } catch (e) {
      logger.error('error init:\r\n%s', e.stack);
    }
  });
}
init();
var zBase32Encoder = new ZBase32Encoder();

exports.getFont = function(req, res) {
  return co(function* () {
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      logger.debug('Start getFont request');
      var fontname = req.params.fontname;
      logger.debug('fontname:' + fontname);

      var fontExt = path.extname(fontname);
      var fontnameDecoded;
      if (JS_EXTENTION == fontExt) {
        fontnameDecoded = zBase32Encoder.decode(path.basename(fontname, fontExt));
      } else {
        fontnameDecoded = zBase32Encoder.decode(fontname);
      }
      logger.debug('fontnameDecoded:' + fontnameDecoded);

      var fontnameDecodedExt = path.extname(fontnameDecoded);
      var realFontName;
      if (JS_EXTENTION == fontnameDecodedExt) {
        realFontName = path.basename(fontnameDecoded, fontnameDecodedExt);
      } else {
        realFontName = fontnameDecoded;
      }

      var filePath = fontNameToFullPath[realFontName.toLowerCase()];
      if (filePath) {
        var stats = yield utils.fsStat(filePath);
        var lastModified = stats.mtime;
        var eTag = lastModified.getTime().toString(16);

        var requestIfModSince = req.headers['if-modified-since'];
        var requestETag = req.headers['if-none-match'];
        if ((requestETag || requestIfModSince) && (!requestETag || requestETag == eTag) &&
          (!requestIfModSince || Math.abs(new Date(requestIfModSince).getTime() - lastModified.getTime()) < 1000)) {
          res.sendStatus(304);
        } else {
          var expires = new Date();
          utils.addSeconds(expires, cfgResourceExpires);
          res.set({
            'Cache-Control': 'public',
            'Expires': expires.toUTCString(),
            'Content-Type': mime.lookup(fontnameDecoded),
            'Content-Disposition': utils.getContentDisposition(fontname, req.headers['user-agent']),
            'ETag': eTag,
            'Last-Modified': lastModified.toUTCString()
          });
          var fileStream = yield utils.promiseCreateReadStream(filePath);
          if (JS_EXTENTION == fontnameDecodedExt) {
            yield getJsContent(res, fileStream, stats.size, realFontName);
          } else {
            yield getObfuscateContent(res, fileStream, stats.size);
          }
          res.end();
        }
      } else {
        res.sendStatus(404);
      }
      logger.debug('End getFont request');
      if(clientStatsD) {
        clientStatsD.timing('coauth.getFont', new Date() - startDate);
      }
    }
    catch (e) {
      logger.error('error getFont:\r\n%s', e.stack);
      res.sendStatus(400);
    }
  });
};
