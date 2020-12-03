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
const crypto = require('crypto');
var pathModule = require('path');
var urlModule = require('url');
var co = require('co');
const ms = require('ms');
const retry = require('retry');
const MultiRange = require('multi-integer-range').MultiRange;
var sqlBase = require('./baseConnector');
var docsCoServer = require('./DocsCoServer');
var taskResult = require('./taskresult');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var commonDefines = require('./../../Common/sources/commondefines');
var storage = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var statsDClient = require('./../../Common/sources/statsdclient');
var config = require('config');
var config_server = config.get('services.CoAuthoring.server');
var config_utils = config.get('services.CoAuthoring.utils');


var cfgTypesUpload = config_utils.get('limits_image_types_upload');
var cfgImageSize = config_server.get('limits_image_size');
var cfgImageDownloadTimeout = config_server.get('limits_image_download_timeout');
var cfgRedisPrefix = config.get('services.CoAuthoring.redis.prefix');
var cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgForgottenFiles = config_server.get('forgottenfiles');
const cfgForgottenFilesName = config_server.get('forgottenfilesname');
const cfgOpenProtectedFile = config_server.get('openProtectedFile');
const cfgExpUpdateVersionStatus = ms(config.get('services.CoAuthoring.expire.updateVersionStatus'));
const cfgCallbackBackoffOptions = config.get('services.CoAuthoring.callbackBackoffOptions');

var SAVE_TYPE_PART_START = 0;
var SAVE_TYPE_PART = 1;
var SAVE_TYPE_COMPLETE = 2;
var SAVE_TYPE_COMPLETE_ALL = 3;

var clientStatsD = statsDClient.getClient();
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;

const retryHttpStatus = new MultiRange(cfgCallbackBackoffOptions.httpStatus);

function OutputDataWrap(type, data) {
  this['type'] = type;
  this['data'] = data;
}
OutputDataWrap.prototype = {
  fromObject: function(data) {
    this['type'] = data['type'];
    this['data'] = new OutputData();
    this['data'].fromObject(data['data']);
  },
  getType: function() {
    return this['type'];
  },
  setType: function(data) {
    this['type'] = data;
  },
  getData: function() {
    return this['data'];
  },
  setData: function(data) {
    this['data'] = data;
  }
};
function OutputData(type) {
  this['type'] = type;
  this['status'] = undefined;
  this['data'] = undefined;
}
OutputData.prototype = {
  fromObject: function(data) {
    this['type'] = data['type'];
    this['status'] = data['status'];
    this['data'] = data['data'];
  },
  getType: function() {
    return this['type'];
  },
  setType: function(data) {
    this['type'] = data;
  },
  getStatus: function() {
    return this['status'];
  },
  setStatus: function(data) {
    this['status'] = data;
  },
  getData: function() {
    return this['data'];
  },
  setData: function(data) {
    this['data'] = data;
  }
};

function* getOutputData(docLogger, cmd, outputData, key, status, statusInfo, optConn, optAdditionalOutput, opt_bIsRestore) {
  var docId = cmd.getDocId();
  docLogger.addContext('docId', docId);
  switch (status) {
    case taskResult.FileStatus.SaveVersion:
    case taskResult.FileStatus.UpdateVersion:
    case taskResult.FileStatus.Ok:
      if(taskResult.FileStatus.Ok == status) {
        outputData.setStatus('ok');
      } else if (taskResult.FileStatus.SaveVersion == status ||
        (!opt_bIsRestore && taskResult.FileStatus.UpdateVersion === status &&
        Date.now() - statusInfo * 60000 > cfgExpUpdateVersionStatus)) {
        if ((optConn && optConn.user.view) || optConn.isCloseCoAuthoring) {
          outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
        } else {
          if (taskResult.FileStatus.UpdateVersion === status) {
            docLogger.warn("UpdateVersion expired");
          }
          var updateMask = new taskResult.TaskResultData();
          updateMask.key = docId;
          updateMask.status = status;
          updateMask.statusInfo = statusInfo;
          var updateTask = new taskResult.TaskResultData();
          updateTask.status = taskResult.FileStatus.Ok;
          updateTask.statusInfo = constants.NO_ERROR;
          var updateIfRes = yield taskResult.updateIf(updateTask, updateMask);
          if (updateIfRes.affectedRows > 0) {
            outputData.setStatus('ok');
          } else {
            outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
          }
        }
      } else {
        outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
      }
      var command = cmd.getCommand();
      if ('open' != command && 'reopen' != command && !cmd.getOutputUrls()) {
        var strPath = key + '/' + cmd.getOutputPath();
        if (optConn) {
          var contentDisposition = cmd.getInline() ? constants.CONTENT_DISPOSITION_INLINE : constants.CONTENT_DISPOSITION_ATTACHMENT;
          let url = yield storage.getSignedUrl(optConn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Temporary,
                                               cmd.getTitle(),
                                               contentDisposition);
          outputData.setData(url);
        } else if (optAdditionalOutput) {
          optAdditionalOutput.needUrlKey = strPath;
          optAdditionalOutput.needUrlMethod = 2;
          optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Temporary;
        }
      } else {
        if (optConn) {
          outputData.setData(yield storage.getSignedUrls(optConn.baseUrl, key, commonDefines.c_oAscUrlTypes.Session));
        } else if (optAdditionalOutput) {
          optAdditionalOutput.needUrlKey = key;
          optAdditionalOutput.needUrlMethod = 0;
          optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Session;
        }
      }
      break;
    case taskResult.FileStatus.NeedParams:
      outputData.setStatus('needparams');
      var settingsPath = key + '/' + 'origin.' + cmd.getFormat();
      if (optConn) {
        let url = yield storage.getSignedUrl(optConn.baseUrl, settingsPath, commonDefines.c_oAscUrlTypes.Temporary);
        outputData.setData(url);
      } else if (optAdditionalOutput) {
        optAdditionalOutput.needUrlKey = settingsPath;
        optAdditionalOutput.needUrlMethod = 1;
        optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Temporary;
      }
      break;
    case taskResult.FileStatus.NeedPassword:
      outputData.setStatus('needpassword');
      outputData.setData(statusInfo);
      break;
    case taskResult.FileStatus.Err:
    case taskResult.FileStatus.ErrToReload:
      outputData.setStatus('err');
      outputData.setData(statusInfo);
      if (taskResult.FileStatus.ErrToReload == status) {
        yield cleanupCache(key);
      }
      break;
  }
}
function* addRandomKeyTaskCmd(cmd) {
  var task = yield* taskResult.addRandomKeyTask(cmd.getDocId());
  cmd.setSaveKey(task.key);
}
function* saveParts(cmd, filename) {
  var result = false;
  var saveType = cmd.getSaveType();
  if (SAVE_TYPE_COMPLETE_ALL !== saveType) {
    let ext = pathModule.extname(filename);
    let saveIndex = parseInt(cmd.getSaveIndex()) || 1;//prevent path traversal
    filename = pathModule.basename(filename, ext) + saveIndex + ext;
  }
  if ((SAVE_TYPE_PART_START === saveType || SAVE_TYPE_COMPLETE_ALL === saveType) && !cmd.getSaveKey()) {
    yield* addRandomKeyTaskCmd(cmd);
  }
  if (cmd.getUrl()) {
    result = true;
  } else {
    var buffer = cmd.getData();
    yield storage.putObject(cmd.getSaveKey() + '/' + filename, buffer, buffer.length);
    //delete data to prevent serialize into json
    cmd.data = null;
    result = (SAVE_TYPE_COMPLETE_ALL === saveType || SAVE_TYPE_COMPLETE === saveType);
  }
  return result;
}
function getSaveTask(cmd) {
  cmd.setData(null);
  var queueData = new commonDefines.TaskQueueData();
  queueData.setCmd(cmd);
  queueData.setToFile(constants.OUTPUT_NAME + '.' + formatChecker.getStringFromFormat(cmd.getOutputFormat()));
  //todo paid
  //if (cmd.vkey) {
  //  bool
  //  bPaid;
  //  Signature.getVKeyParams(cmd.vkey, out bPaid);
  //  oTaskQueueData.m_bPaid = bPaid;
  //}
  return queueData;
}
function getUpdateResponse(cmd) {
  var updateTask = new taskResult.TaskResultData();
  updateTask.key = cmd.getSaveKey() ? cmd.getSaveKey() : cmd.getDocId();
  var statusInfo = cmd.getStatusInfo();
  if (constants.NO_ERROR == statusInfo) {
    updateTask.status = taskResult.FileStatus.Ok;
  } else if (constants.CONVERT_DOWNLOAD == statusInfo) {
    updateTask.status = taskResult.FileStatus.ErrToReload;
  } else if (constants.CONVERT_NEED_PARAMS == statusInfo) {
    updateTask.status = taskResult.FileStatus.NeedParams;
  } else if (constants.CONVERT_DRM == statusInfo) {
    if (cfgOpenProtectedFile) {
    updateTask.status = taskResult.FileStatus.NeedPassword;
    } else {
      updateTask.status = taskResult.FileStatus.Err;
    }
  } else if (constants.CONVERT_PASSWORD == statusInfo) {
    updateTask.status = taskResult.FileStatus.NeedPassword;
  } else if (constants.CONVERT_DEAD_LETTER == statusInfo) {
    updateTask.status = taskResult.FileStatus.ErrToReload;
  } else {
    updateTask.status = taskResult.FileStatus.Err;
  }
  updateTask.statusInfo = statusInfo;
  return updateTask;
}
var cleanupCache = co.wrap(function* (docId) {
  //todo redis ?
  var res = false;
  var removeRes = yield taskResult.remove(docId);
  if (removeRes.affectedRows > 0) {
    yield storage.deletePath(docId);
    res = true;
  }
  return res;
});

function commandOpenStartPromise(docId, baseUrl, opt_updateUserIndex, opt_documentCallbackUrl) {
  var task = new taskResult.TaskResultData();
  task.key = docId;
  //None instead WaitQueue to prevent: conversion task is lost when entering and leaving the editor quickly(that leads to an endless opening)
  task.status = taskResult.FileStatus.None;
  task.statusInfo = constants.NO_ERROR;
  task.baseurl = baseUrl;
  if (opt_documentCallbackUrl) {
    task.callback = opt_documentCallbackUrl;
  }
  return taskResult.upsert(task, opt_updateUserIndex);
}
function* commandOpen(docLogger, conn, cmd, outputData, opt_upsertRes, opt_bIsRestore) {
  var upsertRes;
  if (opt_upsertRes) {
    upsertRes = opt_upsertRes;
  } else {
    upsertRes = yield commandOpenStartPromise(cmd.getDocId(), utils.getBaseUrlByConnection(conn));
  }
  //if CLIENT_FOUND_ROWS don't specify 1 row is inserted , 2 row is updated, and 0 row is set to its current values
  //http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
  let bCreate = upsertRes.affectedRows == 1;
  let needAddTask = bCreate;
  if (!bCreate) {
    needAddTask = yield* commandOpenFillOutput(docLogger, conn, cmd, outputData, opt_bIsRestore);
  }
  if (conn.encrypted) {
    docLogger.debug("commandOpen encrypted %j", outputData);
    if (constants.FILE_STATUS_UPDATE_VERSION !== outputData.getStatus()) {
      //don't send output data
      outputData.setStatus(undefined);
    }
  } else if (needAddTask) {
    let updateMask = new taskResult.TaskResultData();
    updateMask.key = cmd.getDocId();
    updateMask.status = taskResult.FileStatus.None;

    let task = new taskResult.TaskResultData();
    task.key = cmd.getDocId();
    task.status = taskResult.FileStatus.WaitQueue;
    task.statusInfo = constants.NO_ERROR;

    let updateIfRes = yield taskResult.updateIf(task, updateMask);
      if (updateIfRes.affectedRows > 0) {
        let forgottenId = cfgForgottenFiles + '/' + cmd.getDocId();
        let forgotten = yield storage.listObjects(forgottenId);
        //replace url with forgotten file because it absorbed all lost changes
        if (forgotten.length > 0) {
          docLogger.debug("commandOpen from forgotten");
          cmd.setUrl(undefined);
          cmd.setForgotten(forgottenId);
        }
        //add task
        cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_CANVAS);
        cmd.setEmbeddedFonts(false);
        var dataQueue = new commonDefines.TaskQueueData();
        dataQueue.setCmd(cmd);
        dataQueue.setToFile('Editor.bin');
        var priority = constants.QUEUE_PRIORITY_HIGH;
        var formatIn = formatChecker.getFormatFromString(cmd.getFormat());
        //decrease pdf, djvu, xps convert priority becase long open time
        if (constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF === formatIn ||
          constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU === formatIn ||
          constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS === formatIn) {
          priority = constants.QUEUE_PRIORITY_LOW;
        }
        yield* docsCoServer.addTask(dataQueue, priority);
      } else {
        yield* commandOpenFillOutput(docLogger, conn, cmd, outputData, opt_bIsRestore);
      }
    }
  }
function* commandOpenFillOutput(docLogger, conn, cmd, outputData, opt_bIsRestore) {
  let needAddTask = false;
  let selectRes = yield taskResult.select(cmd.getDocId());
  if (selectRes.length > 0) {
    let row = selectRes[0];
    if (taskResult.FileStatus.None === row.status) {
      needAddTask = true;
    } else {
      yield* getOutputData(docLogger, cmd, outputData, cmd.getDocId(), row.status, row.status_info, conn, undefined, opt_bIsRestore);
    }
  }
  return needAddTask;
}
function* commandReopen(cmd) {
  let res = true;
  let isPassword = undefined !== cmd.getPassword();
  if (!isPassword || cfgOpenProtectedFile) {
  let updateMask = new taskResult.TaskResultData();
  updateMask.key = cmd.getDocId();
    updateMask.status = isPassword ? taskResult.FileStatus.NeedPassword : taskResult.FileStatus.NeedParams;

  var task = new taskResult.TaskResultData();
  task.key = cmd.getDocId();
  task.status = taskResult.FileStatus.WaitQueue;
  task.statusInfo = constants.NO_ERROR;

  var upsertRes = yield taskResult.updateIf(task, updateMask);
  if (upsertRes.affectedRows > 0) {
    //add task
    cmd.setUrl(null);//url may expire
    cmd.setSaveKey(cmd.getDocId());
    cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_CANVAS);
    cmd.setEmbeddedFonts(false);
    var dataQueue = new commonDefines.TaskQueueData();
    dataQueue.setCmd(cmd);
    dataQueue.setToFile('Editor.bin');
    dataQueue.setFromSettings(true);
    yield* docsCoServer.addTask(dataQueue, constants.QUEUE_PRIORITY_HIGH);
  }
  } else {
    res = false;
}
  return res;
}
function* commandSave(cmd, outputData) {
  var completeParts = yield* saveParts(cmd, "Editor.bin");
  if (completeParts) {
    var queueData = getSaveTask(cmd);
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  }
  outputData.setStatus('ok');
  outputData.setData(cmd.getSaveKey());
}
function* commandSendMailMerge(cmd, outputData) {
  let mailMergeSend = cmd.getMailMergeSend();
  let isJson = mailMergeSend.getIsJsonKey();
  var completeParts = yield* saveParts(cmd, isJson ? "Editor.json" : "Editor.bin");
  var isErr = false;
  if (completeParts && !isJson) {
    isErr = true;
    var getRes = yield* docsCoServer.getCallback(cmd.getDocId(), cmd.getUserIndex());
    if (getRes) {
      mailMergeSend.setUrl(getRes.server.href);
      mailMergeSend.setBaseUrl(getRes.baseUrl);
      //меняем JsonKey и SaveKey, новый key нужет потому что за одну конвертацию делается часть, а json нужен всегда
      mailMergeSend.setJsonKey(cmd.getSaveKey());
      mailMergeSend.setRecordErrorCount(0);
      yield* addRandomKeyTaskCmd(cmd);
      var queueData = getSaveTask(cmd);
      yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
      isErr = false;
    }
  }
  if (isErr) {
    outputData.setStatus('err');
    outputData.setData(constants.UNKNOWN);
  } else {
    outputData.setStatus('ok');
    outputData.setData(cmd.getSaveKey());
  }
}
function* commandSfctByCmd(cmd, opt_priority, opt_expiration, opt_queue) {
  yield* addRandomKeyTaskCmd(cmd);
  var queueData = getSaveTask(cmd);
  queueData.setFromChanges(true);
  let priority = null != opt_priority ? opt_priority : constants.QUEUE_PRIORITY_LOW;
  yield* docsCoServer.addTask(queueData, priority, opt_queue, opt_expiration);
}
function* commandSfct(cmd, outputData) {
  yield* commandSfctByCmd(cmd);
  outputData.setStatus('ok');
}
function isDisplayedImage(strName) {
  var res = 0;
  if (strName) {
    //шаблон display[N]image.ext
    var findStr = constants.DISPLAY_PREFIX;
    var index = strName.indexOf(findStr);
    if (-1 != index) {
      if (index + findStr.length < strName.length) {
        var displayN = parseInt(strName[index + findStr.length]);
        if (!isNaN(displayN)) {
          var imageIndex = index + findStr.length + 1;
          if (imageIndex == strName.indexOf("image", imageIndex))
            res = displayN;
        }
      }
    }
  }
  return res;
}
function* commandImgurls(docLogger, conn, cmd, outputData) {
  let docId = cmd.getDocId();
  var errorCode = constants.NO_ERROR;
  let urls = cmd.getData();
  let authorization;
  let token = cmd.getTokenDownload();
  if (cfgTokenEnableBrowser && token) {
    let checkJwtRes = docsCoServer.checkJwt(docLogger, token, commonDefines.c_oAscSecretType.Browser);
    if (checkJwtRes.decoded) {
      //todo multiple url case
      let url = checkJwtRes.decoded.url;
      urls = [url];
      if (utils.canIncludeOutboxAuthorization(url)) {
        authorization = utils.fillJwtForRequest({url: url});
      }
    } else {
      docLogger.warn('Error commandImgurls jwt: \r\n%s', checkJwtRes.description);
      errorCode = constants.VKEY_ENCRYPT;
    }
  }
  var supportedFormats = cfgTypesUpload || 'jpg';
  var outputUrls = [];
  if (constants.NO_ERROR === errorCode && !conn.user.view && !conn.isCloseCoAuthoring) {
    //todo Promise.all()
    let displayedImageMap = {};//to make one prefix for ole object urls
    for (var i = 0; i < urls.length; ++i) {
      var urlSource = urls[i];
      var urlParsed;
      var data = undefined;
      if (urlSource.startsWith('data:')) {
        let delimiterIndex = urlSource.indexOf(',');
        if (-1 != delimiterIndex) {
          let dataLen = urlSource.length - (delimiterIndex + 1);
          if ('hex' === urlSource.substring(delimiterIndex - 3, delimiterIndex).toLowerCase()) {
            if (dataLen * 0.5 <= cfgImageSize) {
              data = Buffer.from(urlSource.substring(delimiterIndex + 1), 'hex');
            } else {
              errorCode = constants.UPLOAD_CONTENT_LENGTH;
            }
          } else {
            if (dataLen * 0.75 <= cfgImageSize) {
              data = Buffer.from(urlSource.substring(delimiterIndex + 1), 'base64');
            } else {
              errorCode = constants.UPLOAD_CONTENT_LENGTH;
            }
          }
        }
      } else if (urlSource) {
        try {
          //todo stream
          data = yield utils.downloadUrlPromise(urlSource, cfgImageDownloadTimeout, cfgImageSize, authorization);
          urlParsed = urlModule.parse(urlSource);
        } catch (e) {
          data = undefined;
          docLogger.error('error commandImgurls download: url = %s; \r\n%s', urlSource, e.stack);
          if (e.code === 'EMSGSIZE') {
            errorCode = constants.UPLOAD_CONTENT_LENGTH;
          } else {
            errorCode = constants.UPLOAD_URL;
          }
        }
      }
      var outputUrl = {url: 'error', path: 'error'};
      if (data) {
        let format = formatChecker.getImageFormat(data);
        let formatStr;
        let isAllow = false;
        if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== format) {
          formatStr = formatChecker.getStringFromFormat(format);
          if (formatStr && -1 !== supportedFormats.indexOf(formatStr)) {
            isAllow = true;
          } else if ('svg' === formatStr && isDisplayedImage(pathModule.basename(urlParsed.pathname)) > 0) {
            //paste case
            //todo refactoring
            isAllow = true;
          }
        }
        if (!isAllow && urlParsed) {
          //for ole object, presentation video/audio
          let ext = pathModule.extname(urlParsed.pathname).substring(1);
          let urlBasename = pathModule.basename(urlParsed.pathname);
          let displayedImageName = urlBasename.substring(0, urlBasename.length - ext.length - 1);
          if (displayedImageMap.hasOwnProperty(displayedImageName)) {
            formatStr = ext;
            isAllow = true;
          }
        }
        if (isAllow) {
          let strLocalPath = 'media/' + crypto.randomBytes(16).toString("hex") + '_';
          if (urlParsed) {
            var urlBasename = pathModule.basename(urlParsed.pathname);
            var displayN = isDisplayedImage(urlBasename);
            if (displayN > 0) {
              var displayedImageName = urlBasename.substring(0, urlBasename.length - formatStr.length - 1);
              if (displayedImageMap[displayedImageName]) {
                strLocalPath = displayedImageMap[displayedImageName];
              } else {
                displayedImageMap[displayedImageName] = strLocalPath;
              }
              strLocalPath += constants.DISPLAY_PREFIX + displayN;
            }
          }
          strLocalPath += 'image1' + '.' + formatStr;
          var strPath = cmd.getDocId() + '/' + strLocalPath;
          yield storage.putObject(strPath, data, data.length);
          var imgUrl = yield storage.getSignedUrl(conn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Session);
          outputUrl = {url: imgUrl, path: strLocalPath};
        }
      }
      if (constants.NO_ERROR === errorCode && ('error' === outputUrl.url || 'error' === outputUrl.path)) {
        errorCode = constants.UPLOAD_EXTENSION;
      }
      outputUrls.push(outputUrl);
    }
  } else if(constants.NO_ERROR === errorCode) {
    docLogger.warn('error commandImgurls: access deny');
    errorCode = constants.UPLOAD;
  }
  if (constants.NO_ERROR !== errorCode && 0 == outputUrls.length) {
    outputData.setStatus('err');
    outputData.setData(errorCode);
  } else {
    outputData.setStatus('ok');
    outputData.setData({error: errorCode, urls: outputUrls});
  }
}
function* commandPathUrls(conn, cmd, outputData) {
  let contentDisposition = cmd.getInline() ? constants.CONTENT_DISPOSITION_INLINE :
    constants.CONTENT_DISPOSITION_ATTACHMENT;
  let listImages = cmd.getData().map(function callback(currentValue) {
    return conn.docId + '/' + currentValue;
  });
  let urls = yield storage.getSignedUrlsArrayByArray(conn.baseUrl, listImages, commonDefines.c_oAscUrlTypes.Session,
                                                     contentDisposition);
  outputData.setStatus('ok');
  outputData.setData(urls);
}
function* commandPathUrl(conn, cmd, outputData) {
  var contentDisposition = cmd.getInline() ? constants.CONTENT_DISPOSITION_INLINE :
    constants.CONTENT_DISPOSITION_ATTACHMENT;
  var strPath = conn.docId + '/' + cmd.getData();
  var url = yield storage.getSignedUrl(conn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Temporary, cmd.getTitle(),
                                       contentDisposition);
  var errorCode = constants.NO_ERROR;
  if (constants.NO_ERROR !== errorCode) {
    outputData.setStatus('err');
    outputData.setData(errorCode);
  } else {
    outputData.setStatus('ok');
    outputData.setData(url);
  }
}
function* commandSaveFromOrigin(cmd, outputData) {
  yield* addRandomKeyTaskCmd(cmd);
  var queueData = getSaveTask(cmd);
  queueData.setFromOrigin(true);
  yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  outputData.setStatus('ok');
  outputData.setData(cmd.getSaveKey());
}
function checkAuthorizationLength(authorization, data){
  //todo it is stub (remove in future versions)
  //8kb(https://stackoverflow.com/questions/686217/maximum-on-http-header-values) - 1kb(for other header)
  let res = authorization.length < 7168;

  let docLogger = logger.getLogger('nodeJS');
  docLogger.addContext('docId', data.getKey());

  if (!res) {
    docLogger.warn('authorization too long: length=%d', authorization.length);
    data.setChangeUrl(undefined);
    //for backward compatibility. remove this when Community is ready
    data.setChangeHistory({});
  }
  return res;
}
function* commandSfcCallback(docLogger, cmd, isSfcm, isEncrypted) {
  var docId = cmd.getDocId();
  docLogger.addContext('docId', docId);
  docLogger.debug('Start commandSfcCallback');
  var statusInfo = cmd.getStatusInfo();
  //setUserId - set from changes in convert
  //setUserActionId - used in case of save without changes(forgotten files)
  const userLastChangeId = cmd.getUserId() || cmd.getUserActionId();
  const userLastChangeIndex = cmd.getUserIndex() || cmd.getUserActionIndex();
  let replyStr;
  if (constants.EDITOR_CHANGES !== statusInfo || isSfcm) {
    var saveKey = cmd.getSaveKey();
    var isError = constants.NO_ERROR != statusInfo;
    var isErrorCorrupted = constants.CONVERT_CORRUPTED == statusInfo;
    var savePathDoc = saveKey + '/' + cmd.getOutputPath();
    var savePathChanges = saveKey + '/changes.zip';
    var savePathHistory = saveKey + '/changesHistory.json';
    var forceSave = cmd.getForceSave();
    var forceSaveType = forceSave ? forceSave.getType() : commonDefines.c_oAscForceSaveTypes.Command;
    let forceSaveUserId = forceSave ? forceSave.getAuthorUserId() : undefined;
    let forceSaveUserIndex = forceSave ? forceSave.getAuthorUserIndex() : undefined;
    let callbackUserIndex = (forceSaveUserIndex || 0 === forceSaveUserIndex) ? forceSaveUserIndex : userLastChangeIndex;
    var getRes = yield* docsCoServer.getCallback(docId, callbackUserIndex);
    var isSfcmSuccess = false;
    let storeForgotten = false;
    let needRetry = false;
    var statusOk;
    var statusErr;
    if (isSfcm) {
      statusOk = docsCoServer.c_oAscServerStatus.MustSaveForce;
      statusErr = docsCoServer.c_oAscServerStatus.CorruptedForce;
    } else {
      statusOk = docsCoServer.c_oAscServerStatus.MustSave;
      statusErr = docsCoServer.c_oAscServerStatus.Corrupted;
    }
    let recoverTask = new taskResult.TaskResultData();
    recoverTask.status = taskResult.FileStatus.Ok;
    recoverTask.statusInfo = constants.NO_ERROR;
    let updateIfTask = new taskResult.TaskResultData();
    updateIfTask.status = taskResult.FileStatus.UpdateVersion;
    updateIfTask.statusInfo = Math.floor(Date.now() / 60000);//minutes
    let updateIfRes;

    let updateMask = new taskResult.TaskResultData();
    updateMask.key = docId;
    let selectRes = yield taskResult.select(docId);
    let row = selectRes.length > 0 ? selectRes[0] : null;
    if (row) {
      if (isEncrypted) {
        recoverTask.status = updateMask.status = row.status;
        recoverTask.statusInfo = updateMask.statusInfo = row.status_info;
      } else if ((taskResult.FileStatus.SaveVersion === row.status && cmd.getStatusInfoIn() === row.status_info) ||
        taskResult.FileStatus.UpdateVersion === row.status) {
        if (taskResult.FileStatus.UpdateVersion === row.status) {
          updateIfRes = {affectedRows: 1};
        }
        recoverTask.status = taskResult.FileStatus.SaveVersion;
        recoverTask.statusInfo = cmd.getStatusInfoIn();
        updateMask.status = row.status;
        updateMask.statusInfo = row.status_info;
      } else {
        updateIfRes = {affectedRows: 0};
      }
    } else {
      isError = true;
    }
    if (getRes) {
      docLogger.debug('Callback commandSfcCallback: callback = %s', getRes.server.href);
      var outputSfc = new commonDefines.OutputSfcData();
      outputSfc.setKey(docId);
      outputSfc.setEncrypted(isEncrypted);
      var users = [];
      let isOpenFromForgotten = false;
      if (userLastChangeId) {
        users.push(userLastChangeId);
      }
      outputSfc.setUsers(users);
      if (!isSfcm) {
        var actions = [];
        //use UserId case UserActionId miss in gc convertion
        var userActionId = cmd.getUserActionId() || cmd.getUserId();
        if (userActionId) {
          actions.push(new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, userActionId));
        }
        outputSfc.setActions(actions);
      } else if(forceSaveUserId) {
        outputSfc.setActions([new commonDefines.OutputAction(commonDefines.c_oAscUserAction.ForceSaveButton, forceSaveUserId)]);
      }
      outputSfc.setUserData(cmd.getUserData());
      if (!isError || isErrorCorrupted) {
        try {
          let forgottenId = cfgForgottenFiles + '/' + docId;
          let forgotten = yield storage.listObjects(forgottenId);
          let isSendHistory = 0 === forgotten.length;
          if (!isSendHistory) {
            //check indicator file to determine if opening was from the forgotten file
            var forgottenMarkPath = docId + '/' + cfgForgottenFilesName + '.txt';
            var forgottenMark = yield storage.listObjects(forgottenMarkPath);
            isOpenFromForgotten = 0 !== forgottenMark.length;
            isSendHistory = !isOpenFromForgotten;
            docLogger.debug('commandSfcCallback forgotten no empty: isSendHistory = %s', isSendHistory);
          }
          if (isSendHistory && !isEncrypted) {
            //don't send history info because changes isn't from file in storage
            var data = yield storage.getObject(savePathHistory);
            outputSfc.setChangeHistory(JSON.parse(data.toString('utf-8')));
            let changeUrl = yield storage.getSignedUrl(getRes.baseUrl, savePathChanges,
                                                       commonDefines.c_oAscUrlTypes.Temporary);
            outputSfc.setChangeUrl(changeUrl);
          } else {
            //for backward compatibility. remove this when Community is ready
            outputSfc.setChangeHistory({});
          }
          let url = yield storage.getSignedUrl(getRes.baseUrl, savePathDoc, commonDefines.c_oAscUrlTypes.Temporary);
          outputSfc.setUrl(url);
        } catch (e) {
          docLogger.error('Error commandSfcCallback: \r\n%s', e.stack);
        }
        if (outputSfc.getUrl() && outputSfc.getUsers().length > 0) {
          outputSfc.setStatus(statusOk);
        } else {
          isError = true;
        }
      }
      if (isError) {
        outputSfc.setStatus(statusErr);
      }
      var uri = getRes.server.href;
      if (isSfcm) {
        let selectRes = yield taskResult.select(docId);
        let row = selectRes.length > 0 ? selectRes[0] : null;
        //send only if FileStatus.Ok to prevent forcesave after final save
        if (row && row.status == taskResult.FileStatus.Ok) {
          if (forceSave) {
            let forceSaveDate = forceSave.getTime() ? new Date(forceSave.getTime()): new Date();
            outputSfc.setForceSaveType(forceSaveType);
            outputSfc.setLastSave(forceSaveDate.toISOString());
          }
          try {
            replyStr = yield* docsCoServer.sendServerRequest(docLogger, uri, outputSfc, checkAuthorizationLength);
            let replyData = docsCoServer.parseReplyData(docLogger, replyStr);
            isSfcmSuccess = replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error;
            if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
              docLogger.warn('sendServerRequest returned an error: data = %s', replyStr);
            }
          } catch (err) {
            docLogger.error('sendServerRequest error: url = %s;data = %j\r\n%s', uri, outputSfc, err.stack);
          }
        }
      } else {
        //if anybody in document stop save
        let editorsCount = yield docsCoServer.getEditorsCountPromise(docId);
        docLogger.debug('commandSfcCallback presence: count = %d', editorsCount);
        if (0 === editorsCount || (isEncrypted && 1 === editorsCount)) {
          if (!updateIfRes) {
            updateIfRes = yield taskResult.updateIf(updateIfTask, updateMask);
          }
          if (updateIfRes.affectedRows > 0) {
            let actualForceSave = yield docsCoServer.editorData.getForceSave(docId);
            let forceSaveDate = (actualForceSave && actualForceSave.time) ? new Date(actualForceSave.time) : new Date();
            let notModified = actualForceSave && true === actualForceSave.ended;
            outputSfc.setLastSave(forceSaveDate.toISOString());
            outputSfc.setNotModified(notModified);

            updateMask.status = updateIfTask.status;
            updateMask.statusInfo = updateIfTask.statusInfo;
            try {
              replyStr = yield* docsCoServer.sendServerRequest(docLogger, uri, outputSfc, checkAuthorizationLength);
            } catch (err) {
              docLogger.error('sendServerRequest error: url = %s;data = %j\r\n%s', uri, outputSfc, err.stack);
              if (!isEncrypted && !docsCoServer.getIsShutdown() && (!err.statusCode || retryHttpStatus.has(err.statusCode.toString()))) {
                let attempt = cmd.getAttempt() || 0;
                if (attempt < cfgCallbackBackoffOptions.retries) {
                  needRetry = true;
                } else {
                  docLogger.warn('commandSfcCallback backoff limit exceeded');
                }
              }
            }
            var requestRes = false;
            var replyData = docsCoServer.parseReplyData(docLogger, replyStr);
            if (replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error) {
              //в случае comunity server придет запрос в CommandService проверяем результат
              var savedVal = yield docsCoServer.editorData.getdelSaved(docId);
              requestRes = (null == savedVal || '1' === savedVal);
            }
            if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
              docLogger.warn('sendServerRequest returned an error: data = %s', replyStr);
            }
            if (requestRes) {
              updateIfTask = undefined;
              yield docsCoServer.cleanDocumentOnExitPromise(docId, true);
              if (isOpenFromForgotten) {
                //remove forgotten file in cache
                yield cleanupCache(docId);
              }
            } else {
              storeForgotten = true;
            }
          } else {
            updateIfTask = undefined;
          }
        }
      }
    } else {
      docLogger.warn('Empty Callback commandSfcCallback');
      storeForgotten = true;
    }
    if (undefined !== updateIfTask && !isSfcm) {
      docLogger.debug('commandSfcCallback restore %d status', recoverTask.status);
      updateIfTask.status = recoverTask.status;
      updateIfTask.statusInfo = recoverTask.statusInfo;
      updateIfRes = yield taskResult.updateIf(updateIfTask, updateMask);
      if (!(updateIfRes.affectedRows > 0)) {
        docLogger.debug('commandSfcCallback restore %d status failed', recoverTask.status);
      }
    }
    if (storeForgotten && !needRetry && !isEncrypted && (!isError || isErrorCorrupted)) {
      try {
        docLogger.warn("storeForgotten");
        let forgottenName = cfgForgottenFilesName + pathModule.extname(cmd.getOutputPath());
        yield storage.copyObject(savePathDoc, cfgForgottenFiles + '/' + docId + '/' + forgottenName);
      } catch (err) {
        docLogger.error('Error storeForgotten: \r\n%s', err.stack);
      }
    }
    if (forceSave) {
      yield* docsCoServer.setForceSave(docId, forceSave, cmd, isSfcmSuccess && !isError);
    }
    if (needRetry) {
      let attempt = cmd.getAttempt() || 0;
      cmd.setAttempt(attempt + 1);
      let queueData = new commonDefines.TaskQueueData();
      queueData.setCmd(cmd);
      let timeout = retry.createTimeout(attempt, cfgCallbackBackoffOptions.timeout);
      docLogger.debug('commandSfcCallback backoff timeout = %d', timeout);
      yield* docsCoServer.addDelayed(queueData, timeout);
    }
  } else {
    docLogger.debug('commandSfcCallback cleanDocumentOnExitNoChangesPromise');
    yield docsCoServer.cleanDocumentOnExitNoChangesPromise(docId, undefined, userLastChangeIndex, true);
  }

  if ((docsCoServer.getIsShutdown() && !isSfcm) || cmd.getRedisKey()) {
    let keyRedis = cmd.getRedisKey() ? cmd.getRedisKey() : redisKeyShutdown;
    yield docsCoServer.editorData.removeShutdown(keyRedis, docId);
  }
  docLogger.debug('End commandSfcCallback');
  return replyStr;
}
function* commandSendMMCallback(docLogger, cmd) {
  var docId = cmd.getDocId();
  docLogger.debug('Start commandSendMMCallback');
  var saveKey = cmd.getSaveKey();
  var statusInfo = cmd.getStatusInfo();
  var outputSfc = new commonDefines.OutputSfcData();
  outputSfc.setKey(docId);
  if (constants.NO_ERROR == statusInfo) {
    outputSfc.setStatus(docsCoServer.c_oAscServerStatus.MailMerge);
  } else {
    outputSfc.setStatus(docsCoServer.c_oAscServerStatus.Corrupted);
  }
  var mailMergeSendData = cmd.getMailMergeSend();
  var outputMailMerge = new commonDefines.OutputMailMerge(mailMergeSendData);
  outputSfc.setMailMerge(outputMailMerge);
  outputSfc.setUsers([mailMergeSendData.getUserId()]);
  var data = yield storage.getObject(saveKey + '/' + cmd.getOutputPath());
  var xml = data.toString('utf8');
  var files = xml.match(/[< ]file.*?\/>/g);
  var recordRemain = (mailMergeSendData.getRecordTo() - mailMergeSendData.getRecordFrom() + 1);
  var recordIndexStart = mailMergeSendData.getRecordCount() - recordRemain;
  for (var i = 0; i < files.length; ++i) {
    var file = files[i];
    var fieldRes = /field=["'](.*?)["']/.exec(file);
    outputMailMerge.setTo(fieldRes[1]);
    outputMailMerge.setRecordIndex(recordIndexStart + i);
    var pathRes = /path=["'](.*?)["']/.exec(file);
    var signedUrl = yield storage.getSignedUrl(mailMergeSendData.getBaseUrl(), saveKey + '/' + pathRes[1],
                                               commonDefines.c_oAscUrlTypes.Temporary);
    outputSfc.setUrl(signedUrl);
    var uri = mailMergeSendData.getUrl();
    var replyStr = null;
    try {
      replyStr = yield* docsCoServer.sendServerRequest(docLogger, uri, outputSfc);
    } catch (err) {
      replyStr = null;
      docLogger.error('sendServerRequest error: url = %s;data = %j\r\n%s', uri, outputSfc, err.stack);
    }
    var replyData = docsCoServer.parseReplyData(docLogger, replyStr);
    if (!(replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error)) {
      var recordErrorCount = mailMergeSendData.getRecordErrorCount();
      recordErrorCount++;
      outputMailMerge.setRecordErrorCount(recordErrorCount);
      mailMergeSendData.setRecordErrorCount(recordErrorCount);
    }
    if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
      docLogger.warn('sendServerRequest returned an error: data = %s', replyStr);
    }
  }
  var newRecordFrom = mailMergeSendData.getRecordFrom() + Math.max(files.length, 1);
  if (newRecordFrom <= mailMergeSendData.getRecordTo()) {
    mailMergeSendData.setRecordFrom(newRecordFrom);
    yield* addRandomKeyTaskCmd(cmd);
    var queueData = getSaveTask(cmd);
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  } else {
    docLogger.debug('End MailMerge');
  }
  docLogger.debug('End commandSendMMCallback');
}

exports.openDocument = function(docLogger, conn, cmd, opt_upsertRes, opt_bIsRestore) {
  return co(function* () {
    var outputData;
    var docId = conn ? conn.docId : 'null';
    docLogger.addContext('docId', docId);
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      docLogger.debug('Start command: %s', JSON.stringify(cmd));
      outputData = new OutputData(cmd.getCommand());
      let res = true;
      switch (cmd.getCommand()) {
        case 'open':
          yield* commandOpen(docLogger, conn, cmd, outputData, opt_upsertRes, opt_bIsRestore);
          break;
        case 'reopen':
          res = yield* commandReopen(cmd);
          break;
        case 'imgurls':
          yield* commandImgurls(docLogger, conn, cmd, outputData);
          break;
        case 'pathurl':
          yield* commandPathUrl(conn, cmd, outputData);
          break;
        case 'pathurls':
          yield* commandPathUrls(conn, cmd, outputData);
          break;
        default:
          res = false;
          break;
      }
      if(!res){
          outputData.setStatus('err');
          outputData.setData(constants.UNKNOWN);
      }
      if(clientStatsD) {
        clientStatsD.timing('coauth.openDocument.' + cmd.getCommand(), new Date() - startDate);
      }
    }
    catch (e) {
      docLogger.error('Error openDocument: \r\n%s', e.stack);
      if (!outputData) {
        outputData = new OutputData();
      }
      outputData.setStatus('err');
      outputData.setData(constants.UNKNOWN);
    }
    finally {
      if (outputData && outputData.getStatus()) {
        docLogger.debug('Response command: %s', JSON.stringify(outputData));
        docsCoServer.sendData(conn, new OutputDataWrap('documentOpen', outputData));
      }
      docLogger.debug('End command');
    }
  });
};
exports.downloadAs = function(req, res) {
  return co(function* () {
    var docId = 'null';
    let docLogger = logger.getLogger('nodeJS');
    docLogger.addContext('docId', docId);
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      var strCmd = req.query['cmd'];
      var cmd = new commonDefines.InputCommand(JSON.parse(strCmd));
      docId = cmd.getDocId();
      docLogger.addContext('docId', docId);
      docLogger.debug('Start downloadAs: %s', strCmd);

      if (cfgTokenEnableBrowser) {
        var isValidJwt = false;
        if (cmd.getTokenDownload()) {
          let checkJwtRes = docsCoServer.checkJwt(docLogger, cmd.getTokenDownload(), commonDefines.c_oAscSecretType.Browser);
          if (checkJwtRes.decoded) {
            isValidJwt = true;
            cmd.setFormat(checkJwtRes.decoded.fileType);
            cmd.setUrl(checkJwtRes.decoded.url);
            cmd.setWithAuthorization(true);
          } else {
            docLogger.warn('Error downloadAs jwt: \r\n%s', checkJwtRes.description);
          }
        } else {
          let checkJwtRes = docsCoServer.checkJwt(docLogger, cmd.getTokenSession(), commonDefines.c_oAscSecretType.Session);
          if (checkJwtRes.decoded) {
            let decoded = checkJwtRes.decoded;
            var doc = checkJwtRes.decoded.document;
            if (!doc.permissions || (false !== doc.permissions.download || false !== doc.permissions.print)) {
              isValidJwt = true;
              docId = doc.key;
              cmd.setDocId(doc.key);
              cmd.setUserIndex(decoded.editorConfig && decoded.editorConfig.user && decoded.editorConfig.user.index);
            } else {
              docLogger.warn('Error downloadAs jwt: \r\n%s', 'access deny');
            }
          } else {
            docLogger.warn('Error downloadAs jwt: \r\n%s', checkJwtRes.description);
          }
        }
        if (!isValidJwt) {
          res.sendStatus(403);
          return;
        }
      }

      cmd.setData(req.body);
      var outputData = new OutputData(cmd.getCommand());
      switch (cmd.getCommand()) {
        case 'save':
          yield* commandSave(cmd, outputData);
          break;
        case 'savefromorigin':
          yield* commandSaveFromOrigin(cmd, outputData);
          break;
        case 'sendmm':
          yield* commandSendMailMerge(cmd, outputData);
          break;
        case 'sfct':
          yield* commandSfct(cmd, outputData);
          break;
        default:
          outputData.setStatus('err');
          outputData.setData(constants.UNKNOWN);
          break;
      }
      var strRes = JSON.stringify(outputData);
      res.setHeader('Content-Type', 'application/json');
      res.send(strRes);
      docLogger.debug('End downloadAs: %s', strRes);
      if(clientStatsD) {
        clientStatsD.timing('coauth.downloadAs.' + cmd.getCommand(), new Date() - startDate);
      }
    }
    catch (e) {
      docLogger.error('Error downloadAs: \r\n%s', e.stack);
      res.sendStatus(400);
    }
  });
};
exports.saveFile = function(req, res) {
  return co(function*() {
    let docId = 'null';
    let docLogger = logger.getLogger('nodeJS');
    docLogger.addContext('docId', docId);
    try {
      let startDate = null;
      if (clientStatsD) {
        startDate = new Date();
      }

      let strCmd = req.query['cmd'];
      let cmd = new commonDefines.InputCommand(JSON.parse(strCmd));
      docId = cmd.getDocId();
      docLogger.addContext('docId', docId);
      docLogger.debug('Start saveFile');

      if (cfgTokenEnableBrowser) {
        let isValidJwt = false;
        let checkJwtRes = docsCoServer.checkJwt(docLogger, cmd.getTokenSession(), commonDefines.c_oAscSecretType.Session);
        if (checkJwtRes.decoded) {
          let doc = checkJwtRes.decoded.document;
          var edit = checkJwtRes.decoded.editorConfig;
          if (doc.ds_encrypted && !edit.ds_view && !edit.ds_isCloseCoAuthoring) {
            isValidJwt = true;
            docId = doc.key;
            cmd.setDocId(doc.key);
          } else {
            docLogger.warn('Error saveFile jwt: \r\n%s', 'access deny');
          }
        } else {
          docLogger.warn('Error saveFile jwt: \r\n%s', checkJwtRes.description);
        }
        if (!isValidJwt) {
          res.sendStatus(403);
          return;
        }
      }
      cmd.setStatusInfo(constants.NO_ERROR);
      yield* addRandomKeyTaskCmd(cmd);
      cmd.setOutputPath(constants.OUTPUT_NAME + pathModule.extname(cmd.getOutputPath()));
      yield storage.putObject(cmd.getSaveKey() + '/' + cmd.getOutputPath(), req.body, req.body.length);
      let replyStr = yield* commandSfcCallback(docLogger, cmd, false, true);
      if (replyStr) {
        utils.fillResponseSimple(res, replyStr, 'application/json');
      } else {
        res.sendStatus(400);
      }
      docLogger.debug('End saveFile: %s', replyStr);
      if (clientStatsD) {
        clientStatsD.timing('coauth.saveFile', new Date() - startDate);
      }
    }
    catch (e) {
      docLogger.error('Error saveFile: \r\n%s', e.stack);
      res.sendStatus(400);
    }
  });
};
exports.saveFromChanges = function(docLogger, docId, statusInfo, optFormat, opt_userId, opt_userIndex, opt_queue) {
  return co(function* () {
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      docLogger.debug('Start saveFromChanges');
      var task = new taskResult.TaskResultData();
      task.key = docId;
      //делаем select, потому что за время timeout информация могла измениться
      var selectRes = yield taskResult.select(docId);
      var row = selectRes.length > 0 ? selectRes[0] : null;
      if (row && row.status == taskResult.FileStatus.SaveVersion && row.status_info == statusInfo) {
        if (null == optFormat) {
          optFormat = constants.AVS_OFFICESTUDIO_FILE_OTHER_TEAMLAB_INNER;
        }
        var cmd = new commonDefines.InputCommand();
        cmd.setCommand('sfc');
        cmd.setDocId(docId);
        cmd.setOutputFormat(optFormat);
        cmd.setStatusInfoIn(statusInfo);
        cmd.setUserActionId(opt_userId);
        cmd.setUserActionIndex(opt_userIndex);
        yield* addRandomKeyTaskCmd(cmd);
        var queueData = getSaveTask(cmd);
        queueData.setFromChanges(true);
        yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_NORMAL, opt_queue);
        if (docsCoServer.getIsShutdown()) {
          yield docsCoServer.editorData.addShutdown(redisKeyShutdown, docId);
        }
        docLogger.debug('AddTask saveFromChanges');
      } else {
        if (row) {
          docLogger.debug('saveFromChanges status mismatch: row: %d; %d; expected: %d', row.status, row.status_info, statusInfo);
        }
      }
      if (clientStatsD) {
        clientStatsD.timing('coauth.saveFromChanges', new Date() - startDate);
      }
    }
    catch (e) {
      docLogger.error('Error saveFromChanges: \r\n%s', e.stack);
    }
  });
};
exports.receiveTask = function(data, ack) {
  return co(function* () {
    var docId = 'null';
    let docLogger = logger.getLogger('nodeJS');
    docLogger.addContext('docId', docId);
    try {
      var task = new commonDefines.TaskQueueData(JSON.parse(data));
      if (task) {
        var cmd = task.getCmd();
        docId = cmd.getDocId();
        docLogger.addContext('docId', docId);
        docLogger.debug('Start receiveTask: %s', data);
        var updateTask = getUpdateResponse(cmd);
        var updateRes = yield taskResult.update(updateTask);
        if (updateRes.affectedRows > 0) {
          var outputData = new OutputData(cmd.getCommand());
          var command = cmd.getCommand();
          var additionalOutput = {needUrlKey: null, needUrlMethod: null, needUrlType: null};
          if ('open' == command || 'reopen' == command) {
            //yield utils.sleep(5000);
            yield* getOutputData(docLogger, cmd, outputData, cmd.getDocId(), updateTask.status,
              updateTask.statusInfo, null, additionalOutput);
          } else if ('save' == command || 'savefromorigin' == command || 'sfct' == command) {
            yield* getOutputData(docLogger, cmd, outputData, cmd.getSaveKey(), updateTask.status,
              updateTask.statusInfo, null, additionalOutput);
          } else if ('sfcm' == command) {
            yield* commandSfcCallback(docLogger, cmd, true);
          } else if ('sfc' == command) {
            yield* commandSfcCallback(docLogger, cmd, false);
          } else if ('sendmm' == command) {
            yield* commandSendMMCallback(docLogger, cmd);
          } else if ('conv' == command) {
            //nothing
          }
          if (outputData.getStatus()) {
            docLogger.debug('Send receiveTask: %s', JSON.stringify(outputData));
            var output = new OutputDataWrap('documentOpen', outputData);
            yield* docsCoServer.publish({
                                          type: commonDefines.c_oPublishType.receiveTask, cmd: cmd, output: output,
                                          needUrlKey: additionalOutput.needUrlKey,
                                          needUrlMethod: additionalOutput.needUrlMethod,
                                          needUrlType: additionalOutput.needUrlType
                                        });
          }
        }
        docLogger.debug('End receiveTask');
      }
    } catch (err) {
      docLogger.debug('Error receiveTask: \r\n%s', err.stack);
    } finally {
      ack();
    }
  });
};

exports.cleanupCache = cleanupCache;
exports.commandSfctByCmd = commandSfctByCmd;
exports.commandOpenStartPromise = commandOpenStartPromise;
exports.OutputDataWrap = OutputDataWrap;
exports.OutputData = OutputData;
