var config = require('config').get('services.CoAuthoring');
var co = require('co');
var taskResult = require('./taskresult');
var storage = require('./../../Common/sources/storage-base');
var utils = require('./../../Common/sources/utils');
var logger = require('./../../Common/sources/logger');

var cfgExpFiles = config.get('expire.files');
var cfgExpFilesRemovedAtOnce = config.get('expire.filesremovedatonce');

//todo checkDocumentExpire
var checkFileExpire = function() {
  return co(function* () {
    try {
      logger.debug('checkFileExpire start');
      var expired;
      var removedCount = 0;
      var currentRemovedCount;
      do {
        currentRemovedCount = 0;
        expired = yield taskResult.getExpired(cfgExpFilesRemovedAtOnce, cfgExpFiles);
        for (var i = 0; i < expired.length; ++i) {
          var docId = expired[i].tr_key;
          //todo drop user
          var removeRes = yield taskResult.remove(docId);
          //если ничего не удалилось, значит это сделал другой процесс
          if (removeRes.affectedRows > 0) {
            currentRemovedCount++;
            yield storage.deletePath(docId);
          }
        }
        removedCount += currentRemovedCount;
      } while (currentRemovedCount > 0);
      logger.debug('checkFileExpire end: removedCount = %d', removedCount);
    } catch (e) {
      logger.error('checkFileExpire error:\r\n%s', e.stack);
    }
  });
};
exports.checkFileExpire = checkFileExpire;
