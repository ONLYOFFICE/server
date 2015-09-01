var taskResult = require('./taskresult');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var commonDefines = require('./../../Common/sources/commondefines');
var docsCoServer = require('./DocsCoServer');
var storage = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
//var config = require('./config.json');

//todo
var CONVERT_TIMEOUT = 6 * 60 * 1000;
var CONVERT_ASYNC_DELAY = 1000;

function* getConvertStatus(cmd, selectRes, req) {
  var status = {url: undefined, err: constants.NO_ERROR};
  if (selectRes.length > 0) {
    var row = selectRes[0];
    switch (row.tr_status) {
      case taskResult.FileStatus.Ok:
        status.url = yield storage.getSignedUrl(utils.getBaseUrlByRequest(req), cmd.getDocId() + '/' + cmd.getTitle());
        break;
      case taskResult.FileStatus.Err:
      case taskResult.FileStatus.ErrToReload:
        status.err = row.tr_status_info;
        break;
    }
    var lastOpenDate = row.tr_last_open_date;
    //todo
    if (new Date().getTime() - lastOpenDate.getTime() > CONVERT_TIMEOUT) {
      status.err = constants.UNKNOWN;
    }
  }
  return status;
}

exports.convert = function(req, res) {
  utils.spawn(function* () {
    try {
      logger.debug('Start convert request');
      var cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setVKey(req.query['vkey']);
      cmd.setUrl(req.query['url']);
      cmd.setEmbeddedFonts(false);//req.query['embeddedfonts'];
      cmd.setFormat(req.query['filetype']);
      var outputtype = req.query['outputtype'];
      cmd.setDocId('conv_' + req.query['key'] + '_' + outputtype);
      cmd.setTitle('output.' + outputtype);
      cmd.setOutputFormat(formatChecker.getFormatFromString(outputtype));
      cmd.setCodepage(req.query['codePage']);
      cmd.setCodepage(req.query['delimiter']);
      var async = 'true' == req.query['async'];

      var task = new taskResult.TaskResultData();
      task.key = cmd.getDocId();
      task.format = cmd.getFormat();
      task.status = taskResult.FileStatus.WaitQueue;
      task.statusInfo = constants.NO_ERROR;
      task.title = cmd.getTitle();

      var upsertRes = yield taskResult.upsert(task);
      //var bCreate = (upsertRes.affectedRows == 1);
      var bExist = (upsertRes.affectedRows > 1);
      var selectRes;
      var status;
      if (bExist) {
        selectRes = yield taskResult.select(task);
        status = yield* getConvertStatus(cmd, selectRes, req);
      } else {
        var queueData = new commonDefines.TaskQueueData();
        queueData.setCmd(cmd);
        queueData.setToFile('output.' + formatChecker.getStringFromFormat(cmd.getOutputFormat()));
        yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
        //wait
        if (!async) {
          var waitTime = 0;
          while (true) {
            yield utils.sleep(CONVERT_ASYNC_DELAY);
            selectRes = yield taskResult.select(task);
            status = yield* getConvertStatus(cmd, selectRes, req);
            waitTime += CONVERT_ASYNC_DELAY;
            if (waitTime > CONVERT_TIMEOUT) {
              status.err = constants.CONVERT_TIMEOUT;
            }
            if (status.url || constants.NO_ERROR != status.err) {
              break;
            }
          }
        } else {
          status = {url: undefined, percent: 0, err: constants.NO_ERROR};
        }
      }
      utils.fillXmlResponse(res, status.url, status.err);
      logger.debug('End convert request');
    }
    catch (e) {
      logger.error('error convert:\r\n%s', e.stack);
      res.sendStatus(400);
    }
  });
};
