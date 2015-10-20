var multiparty = require('multiparty');
var taskResult = require('./taskresult');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var storageBase = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var logger = require('./../../Common/sources/logger');
var config = require('config');
var configServer = config.get('services.CoAuthoring.server');
var configUtils = config.get('services.CoAuthoring.utils');

var cfgImageSize = configServer.get('limits_image_size');
var cfgTypesUpload = configUtils.get('limits_image_types_upload');

exports.uploadTempFile = function(req, res) {
  utils.spawn(function* () {
    var docId = 'null';
    try {
      docId = req.query['key'];
      var vkey = req.query['vkey'];
      logger.debug('Start uploadTempFile: docId = %s', docId);
      if (docId && req.body && Buffer.isBuffer(req.body)) {
        //todo vkey
        var task = yield* taskResult.addRandomKeyTask(docId);
        var strPath = task.key + '/' + docId + '.tmp';
        yield storageBase.putObject(strPath, req.body, req.body.length);
        var url = yield storageBase.getSignedUrl(utils.getBaseUrlByRequest(req), strPath);
        utils.fillXmlResponse(res, url, constants.NO_ERROR);
      } else {
        utils.fillXmlResponse(res, undefined, constants.UNKNOWN);
      }
      logger.debug('End uploadTempFile: docId = %s', docId);
    }
    catch (e) {
      logger.error('Error uploadTempFile: docId = %s\r\n%s', docId, e.stack);
      utils.fillXmlResponse(res, undefined, constants.UNKNOWN);
    }
  });
};
exports.uploadImageFileOld = function(req, res) {
  var docId = req.params.docid;
  logger.debug('Start uploadImageFileOld: docId = %s', docId);
  var userid = req.params.userid;
  var vkey = req.params.vkey;
  var index = parseInt(req.params.index);
  var listImages = [];
  //todo userid
  //todo vkey
  if (docId && index) {
    var isError = false;
    var form = new multiparty.Form();
    form.on('error', function(err) {
      logger.error('Error parsing form: docId = %s\r\n%s', docId, err.toString());
      res.sendStatus(400);
    });
    form.on('part', function(part) {
      if (!part.filename) {
        // ignore field's content
        part.resume();
      }
      if (part.filename) {
        if (part.byteCount > cfgImageSize) {
          isError = true;
        }
        if (isError) {
          part.resume();
        } else {
          //в начале пишется хеш, чтобы избежать ошибок при параллельном upload в совместном редактировании
          var strImageName = utils.crc32(userid).toString(16) + '_image' + (parseInt(index) + listImages.length);
          var strPath = docId + '/media/' + strImageName + '.jpg';
          listImages.push(strPath);
          utils.stream2Buffer(part).then(function(buffer) {
            return storageBase.putObject(strPath, buffer, buffer.length);
          }).then(function() {
            part.resume();
          }).catch(function(err) {
            logger.error('Upload putObject: docId = %s\r\n%s', docId, err.stack);
            isError = true;
            part.resume();
          });
        }
      }
      part.on('error', function(err) {
        logger.error('Error parsing form part: docId = %s\r\n%s', docId, err.toString());
      });
    });
    form.on('close', function() {
      if (isError) {
        res.sendStatus(400);
      } else {
        storageBase.getSignedUrlsByArray(utils.getBaseUrlByRequest(req), listImages, docId).then(function(urls) {
            var outputData = {'type': 0, 'error': constants.NO_ERROR, 'urls': urls, 'input': req.query};
            var output = '<html><head><script type="text/javascript">function load(){ parent.postMessage("';
            output += JSON.stringify(outputData).replace(/"/g, '\\"');
            output += '", "*"); }</script></head><body onload="load()"></body></html>';

            //res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(output);
            logger.debug('End uploadImageFileOld: docId = %s %s', docId, output);
          }
        ).catch(function(err) {
            res.sendStatus(400);
            logger.error('upload getSignedUrlsByArray: docId = %s\r\n%s', docId, err.stack);
          });
      }
    });
    form.parse(req);
  } else {
    logger.debug('Error params uploadImageFileOld: docId = %s', docId);
    res.sendStatus(400);
  }
};
exports.uploadImageFile = function(req, res) {
  utils.spawn(function* () {
    var isError = true;
    var docId = 'null';
    try {
      docId = req.params.docid;
      logger.debug('Start uploadImageFile: docId = %s', docId);
      var userid = req.params.userid;
      var vkey = req.params.vkey;
      var index = parseInt(req.params.index);
      if (docId && req.body && Buffer.isBuffer(req.body)) {
        var buffer = req.body;
        var format = formatChecker.getImageFormat(buffer);
        var formatStr = formatChecker.getStringFromFormat(format);
        var supportedFormats = cfgTypesUpload || 'jpg';
        if (-1 !== supportedFormats.indexOf(formatStr) && buffer.length <= cfgImageSize) {
          //в начале пишется хеш, чтобы избежать ошибок при параллельном upload в совместном редактировании
          var strImageName = utils.crc32(userid).toString(16) + '_image' + index;
          var strPathRel = 'media/' + strImageName + '.' + formatStr;
          var strPath = docId + '/' + strPathRel;
          yield storageBase.putObject(strPath, buffer, buffer.length);
          var output = {};
          output[strPathRel] = yield storageBase.getSignedUrl(utils.getBaseUrlByRequest(req), strPath);
          res.send(JSON.stringify(output));
          isError = false;
        }
      }
      logger.debug('End uploadImageFile: isError = %d docId = %s', isError, docId);
    } catch (e) {
      logger.error('Error uploadImageFile: docId = %s\r\n%s', docId, e.stack);
    } finally {
      if (isError) {
        res.sendStatus(400);
      }
    }
  });
};
