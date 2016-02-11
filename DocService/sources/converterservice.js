var config = require('config');
var taskResult = require('./taskresult');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var commonDefines = require('./../../Common/sources/commondefines');
var docsCoServer = require('./DocsCoServer');
var canvasService = require('./canvasservice');
var storage = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var statsDClient = require('./../../Common/sources/statsdclient');

var cfgVisibilityTimeout = config.get('queue.visibilityTimeout');
var cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');

var CONVERT_TIMEOUT = 1.5 * (cfgVisibilityTimeout + cfgQueueRetentionPeriod) * 1000;
var CONVERT_ASYNC_DELAY = 1000;

var clientStatsD = statsDClient.getClient();

function* getConvertStatus(cmd, selectRes, baseUrl) {
  var status = {url: undefined, err: constants.NO_ERROR};
  if (selectRes.length > 0) {
    var docId = cmd.getDocId();
    var row = selectRes[0];
    switch (row.tr_status) {
      case taskResult.FileStatus.Ok:
        status.url = yield storage.getSignedUrl(baseUrl, docId + '/' + cmd.getTitle());
        break;
      case taskResult.FileStatus.Err:
      case taskResult.FileStatus.ErrToReload:
        status.err = row.tr_status_info;
        //todo
        if (taskResult.FileStatus.ErrToReload == row.tr_status) {
          yield taskResult.remove(docId);
        }
        break;
      case taskResult.FileStatus.NeedParams:
      case taskResult.FileStatus.SaveVersion:
      case taskResult.FileStatus.UpdateVersion:
        status.err = constants.UNKNOWN;
        break;
    }
    var lastOpenDate = row.tr_last_open_date;
    if (new Date().getTime() - lastOpenDate.getTime() > CONVERT_TIMEOUT) {
      status.err = constants.CONVERT_TIMEOUT;
    }
  }
  return status;
}

function* convertByCmd(cmd, async, baseUrl) {
  var docId = cmd.getDocId();
  var startDate = null;
  if (clientStatsD) {
    startDate = new Date();
  }
  logger.debug('Start convert request docId = %s', docId);

  var task = new taskResult.TaskResultData();
  task.key = docId;
  task.format = cmd.getFormat();
  task.status = taskResult.FileStatus.WaitQueue;
  task.statusInfo = constants.NO_ERROR;
  task.title = cmd.getTitle();

  var upsertRes = yield taskResult.upsert(task);
  //if CLIENT_FOUND_ROWS don't specify 1 row is inserted , 2 row is updated, and 0 row is set to its current values
  //http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
  var bCreate = upsertRes.affectedRows == 1;
  var selectRes;
  var status;
  if (!bCreate) {
    selectRes = yield taskResult.select(task);
    status = yield* getConvertStatus(cmd, selectRes, baseUrl);
  } else {
    var queueData = new commonDefines.TaskQueueData();
    queueData.setCmd(cmd);
    queueData.setToFile(cmd.getTitle());
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
    status = {url: undefined, err: constants.NO_ERROR};
  }
  //wait
  if (!async) {
    var waitTime = 0;
    while (true) {
      if (status.url || constants.NO_ERROR != status.err) {
        break;
      }
      yield utils.sleep(CONVERT_ASYNC_DELAY);
      selectRes = yield taskResult.select(task);
      status = yield* getConvertStatus(cmd, selectRes, baseUrl);
      waitTime += CONVERT_ASYNC_DELAY;
      if (waitTime > CONVERT_TIMEOUT) {
        status.err = constants.CONVERT_TIMEOUT;
      }
    }
  }
  logger.debug('End convert request url %s status %s docId = %s', status.url, status.err, docId);
  if (clientStatsD) {
    clientStatsD.timing('coauth.convertservice', new Date() - startDate);
  }
  return status;
}

function* convertFromChanges(docId, baseUrl) {
  var cmd = new commonDefines.InputCommand();
  cmd.setCommand('sfcm');
  cmd.setDocId(docId);
  cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_OTHER_TEAMLAB_INNER);
  cmd.setEmbeddedFonts(false);
  cmd.setCodepage(commonDefines.c_oAscCodePageUtf8);
  cmd.setDelimiter(commonDefines.c_oAscCsvDelimiter.Comma);

  yield* canvasService.commandSfctByCmd(cmd);
  return yield* convertByCmd(cmd, true, baseUrl);
}

function convertRequest(req, res) {
  utils.spawn(function* () {
    var docId = 'null';
    try {
      var cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setVKey(req.query['vkey']);
      cmd.setUrl(req.query['url']);
      cmd.setEmbeddedFonts(false);//req.query['embeddedfonts'];
      cmd.setFormat(req.query['filetype']);
      var outputtype = req.query['outputtype'];
      docId = 'conv_' + req.query['key'] + '_' + outputtype;
      cmd.setDocId(docId);
      cmd.setTitle(constants.OUTPUT_NAME + '.' + outputtype);
      cmd.setOutputFormat(formatChecker.getFormatFromString(outputtype));
      cmd.setCodepage(commonDefines.c_oAscEncodingsMap[req.query['codePage']] || commonDefines.c_oAscCodePageUtf8);
      cmd.setDelimiter(req.query['delimiter'] || commonDefines.c_oAscCsvDelimiter.Comma);
      var async = 'true' == req.query['async'];

      var status = yield* convertByCmd(cmd, async, utils.getBaseUrlByRequest(req));
      utils.fillXmlResponse(res, status.url, status.err);
    }
    catch (e) {
      logger.error('Error convert: docId = %s\r\n%s', docId, e.stack);
      utils.fillXmlResponse(res, undefined, constants.UNKNOWN);
    }
  });
}

exports.convertFromChanges = convertFromChanges;
exports.convert = convertRequest;
