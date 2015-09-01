var multiparty = require('multiparty');
var taskResult = require('./taskresult');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var storageBase = require('./../../Common/sources/storage-base');
var logger = require('./../../Common/sources/logger');
var config = require('config').get('services.CoAuthoring.server');

var cfgImageSize = config.get('limits_image_size');

exports.uploadTempFile = function(req, res) {
  utils.spawn(function* () {
    try {
      logger.debug('Start uploadTempFile request');
      var key = req.query['key'];
      var vkey = req.query['vkey'];
      if (key && req.body && Buffer.isBuffer(req.body)) {
        //todo vkey
        var task = yield* taskResult.addRandomKeyTask(key);
        var strPath = task.key + '/' + key + '.tmp';
        yield storageBase.putObject(strPath, req.body, req.body.length);
        var url = yield storageBase.getSignedUrl(utils.getBaseUrlByRequest(req), strPath);
        utils.fillXmlResponse(res, url, constants.NO_ERROR);
      } else {
        utils.fillXmlResponse(res, undefined, constants.UNKNOWN);
      }
      logger.debug('End uploadTempFile request');
    }
    catch (e) {
      logger.error('error uploadTempFile:\r\n%s', e.stack);
      res.sendStatus(400);
    }
  });
};
exports.uploadImageFile = function(req, res) {
  logger.debug('Start uploadImageFile request');
  var key = req.params.docid;
  var userid = req.params.userid;
  var vkey = req.params.vkey;
  var index = parseInt(req.params.index);
  var listImages = [];
  //todo userid
  //todo vkey
  if (key && index) {
    var isError = false;
    var form = new multiparty.Form();
    form.on('error', function(err) {
      logger.debug('Error parsing form: %s', err.toString());
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
          var strPath = key + '/media/' + strImageName + '.jpg';
          listImages.push(strPath);
          utils.stream2Buffer(part).then(function(buffer) {
            return storageBase.putObject(strPath, buffer, buffer.length);
          }).then(function() {
            part.resume();
          }).catch(function(err) {
            logger.error('upload putObject:\r\n%s', err.stack);
            isError = true;
            part.resume();
          });
        }
      }
      part.on('error', function(err) {
        logger.debug('Error parsing form part: %s', err.toString());
      });
    });
    form.on('close', function() {
      if (isError) {
        res.sendStatus(400);
      } else {
        storageBase.getSignedUrlsByArray(utils.getBaseUrlByRequest(req), listImages, key).then(function(urls) {
            var outputData = {'type': 0, 'error': constants.NO_ERROR, 'urls': urls, 'input': req.query};
            var output = '<html><head><script type="text/javascript">function load(){ parent.postMessage("';
            output += JSON.stringify(outputData).replace(/"/g, '\\"');
            output += '", "*"); }</script></head><body onload="load()"></body></html>';

            //res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(output);
            logger.debug('End uploadImageFile request %s', output);
          }
        ).catch(function(err) {
            res.sendStatus(400);
            logger.error('upload getSignedUrlsByArray:\r\n%s', err.stack);
          });
      }
    });
    form.parse(req);
  } else {
    res.sendStatus(400);
  }
}
;
