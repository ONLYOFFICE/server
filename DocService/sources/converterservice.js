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

const path = require('path');
var config = require('config');
var co = require('co');
const mime = require('mime');
var taskResult = require('./taskresult');
var utils = require('./../../Common/sources/utils');
var constants = require('./../../Common/sources/constants');
var commonDefines = require('./../../Common/sources/commondefines');
var docsCoServer = require('./DocsCoServer');
var canvasService = require('./canvasservice');
var wopiClient = require('./wopiClient');
var storage = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var statsDClient = require('./../../Common/sources/statsdclient');
var storageBase = require('./../../Common/sources/storage-base');
var operationContext = require('./../../Common/sources/operationContext');
const sqlBase = require('./databaseConnectors/baseConnector');
const utilsDocService = require("./utilsDocService");

const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');

var CONVERT_ASYNC_DELAY = 1000;

var clientStatsD = statsDClient.getClient();

function* getConvertStatus(ctx, docId, encryptedUserPassword, selectRes, opt_checkPassword) {
  var status = new commonDefines.ConvertStatus(constants.NO_ERROR);
  if (selectRes.length > 0) {
    var row = selectRes[0];
    let password = opt_checkPassword && sqlBase.DocumentPassword.prototype.getCurPassword(ctx, row.password);
    switch (row.status) {
      case commonDefines.FileStatus.Ok:
        if (password) {
          let isCorrectPassword;
          if (encryptedUserPassword) {
            let decryptedPassword = yield utils.decryptPassword(ctx, password);
            let userPassword = yield utils.decryptPassword(ctx, encryptedUserPassword);
            isCorrectPassword = decryptedPassword === userPassword;
          }
          if (isCorrectPassword) {
            ctx.logger.debug("getConvertStatus password match");
            status.end = true;
          } else {
            ctx.logger.debug("getConvertStatus password mismatch");
            status.err = constants.CONVERT_PASSWORD;
          }
        } else {
          status.end = true;
        }
        break;
      case commonDefines.FileStatus.Err:
        status.err = row.status_info;
        break;
      case commonDefines.FileStatus.ErrToReload:
      case commonDefines.FileStatus.NeedPassword:
        status.err = row.status_info;
        yield canvasService.cleanupErrToReload(ctx, docId);
        break;
      case commonDefines.FileStatus.NeedParams:
      case commonDefines.FileStatus.SaveVersion:
      case commonDefines.FileStatus.UpdateVersion:
        status.err = constants.UNKNOWN;
        break;
    }
    var lastOpenDate = row.last_open_date;
    if (new Date().getTime() - lastOpenDate.getTime() > utils.getConvertionTimeout(ctx)) {
      status.err = constants.CONVERT_TIMEOUT;
    }
  } else {
    status.err = constants.UNKNOWN;
  }
  return status;
}
function* getConvertPath(ctx, docId, fileTo, formatTo) {
  if (constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML === formatTo || constants.AVS_OFFICESTUDIO_FILE_OTHER_ODF === formatTo) {
    let list = yield storage.listObjects(ctx, docId);
    let baseName = path.basename(fileTo, path.extname(fileTo));
    for (let i = 0; i < list.length; ++i) {
      if (path.basename(list[i], path.extname(list[i])) === baseName) {
        return list[i];
      }
    }
  }
  return docId + '/' + fileTo;
}
function* getConvertUrl(ctx, baseUrl, fileToPath, title) {
  if (title) {
    title = path.basename(title, path.extname(title)) + path.extname(fileToPath);
  }
  return yield storage.getSignedUrl(ctx, baseUrl, fileToPath, commonDefines.c_oAscUrlTypes.Temporary, title);
}
function* convertByCmd(ctx, cmd, async, opt_fileTo, opt_taskExist, opt_priority, opt_expiration, opt_queue, opt_checkPassword) {
  var docId = cmd.getDocId();
  var startDate = null;
  if (clientStatsD) {
    startDate = new Date();
  }
  ctx.logger.debug('Start convert request');

  let bCreate = false;
  if (!opt_taskExist) {
    let task = new taskResult.TaskResultData();
    task.tenant = ctx.tenant;
    task.key = docId;
    task.status = commonDefines.FileStatus.WaitQueue;
    task.statusInfo = constants.NO_ERROR;

    const upsertRes = yield taskResult.upsert(ctx, task);
    bCreate = upsertRes.isInsert;
  }
  var selectRes;
  var status;
  if (!bCreate) {
    selectRes = yield taskResult.select(ctx, docId);
    status = yield* getConvertStatus(ctx, cmd.getDocId() ,cmd.getPassword(), selectRes, opt_checkPassword);
  }
  if (bCreate || (commonDefines.FileStatus.None === selectRes?.[0]?.status)) {
    var queueData = new commonDefines.TaskQueueData();
    queueData.setCtx(ctx);
    queueData.setCmd(cmd);
    if (opt_fileTo) {
      queueData.setToFile(opt_fileTo);
    }
    queueData.setFromOrigin(true);
    var priority = null != opt_priority ? opt_priority : constants.QUEUE_PRIORITY_LOW;
    yield* docsCoServer.addTask(queueData, priority, opt_queue, opt_expiration);
    status = new commonDefines.ConvertStatus(constants.NO_ERROR);
  }
  //wait
  if (!async) {
    var waitTime = 0;
    while (true) {
      if (status.end || constants.NO_ERROR != status.err) {
        break;
      }
      yield utils.sleep(CONVERT_ASYNC_DELAY);
      selectRes = yield taskResult.select(ctx, docId);
      status = yield* getConvertStatus(ctx, cmd.getDocId() ,cmd.getPassword(), selectRes, opt_checkPassword);
      waitTime += CONVERT_ASYNC_DELAY;
      if (waitTime > utils.getConvertionTimeout(ctx)) {
        status.err = constants.CONVERT_TIMEOUT;
      }
    }
  }
  ctx.logger.debug('End convert request end %s status %s', status.end, status.err);
  if (clientStatsD) {
    clientStatsD.timing('coauth.convertservice', new Date() - startDate);
  }
  return status;
}

async function convertFromChanges(ctx, docId, baseUrl, forceSave, externalChangeInfo, opt_userdata, opt_formdata,
                                  opt_userConnectionId, opt_userConnectionDocId, opt_responseKey, opt_priority,
                                  opt_expiration, opt_queue, opt_redisKey, opt_initShardKey, opt_jsonParams) {
  var cmd = new commonDefines.InputCommand();
  cmd.setCommand('sfcm');
  cmd.setDocId(docId);
  cmd.setOutputFormat(constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML);
  cmd.setEmbeddedFonts(false);
  cmd.setCodepage(commonDefines.c_oAscCodePageUtf8);
  cmd.setDelimiter(commonDefines.c_oAscCsvDelimiter.Comma);
  cmd.setForceSave(forceSave);
  cmd.setExternalChangeInfo(externalChangeInfo);
  if (externalChangeInfo.lang) {
    //todo lang and region are different
    cmd.setLCID(utilsDocService.localeToLCID(externalChangeInfo.lang));
  }
  if (opt_userdata) {
    cmd.setUserData(opt_userdata);
  }
  if (opt_formdata) {
    //todo put file to storage
    cmd.setFormData(opt_formdata);
  }
  if (opt_userConnectionId) {
    cmd.setUserConnectionId(opt_userConnectionId);
  }
  if (opt_userConnectionDocId) {
    cmd.setUserConnectionDocId(opt_userConnectionDocId);
  }
  if (opt_responseKey) {
    cmd.setResponseKey(opt_responseKey);
  }
  if (opt_redisKey) {
    cmd.setRedisKey(opt_redisKey);
  }
  if (opt_jsonParams) {
    cmd.appendJsonParams(opt_jsonParams);
  }

  let commandSfctByCmdRes = await canvasService.commandSfctByCmd(ctx, cmd, opt_priority, opt_expiration, opt_queue, opt_initShardKey);
  if (!commandSfctByCmdRes) {
    return new commonDefines.ConvertStatus(constants.UNKNOWN);
  }
  var fileTo = constants.OUTPUT_NAME;
  let outputExt = formatChecker.getStringFromFormat(cmd.getOutputFormat());
  if (outputExt) {
    fileTo += '.' + outputExt;
  }
  let status = await co(convertByCmd(ctx, cmd, true, fileTo, undefined, opt_priority, opt_expiration, opt_queue));
  if (status.end) {
    let fileToPath = await co(getConvertPath(ctx, docId, fileTo, cmd.getOutputFormat()));
    status.setExtName(path.extname(fileToPath));
    status.setUrl(await co(getConvertUrl(ctx, baseUrl, fileToPath, cmd.getTitle())));
  }
  return status;
}
function parseIntParam(val){
  return (typeof val === 'string') ? parseInt(val) : val;
}

function convertRequest(req, res, isJson) {
  return co(function* () {
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('convertRequest start');
      let params;
      let authRes = yield docsCoServer.getRequestParams(ctx, req);
      if(authRes.code === constants.NO_ERROR){
        params = authRes.params;
      } else {
        ctx.logger.warn('convertRequest auth failed %j', authRes);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(authRes.code), isJson);
        return;
      }
      let filetype = params.filetype || params.fileType || '';
      let outputtype = params.outputtype || params.outputType || '';
      ctx.setDocId(params.key);

      if (params.key && !constants.DOC_ID_REGEX.test(params.key)) {
        ctx.logger.warn('convertRequest unexpected key = %s', params.key);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
        return;
      }
      if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
        ctx.logger.warn('convertRequest unexpected filetype = %s', filetype);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
        return;
      }
      let outputFormat = formatChecker.getFormatFromString(outputtype);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.warn('convertRequest unexpected outputtype = %s', outputtype);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
        return;
      }
      if (params.pdf) {
        if (true === params.pdf.pdfa && constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF === outputFormat) {
          outputFormat = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA;
        } else if (false === params.pdf.pdfa && constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA === outputFormat) {
          outputFormat = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
        }
        if (params.pdf.form && (constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF === outputFormat ||
          constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA === outputFormat)) {
          outputFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM_PDF;
        }
      }
      //todo use hash of params as id
      let docId = 'conv_' + params.key + '_' + outputFormat;
      var cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setUrl(params.url);
      cmd.setEmbeddedFonts(false);//params.embeddedfonts'];
      cmd.setFormat(filetype);
      cmd.setDocId(docId);
      cmd.setOutputFormat(outputFormat);
      let outputExt = formatChecker.getStringFromFormat(cmd.getOutputFormat());

      cmd.setCodepage(commonDefines.c_oAscEncodingsMap[params.codePage] || commonDefines.c_oAscCodePageUtf8);
      cmd.setDelimiter(parseIntParam(params.delimiter) || commonDefines.c_oAscCsvDelimiter.Comma);
      if(undefined != params.delimiterChar)
        cmd.setDelimiterChar(params.delimiterChar);
      if (params.region) {
        cmd.setLCID(utilsDocService.localeToLCID(params.region));
      }
      let jsonParams = {};
      if (params.documentLayout) {
        jsonParams['documentLayout'] = params.documentLayout;
      }
      if (params.spreadsheetLayout) {
        jsonParams['spreadsheetLayout'] = params.spreadsheetLayout;
      }
      if (params.watermark) {
        jsonParams['watermark'] = params.watermark;
      }
      if (Object.keys(jsonParams).length > 0) {
        cmd.appendJsonParams(jsonParams);
      }
      if (params.password) {
        if (params.password.length > constants.PASSWORD_MAX_LENGTH) {
          ctx.logger.warn('convertRequest password too long actual = %s; max = %s', params.password.length, constants.PASSWORD_MAX_LENGTH);
          utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
          return;
        }
        let encryptedPassword = yield utils.encryptPassword(ctx, params.password);
        cmd.setPassword(encryptedPassword);
      }
      if (authRes.isDecoded) {
        cmd.setWithAuthorization(true);
      }
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
        if (false === thumbnailData.getFirst() && 0 !== (constants.AVS_OFFICESTUDIO_FILE_IMAGE & cmd.getOutputFormat())) {
          outputExt = 'zip';
        }
      }
      var documentRenderer = params.documentRenderer;
      if (documentRenderer) {
        if (typeof documentRenderer === 'string') {
          documentRenderer = JSON.parse(documentRenderer);
        }
        var textParamsData = new commonDefines.CTextParams();
        switch (documentRenderer.textAssociation) {
          case 'plainParagraph':
            textParamsData.setAssociation(3);
            break;
          case 'plainLine':
            textParamsData.setAssociation(2);
            break;
          case 'blockLine':
            textParamsData.setAssociation(1);
            break;
          case 'blockChar':
          default:
            textParamsData.setAssociation(0);
            break;
        }
        cmd.setTextParams(textParamsData);
      }
      if (params.title) {
        cmd.setTitle(path.basename(params.title, path.extname(params.title)) + '.' + outputExt);
      }
      var async = (typeof params.async === 'string') ? 'true' == params.async : params.async;
      if (async && !req.query[constants.SHARD_KEY_API_NAME] && !req.query[constants.SHARD_KEY_WOPI_NAME] && process.env.DEFAULT_SHARD_KEY) {
        ctx.logger.warn('convertRequest set async=false. Pass query string parameter "%s" to correctly process request in sharded cluster', constants.SHARD_KEY_API_NAME);
        async = false;
      }
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== cmd.getOutputFormat()) {
        let fileTo = constants.OUTPUT_NAME + '.' + outputExt;
        var status = yield* convertByCmd(ctx, cmd, async, fileTo, undefined, undefined, undefined, undefined, true);
        if (status.end) {
          let fileToPath = yield* getConvertPath(ctx, docId, fileTo, cmd.getOutputFormat());
          status.setExtName(path.extname(fileToPath));
          status.setUrl(yield* getConvertUrl(ctx, utils.getBaseUrlByRequest(ctx, req), fileToPath, cmd.getTitle()));
          ctx.logger.debug('convertRequest: url = %s', status.url);
        }
        utils.fillResponse(req, res, status, isJson);
      } else {
        var addresses = utils.forwarded(req);
        ctx.logger.warn('Error convert unknown outputtype: query = %j from = %s', params, addresses);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
      }
    } catch (e) {
      ctx.logger.error('convertRequest error: %s', e.stack);
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
    } finally {
      ctx.logger.info('convertRequest end');
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
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('builderRequest start');
      let authRes = yield docsCoServer.getRequestParams(ctx, req);
      let params = authRes.params;
      let docId = params.key;
      ctx.setDocId(docId);

      let error = authRes.code;
      let urls;
      let end = false;
      let needCreateId = !docId;
      let isInBody = req.body && Buffer.isBuffer(req.body) && req.body.length > 0;
      if (error === constants.NO_ERROR && (params.key || params.url || isInBody)) {
        if (needCreateId) {
          let task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'bld_', 8);
          docId = task.key;
          ctx.setDocId(docId);
        }
        let cmd = new commonDefines.InputCommand();
        cmd.setCommand('builder');
        cmd.setBuilderParams({argument: params.argument});
        if (authRes.isDecoded) {
          cmd.setWithAuthorization(true);
        }
        cmd.setDocId(docId);
        if (params.url) {
          cmd.setUrl(params.url);
          cmd.setFormat('docbuilder');
        } else if (isInBody) {
          yield storageBase.putObject(ctx, docId + '/script.docbuilder', req.body, req.body.length);
        }
        if (needCreateId) {
          let queueData = new commonDefines.TaskQueueData();
          queueData.setCtx(ctx);
          queueData.setCmd(cmd);
          yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
        }
        let async = (typeof params.async === 'string') ? 'true' === params.async : params.async;
        if (async && !req.query[constants.SHARD_KEY_API_NAME] && !req.query[constants.SHARD_KEY_WOPI_NAME] && process.env.DEFAULT_SHARD_KEY) {
          ctx.logger.warn('builderRequest set async=false. Pass query string parameter "%s" to correctly process request in sharded cluster', constants.SHARD_KEY_API_NAME);
          async = false;
        }
        let status = yield* convertByCmd(ctx, cmd, async, undefined, undefined, constants.QUEUE_PRIORITY_LOW);
        end = status.end;
        error = status.err;
        if (end) {
          urls = yield storageBase.getSignedUrls(ctx, utils.getBaseUrlByRequest(ctx, req), docId + '/output',
                                                 commonDefines.c_oAscUrlTypes.Temporary);
        }
      } else if (error === constants.NO_ERROR) {
        error = constants.UNKNOWN;
      }
      ctx.logger.debug('End builderRequest request: urls = %j end = %s error = %s', urls, end, error);
      utils.fillResponseBuilder(res, docId, urls, end, error);
    }
    catch (e) {
      ctx.logger.error('Error builderRequest: %s', e.stack);
      utils.fillResponseBuilder(res, undefined, undefined, undefined, constants.UNKNOWN);
    } finally {
      ctx.logger.info('builderRequest end');
    }
  });
}
function convertTo(req, res) {
  return co(function*() {
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('convert-to start');
      let format = req.body['format'];
      if (req.params.format) {
        format = req.params.format;
      }
      //todo https://github.com/LibreOffice/core/blob/9d3366f5b392418dc83bc0adbe3d215cff4b3605/desktop/source/lib/init.cxx#L3478
      let password = req.body['Password'];
      if (password) {
        if (password.length > constants.PASSWORD_MAX_LENGTH) {
          ctx.logger.warn('convert-to Password too long actual = %s; max = %s', password.length, constants.PASSWORD_MAX_LENGTH);
          res.sendStatus(400);
          return;
        }
      }
      //by analogy with Password
      let passwordToOpen = req.body['PasswordToOpen'];
      if (passwordToOpen) {
        if (passwordToOpen.length > constants.PASSWORD_MAX_LENGTH) {
          ctx.logger.warn('convert-to PasswordToOpen too long actual = %s; max = %s', passwordToOpen.length, constants.PASSWORD_MAX_LENGTH);
          res.sendStatus(400);
          return;
        }
      }
      let pdfVer = req.body['PDFVer'];
      if (pdfVer && pdfVer.startsWith("PDF/A") && 'pdf' === format) {
        format = 'pdfa';
      }
      let fullSheetPreview = req.body['FullSheetPreview'];
      let lang = req.body['lang'];
      let outputFormat = formatChecker.getFormatFromString(format);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.warn('convert-to unexpected format = %s', format);
        res.sendStatus(400);
        return;
      }
      let docId, fileTo, status, originalname;
      if (req.files?.length > 0 && req.files[0].originalname && req.files[0].buffer) {
        const file = req.files[0];
        originalname = file.originalname;
        let filetype = path.extname(file.originalname).substring(1);
        if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
          ctx.logger.warn('convertRequest unexpected filetype = %s', filetype);
          res.sendStatus(400);
          return;
        }

        let task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'conv_', 8);
        docId = task.key;
        ctx.setDocId(docId);

        //todo stream
        let buffer = file.buffer;
        yield storageBase.putObject(ctx, docId + '/origin.' + filetype, buffer, buffer.length);

        let cmd = new commonDefines.InputCommand();
        cmd.setCommand('conv');
        cmd.setDocId(docId);
        cmd.setFormat(filetype);
        cmd.setOutputFormat(outputFormat);
        cmd.setCodepage(commonDefines.c_oAscCodePageUtf8);
        cmd.setDelimiter(commonDefines.c_oAscCsvDelimiter.Comma);
        if (lang) {
          cmd.setLCID(utilsDocService.localeToLCID(lang));
        }
        if (fullSheetPreview) {
          cmd.appendJsonParams({'spreadsheetLayout': {
            "ignorePrintArea": true,
            "fitToWidth": 1,
            "fitToHeight": 1
          }});
        } else {
          cmd.appendJsonParams({'spreadsheetLayout': {
            "ignorePrintArea": true,
            "fitToWidth": 0,
            "fitToHeight": 0,
            "scale": 100
          }});
        }
        if (password) {
          let encryptedPassword = yield utils.encryptPassword(ctx, password);
          cmd.setSavePassword(encryptedPassword);
        }
        if (passwordToOpen) {
          let encryptedPassword = yield utils.encryptPassword(ctx, passwordToOpen);
          cmd.setPassword(encryptedPassword);
        }

        fileTo = constants.OUTPUT_NAME;
        let outputExt = formatChecker.getStringFromFormat(outputFormat);
        if (outputExt) {
          fileTo += '.' + outputExt;
        }

        let queueData = new commonDefines.TaskQueueData();
        queueData.setCtx(ctx);
        queueData.setCmd(cmd);
        queueData.setToFile(fileTo);
        queueData.setFromOrigin(true);
        yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);

        let async = false;
        status = yield* convertByCmd(ctx, cmd, async, fileTo);
      }
      if (status && status.end && constants.NO_ERROR === status.err) {
        let filename = path.basename(originalname, path.extname(originalname)) + path.extname(fileTo);
        let streamObj = yield storage.createReadStream(ctx, `${docId}/${fileTo}`);
        res.setHeader('Content-Disposition', utils.getContentDisposition(filename, null, constants.CONTENT_DISPOSITION_INLINE));
        res.setHeader('Content-Length', streamObj.contentLength);
        res.setHeader('Content-Type', mime.getType(filename));
        yield utils.pipeStreams(streamObj.readStream, res, true);
      } else {
        ctx.logger.error('convert-to error status:%j', status);
        res.sendStatus(400);
      }
    } catch (err) {
      ctx.logger.error('convert-to error:%s', err.stack);
      res.sendStatus(400);
    } finally {
      ctx.logger.info('convert-to end');
    }
  });
}
function convertAndEdit(ctx, wopiParams, filetypeFrom, filetypeTo) {
  return co(function*() {
    try {
      ctx.logger.info('convert-and-edit start');

      let task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'conv_', 8);
      let docId = task.key;
      let outputFormat = formatChecker.getFormatFromString(filetypeTo);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.debug('convert-and-edit unknown outputFormat %s', filetypeTo);
        return;
      }

      let cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setDocId(docId);
      cmd.setUrl('dummy-url');
      cmd.setWopiParams(wopiParams);
      cmd.setFormat(filetypeFrom);
      cmd.setOutputFormat(outputFormat);

      let fileTo = constants.OUTPUT_NAME;
      let outputExt = formatChecker.getStringFromFormat(outputFormat);
      if (outputExt) {
        fileTo += '.' + outputExt;
      }

      let queueData = new commonDefines.TaskQueueData();
      queueData.setCtx(ctx);
      queueData.setCmd(cmd);
      queueData.setToFile(fileTo);
      yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);

      let async = true;
      yield* convertByCmd(ctx, cmd, async, fileTo);
      return docId;
    } catch (err) {
      ctx.logger.error('convert-and-edit error:%s', err.stack);
    } finally {
      ctx.logger.info('convert-and-edit end');
    }
  });
}
function getConverterHtmlHandler(req, res) {
  return co(function*() {
    let isJson = true;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('convert-and-edit-handler start');
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

      let wopiSrc = req.query['wopisrc'];
      let access_token = req.query['access_token'];
      let targetext = req.query['targetext'];
      let docId = req.query['docid'];
      ctx.setDocId(docId);
      if (!(wopiSrc && access_token && access_token && targetext && docId) ||
        constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === formatChecker.getFormatFromString(targetext)) {
        ctx.logger.debug('convert-and-edit-handler invalid params: WOPISrc=%s; access_token=%s; targetext=%s; docId=%s', wopiSrc, access_token, targetext, docId);
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
        return;
      }
      let token = req.query['token'];
      if (tenTokenEnableBrowser) {
        let checkJwtRes = yield docsCoServer.checkJwt(ctx, token, commonDefines.c_oAscSecretType.Browser);
        if (checkJwtRes.decoded) {
          docId = checkJwtRes.decoded.docId;
        } else {
          ctx.logger.debug('convert-and-edit-handler invalid token %j', token);
          utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.VKEY), isJson);
          return;
        }
      }
      ctx.setDocId(docId);

      let selectRes = yield taskResult.select(ctx, docId);
      let status = yield* getConvertStatus(ctx, docId, undefined, selectRes);
      if (status.end && constants.NO_ERROR === status.err) {
        let fileTo = `${docId}/${constants.OUTPUT_NAME}.${targetext}`;

        let metadata = yield storage.headObject(ctx, fileTo);
        let streamObj = yield storage.createReadStream(ctx, fileTo);
        let putRelativeRes = yield wopiClient.putRelativeFile(ctx, wopiSrc, access_token, null, streamObj.readStream, metadata.ContentLength, `.${targetext}`, undefined, true);
        if (putRelativeRes) {
          status.setUrl(putRelativeRes.HostEditUrl);
          status.setExtName('.' + targetext);
        } else {
          status.err = constants.UNKNOWN;
        }
      }
      utils.fillResponse(req, res, status, isJson);
    } catch (err) {
      ctx.logger.error('convert-and-edit-handler error:%s', err.stack);
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
    } finally {
      ctx.logger.info('convert-and-edit-handler end');
    }
  });
}
exports.convertFromChanges = convertFromChanges;
exports.convertJson = convertRequestJson;
exports.convertXml = convertRequestXml;
exports.convertTo = convertTo;
exports.convertAndEdit = convertAndEdit;
exports.getConverterHtmlHandler = getConverterHtmlHandler;
exports.builder = builderRequest;
