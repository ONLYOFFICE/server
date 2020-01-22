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

const path = require('path');
var config = require('config');
var co = require('co');
const locale = require('windows-locale');
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
var storageBase = require('./../../Common/sources/storage-base');

var CONVERT_ASYNC_DELAY = 1000;

var clientStatsD = statsDClient.getClient();

function* getConvertStatus(cmd, selectRes, baseUrl, opt_fileTo) {
  var status = {end: false, url: undefined, err: constants.NO_ERROR};
  if (selectRes.length > 0) {
    var docId = cmd.getDocId();
    var row = selectRes[0];
    switch (row.status) {
      case taskResult.FileStatus.Ok:
        status.end = true;
        if (opt_fileTo) {
          status.url = yield storage.getSignedUrl(baseUrl, docId + '/' + opt_fileTo,
                                                  commonDefines.c_oAscUrlTypes.Temporary, cmd.getTitle());
        }
        break;
      case taskResult.FileStatus.Err:
      case taskResult.FileStatus.ErrToReload:
      case taskResult.FileStatus.NeedPassword:
        status.err = row.status_info;
        if (taskResult.FileStatus.ErrToReload == row.status || taskResult.FileStatus.NeedPassword == row.status) {
          yield canvasService.cleanupCache(docId);
        }
        break;
      case taskResult.FileStatus.NeedParams:
      case taskResult.FileStatus.SaveVersion:
      case taskResult.FileStatus.UpdateVersion:
        status.err = constants.UNKNOWN;
        break;
    }
    var lastOpenDate = row.last_open_date;
    if (new Date().getTime() - lastOpenDate.getTime() > utils.CONVERTION_TIMEOUT) {
      status.err = constants.CONVERT_TIMEOUT;
    }
  } else {
    status.err = constants.UNKNOWN;
  }
  return status;
}

function* convertByCmd(cmd, async, baseUrl, opt_fileTo, opt_taskExist, opt_priority, opt_expiration, opt_queue) {
  var docId = cmd.getDocId();
  var startDate = null;
  if (clientStatsD) {
    startDate = new Date();
  }
  logger.debug('Start convert request docId = %s', docId);

  let bCreate = false;
  if (!opt_taskExist) {
    let task = new taskResult.TaskResultData();
    task.key = docId;
    task.status = taskResult.FileStatus.WaitQueue;
    task.statusInfo = constants.NO_ERROR;

    let upsertRes = yield taskResult.upsert(task);
    //if CLIENT_FOUND_ROWS don't specify 1 row is inserted , 2 row is updated, and 0 row is set to its current values
    //http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
    bCreate = upsertRes.affectedRows == 1;
  }
  var selectRes;
  var status;
  if (!bCreate) {
    selectRes = yield taskResult.select(docId);
    status = yield* getConvertStatus(cmd, selectRes, baseUrl, opt_fileTo);
  } else {
    var queueData = new commonDefines.TaskQueueData();
    queueData.setCmd(cmd);
    if (opt_fileTo) {
      queueData.setToFile(opt_fileTo);
    }
    queueData.setFromOrigin(true);
    var priority = null != opt_priority ? opt_priority : constants.QUEUE_PRIORITY_LOW
    yield* docsCoServer.addTask(queueData, priority, opt_queue, opt_expiration);
    status = {end: false, url: undefined, err: constants.NO_ERROR};
  }
  //wait
  if (!async) {
    var waitTime = 0;
    while (true) {
      if (status.end || constants.NO_ERROR != status.err) {
        break;
      }
      yield utils.sleep(CONVERT_ASYNC_DELAY);
      selectRes = yield taskResult.select(docId);
      status = yield* getConvertStatus(cmd, selectRes, baseUrl, opt_fileTo);
      waitTime += CONVERT_ASYNC_DELAY;
      if (waitTime > utils.CONVERTION_TIMEOUT) {
        status.err = constants.CONVERT_TIMEOUT;
      }
    }
  }
  logger.debug('End convert request end %s url %s status %s docId = %s', status.end, status.url, status.err, docId);
  if (clientStatsD) {
    clientStatsD.timing('coauth.convertservice', new Date() - startDate);
  }
  return status;
}

function* convertFromChanges(docId, baseUrl, forceSave, opt_userdata, opt_userConnectionId, opt_priority,
                             opt_expiration, opt_queue, opt_redisKey) {
  var cmd = new commonDefines.InputCommand();
  cmd.setCommand('sfcm');
  cmd.setDocId(docId);
  cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_OTHER_TEAMLAB_INNER);
  cmd.setEmbeddedFonts(false);
  cmd.setCodepage(commonDefines.c_oAscCodePageUtf8);
  cmd.setDelimiter(commonDefines.c_oAscCsvDelimiter.Comma);
  cmd.setForceSave(forceSave);
  if (opt_userdata) {
    cmd.setUserData(opt_userdata);
  }
  if (opt_userConnectionId) {
    cmd.setUserConnectionId(opt_userConnectionId);
  }
  if (opt_redisKey) {
    cmd.setRedisKey(opt_redisKey);
  }

  yield* canvasService.commandSfctByCmd(cmd, opt_priority, opt_expiration, opt_queue);
  return yield* convertByCmd(cmd, true, baseUrl, constants.OUTPUT_NAME, undefined, opt_priority, opt_expiration, opt_queue);
}
function parseIntParam(val){
  return (typeof val === 'string') ? parseInt(val) : val;
}

function convertRequest(req, res, isJson) {
  return co(function* () {
    var docId = 'convertRequest';
    try {
      let params;
      let authRes = docsCoServer.getRequestParams(docId, req);
      if(authRes.code === constants.NO_ERROR){
        params = authRes.params;
      } else {
        utils.fillResponse(req, res, undefined, authRes.code, isJson);
        return;
      }
      let outputtype = params.outputtype || '';
      let outputFormat = formatChecker.getFormatFromString(outputtype);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        utils.fillResponse(req, res, undefined, constants.CONVERT_PARAMS, isJson);
        return;
      }
      var cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setUrl(params.url);
      cmd.setEmbeddedFonts(false);//params.embeddedfonts'];
      cmd.setFormat(params.filetype);
      docId = 'conv_' + params.key + '_' + outputtype;
      cmd.setDocId(docId);
      cmd.setOutputFormat(outputFormat);
      let outputExt = formatChecker.getStringFromFormat(cmd.getOutputFormat());
      var fileTo = constants.OUTPUT_NAME + '.' + outputExt;
      cmd.setCodepage(commonDefines.c_oAscEncodingsMap[params.codePage] || commonDefines.c_oAscCodePageUtf8);
      cmd.setDelimiter(parseIntParam(params.delimiter) || commonDefines.c_oAscCsvDelimiter.Comma);
      if(undefined != params.delimiterChar)
        cmd.setDelimiterChar(params.delimiterChar);
      if (params.region && locale[params.region.toLowerCase()]) {
        cmd.setLCID(locale[params.region.toLowerCase()].id);
      }
      if (params.spreadsheetLayout) {
        cmd.setJsonParams(JSON.stringify({'spreadsheetLayout': params.spreadsheetLayout}));
      }
      cmd.setPassword(params.password);
      cmd.setWithAuthorization(true);
      var thumbnail = params.thumbnail;
      if (thumbnail) {
        if (typeof thumbnail === 'string') {
          thumbnail = JSON.parse(thumbnail);
        }
        var thumbnailData = new commonDefines.CThumbnailData(thumbnail);
        //constants from CXIMAGE_FORMAT_
        switch (cmd.getOutputFormat()) {
          case constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG:
            thumbnailData.setFormat(3);
            break;
          case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG:
            thumbnailData.setFormat(4);
            break;
          case constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF:
            thumbnailData.setFormat(2);
            break;
          case constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP:
            thumbnailData.setFormat(1);
            break;
        }
        cmd.setThumbnail(thumbnailData);
        cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_IMAGE);
        if (false == thumbnailData.getFirst()) {
          outputExt = 'zip';
        }
      }
      if (params.title) {
        cmd.setTitle(path.basename(params.title, path.extname(params.title)) + '.' + outputExt);
      }
      var async = (typeof params.async === 'string') ? 'true' == params.async : params.async;

      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== cmd.getOutputFormat()) {
        var status = yield* convertByCmd(cmd, async, utils.getBaseUrlByRequest(req), fileTo);
        utils.fillResponse(req, res, status.url, status.err, isJson);
      } else {
        var addresses = utils.forwarded(req);
        logger.warn('Error convert unknown outputtype: query = %j from = %s docId = %s', params, addresses, docId);
        utils.fillResponse(req, res, undefined, constants.UNKNOWN, isJson);
      }
    }
    catch (e) {
      logger.error('Error convert: docId = %s\r\n%s', docId, e.stack);
      utils.fillResponse(req, res, undefined, constants.UNKNOWN, isJson);
    }
  });
}
function convertRequestJson(req, res) {
  return convertRequest(req, res, true);
}
function convertRequestXml(req, res) {
  return convertRequest(req, res, false);
}

function builderRequest(req, res) {
  return co(function* () {
    let docId = 'builderRequest';
    try {
      let authRes;
      if (!utils.isEmptyObject(req.query)) {
        //todo this is a stub for compatibility. remove in future version
        authRes = docsCoServer.getRequestParams(docId, req, true, true);
      } else {
        authRes = docsCoServer.getRequestParams(docId, req);
      }

      let params = authRes.params;
      let error = authRes.code;
      let urls;
      let end = false;
      if (error === constants.NO_ERROR &&
        (params.key || params.url || (req.body && Buffer.isBuffer(req.body) && req.body.length > 0))) {
        docId = params.key;
        let cmd = new commonDefines.InputCommand();
        cmd.setCommand('builder');
        cmd.setIsBuilder(true);
        cmd.setWithAuthorization(true);
        cmd.setDocId(docId);
        if (!docId) {
          let task = yield* taskResult.addRandomKeyTask(undefined, 'bld_', 8);
          docId = task.key;
          cmd.setDocId(docId);
          if (params.url) {
            cmd.setUrl(params.url);
            cmd.setFormat('docbuilder');
          } else {
            yield storageBase.putObject(docId + '/script.docbuilder', req.body, req.body.length);
          }
          let queueData = new commonDefines.TaskQueueData();
          queueData.setCmd(cmd);
          yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
        }
        let async = (typeof params.async === 'string') ? 'true' === params.async : params.async;
        let status = yield* convertByCmd(cmd, async, utils.getBaseUrlByRequest(req), undefined, true);
        end = status.end;
        error = status.err;
        if (end) {
          urls = yield storageBase.getSignedUrls(utils.getBaseUrlByRequest(req), docId + '/output',
                                                 commonDefines.c_oAscUrlTypes.Temporary);
        }
      } else if (error === constants.NO_ERROR) {
        error = constants.UNKNOWN;
      }
      logger.debug('End builderRequest request: docId = %s urls = %j end = %s error = %s', docId, urls, end, error);
      utils.fillResponseBuilder(res, docId, urls, end, error);
    }
    catch (e) {
      logger.error('Error builderRequest: docId = %s\r\n%s', docId, e.stack);
      utils.fillResponseBuilder(res, undefined, undefined, undefined, constants.UNKNOWN);
    }
  });
}

exports.convertFromChanges = convertFromChanges;
exports.convertJson = convertRequestJson;
exports.convertXml = convertRequestXml;
exports.builder = builderRequest;
