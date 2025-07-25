/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
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
const { pipeline } = require('node:stream/promises');
const { buffer } = require('node:stream/consumers');
var co = require('co');
const ms = require('ms');
const retry = require('retry');
const MultiRange = require('multi-integer-range').MultiRange;
var sqlBase = require('./databaseConnectors/baseConnector');
const utilsDocService = require('./utilsDocService');
var docsCoServer = require('./DocsCoServer');
var taskResult = require('./taskresult');
var wopiUtils = require('./wopiUtils');
var wopiClient = require('./wopiClient');
var logger = require('./../../Common/sources/logger');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var commonDefines = require('./../../Common/sources/commondefines');
var storage = require('./../../Common/sources/storage/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var statsDClient = require('./../../Common/sources/statsdclient');
var operationContext = require('./../../Common/sources/operationContext');
var tenantManager = require('./../../Common/sources/tenantManager');
var config = require('config');
const path = require("path");

const cfgTypesUpload = config.get('services.CoAuthoring.utils.limits_image_types_upload');
const cfgImageSize = config.get('services.CoAuthoring.server.limits_image_size');
const cfgImageDownloadTimeout = config.get('services.CoAuthoring.server.limits_image_download_timeout');
const cfgRedisPrefix = config.get('services.CoAuthoring.redis.prefix');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgTokenSessionAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenSessionExpires = config.get('services.CoAuthoring.token.session.expires');
const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgForgottenFilesName = config.get('services.CoAuthoring.server.forgottenfilesname');
const cfgOpenProtectedFile = config.get('services.CoAuthoring.server.openProtectedFile');
const cfgExpUpdateVersionStatus = config.get('services.CoAuthoring.expire.updateVersionStatus');
const cfgCallbackBackoffOptions = config.get('services.CoAuthoring.callbackBackoffOptions');
const cfgAssemblyFormatAsOrigin = config.get('services.CoAuthoring.server.assemblyFormatAsOrigin');
const cfgDownloadMaxBytes = config.get('FileConverter.converter.maxDownloadBytes');
const cfgDownloadTimeout = config.get('FileConverter.converter.downloadTimeout');
const cfgDownloadFileAllowExt = config.get('services.CoAuthoring.server.downloadFileAllowExt');
const cfgNewFileTemplate = config.get('services.CoAuthoring.server.newFileTemplate');

var SAVE_TYPE_PART_START = 0;
var SAVE_TYPE_PART = 1;
var SAVE_TYPE_COMPLETE = 2;
var SAVE_TYPE_COMPLETE_ALL = 3;

var clientStatsD = statsDClient.getClient();
var redisKeyShutdown = cfgRedisPrefix + constants.REDIS_KEY_SHUTDOWN;
let hasPasswordCol = false;//stub on upgradev630.sql update failure
exports.hasAdditionalCol = false;//stub on upgradev710.sql update failure

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
  this['filetype'] = undefined;
  this['openedAt'] = undefined;
}
OutputData.prototype = {
  fromObject: function(data) {
    this['type'] = data['type'];
    this['status'] = data['status'];
    this['data'] = data['data'];
    this['filetype'] = data['filetype'];
    this['openedAt'] = data['openedAt'];
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
  },
  getExtName: function() {
    return this['filetype'];
  },
  setExtName: function(data) {
    this['filetype'] = data.substring(1);
  },
  getOpenedAt: function() {
    return this['openedAt'];
  },
  setOpenedAt: function(data) {
    this['openedAt'] = data;
  }
};

function getOpenedAt(row) {
  if (row) {
    return sqlBase.DocumentAdditional.prototype.getOpenedAt(row.additional);
  }
  return;
}
function getOpenedAtJSONParams(row) {
  let documentLayout = row && sqlBase.DocumentAdditional.prototype.getDocumentLayout(row.additional);
  if (documentLayout) {
    return {'documentLayout': documentLayout};
  }
  return undefined;
}

async function getOutputData(ctx, cmd, outputData, key, optConn, optAdditionalOutput, opt_bIsRestore) {
  const tenExpUpdateVersionStatus = ms(ctx.getCfg('services.CoAuthoring.expire.updateVersionStatus', cfgExpUpdateVersionStatus));

  let status, statusInfo, password, creationDate, openedAt, originFormat, row;
  let selectRes = await taskResult.select(ctx, key);
  if (selectRes.length > 0) {
    row = selectRes[0];
    status = row.status;
    statusInfo = row.status_info;
    password = sqlBase.DocumentPassword.prototype.getCurPassword(ctx, row.password);
    creationDate = row.created_at && row.created_at.getTime();
    openedAt = getOpenedAt(row);
    originFormat = row.change_id;
    if (optAdditionalOutput) {
      optAdditionalOutput.row = row;
    }
  }
  switch (status) {
    case commonDefines.FileStatus.SaveVersion:
    case commonDefines.FileStatus.UpdateVersion:
    case commonDefines.FileStatus.Ok:
      if(commonDefines.FileStatus.Ok === status) {
        outputData.setStatus('ok');
      } else if (optConn && optConn.isCloseCoAuthoring) {
        outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
      } else if (optConn && optConn.user.view) {
        outputData.setStatus('ok');
      } else if (commonDefines.FileStatus.SaveVersion === status ||
        (!opt_bIsRestore && commonDefines.FileStatus.UpdateVersion === status &&
        Date.now() - statusInfo * 60000 > tenExpUpdateVersionStatus)) {
        if (commonDefines.FileStatus.UpdateVersion === status) {
          ctx.logger.warn("UpdateVersion expired");
        }
        var updateMask = new taskResult.TaskResultData();
        updateMask.tenant = ctx.tenant;
        updateMask.key = key;
        updateMask.status = status;
        updateMask.statusInfo = statusInfo;
        var updateTask = new taskResult.TaskResultData();
        updateTask.status = commonDefines.FileStatus.Ok;
        updateTask.statusInfo = constants.NO_ERROR;
        var updateIfRes = await taskResult.updateIf(ctx, updateTask, updateMask);
        if (updateIfRes.affectedRows > 0) {
          outputData.setStatus('ok');
        } else {
          outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
        }
      } else {
        outputData.setStatus(constants.FILE_STATUS_UPDATE_VERSION);
      }
      var command = cmd.getCommand();
      if ('open' != command && 'reopen' != command && !cmd.getOutputUrls()) {
        var strPath = key + '/' + cmd.getOutputPath();
        if (optConn) {
          let url;
          if(cmd.getInline()) {
            url = await getPrintFileUrl(ctx, key, optConn.baseUrl, cmd.getTitle());
          } else {
            url = await storage.getSignedUrl(ctx, optConn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Temporary,
                                                 cmd.getTitle());
          }
          outputData.setData(url);
          outputData.setExtName(pathModule.extname(strPath));
        } else if (optAdditionalOutput) {
          optAdditionalOutput.needUrlKey = cmd.getInline() ? key : strPath;
          optAdditionalOutput.needUrlMethod = 2;
          optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Temporary;
        }
      } else {
        let encryptedUserPassword = cmd.getPassword();
        let userPassword;
        let decryptedPassword;
        let isCorrectPassword;
        if (password && encryptedUserPassword) {
          decryptedPassword = await utils.decryptPassword(ctx, password);
          userPassword = await utils.decryptPassword(ctx, encryptedUserPassword);
          isCorrectPassword = decryptedPassword === userPassword;
        }
        let isNeedPassword = password && !isCorrectPassword;
        if (isNeedPassword && formatChecker.isBrowserEditorFormat(originFormat)) {
          //check pdf form
          //todo check without storage
          let formEditor = await storage.listObjects(ctx, key + '/Editor.bin');
          isNeedPassword = 0 !== formEditor.length;
        }
        if (isNeedPassword) {
          ctx.logger.debug("getOutputData password mismatch");
          if (encryptedUserPassword) {
            outputData.setStatus('needpassword');
            outputData.setData(constants.CONVERT_PASSWORD);
          } else {
            outputData.setStatus('needpassword');
            outputData.setData(constants.CONVERT_DRM);
          }
        } else if (optConn) {
          outputData.setOpenedAt(openedAt);
          outputData.setData(await storage.getSignedUrls(ctx, optConn.baseUrl, key, commonDefines.c_oAscUrlTypes.Session, creationDate));
        } else if (optAdditionalOutput) {
          optAdditionalOutput.needUrlKey = key;
          optAdditionalOutput.needUrlMethod = 0;
          optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Session;
          optAdditionalOutput.needUrlIsCorrectPassword = isCorrectPassword;
          optAdditionalOutput.creationDate = creationDate;
          optAdditionalOutput.openedAt = openedAt;
        }
      }
      break;
    case commonDefines.FileStatus.NeedParams:
      outputData.setStatus('needparams');
      var settingsPath = key + '/' + 'origin.' + cmd.getFormat();
      if (optConn) {
        let url = await storage.getSignedUrl(ctx, optConn.baseUrl, settingsPath, commonDefines.c_oAscUrlTypes.Temporary);
        outputData.setData(url);
      } else if (optAdditionalOutput) {
        optAdditionalOutput.needUrlKey = settingsPath;
        optAdditionalOutput.needUrlMethod = 1;
        optAdditionalOutput.needUrlType = commonDefines.c_oAscUrlTypes.Temporary;
      }
      break;
    case commonDefines.FileStatus.NeedPassword:
      outputData.setStatus('needpassword');
      outputData.setData(statusInfo);
      break;
    case commonDefines.FileStatus.Err:
      outputData.setStatus('err');
      outputData.setData(statusInfo);
      break;
    case commonDefines.FileStatus.ErrToReload:
      outputData.setStatus('err');
      outputData.setData(statusInfo);
      await cleanupErrToReload(ctx, key);
      break;
    case commonDefines.FileStatus.None:
      //this status has no handler
      break;
    case commonDefines.FileStatus.WaitQueue:
      //task in the queue. response will be after convertion
      break;
    default:
      outputData.setStatus('err');
      outputData.setData(constants.UNKNOWN);
      break;
  }
  return status;
}
function* addRandomKeyTaskCmd(ctx, cmd) {
  let docId = cmd.getDocId();
  let task = yield* taskResult.addRandomKeyTask(ctx, docId);
  //set saveKey as postfix to fix vulnerability with path traversal to docId or other files
  cmd.setSaveKey(task.key.substring(docId.length));
}
function addPasswordToCmd(ctx, cmd, docPasswordStr, originFormat) {
  let docPassword = sqlBase.DocumentPassword.prototype.getDocPassword(ctx, docPasswordStr);
  if (docPassword.current) {
    if (formatChecker.isBrowserEditorFormat(originFormat)) {
      //todo not allowed different password
      cmd.setPassword(docPassword.current);
    }
    cmd.setSavePassword(docPassword.current);
  }
  if (docPassword.change) {
    cmd.setExternalChangeInfo(docPassword.change);
  }
}
function addOriginFormat(ctx, cmd, row) {
  cmd.setOriginFormat(row && row.change_id);
}

function changeFormatByOrigin(ctx, row, format) {
  const tenAssemblyFormatAsOrigin = ctx.getCfg('services.CoAuthoring.server.assemblyFormatAsOrigin', cfgAssemblyFormatAsOrigin);

  let originFormat = row && row.change_id;
  if (originFormat && constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== originFormat) {
    if (tenAssemblyFormatAsOrigin) {
      format = originFormat;
    } else {
      //for wopi always save origin
      let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
      let wopiParams = wopiClient.parseWopiCallback(ctx, userAuthStr, row.callback);
      if (wopiParams) {
        format = originFormat;
      }
    }
  }
  return format;
}
function* saveParts(ctx, cmd, filename) {
  var result = false;
  var saveType = cmd.getSaveType();
  if (SAVE_TYPE_COMPLETE_ALL !== saveType) {
    let ext = pathModule.extname(filename);
    let saveIndex = parseInt(cmd.getSaveIndex()) || 1;//prevent path traversal
    filename = pathModule.basename(filename, ext) + saveIndex + ext;
  }
  if ((SAVE_TYPE_PART_START === saveType || SAVE_TYPE_COMPLETE_ALL === saveType) && !cmd.getSaveKey()) {
    yield* addRandomKeyTaskCmd(ctx, cmd);
  }
  if (cmd.getUrl()) {
    result = true;
  } else if (cmd.getData() && cmd.getData().length > 0 && cmd.getSaveKey()) {
    var buffer = cmd.getData();
    yield storage.putObject(ctx, cmd.getDocId() + cmd.getSaveKey() + '/' + filename, buffer, buffer.length);
    //delete data to prevent serialize into json
    cmd.data = null;
    result = (SAVE_TYPE_COMPLETE_ALL === saveType || SAVE_TYPE_COMPLETE === saveType);
  } else {
    result = true;
  }
  return result;
}
function getSaveTask(ctx, cmd) {
  cmd.setData(null);
  var queueData = new commonDefines.TaskQueueData();
  queueData.setCtx(ctx);
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
async function getUpdateResponse(ctx, cmd) {
  const tenOpenProtectedFile = ctx.getCfg('services.CoAuthoring.server.openProtectedFile', cfgOpenProtectedFile);

  var updateTask = new taskResult.TaskResultData();
  updateTask.tenant = ctx.tenant;
  updateTask.key = cmd.getDocId();
  if (cmd.getSaveKey()) {
    updateTask.key += cmd.getSaveKey();
  }
  var statusInfo = cmd.getStatusInfo();
  if (constants.NO_ERROR === statusInfo) {
    updateTask.status = commonDefines.FileStatus.Ok;
    let password = cmd.getPassword();
    if (password) {
      if (false === hasPasswordCol) {
        let selectRes = await taskResult.select(ctx, updateTask.key);
        hasPasswordCol = selectRes.length > 0 && undefined !== selectRes[0].password;
      }
      if(hasPasswordCol) {
        updateTask.password = password;
      }
    }
  } else if (constants.CONVERT_TEMPORARY === statusInfo) {
    updateTask.status = commonDefines.FileStatus.ErrToReload;
  } else if (constants.CONVERT_DOWNLOAD === statusInfo) {
    updateTask.status = commonDefines.FileStatus.ErrToReload;
  } else if (constants.CONVERT_LIMITS === statusInfo) {
    updateTask.status = commonDefines.FileStatus.ErrToReload;
  } else if (constants.CONVERT_NEED_PARAMS === statusInfo) {
    updateTask.status = commonDefines.FileStatus.NeedParams;
  } else if (constants.CONVERT_DRM === statusInfo || constants.CONVERT_PASSWORD === statusInfo) {
    if (tenOpenProtectedFile) {
      updateTask.status = commonDefines.FileStatus.NeedPassword;
    } else {
      updateTask.status = commonDefines.FileStatus.Err;
    }
  } else if (constants.CONVERT_DRM_UNSUPPORTED === statusInfo) {
    updateTask.status = commonDefines.FileStatus.Err;
  } else if (constants.CONVERT_DEAD_LETTER === statusInfo) {
    updateTask.status = commonDefines.FileStatus.ErrToReload;
  } else {
    updateTask.status = commonDefines.FileStatus.Err;
  }
  updateTask.statusInfo = statusInfo;
  return updateTask;
}
var cleanupCache = co.wrap(function* (ctx, docId) {
  //todo redis ?
  var res = false;
  var removeRes = yield taskResult.remove(ctx, docId);
  if (removeRes.affectedRows > 0) {
    yield storage.deletePath(ctx, docId);
    res = true;
  }
  ctx.logger.debug("cleanupCache docId=%s db.affectedRows=%d", docId, removeRes.affectedRows);
  return res;
});
var cleanupCacheIf = co.wrap(function* (ctx, mask) {
  //todo redis ?
  var res = false;
  var removeRes = yield taskResult.removeIf(ctx, mask);
  if (removeRes.affectedRows > 0) {
    sqlBase.deleteChanges(ctx, mask.key, null);
    yield storage.deletePath(ctx, mask.key);
    res = true;
  }
  ctx.logger.debug("cleanupCacheIf db.affectedRows=%d", removeRes.affectedRows);
  return res;
});
async function cleanupErrToReload(ctx, key) {
  let updateTask = new taskResult.TaskResultData();
  updateTask.tenant = ctx.tenant;
  updateTask.key = key;
  updateTask.status = commonDefines.FileStatus.None;
  updateTask.statusInfo = constants.NO_ERROR;
  await taskResult.update(ctx, updateTask);
}

function commandOpenStartPromise(ctx, docId, baseUrl, opt_documentCallbackUrl, opt_format) {
  var task = new taskResult.TaskResultData();
  task.tenant = ctx.tenant;
  task.key = docId;
  //None instead WaitQueue to prevent: conversion task is lost when entering and leaving the editor quickly(that leads to an endless opening)
  task.status = commonDefines.FileStatus.None;
  task.statusInfo = constants.NO_ERROR;
  task.baseurl = baseUrl;
  if (opt_documentCallbackUrl) {
    task.callback = opt_documentCallbackUrl;
  }
  if (opt_format) {
    task.changeId = formatChecker.getFormatFromString(opt_format);
  }
  return taskResult.upsert(ctx, task);
}
function* commandOpen(ctx, conn, cmd, outputData, opt_upsertRes, opt_bIsRestore) {
  const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);

  var upsertRes;
  if (opt_upsertRes) {
    upsertRes = opt_upsertRes;
  } else {
    upsertRes = yield commandOpenStartPromise(ctx, cmd.getDocId(), utils.getBaseUrlByConnection(ctx, conn), undefined, cmd.getFormat());
  }
  let bCreate = upsertRes.isInsert;
  let needAddTask = bCreate;
  if (!bCreate) {
    needAddTask = yield* commandOpenFillOutput(ctx, conn, cmd, outputData, opt_bIsRestore);
  }
  if (conn.encrypted) {
    ctx.logger.debug("commandOpen encrypted %j", outputData);
    if (constants.FILE_STATUS_UPDATE_VERSION !== outputData.getStatus()) {
      //don't send output data
      outputData.setStatus(undefined);
    }
  } else if (needAddTask) {
    let updateMask = new taskResult.TaskResultData();
    updateMask.tenant = ctx.tenant;
    updateMask.key = cmd.getDocId();
    updateMask.status = commonDefines.FileStatus.None;

    let task = new taskResult.TaskResultData();
    task.status = commonDefines.FileStatus.WaitQueue;
    task.statusInfo = constants.NO_ERROR;

    let updateIfRes = yield taskResult.updateIf(ctx, task, updateMask);
      if (updateIfRes.affectedRows > 0) {
        let forgotten = yield storage.listObjects(ctx, cmd.getDocId(), tenForgottenFiles);
        //replace url with forgotten file because it absorbed all lost changes
        if (forgotten.length > 0) {
          ctx.logger.debug("commandOpen from forgotten");
          cmd.setUrl(undefined);
          cmd.setForgotten(cmd.getDocId());
        }
        //add task
        if (!cmd.getOutputFormat()) {
          //todo remove getOpenFormatByEditor after 8.2.1
          cmd.setOutputFormat(docsCoServer.getOpenFormatByEditor(conn.editorType));
        }
        cmd.setEmbeddedFonts(false);
        var dataQueue = new commonDefines.TaskQueueData();
        dataQueue.setCtx(ctx);
        dataQueue.setCmd(cmd);
        dataQueue.setToFile('Editor.bin');
        yield* docsCoServer.addTask(dataQueue, constants.QUEUE_PRIORITY_HIGH);
      } else {
        yield* commandOpenFillOutput(ctx, conn, cmd, outputData, opt_bIsRestore);
      }
    }
  }
function* commandOpenFillOutput(ctx, conn, cmd, outputData, opt_bIsRestore) {
  let status = yield getOutputData(ctx, cmd, outputData, cmd.getDocId(), conn, undefined, opt_bIsRestore);
  return commonDefines.FileStatus.None === status;
}
function* commandReopen(ctx, conn, cmd, outputData) {
  const tenOpenProtectedFile = ctx.getCfg('services.CoAuthoring.server.openProtectedFile', cfgOpenProtectedFile);

  let res = true;
  let isPassword = undefined !== cmd.getPassword();
  if (isPassword) {
    let selectRes = yield taskResult.select(ctx, cmd.getDocId());
    if (selectRes.length > 0) {
      let row = selectRes[0];
      if (sqlBase.DocumentPassword.prototype.getCurPassword(ctx, row.password)) {
        ctx.logger.debug('commandReopen has password');
        yield* commandOpenFillOutput(ctx, conn, cmd, outputData, false);
        yield docsCoServer.modifyConnectionForPassword(ctx, conn, constants.FILE_STATUS_OK === outputData.getStatus());
        return res;
      }
    }
  }
  if (!isPassword || tenOpenProtectedFile) {
    let updateMask = new taskResult.TaskResultData();
    updateMask.tenant = ctx.tenant;
    updateMask.key = cmd.getDocId();
    updateMask.status = isPassword ? commonDefines.FileStatus.NeedPassword : commonDefines.FileStatus.NeedParams;

    var task = new taskResult.TaskResultData();
    task.status = commonDefines.FileStatus.WaitQueue;
    task.statusInfo = constants.NO_ERROR;

    var upsertRes = yield taskResult.updateIf(ctx, task, updateMask);
    if (upsertRes.affectedRows > 0) {
      //add task
      cmd.setUrl(null);//url may expire
      if (!cmd.getOutputFormat()) {
        //todo remove getOpenFormatByEditor after 8.2.1
        cmd.setOutputFormat(docsCoServer.getOpenFormatByEditor(conn.editorType));
      }
      cmd.setEmbeddedFonts(false);
      if (isPassword) {
        cmd.setUserConnectionId(conn.user.id);
      }
      var dataQueue = new commonDefines.TaskQueueData();
      dataQueue.setCtx(ctx);
      dataQueue.setCmd(cmd);
      dataQueue.setToFile('Editor.bin');
      dataQueue.setFromSettings(true);
      yield* docsCoServer.addTask(dataQueue, constants.QUEUE_PRIORITY_HIGH);
    } else {
      outputData.setStatus('needpassword');
      outputData.setData(constants.CONVERT_PASSWORD);
    }
  } else {
    res = false;
  }
  return res;
}
function* commandSave(ctx, cmd, outputData) {
  let format = cmd.getFormat() || 'bin';
  var completeParts = yield* saveParts(ctx, cmd, "Editor." + format);
  if (completeParts) {
    var queueData = getSaveTask(ctx, cmd);
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  }
  outputData.setStatus('ok');
  outputData.setData(cmd.getSaveKey());
}
function* commandSendMailMerge(ctx, cmd, outputData) {
  let mailMergeSend = cmd.getMailMergeSend();
  let isJson = mailMergeSend.getIsJsonKey();
  var completeParts = yield* saveParts(ctx, cmd, isJson ? "Editor.json" : "Editor.bin");
  var isErr = false;
  if (completeParts && !isJson) {
    isErr = true;
    var getRes = yield docsCoServer.getCallback(ctx, cmd.getDocId(), cmd.getUserIndex());
    if (getRes && !getRes.wopiParams) {
      mailMergeSend.setUrl(getRes.server.href);
      mailMergeSend.setBaseUrl(getRes.baseUrl);
      //we change JsonKey and SaveKey, a new key is needed because a part is done in one conversion, and json is always needed
      mailMergeSend.setJsonKey(cmd.getSaveKey());
      mailMergeSend.setRecordErrorCount(0);
      yield* addRandomKeyTaskCmd(ctx, cmd);
      var queueData = getSaveTask(ctx, cmd);
      yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
      isErr = false;
    } else if (getRes.wopiParams) {
      ctx.logger.warn('commandSendMailMerge unexpected with wopi');
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
let commandSfctByCmd = co.wrap(function*(ctx, cmd, opt_priority, opt_expiration, opt_queue, opt_initShardKey) {
  var selectRes = yield taskResult.selectWithCache(ctx, cmd.getDocId());
  var row = selectRes.length > 0 ? selectRes[0] : null;
  if (!row) {
    return false;
  }
  if (opt_initShardKey) {
    ctx.setShardKey(sqlBase.DocumentAdditional.prototype.getShardKey(row.additional));
    ctx.setWopiSrc(sqlBase.DocumentAdditional.prototype.getWopiSrc(row.additional));
  }
  yield* addRandomKeyTaskCmd(ctx, cmd);
  addPasswordToCmd(ctx, cmd, row.password, row.change_id);
  addOriginFormat(ctx, cmd, row);
  let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
  cmd.setWopiParams(wopiClient.parseWopiCallback(ctx, userAuthStr, row.callback));
  cmd.setOutputFormat(changeFormatByOrigin(ctx, row, cmd.getOutputFormat()));
  cmd.appendJsonParams(getOpenedAtJSONParams(row));
  var queueData = getSaveTask(ctx, cmd);
  queueData.setFromChanges(true);
  let priority = null != opt_priority ? opt_priority : constants.QUEUE_PRIORITY_LOW;
  yield* docsCoServer.addTask(queueData, priority, opt_queue, opt_expiration);
  return true;
});
function isDisplayedImage(strName) {
  var res = 0;
  if (strName) {
    //template display[N]image.ext
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
function* commandImgurls(ctx, conn, cmd, outputData) {
  const tenTypesUpload = ctx.getCfg('services.CoAuthoring.utils.limits_image_types_upload', cfgTypesUpload);
  const tenImageSize = ctx.getCfg('services.CoAuthoring.server.limits_image_size', cfgImageSize);
  const tenImageDownloadTimeout = ctx.getCfg('services.CoAuthoring.server.limits_image_download_timeout', cfgImageDownloadTimeout);
  const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

  var errorCode = constants.NO_ERROR;
  let urls = cmd.getData();
  let authorizations = [];
  let isInJwtToken = false;
  let token = cmd.getTokenDownload();
  if (tenTokenEnableBrowser && token) {
    let checkJwtRes = yield docsCoServer.checkJwt(ctx, token, commonDefines.c_oAscSecretType.Browser);
    if (checkJwtRes.decoded) {
      //todo multiple url case
      if (checkJwtRes.decoded.images) {
        urls = checkJwtRes.decoded.images.map(function(curValue) {
          return curValue.url;
        });
      } else {
        urls = [checkJwtRes.decoded.url];
      }
      for (let i = 0; i < urls.length; ++i) {
        if (utils.canIncludeOutboxAuthorization(ctx, urls[i])) {
          let secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Outbox);
          authorizations[i] = [utils.fillJwtForRequest(ctx, {url: urls[i]}, secret, false)];
        }
      }
      isInJwtToken = true;
    } else {
      ctx.logger.warn('Error commandImgurls jwt: %s', checkJwtRes.description);
      errorCode = constants.VKEY_ENCRYPT;
    }
  }
  var supportedFormats = tenTypesUpload || 'jpg';
  var outputUrls = [];
  if (constants.NO_ERROR === errorCode && !conn.user.view && !conn.isCloseCoAuthoring) {
    //todo Promise.all()
    let displayedImageMap = {};//to make one prefix for ole object urls
    for (var i = 0; i < urls.length; ++i) {
      var urlSource = urls[i];
      var urlParsed;
      var data = undefined;
      if (urlSource?.startsWith('data:')) {
        let delimiterIndex = urlSource.indexOf(',');
        if (-1 != delimiterIndex) {
          let dataLen = urlSource.length - (delimiterIndex + 1);
          if ('hex' === urlSource.substring(delimiterIndex - 3, delimiterIndex).toLowerCase()) {
            if (dataLen * 0.5 <= tenImageSize) {
              data = Buffer.from(urlSource.substring(delimiterIndex + 1), 'hex');
            } else {
              errorCode = constants.UPLOAD_CONTENT_LENGTH;
            }
          } else {
            if (dataLen * 0.75 <= tenImageSize) {
              data = Buffer.from(urlSource.substring(delimiterIndex + 1), 'base64');
            } else {
              errorCode = constants.UPLOAD_CONTENT_LENGTH;
            }
          }
        }
      } else if (urlSource) {
        try {
          if (authorizations[i]) {
            let urlParsed = urlModule.parse(urlSource);
            let filterStatus = yield* utils.checkHostFilter(ctx, urlParsed.hostname);
            if (0 !== filterStatus) {
              throw Error('checkIpFilter');
            }
          }
          //todo stream
          let getRes = yield utils.downloadUrlPromise(ctx, urlSource, tenImageDownloadTimeout, tenImageSize, authorizations[i], isInJwtToken);
          data = getRes.body;
          urlParsed = urlModule.parse(urlSource);
        } catch (e) {
          data = undefined;
          ctx.logger.error('error commandImgurls download: url = %s; %s', urlSource, e.stack);
          if (e.code === 'EMSGSIZE') {
            errorCode = constants.UPLOAD_CONTENT_LENGTH;
          } else {
            errorCode = constants.UPLOAD_URL;
          }
        }
      }

      var outputUrl = {url: 'error', path: 'error'};
      if (data) {
        data = yield utilsDocService.fixImageExifRotation(ctx, data);

        let format = formatChecker.getImageFormat(ctx, data);
        let formatStr;
        let isAllow = false;
        if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== format) {
          formatStr = formatChecker.getStringFromFormat(format);
          if (formatStr && -1 !== supportedFormats.indexOf(formatStr)) {
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
          if (format === constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF) {
            data = yield utilsDocService.convertImageToPng(ctx, data);
            format = constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG;
            formatStr = formatChecker.getStringFromFormat(format);
          }
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
          yield storage.putObject(ctx, strPath, data, data.length);
          var imgUrl = yield storage.getSignedUrl(ctx, conn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Session);
          outputUrl = {url: imgUrl, path: strLocalPath};
        }
      }
      if (constants.NO_ERROR === errorCode && ('error' === outputUrl.url || 'error' === outputUrl.path)) {
        errorCode = constants.UPLOAD_EXTENSION;
      }
      outputUrls.push(outputUrl);
    }
  } else if(constants.NO_ERROR === errorCode) {
    ctx.logger.warn('error commandImgurls: access deny');
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
function* commandPathUrls(ctx, conn, data, outputData) {
  let listImages = data.map(function callback(currentValue) {
    return conn.docId + '/' + currentValue;
  });
  let urls = yield storage.getSignedUrlsArrayByArray(ctx, conn.baseUrl, listImages, commonDefines.c_oAscUrlTypes.Session);
  outputData.setStatus('ok');
  outputData.setData(urls);
}
function* commandPathUrl(ctx, conn, cmd, outputData) {
  var strPath = conn.docId + '/' + cmd.getData();
  var url = yield storage.getSignedUrl(ctx, conn.baseUrl, strPath, commonDefines.c_oAscUrlTypes.Temporary, cmd.getTitle());
  var errorCode = constants.NO_ERROR;
  if (constants.NO_ERROR !== errorCode) {
    outputData.setStatus('err');
    outputData.setData(errorCode);
  } else {
    outputData.setStatus('ok');
    outputData.setData(url);
    outputData.setExtName(pathModule.extname(strPath));
  }
}
function* commandSaveFromOrigin(ctx, cmd, outputData, password) {
  var completeParts = yield* saveParts(ctx, cmd, "changes0.json");
  if (completeParts) {
    let docPassword = sqlBase.DocumentPassword.prototype.getDocPassword(ctx, password);
    //Use current password for pdf because password is entered in the browser when opening and is set via setPassword
    if (docPassword.initial || docPassword.current) {
      cmd.setPassword(docPassword.initial || docPassword.current);
    }
    //todo setLCID in browser
    var queueData = getSaveTask(ctx, cmd);
    queueData.setFromOrigin(true);
    queueData.setFromChanges(true);
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  }
  outputData.setStatus('ok');
  outputData.setData(cmd.getSaveKey());
}
function* commandSetPassword(ctx, conn, cmd, outputData) {
  const tenOpenProtectedFile = ctx.getCfg('services.CoAuthoring.server.openProtectedFile', cfgOpenProtectedFile);

  let hasDocumentPassword = false;
  let isDocumentPasswordModified = true;
  let originFormat;
  let selectRes = yield taskResult.select(ctx, cmd.getDocId());
  if (selectRes.length > 0) {
    let row = selectRes[0];
    originFormat = row.change_id;
    hasPasswordCol = undefined !== row.password;
    if (commonDefines.FileStatus.Ok === row.status) {
      let documentPasswordCurEnc = sqlBase.DocumentPassword.prototype.getCurPassword(ctx, row.password);
      if (documentPasswordCurEnc) {
        hasDocumentPassword = true;
        if (cmd.getPassword()) {
          const passwordCurPlain = yield utils.decryptPassword(ctx, documentPasswordCurEnc);
          const passwordPlain = yield utils.decryptPassword(ctx, cmd.getPassword());
          isDocumentPasswordModified = passwordCurPlain !== passwordPlain;
        }
      }
    }
  }
  //https://github.com/ONLYOFFICE/web-apps/blob/4a7879b4f88f315fe94d9f7d97c0ed8aa9f82221/apps/documenteditor/main/app/controller/Main.js#L1652
  //this.appOptions.isPasswordSupport = this.appOptions.isEdit && this.api.asc_isProtectionSupport() && (this.permissions.protect!==false);
  let isPasswordSupport = tenOpenProtectedFile && !conn.user?.view && false !== conn.permissions?.protect;
  ctx.logger.debug('commandSetPassword isEnterCorrectPassword=%s, hasDocumentPassword=%s, hasPasswordCol=%s, isPasswordSupport=%s', conn.isEnterCorrectPassword, hasDocumentPassword, hasPasswordCol, isPasswordSupport);
  if (isPasswordSupport && hasPasswordCol && hasDocumentPassword && !isDocumentPasswordModified) {
    outputData.setStatus('ok');
  } else if (isPasswordSupport && (conn.isEnterCorrectPassword || !hasDocumentPassword) && hasPasswordCol) {
    let updateMask = new taskResult.TaskResultData();
    updateMask.tenant = ctx.tenant;
    updateMask.key = cmd.getDocId();
    updateMask.status = commonDefines.FileStatus.Ok;

    let newChangesLastDate = new Date();
    newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding

    var task = new taskResult.TaskResultData();
    task.password = cmd.getPassword() || "";
    let changeInfo = null;
    if (conn.user && (hasDocumentPassword || !formatChecker.isBrowserEditorFormat(originFormat))) {
      changeInfo = task.innerPasswordChange = docsCoServer.getExternalChangeInfo(conn.user, newChangesLastDate.getTime(), conn.lang);
    }

    var upsertRes = yield taskResult.updateIf(ctx, task, updateMask);
    if (upsertRes.affectedRows > 0) {
      outputData.setStatus('ok');
      if (!conn.isEnterCorrectPassword) {
        yield docsCoServer.modifyConnectionForPassword(ctx, conn, true);
      }
      if (changeInfo) {
        let forceSave = yield docsCoServer.editorData.getForceSave(ctx, cmd.getDocId());
        let index = forceSave?.index || 0;
        yield docsCoServer.resetForceSaveAfterChanges(ctx, cmd.getDocId(), newChangesLastDate.getTime(), index, utils.getBaseUrlByConnection(ctx, conn), changeInfo);
      }
    } else {
      ctx.logger.debug('commandSetPassword sql update error');
      outputData.setStatus('err');
      outputData.setData(constants.PASSWORD);
    }
  } else {
    outputData.setStatus('err');
    outputData.setData(constants.PASSWORD);
  }
}
function* commandChangeDocInfo(ctx, conn, cmd, outputData) {
  let res = yield docsCoServer.changeConnectionInfo(ctx, conn, cmd);
  if(res) {
    outputData.setStatus('ok');
  } else {
    outputData.setStatus('err');
    outputData.setData(constants.CHANGE_DOC_INFO);
  }
}
function checkAndFixAuthorizationLength(authorization, data){
  //todo it is stub (remove in future versions)
  //8kb(https://stackoverflow.com/questions/686217/maximum-on-http-header-values) - 1kb(for other headers)
  let res = authorization.length < 7168;
  if (!res) {
    data.setChangeUrl(undefined);
    data.setChangeHistory({});
  }
  return res;
}
const commandSfcCallback = co.wrap(function*(ctx, cmd, isSfcm, isEncrypted) {
  const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);
  const tenForgottenFilesName = ctx.getCfg('services.CoAuthoring.server.forgottenfilesname', cfgForgottenFilesName);
  const tenCallbackBackoffOptions = ctx.getCfg('services.CoAuthoring.callbackBackoffOptions', cfgCallbackBackoffOptions);

  var docId = cmd.getDocId();
  ctx.logger.debug('Start commandSfcCallback');
  var statusInfo = cmd.getStatusInfo();
  //setUserId - set from changes in convert
  //setUserActionId - used in case of save without changes(forgotten files)
  const userLastChangeId = cmd.getUserId() || cmd.getUserActionId();
  const userLastChangeIndex = cmd.getUserIndex() || cmd.getUserActionIndex();
  let replyStr;
  if (constants.EDITOR_CHANGES !== statusInfo || isSfcm) {
    var saveKey = docId + cmd.getSaveKey();
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
    let uri, baseUrl, wopiParams, lastOpenDate;
    let selectRes = yield taskResult.select(ctx, docId);
    let row = selectRes.length > 0 ? selectRes[0] : null;
    if (row) {
      if (row.callback) {
        uri = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback, callbackUserIndex);
        wopiParams = wopiClient.parseWopiCallback(ctx, uri, row.callback);
      }
      if (row.baseurl) {
        baseUrl = row.baseurl;
      }
      lastOpenDate = row.last_open_date;
    }
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
    recoverTask.status = commonDefines.FileStatus.Ok;
    recoverTask.statusInfo = constants.NO_ERROR;
    let updateIfTask = new taskResult.TaskResultData();
    updateIfTask.status = commonDefines.FileStatus.UpdateVersion;
    updateIfTask.statusInfo = Math.floor(Date.now() / 60000);//minutes
    let updateIfRes;

    let updateMask = new taskResult.TaskResultData();
    updateMask.tenant = ctx.tenant;
    updateMask.key = docId;
    if (row) {
      if (isEncrypted) {
        recoverTask.status = updateMask.status = row.status;
        recoverTask.statusInfo = updateMask.statusInfo = row.status_info;
      } else if ((commonDefines.FileStatus.SaveVersion === row.status && cmd.getStatusInfoIn() === row.status_info) ||
        commonDefines.FileStatus.UpdateVersion === row.status) {
        if (commonDefines.FileStatus.UpdateVersion === row.status) {
          updateIfRes = {affectedRows: 1};
        }
        recoverTask.status = commonDefines.FileStatus.SaveVersion;
        recoverTask.statusInfo = cmd.getStatusInfoIn();
        updateMask.status = row.status;
        updateMask.statusInfo = row.status_info;
      } else {
        updateIfRes = {affectedRows: 0};
      }
    } else {
      isError = true;
    }
    let outputSfc;
    if (uri && baseUrl && userLastChangeId) {
      ctx.logger.debug('Callback commandSfcCallback: callback = %s', uri);
      outputSfc = new commonDefines.OutputSfcData(docId);
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
      let formsData = cmd.getFormData();
      if (formsData) {
        let formsDataPath = saveKey + '/formsdata.json';
        let formsBuffer = Buffer.from(JSON.stringify(formsData), 'utf8');
        yield storage.putObject(ctx, formsDataPath, formsBuffer, formsBuffer.length);
        let formsDataUrl = yield storage.getSignedUrl(ctx, baseUrl, formsDataPath, commonDefines.c_oAscUrlTypes.Temporary);
        outputSfc.setFormsDataUrl(formsDataUrl);
      }
      if (!isError || isErrorCorrupted) {
        try {
          let forgotten = yield storage.listObjects(ctx, docId, tenForgottenFiles);
          let isSendHistory = 0 === forgotten.length;
          if (!isSendHistory) {
            //check indicator file to determine if opening was from the forgotten file
            var forgottenMarkPath = docId + '/' + tenForgottenFilesName + '.txt';
            var forgottenMark = yield storage.listObjects(ctx, forgottenMarkPath);
            isOpenFromForgotten = 0 !== forgottenMark.length;
            isSendHistory = !isOpenFromForgotten;
            ctx.logger.debug('commandSfcCallback forgotten no empty: isSendHistory = %s', isSendHistory);
          }
          if (isSendHistory && !isEncrypted) {
            //don't send history info because changes isn't from file in storage
            var data = yield storage.getObject(ctx, savePathHistory);
            outputSfc.setChangeHistory(JSON.parse(data.toString('utf-8')));
            let changeUrl = yield storage.getSignedUrl(ctx, baseUrl, savePathChanges,
                                                       commonDefines.c_oAscUrlTypes.Temporary);
            outputSfc.setChangeUrl(changeUrl);
          } else {
            //for backward compatibility. remove this when Community is ready
            outputSfc.setChangeHistory({});
          }
          let url = yield storage.getSignedUrl(ctx, baseUrl, savePathDoc, commonDefines.c_oAscUrlTypes.Temporary);
          outputSfc.setUrl(url);
          outputSfc.setExtName(pathModule.extname(savePathDoc));
        } catch (e) {
          ctx.logger.error('Error commandSfcCallback: %s', e.stack);
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
      if (isSfcm) {
        let selectRes = yield taskResult.select(ctx, docId);
        let row = selectRes.length > 0 ? selectRes[0] : null;
        //send only if FileStatus.Ok to prevent forcesave after final save
        if (row && row.status == commonDefines.FileStatus.Ok) {
          if (forceSave) {
            let forceSaveDate = forceSave.getTime() ? new Date(forceSave.getTime()): new Date();
            outputSfc.setForceSaveType(forceSaveType);
            outputSfc.setLastSave(forceSaveDate.toISOString());
          }
          if (forceSave && forceSaveType === commonDefines.c_oAscForceSaveTypes.Internal) {
            //send to browser only if internal forcesave
            isSfcmSuccess = true;
          } else {
            try {
              if (wopiParams) {
                if (outputSfc.getUrl()) {
                  if (forceSaveType === commonDefines.c_oAscForceSaveTypes.Form) {
                    yield processWopiSaveAs(ctx, cmd);
                    replyStr = JSON.stringify({error: 0});
                  } else {
                    let isAutoSave = forceSaveType !== commonDefines.c_oAscForceSaveTypes.Button && forceSaveType !== commonDefines.c_oAscForceSaveTypes.Form;
                    replyStr = yield processWopiPutFile(ctx, docId, wopiParams, savePathDoc, userLastChangeId, true, isAutoSave, false);
                  }
                } else {
                  replyStr = JSON.stringify({error: 1, descr: "wopi: no file"});
                }
              } else {
                replyStr = yield docsCoServer.sendServerRequest(ctx, uri, outputSfc, checkAndFixAuthorizationLength);
              }
              let replyData = docsCoServer.parseReplyData(ctx, replyStr);
              isSfcmSuccess = replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error;
              if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
                ctx.logger.warn('sendServerRequest returned an error: data = %s', replyStr);
              }
            } catch (err) {
              ctx.logger.error('sendServerRequest error: url = %s;data = %j %s', uri, outputSfc, err.stack);
            }
          }
        }
      } else {
        //if anybody in document stop save
        let editorsCount = yield docsCoServer.getEditorsCountPromise(ctx, docId);
        ctx.logger.debug('commandSfcCallback presence: count = %d', editorsCount);
        if (0 === editorsCount || (isEncrypted && 1 === editorsCount)) {
          if (!updateIfRes) {
            updateIfRes = yield taskResult.updateIf(ctx, updateIfTask, updateMask);
          }
          if (updateIfRes.affectedRows > 0) {
            let actualForceSave = yield docsCoServer.editorData.getForceSave(ctx, docId);
            let forceSaveDate = (actualForceSave && actualForceSave.time) ? new Date(actualForceSave.time) : new Date();
            let notModified = actualForceSave && true === actualForceSave.ended;
            outputSfc.setLastSave(forceSaveDate.toISOString());
            outputSfc.setNotModified(notModified);

            updateMask.status = updateIfTask.status;
            updateMask.statusInfo = updateIfTask.statusInfo;
            try {
              if (wopiParams) {
                if (outputSfc.getUrl()) {
                  replyStr = yield processWopiPutFile(ctx, docId, wopiParams, savePathDoc, userLastChangeId, !notModified, false, true);
                } else {
                  replyStr = JSON.stringify({error: 1, descr: "wopi: no file"});
                }
              } else {
                replyStr = yield docsCoServer.sendServerRequest(ctx, uri, outputSfc, checkAndFixAuthorizationLength);
              }
            } catch (err) {
              ctx.logger.error('sendServerRequest error: url = %s;data = %j %s', uri, outputSfc, err.stack);
              const retryHttpStatus = new MultiRange(tenCallbackBackoffOptions.httpStatus);
              if (!isEncrypted && !docsCoServer.getIsShutdown() && (!err.statusCode || retryHttpStatus.has(err.statusCode.toString()))) {
                let attempt = cmd.getAttempt() || 0;
                if (attempt < tenCallbackBackoffOptions.retries) {
                  needRetry = true;
                } else {
                  ctx.logger.warn('commandSfcCallback backoff limit exceeded');
                }
              }
            }
            var requestRes = false;
            var replyData = docsCoServer.parseReplyData(ctx, replyStr);
            if (replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error) {
              //in the case of a community server, a request will come to the Command Service, check the result
              var savedVal = yield docsCoServer.editorData.getdelSaved(ctx, docId);
              requestRes = (null == savedVal || '1' === savedVal);
            }
            if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
              ctx.logger.warn('sendServerRequest returned an error: data = %s', replyStr);
            }
            if (requestRes) {
              updateIfTask = undefined;
              yield docsCoServer.cleanDocumentOnExitPromise(ctx, docId, true, callbackUserIndex);
              if (isOpenFromForgotten) {
                //remove forgotten file in cache
                yield cleanupCache(ctx, docId);
              }
              if (lastOpenDate) {
                //todo error case
                let time = new Date() - lastOpenDate;
                ctx.logger.debug('commandSfcCallback saveAfterEditingSessionClosed=%d', time);
                if (clientStatsD) {
                  clientStatsD.timing('coauth.saveAfterEditingSessionClosed', time);
                }
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
      ctx.logger.warn('Empty Callback=%s or baseUrl=%s or userLastChangeId=%s commandSfcCallback', uri, baseUrl, userLastChangeId);
      storeForgotten = true;
    }
    if (undefined !== updateIfTask && !isSfcm) {
      ctx.logger.debug('commandSfcCallback restore %d status', recoverTask.status);
      updateIfTask.status = recoverTask.status;
      updateIfTask.statusInfo = recoverTask.statusInfo;
      updateIfRes = yield taskResult.updateIf(ctx, updateIfTask, updateMask);
      if (updateIfRes.affectedRows > 0) {
        updateMask.status = updateIfTask.status;
        updateMask.statusInfo = updateIfTask.statusInfo;
      } else {
        ctx.logger.debug('commandSfcCallback restore %d status failed', recoverTask.status);
      }
    }
    if (storeForgotten && !needRetry && !isEncrypted && (!isError || isErrorCorrupted)) {
      try {
        ctx.logger.warn("storeForgotten");
        let forgottenName = tenForgottenFilesName + pathModule.extname(cmd.getOutputPath());
        yield storage.copyObject(ctx, savePathDoc, docId + '/' + forgottenName, undefined, tenForgottenFiles);
      } catch (err) {
        ctx.logger.error('Error storeForgotten: %s', err.stack);
      }
      if (!isSfcm) {
        //todo simultaneous opening
        //clean redis (redisKeyPresenceSet and redisKeyPresenceHash removed with last element)
        yield docsCoServer.editorData.cleanDocumentOnExit(ctx, docId);
        //to unlock wopi file
        yield docsCoServer.unlockWopiDoc(ctx, docId, callbackUserIndex);
        //cleanupRes can be false in case of simultaneous opening. it is OK
        let cleanupRes = yield cleanupCacheIf(ctx, updateMask);
        ctx.logger.debug('storeForgotten cleanupRes=%s', cleanupRes);
    }
    }
    if (forceSave) {
      yield* docsCoServer.setForceSave(ctx, docId, forceSave, cmd, isSfcmSuccess && !isError, outputSfc?.getUrl());
    }
    if (needRetry) {
      let attempt = cmd.getAttempt() || 0;
      cmd.setAttempt(attempt + 1);
      let queueData = new commonDefines.TaskQueueData();
      queueData.setCtx(ctx);
      queueData.setCmd(cmd);
      let timeout = retry.createTimeout(attempt, tenCallbackBackoffOptions.timeout);
      ctx.logger.debug('commandSfcCallback backoff timeout = %d', timeout);
      yield* docsCoServer.addDelayed(queueData, timeout);
    }
  } else {
    ctx.logger.debug('commandSfcCallback cleanDocumentOnExitNoChangesPromise');
    yield docsCoServer.cleanDocumentOnExitNoChangesPromise(ctx, docId, undefined, userLastChangeIndex, true);
  }

  if ((docsCoServer.getIsShutdown() && !isSfcm) || cmd.getRedisKey()) {
    let keyRedis = cmd.getRedisKey() ? cmd.getRedisKey() : redisKeyShutdown;
    yield docsCoServer.editorStat.removeShutdown(keyRedis, docId);
  }
  ctx.logger.debug('End commandSfcCallback');
  return replyStr;
});
function* processWopiPutFile(ctx, docId, wopiParams, savePathDoc, userLastChangeId, isModifiedByUser, isAutosave, isExitSave) {
  let res = '{"error": 1}';
  let metadata = yield storage.headObject(ctx, savePathDoc);
  let streamObj = yield storage.createReadStream(ctx, savePathDoc);
  let postRes = yield wopiClient.putFile(ctx, wopiParams, null, streamObj.readStream, metadata.ContentLength, userLastChangeId, isModifiedByUser, isAutosave, isExitSave);
  if (postRes) {
    res = '{"error": 0}';
    let body = wopiClient.parsePutFileResponse(ctx, postRes);
    //collabora nexcloud connector
    if (body?.LastModifiedTime) {
      let lastModifiedTimeInfo = wopiClient.getWopiModifiedMarker(wopiParams, body.LastModifiedTime);
      yield commandOpenStartPromise(ctx, docId, undefined, lastModifiedTimeInfo);
    }
  }
  return res;
}
function* commandSendMMCallback(ctx, cmd) {
  var docId = cmd.getDocId();
  ctx.logger.debug('Start commandSendMMCallback');
  var saveKey = docId + cmd.getSaveKey();
  var statusInfo = cmd.getStatusInfo();
  var outputSfc = new commonDefines.OutputSfcData(docId);
  if (constants.NO_ERROR == statusInfo) {
    outputSfc.setStatus(docsCoServer.c_oAscServerStatus.MailMerge);
  } else {
    outputSfc.setStatus(docsCoServer.c_oAscServerStatus.Corrupted);
  }
  var mailMergeSendData = cmd.getMailMergeSend();
  var outputMailMerge = new commonDefines.OutputMailMerge(mailMergeSendData);
  outputSfc.setMailMerge(outputMailMerge);
  outputSfc.setUsers([mailMergeSendData.getUserId()]);
  var data = yield storage.getObject(ctx, saveKey + '/' + cmd.getOutputPath());
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
    var signedUrl = yield storage.getSignedUrl(ctx, mailMergeSendData.getBaseUrl(), saveKey + '/' + pathRes[1],
                                               commonDefines.c_oAscUrlTypes.Temporary);
    outputSfc.setUrl(signedUrl);
    outputSfc.setExtName(pathModule.extname(pathRes[1]));
    var uri = mailMergeSendData.getUrl();
    var replyStr = null;
    try {
      replyStr = yield docsCoServer.sendServerRequest(ctx, uri, outputSfc);
    } catch (err) {
      replyStr = null;
      ctx.logger.error('sendServerRequest error: url = %s;data = %j %s', uri, outputSfc, err.stack);
    }
    var replyData = docsCoServer.parseReplyData(ctx, replyStr);
    if (!(replyData && commonDefines.c_oAscServerCommandErrors.NoError == replyData.error)) {
      var recordErrorCount = mailMergeSendData.getRecordErrorCount();
      recordErrorCount++;
      outputMailMerge.setRecordErrorCount(recordErrorCount);
      mailMergeSendData.setRecordErrorCount(recordErrorCount);
    }
    if (replyData && commonDefines.c_oAscServerCommandErrors.NoError != replyData.error) {
      ctx.logger.warn('sendServerRequest returned an error: data = %s', docId, replyStr);
    }
  }
  var newRecordFrom = mailMergeSendData.getRecordFrom() + Math.max(files.length, 1);
  if (newRecordFrom <= mailMergeSendData.getRecordTo()) {
    mailMergeSendData.setRecordFrom(newRecordFrom);
    yield* addRandomKeyTaskCmd(ctx, cmd);
    var queueData = getSaveTask(ctx, cmd);
    yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
  } else {
    ctx.logger.debug('End MailMerge');
  }
  ctx.logger.debug('End commandSendMMCallback');
}

exports.openDocument = function(ctx, conn, cmd, opt_upsertRes, opt_bIsRestore) {
  return co(function* () {
    var outputData;
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      ctx.logger.debug('Start command: %s', JSON.stringify(cmd));
      outputData = new OutputData(cmd.getCommand());
      let res = true;
      switch (cmd.getCommand()) {
        case 'open':
          yield* commandOpen(ctx, conn, cmd, outputData, opt_upsertRes, opt_bIsRestore);
          break;
        case 'reopen':
          res = yield* commandReopen(ctx, conn, cmd, outputData);
          break;
        case 'imgurls':
          yield* commandImgurls(ctx, conn, cmd, outputData);
          break;
        case 'pathurl':
          yield* commandPathUrl(ctx, conn, cmd, outputData);
          break;
        case 'pathurls':
          yield* commandPathUrls(ctx, conn, cmd.getData(), outputData);
          break;
        case 'setpassword':
          yield* commandSetPassword(ctx, conn, cmd, outputData);
          break;
        case 'changedocinfo':
          yield* commandChangeDocInfo(ctx, conn, cmd, outputData);
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
      ctx.logger.error('Error openDocument: %s', e.stack);
      if (!outputData) {
        outputData = new OutputData();
      }
      outputData.setStatus('err');
      outputData.setData(constants.UNKNOWN);
    }
    finally {
      if (outputData?.getStatus()) {
        ctx.logger.debug('Response command: %s', JSON.stringify(outputData));
        docsCoServer.sendData(ctx, conn, new OutputDataWrap('documentOpen', outputData));
      }
      ctx.logger.debug('End command');
    }
  });
};
exports.downloadAs = function(req, res) {
  return co(function* () {
    var docId = 'null';
    let ctx = new operationContext.Context();
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      var strCmd = req.query['cmd'];
      var cmd = new commonDefines.InputCommand(JSON.parse(strCmd));
      docId = cmd.getDocId();
      ctx.setDocId(docId);
      ctx.logger.debug('Start downloadAs: %s', strCmd);
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

      if (tenTokenEnableBrowser) {
        var isValidJwt = false;
        if (cmd.getTokenDownload()) {
          let checkJwtRes = yield docsCoServer.checkJwt(ctx, cmd.getTokenDownload(), commonDefines.c_oAscSecretType.Browser);
          if (checkJwtRes.decoded) {
            isValidJwt = true;
            cmd.setFormat(checkJwtRes.decoded.fileType);
            cmd.setUrl(checkJwtRes.decoded.url);
            cmd.setWithAuthorization(true);
          } else {
            ctx.logger.warn('Error downloadAs jwt: %s', checkJwtRes.description);
          }
        } else {
          let checkJwtRes = yield docsCoServer.checkJwt(ctx, cmd.getTokenSession(), commonDefines.c_oAscSecretType.Session);
          if (checkJwtRes.decoded) {
            let decoded = checkJwtRes.decoded;
            var doc = checkJwtRes.decoded.document;
            if (!doc.permissions || (false !== doc.permissions.download || false !== doc.permissions.print)) {
              isValidJwt = true;
              docId = doc.key;
              cmd.setDocId(doc.key);
              cmd.setUserIndex(decoded.editorConfig && decoded.editorConfig.user && decoded.editorConfig.user.index);
            } else {
              ctx.logger.warn('Error downloadAs jwt: %s', 'access deny');
            }
          } else {
            ctx.logger.warn('Error downloadAs jwt: %s', checkJwtRes.description);
          }
        }
        if (!isValidJwt) {
          res.sendStatus(403);
          return;
        }
      }
      ctx.setDocId(docId);
      var selectRes = yield taskResult.select(ctx, docId);
      var row = selectRes.length > 0 ? selectRes[0] : null;
      if (!cmd.getWithoutPassword()) {
        addPasswordToCmd(ctx, cmd, row && row.password, row && row.change_id);
      }
      addOriginFormat(ctx, cmd, row);
      cmd.setData(req.body);
      var outputData = new OutputData(cmd.getCommand());
      switch (cmd.getCommand()) {
        case 'save':
          yield* commandSave(ctx, cmd, outputData);
          break;
        case 'savefromorigin':
          yield* commandSaveFromOrigin(ctx, cmd, outputData, row && row.password);
          break;
        case 'sendmm':
          yield* commandSendMailMerge(ctx, cmd, outputData);
          break;
        default:
          outputData.setStatus('err');
          outputData.setData(constants.UNKNOWN);
          break;
      }
      var strRes = JSON.stringify(outputData);
      res.setHeader('Content-Type', 'application/json');
      res.send(strRes);
      ctx.logger.debug('End downloadAs: %s', strRes);
      if(clientStatsD) {
        clientStatsD.timing('coauth.downloadAs.' + cmd.getCommand(), new Date() - startDate);
      }
    }
    catch (e) {
      ctx.logger.error('Error downloadAs: %s', e.stack);
      res.sendStatus(400);
    }
  });
};
exports.saveFile = function(req, res) {
  return co(function*() {
    let docId = 'null';
    let ctx = new operationContext.Context();
    try {
      let startDate = null;
      if (clientStatsD) {
        startDate = new Date();
      }
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      let strCmd = req.query['cmd'];
      let cmd = new commonDefines.InputCommand(JSON.parse(strCmd));
      docId = cmd.getDocId();
      ctx.setDocId(docId);
      ctx.logger.debug('Start saveFile');
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

      if (tenTokenEnableBrowser) {
        let isValidJwt = false;
        let checkJwtRes = yield docsCoServer.checkJwt(ctx, cmd.getTokenSession(), commonDefines.c_oAscSecretType.Session);
        if (checkJwtRes.decoded) {
          let doc = checkJwtRes.decoded.document;
          var edit = checkJwtRes.decoded.editorConfig;
          if (doc.ds_encrypted && !edit.ds_view && !edit.ds_isCloseCoAuthoring) {
            isValidJwt = true;
            docId = doc.key;
            cmd.setDocId(doc.key);
          } else {
            ctx.logger.warn('Error saveFile jwt: %s', 'access deny');
          }
        } else {
          ctx.logger.warn('Error saveFile jwt: %s', checkJwtRes.description);
        }
        if (!isValidJwt) {
          res.sendStatus(403);
          return;
        }
      }
      ctx.setDocId(docId);
      cmd.setStatusInfo(constants.NO_ERROR);
      yield* addRandomKeyTaskCmd(ctx, cmd);
      cmd.setOutputPath(constants.OUTPUT_NAME + pathModule.extname(cmd.getOutputPath()));
      yield storage.putObject(ctx, docId + cmd.getSaveKey() + '/' + cmd.getOutputPath(), req.body, req.body.length);
      let replyStr = yield commandSfcCallback(ctx, cmd, false, true);
      if (replyStr) {
        utils.fillResponseSimple(res, replyStr, 'application/json');
      } else {
        res.sendStatus(400);
      }
      ctx.logger.debug('End saveFile: %s', replyStr);
      if (clientStatsD) {
        clientStatsD.timing('coauth.saveFile', new Date() - startDate);
      }
    }
    catch (e) {
      ctx.logger.error('Error saveFile: %s', e.stack);
      res.sendStatus(400);
    }
  });
};
function getPrintFileUrl(ctx, docId, baseUrl, filename) {
  return co(function*() {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenTokenSessionAlgorithm = ctx.getCfg('services.CoAuthoring.token.session.algorithm', cfgTokenSessionAlgorithm);
    const tenTokenSessionExpires = ms(ctx.getCfg('services.CoAuthoring.token.session.expires', cfgTokenSessionExpires));

    baseUrl = utils.checkBaseUrl(ctx, baseUrl);
    let token = '';
    if (tenTokenEnableBrowser) {
      let payload = {document: {key: docId}};
      token = yield docsCoServer.signToken(ctx, payload, tenTokenSessionAlgorithm, tenTokenSessionExpires / 1000, commonDefines.c_oAscSecretType.Session);
    }
    //while save printed file Chrome's extension seems to rely on the resource name set in the URI https://stackoverflow.com/a/53593453
    //replace '/' with %2f before encodeURIComponent becase nginx determine %2f as '/' and get wrong system path
    let userFriendlyName = encodeURIComponent(filename.replace(/\//g, "%2f"));
    let res = `${baseUrl}/printfile/${encodeURIComponent(docId)}/${userFriendlyName}?token=${encodeURIComponent(token)}`;
    if (ctx.shardKey) {
      res += `&${constants.SHARD_KEY_API_NAME}=${encodeURIComponent(ctx.shardKey)}`;
    }
    if (ctx.wopiSrc) {
      res += `&${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(ctx.wopiSrc)}`;
    }
    res += `&filename=${userFriendlyName}`;
    return res;
  });
}
exports.getPrintFileUrl = getPrintFileUrl;
exports.printFile = function(req, res) {
  return co(function*() {
    let docId = 'null';
    let ctx = new operationContext.Context();
    try {
      let startDate = null;
      if (clientStatsD) {
        startDate = new Date();
      }
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      let filename = req.query['filename'];
      let token = req.query['token'];
      docId = req.params.docid;
      ctx.setDocId(docId);
      ctx.logger.info('Start printFile');
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

      if (tenTokenEnableBrowser) {
        let checkJwtRes = yield docsCoServer.checkJwt(ctx, token, commonDefines.c_oAscSecretType.Session);
        if (checkJwtRes.decoded) {
          let docIdBase = checkJwtRes.decoded.document.key;
          if (!docId.startsWith(docIdBase)) {
            ctx.logger.warn('Error printFile jwt: description = %s', 'access deny');
            res.sendStatus(403);
            return;
          }
        } else {
          ctx.logger.warn('Error printFile jwt: description = %s', checkJwtRes.description);
          res.sendStatus(403);
          return;
        }
      }
      ctx.setDocId(docId);
      let streamObj = yield storage.createReadStream(ctx, `${docId}/${constants.OUTPUT_NAME}.pdf`);
      res.setHeader('Content-Disposition', utils.getContentDisposition(filename, null, constants.CONTENT_DISPOSITION_INLINE));
      res.setHeader('Content-Length', streamObj.contentLength);
      res.setHeader('Content-Type', 'application/pdf');
      yield utils.pipeStreams(streamObj.readStream, res, true);

      if (clientStatsD) {
        clientStatsD.timing('coauth.printFile', new Date() - startDate);
      }
    }
    catch (e) {
      ctx.logger.error('Error printFile: %s', e.stack);
      res.sendStatus(400);
    }
    finally {
      ctx.logger.info('End printFile');
    }
  });
};
exports.downloadFile = function(req, res) {
  return co(function*() {
    let ctx = new operationContext.Context();
    try {
      let startDate = null;
      if (clientStatsD) {
        startDate = new Date();
      }
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.setDocId(req.params.docid);
      //todo remove in 8.1. For compatibility
      let url = req.get('x-url');
      if (url) {
        url = decodeURI(url);
      }
      ctx.logger.info('Start downloadFile');
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
      const tenDownloadMaxBytes = ctx.getCfg('FileConverter.converter.maxDownloadBytes', cfgDownloadMaxBytes);
      const tenDownloadTimeout = ctx.getCfg('FileConverter.converter.downloadTimeout', cfgDownloadTimeout);
      const tenDownloadFileAllowExt = ctx.getCfg('services.CoAuthoring.server.downloadFileAllowExt', cfgDownloadFileAllowExt);
      const tenNewFileTemplate = ctx.getCfg('services.CoAuthoring.server.newFileTemplate', cfgNewFileTemplate);

      let authorization;
      let isInJwtToken = false;
      let errorDescription;
      let headers, fromTemplate;
      let authRes = yield docsCoServer.getRequestParams(ctx, req);
      if (authRes.code === constants.NO_ERROR) {
        let decoded = authRes.params;
        if (decoded.changesUrl) {
          url = decoded.changesUrl;
          isInJwtToken = true;
        } else if (decoded.document && -1 !== tenDownloadFileAllowExt.indexOf(decoded.document.fileType)) {
          url = decoded.document.url;
          isInJwtToken = true;
        } else if (decoded.url && -1 !== tenDownloadFileAllowExt.indexOf(decoded.fileType)) {
          url = decoded.url;
          isInJwtToken = true;
        } else if (wopiClient.isWopiJwtToken(decoded)) {
          if (decoded.fileInfo.Size === 0) {
            //editnew case
            fromTemplate = pathModule.extname(decoded.fileInfo.BaseFileName).substring(1);
          } else {
            ({url, headers} = yield wopiUtils.getWopiFileUrl(ctx, decoded.fileInfo, decoded.userAuth));
            let filterStatus = yield wopiClient.checkIpFilter(ctx, url);
            if (0 === filterStatus) {
              //todo false? (true because it passed checkIpFilter for wopi)
              //todo use directIfIn
              isInJwtToken = true;
            } else {
              errorDescription = 'access deny';
            }
          }
        } else if (!tenTokenEnableBrowser) {
          //todo token required
          if (decoded.url) {
            url = decoded.url;
            isInJwtToken = true;
          }
        } else {
          errorDescription = 'access deny';
        }
      } else {
        errorDescription = authRes.description || 'need token';
      }
      if (errorDescription) {
        ctx.logger.warn('Error downloadFile jwt: description = %s', errorDescription);
        res.sendStatus(403);
        return;
      }
      if (fromTemplate) {
        ctx.logger.debug('downloadFile from file template: %s', fromTemplate);
        let locale = constants.TEMPLATES_DEFAULT_LOCALE;
        let fileTemplatePath = pathModule.join(tenNewFileTemplate, locale, 'new.' + fromTemplate);
        res.sendFile(pathModule.resolve(fileTemplatePath));
      } else {
        if (utils.canIncludeOutboxAuthorization(ctx, url)) {
          let secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Outbox);
          authorization = utils.fillJwtForRequest(ctx, {url: url}, secret, false);
        }
        let urlParsed = urlModule.parse(url);
        let filterStatus = yield* utils.checkHostFilter(ctx, urlParsed.hostname);
        if (0 !== filterStatus) {
          ctx.logger.warn('Error downloadFile checkIpFilter error: url = %s', url);
          res.sendStatus(filterStatus);
          return;
        }

        if (req.get('Range')) {
          if (!headers) {
            headers = {};
          }
          headers['Range'] = req.get('Range');
        }

        const { response, stream } = yield utils.downloadUrlPromise(ctx, url, tenDownloadTimeout, tenDownloadMaxBytes, authorization, isInJwtToken, headers, true);
        //Set-Cookie resets browser session
        delete response.headers['set-cookie'];
        // Set the response headers to match the target response
        res.set(response.headers);

        // Use pipeline to pipe the response data to the client
        yield pipeline(stream, res);
      }

      if (clientStatsD) {
        clientStatsD.timing('coauth.downloadFile', new Date() - startDate);
      }
    }
    catch (err) {
      if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
        ctx.logger.debug('Error downloadFile: %s', err.stack);
      } else {
        ctx.logger.error('Error downloadFile: %s', err.stack);
        //catch errors because status may be sent while piping to response
        if (!res.headersSent) {
          try {
            if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
              res.sendStatus(408);
            } else if (err.code === 'EMSGSIZE') {
              res.sendStatus(413);
            } else if (err.response) {
              res.sendStatus(err.response.statusCode);
            } else {
              res.sendStatus(400);
            }
          } catch (err) {
            ctx.logger.error('Error downloadFile: %s', err.stack);
          }
        }
      }
    }
    finally {
      ctx.logger.info('End downloadFile');
    }
  });
};
exports.saveFromChanges = function(ctx, docId, statusInfo, optFormat, opt_userId, opt_userIndex, opt_userLcid, opt_queue, opt_initShardKey) {
  return co(function* () {
    try {
      var startDate = null;
      if(clientStatsD) {
        startDate = new Date();
      }
      ctx.logger.debug('Start saveFromChanges');
      //we do a select, because during the timeout the information could change
      var selectRes = yield taskResult.select(ctx, docId);
      var row = selectRes.length > 0 ? selectRes[0] : null;
      if (row && row.status == commonDefines.FileStatus.SaveVersion && row.status_info == statusInfo && row.callback) {
        if (null == optFormat) {
          optFormat = changeFormatByOrigin(ctx, row, constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML);
        }
        if (opt_initShardKey) {
          ctx.setShardKey(sqlBase.DocumentAdditional.prototype.getShardKey(row.additional));
          ctx.setWopiSrc(sqlBase.DocumentAdditional.prototype.getWopiSrc(row.additional));
        }
        var cmd = new commonDefines.InputCommand();
        cmd.setCommand('sfc');
        cmd.setDocId(docId);
        cmd.setOutputFormat(optFormat);
        cmd.setStatusInfoIn(statusInfo);
        cmd.setUserActionId(opt_userId);
        cmd.setUserActionIndex(opt_userIndex);
        cmd.appendJsonParams(getOpenedAtJSONParams(row));
        //todo lang and region are different
        cmd.setLCID(opt_userLcid);
        let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
        cmd.setWopiParams(wopiClient.parseWopiCallback(ctx, userAuthStr, row.callback));
        addPasswordToCmd(ctx, cmd, row && row.password, row && row.change_id);
        addOriginFormat(ctx, cmd, row);
        yield* addRandomKeyTaskCmd(ctx, cmd);
        var queueData = getSaveTask(ctx, cmd);
        queueData.setFromChanges(true);
        yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_NORMAL, opt_queue);
        if (docsCoServer.getIsShutdown()) {
          yield docsCoServer.editorStat.addShutdown(redisKeyShutdown, docId);
        }
        ctx.logger.debug('AddTask saveFromChanges');
      } else if(row && !row.callback) {
        ctx.logger.debug('saveFromChanges empty callback: %s', docId);
        yield docsCoServer.cleanDocumentOnExitNoChangesPromise(ctx, docId, opt_userId, opt_userIndex, false, true);
        //todo restore status
      } else {
        if (row) {
          ctx.logger.debug('saveFromChanges status mismatch: row: %d; %d; expected: %d', row.status, row.status_info, statusInfo);
        }
      }
      if (clientStatsD) {
        clientStatsD.timing('coauth.saveFromChanges', new Date() - startDate);
      }
    }
    catch (e) {
      ctx.logger.error('Error saveFromChanges: %s', e.stack);
    }
  });
};

async function processWopiSaveAs(ctx, cmd) {
  let res;
  const info = await docsCoServer.getCallback(ctx, cmd.getDocId(), cmd.getUserIndex());
  // info.wopiParams is null if it is not wopi
  if (info?.wopiParams) {
    const suggestedExt = `.${formatChecker.getStringFromFormat(cmd.getOutputFormat())}`;
    const suggestedTarget = cmd.getSaveAsPath();
    const storageFilePath = `${cmd.getDocId()}${cmd.getSaveKey()}/${cmd.getOutputPath()}`;
    const stream = await storage.createReadStream(ctx, storageFilePath);
    const { wopiSrc, access_token } = info.wopiParams.userAuth;
    res = await wopiClient.putRelativeFile(ctx, wopiSrc, access_token, null, stream.readStream, stream.contentLength, suggestedExt, suggestedTarget, false);
  }
  return {res: res, wopiParams: info?.wopiParams};
}
exports.receiveTask = function(data, ack) {
  return co(function* () {
    let ctx = new operationContext.Context();
    try {
      var task = new commonDefines.TaskQueueData(JSON.parse(data));
      if (task) {
        var cmd = task.getCmd();
        ctx.initFromTaskQueueData(task);
        yield ctx.initTenantCache();
        ctx.logger.info('receiveTask start: %s', data);
        var updateTask = yield getUpdateResponse(ctx, cmd);
        var updateRes = yield taskResult.update(ctx, updateTask);
        if (updateRes.affectedRows > 0) {
          var outputData = new OutputData(cmd.getCommand());
          var command = cmd.getCommand();
          var additionalOutput = {needUrlKey: null, needUrlMethod: null, needUrlType: null,
            needUrlIsCorrectPassword: undefined, creationDate: undefined, openedAt: undefined, row: undefined};
          if ('open' === command || 'reopen' === command) {
            yield getOutputData(ctx, cmd, outputData, cmd.getDocId(), null, additionalOutput);
            //wopi from TemplateSource
            if (additionalOutput.row) {
              let row = additionalOutput.row;
              let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
              let wopiParams = wopiClient.parseWopiCallback(ctx, userAuthStr, row.callback);
              if (wopiParams?.commonInfo?.fileInfo?.TemplateSource) {
                ctx.logger.debug('receiveTask: save document opened from TemplateSource');
                //todo
                //no need to wait to open file faster
                void docsCoServer.startForceSave(ctx, cmd.getDocId(), commonDefines.c_oAscForceSaveTypes.Timeout,
                  undefined, undefined, undefined, undefined,
                  undefined, undefined, undefined, row.baseurl,
                  undefined,undefined,undefined,undefined,
                  undefined,cmd.getExternalChangeInfo());
              }
            }
          } else if ('save' === command || 'savefromorigin' === command) {
            let status = yield getOutputData(ctx, cmd, outputData, cmd.getDocId() + cmd.getSaveKey(), null, additionalOutput);
            if (commonDefines.FileStatus.Ok === status && (cmd.getSaveAsPath() || cmd.getIsSaveAs())) {
              //todo in case of wopi no need to send url. send it to avoid stubs in sdk
              let saveAsRes = yield processWopiSaveAs(ctx, cmd);
              if (!saveAsRes.res && saveAsRes.wopiParams) {
                outputData.setStatus('err');
                outputData.setData(constants.CONVERT);
                additionalOutput.needUrlKey = null;
              }
            }
          } else if ('sfcm' === command) {
            yield commandSfcCallback(ctx, cmd, true);
          } else if ('sfc' === command) {
            yield commandSfcCallback(ctx, cmd, false);
          } else if ('sendmm' === command) {
            yield* commandSendMMCallback(ctx, cmd);
          } else if ('conv' === command) {
            //nothing
          }
          if (outputData.getStatus()) {
            ctx.logger.debug('receiveTask publish: %s', JSON.stringify(outputData));
            var output = new OutputDataWrap('documentOpen', outputData);
            yield docsCoServer.publish(ctx, {
                                          type: commonDefines.c_oPublishType.receiveTask, ctx: ctx, cmd: cmd, output: output,
                                          needUrlKey: additionalOutput.needUrlKey,
                                          needUrlMethod: additionalOutput.needUrlMethod,
                                          needUrlType: additionalOutput.needUrlType,
                                          needUrlIsCorrectPassword: additionalOutput.needUrlIsCorrectPassword,
                                          creationDate: additionalOutput.creationDate,
                                          openedAt: additionalOutput.openedAt
                                        });
          }
        }
      }
    } catch (err) {
      ctx.logger.error('receiveTask error: %s', err.stack);
    } finally {
      ctx.logger.info('receiveTask end');
      ack();
    }
  });
};

exports.cleanupCache = cleanupCache;
exports.cleanupCacheIf = cleanupCacheIf;
exports.cleanupErrToReload = cleanupErrToReload;
exports.getOpenedAt = getOpenedAt;
exports.commandSfctByCmd = commandSfctByCmd;
exports.commandOpenStartPromise = commandOpenStartPromise;
exports.commandPathUrls = commandPathUrls;
exports.commandSfcCallback = commandSfcCallback;
exports.OutputDataWrap = OutputDataWrap;
exports.OutputData = OutputData;
