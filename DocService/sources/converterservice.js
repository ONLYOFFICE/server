/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
'use strict';

const path = require('path');
const co = require('co');
const mime = require('mime');
const taskResult = require('./taskresult');
const utils = require('./../../Common/sources/utils');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const docsCoServer = require('./DocsCoServer');
const jwtService = require('./jwtService');
const canvasService = require('./canvasservice');
const wopiClient = require('./wopiClient');
const storage = require('./../../Common/sources/storage/storage-base');
const formatChecker = require('./../../Common/sources/formatchecker');
const statsDClient = require('./../../Common/sources/statsdclient');
const storageBase = require('./../../Common/sources/storage/storage-base');
const operationContext = require('./../../Common/sources/operationContext');
const sqlBase = require('./databaseConnectors/baseConnector');
const utilsDocService = require('./utilsDocService');
const {buildParamsDigest, buildBodyDigest, buildConvDocIdFromDigests} = require('./convertDocId');

const CONVERT_ASYNC_DELAY = 1000;

const clientStatsD = statsDClient.getClient();

function getDelimiter(filetype, outputtype, external) {
  const defaults = {
    tsv: commonDefines.c_oAscCsvDelimiter.Tab,
    scsv: commonDefines.c_oAscCsvDelimiter.Semicolon
  };
  return external || defaults[filetype] || defaults[outputtype] || commonDefines.c_oAscCsvDelimiter.Comma;
}

function* getConvertStatus(ctx, docId, encryptedUserPassword, selectRes, opt_checkPassword) {
  const status = new commonDefines.ConvertStatus(constants.NO_ERROR);
  if (selectRes.length > 0) {
    const row = selectRes[0];
    const password = opt_checkPassword && sqlBase.DocumentPassword.prototype.getCurPassword(ctx, row.password);
    switch (row.status) {
      case commonDefines.FileStatus.Ok:
        if (password) {
          let isCorrectPassword;
          if (encryptedUserPassword) {
            const decryptedPassword = yield utils.decryptPassword(ctx, password);
            const userPassword = yield utils.decryptPassword(ctx, encryptedUserPassword);
            isCorrectPassword = decryptedPassword === userPassword;
          }
          if (isCorrectPassword) {
            ctx.logger.debug('getConvertStatus password match');
            status.end = true;
          } else {
            ctx.logger.debug('getConvertStatus password mismatch');
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
    const lastOpenDate = row.last_open_date;
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
    const list = yield storage.listObjects(ctx, docId);
    const baseName = path.basename(fileTo, path.extname(fileTo));
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
// Resolve the async flag, downgrading to sync in a sharded cluster when no shard key routes the status poll.
function resolveAsync(ctx, req, params, label) {
  let async = typeof params.async === 'string' ? 'true' === params.async : !!params.async;
  if (async && !req.query[constants.SHARD_KEY_API_NAME] && !req.query[constants.SHARD_KEY_WOPI_NAME] && process.env.DEFAULT_SHARD_KEY) {
    ctx.logger.warn(
      '%s set async=false. Pass query string parameter "%s" to correctly process request in sharded cluster',
      label,
      constants.SHARD_KEY_API_NAME
    );
    async = false;
  }
  return async;
}
// Fill the signed result URL and extension on a finished convert status; a no-op while still running.
async function setConvertResultUrl(ctx, baseUrl, status, docId, fileTo, cmd) {
  if (status && status.end) {
    const fileToPath = await co(getConvertPath(ctx, docId, fileTo, cmd.getOutputFormat()));
    status.setExtName(path.extname(fileToPath));
    status.setUrl(await co(getConvertUrl(ctx, baseUrl, fileToPath, cmd.getTitle())));
  }
}
function* convertByCmd(ctx, cmd, async, opt_fileTo, opt_taskExist, opt_priority, opt_expiration, opt_queue, opt_checkPassword) {
  const docId = cmd.getDocId();
  let startDate = null;
  if (clientStatsD) {
    startDate = new Date();
  }
  ctx.logger.debug('Start convert request');

  let bCreate = false;
  if (!opt_taskExist) {
    const task = new taskResult.TaskResultData();
    task.tenant = ctx.tenant;
    task.key = docId;
    task.status = commonDefines.FileStatus.WaitQueue;
    task.statusInfo = Math.floor(Date.now() / 60000); //minutes

    const upsertRes = yield taskResult.upsert(ctx, task);
    bCreate = upsertRes.isInsert;
  }
  let selectRes;
  let status;
  if (!bCreate) {
    selectRes = yield taskResult.select(ctx, docId);
    status = yield* getConvertStatus(ctx, cmd.getDocId(), cmd.getPassword(), selectRes, opt_checkPassword);
  }
  if (bCreate || commonDefines.FileStatus.None === selectRes?.[0]?.status) {
    const queueData = new commonDefines.TaskQueueData();
    queueData.setCtx(ctx);
    queueData.setCmd(cmd);
    if (opt_fileTo) {
      queueData.setToFile(opt_fileTo);
    }
    queueData.setFromOrigin(true);
    const priority = null != opt_priority ? opt_priority : constants.QUEUE_PRIORITY_LOW;
    yield* docsCoServer.addTask(queueData, priority, opt_queue, opt_expiration);
    status = new commonDefines.ConvertStatus(constants.NO_ERROR);
  }
  //wait
  if (!async) {
    let waitTime = 0;
    while (true) {
      if (status.end || constants.NO_ERROR != status.err) {
        break;
      }
      yield utils.sleep(CONVERT_ASYNC_DELAY);
      selectRes = yield taskResult.select(ctx, docId);
      status = yield* getConvertStatus(ctx, cmd.getDocId(), cmd.getPassword(), selectRes, opt_checkPassword);
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

async function convertFromChanges(
  ctx,
  docId,
  baseUrl,
  forceSave,
  externalChangeInfo,
  opt_userdata,
  opt_formdata,
  opt_userConnectionId,
  opt_userConnectionDocId,
  opt_responseKey,
  opt_priority,
  opt_expiration,
  opt_queue,
  opt_redisKey,
  opt_initShardKey,
  opt_jsonParams
) {
  const cmd = new commonDefines.InputCommand();
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

  const commandSfctByCmdRes = await canvasService.commandSfctByCmd(ctx, cmd, opt_priority, opt_expiration, opt_queue, opt_initShardKey);
  if (!commandSfctByCmdRes) {
    return new commonDefines.ConvertStatus(constants.UNKNOWN);
  }
  let fileTo = constants.OUTPUT_NAME;
  const outputExt = formatChecker.getStringFromFormat(cmd.getOutputFormat());
  if (outputExt) {
    fileTo += '.' + outputExt;
  }
  const status = await co(convertByCmd(ctx, cmd, true, fileTo, undefined, opt_priority, opt_expiration, opt_queue));
  await setConvertResultUrl(ctx, baseUrl, status, docId, fileTo, cmd);
  return status;
}
function parseIntParam(val) {
  return typeof val === 'string' ? parseInt(val) : val;
}

// Shared parse+validate of conversion params; returns {valid:false, reason, value} or resolved basics.
function getConvertParamsBasics(params, opt_fallbackFileName) {
  let filetype = params.filetype || params.fileType || '';
  if (!filetype && opt_fallbackFileName) {
    filetype = path.extname(opt_fallbackFileName).substring(1);
  }
  const outputtype = params.outputtype || params.outputType || '';
  if (params.key && !constants.DOC_ID_REGEX.test(params.key)) {
    return {valid: false, reason: 'key', value: params.key};
  }
  if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
    return {valid: false, reason: 'filetype', value: filetype};
  }
  let outputFormat = formatChecker.getFormatFromString(outputtype);
  if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
    return {valid: false, reason: 'outputtype', value: outputtype};
  }
  let oformAsPdf;
  if (params.pdf) {
    if (true === params.pdf.pdfa && constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF === outputFormat) {
      outputFormat = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA;
    } else if (false === params.pdf.pdfa && constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA === outputFormat) {
      outputFormat = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
    }
    if (
      params.pdf.form &&
      (constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF === outputFormat || constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA === outputFormat)
    ) {
      outputFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM_PDF;
    } else if (false === params.pdf.form) {
      oformAsPdf = true;
    }
  }
  if (params.password && params.password.length > constants.PASSWORD_MAX_LENGTH) {
    return {valid: false, reason: 'password', value: params.password.length};
  }
  const outputExt = formatChecker.getStringFromFormat(outputFormat);
  return {valid: true, filetype, outputtype, outputFormat, oformAsPdf, outputExt};
}
// withAuthorization attaches our outbox credential to the source fetch, so the url itself must be signed and not merely accompanied by a valid token
function isSignedSource(authRes, url) {
  // the handler picks a source by truthiness, so a signed null, '' or 0 is not a source at all: it would leave the raw body as the script
  if (!authRes.isDecoded || 'string' !== typeof url || 0 === url.length) {
    return false;
  }
  return !!authRes.signedParams && authRes.signedParams.url === url;
}
// Apply shared InputCommand settings; returns outputExt (a multi-image thumbnail can switch it to zip).
async function fillConvertCommand(ctx, cmd, params, basics, opt_isDecoded) {
  cmd.setEmbeddedFonts(false);
  cmd.setFormat(basics.filetype);
  cmd.setOutputFormat(basics.outputFormat);
  cmd.setOformAsPdf(basics.oformAsPdf);
  let outputExt = basics.outputExt;
  cmd.setCodepage(commonDefines.c_oAscEncodingsMap[params.codePage] || commonDefines.c_oAscCodePageUtf8);
  cmd.setDelimiter(getDelimiter(basics.filetype, basics.outputtype, parseIntParam(params.delimiter)));
  if (undefined != params.delimiterChar) cmd.setDelimiterChar(params.delimiterChar);
  if (params.region) {
    cmd.setLCID(utilsDocService.localeToLCID(params.region));
  }
  const jsonParams = {};
  if (params.documentLayout) {
    jsonParams['documentLayout'] = params.documentLayout;
  }
  if (params.spreadsheetLayout) {
    jsonParams['spreadsheetLayout'] = params.spreadsheetLayout;
  }
  if (params.pdfLayout) {
    jsonParams['pdfLayout'] = params.pdfLayout;
  }
  if (params.watermark) {
    jsonParams['watermark'] = params.watermark;
  }
  if (Object.keys(jsonParams).length > 0) {
    cmd.appendJsonParams(jsonParams);
  }
  if (params.password) {
    const encryptedPassword = await utils.encryptPassword(ctx, params.password);
    cmd.setPassword(encryptedPassword);
  }
  if (opt_isDecoded) {
    cmd.setWithAuthorization(true);
  }
  let thumbnail = params.thumbnail;
  if (thumbnail) {
    if (typeof thumbnail === 'string') {
      thumbnail = JSON.parse(thumbnail);
    }
    const thumbnailData = new commonDefines.CThumbnailData(thumbnail);
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
  let documentRenderer = params.documentRenderer;
  if (documentRenderer) {
    if (typeof documentRenderer === 'string') {
      documentRenderer = JSON.parse(documentRenderer);
    }
    const textParamsData = new commonDefines.CTextParams();
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
  return outputExt;
}

// Validate params and build the conv InputCommand; docId comes from the caller-supplied buildDocId(basics).
async function prepareConvertCommand(ctx, params, options) {
  const basics = getConvertParamsBasics(params, options.fallbackFileName);
  if (!basics.valid) {
    return basics;
  }
  const docId = options.buildDocId(basics);
  const cmd = new commonDefines.InputCommand();
  cmd.setCommand('conv');
  cmd.setDocId(docId);
  if (undefined !== options.sourceUrl) {
    cmd.setUrl(options.sourceUrl);
  }
  const outputExt = await fillConvertCommand(ctx, cmd, params, basics, options.isDecoded);
  return {valid: true, cmd, docId, basics, outputExt, fileTo: constants.OUTPUT_NAME + '.' + outputExt};
}

async function convertRequest(req, res, isJson) {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    ctx.logger.info('convertRequest start');
    let params;
    const authRes = await docsCoServer.getRequestParams(ctx, req, constants.JWT_PURPOSE_CONVERTER);
    if (authRes.code === constants.NO_ERROR) {
      params = authRes.params;
    } else {
      ctx.logger.warn('convertRequest auth failed %j', authRes);
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(authRes.code), isJson);
      return;
    }
    ctx.setDocId(params.key);
    //todo use hash of params as id
    const prepared = await prepareConvertCommand(ctx, params, {
      isDecoded: isSignedSource(authRes, params.url),
      sourceUrl: params.url,
      buildDocId: basics => 'conv_' + params.key + '_' + basics.outputFormat
    });
    if (!prepared.valid) {
      if ('password' === prepared.reason) {
        ctx.logger.warn('convertRequest password too long actual = %s; max = %s', prepared.value, constants.PASSWORD_MAX_LENGTH);
      } else {
        ctx.logger.warn('convertRequest unexpected %s = %s', prepared.reason, prepared.value);
      }
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
      return;
    }
    const {cmd, docId, fileTo} = prepared;
    const async = resolveAsync(ctx, req, params, 'convertRequest');
    if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN !== cmd.getOutputFormat()) {
      const status = await co(convertByCmd(ctx, cmd, async, fileTo, undefined, undefined, undefined, undefined, true));
      await setConvertResultUrl(ctx, utils.getBaseUrlByRequest(ctx, req), status, docId, fileTo, cmd);
      if (status.end) {
        ctx.logger.debug('convertRequest: url = %s', status.url);
      }
      utils.fillResponse(req, res, status, isJson);
    } else {
      const addresses = utils.forwarded(req);
      ctx.logger.warn('Error convert unknown outputtype: query = %j from = %s', params, addresses);
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
    }
  } catch (e) {
    ctx.logger.error('convertRequest error: %s', e.stack);
    utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
  } finally {
    ctx.logger.info('convertRequest end');
  }
}
function convertRequestJson(req, res) {
  return convertRequest(req, res, true);
}
function convertRequestXml(req, res) {
  return convertRequest(req, res, false);
}

function builderRequest(req, res, opt_params, opt_isDecoded, opt_signedParams) {
  return co(function* () {
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('builderRequest start');
      let authRes;
      if (opt_params) {
        authRes = {code: constants.NO_ERROR, params: opt_params, isDecoded: !!opt_isDecoded, signedParams: opt_signedParams || {}};
      } else {
        authRes = yield docsCoServer.getRequestParams(ctx, req, constants.JWT_PURPOSE_DOCBUILDER);
      }
      const params = authRes.params;
      let docId = params.key;
      ctx.setDocId(docId);

      let error = authRes.code;
      let urls;
      let end = false;
      const needCreateId = !docId;
      const isInBody = req.body && Buffer.isBuffer(req.body) && req.body.length > 0;
      const multipartFile = req.file;
      const isInMultipartBody = !!(multipartFile && multipartFile.buffer);
      if (error === constants.NO_ERROR && (params.key || params.url || isInBody || isInMultipartBody)) {
        if (needCreateId) {
          const task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'bld_', 8);
          docId = task.key;
          ctx.setDocId(docId);
        }
        const cmd = new commonDefines.InputCommand();
        cmd.setCommand('builder');
        cmd.setBuilderParams({argument: params.argument});
        // a script in the body can never be signed, so a matching claim stands in for provenance there and keeps the network options such a build had before
        const claimedBodyScript =
          !params.url && (isInBody || isInMultipartBody) && jwtService.hasOperationClaim(authRes, constants.JWT_PURPOSE_DOCBUILDER);
        if (isSignedSource(authRes, params.url) || claimedBodyScript) {
          cmd.setWithAuthorization(true);
        }
        cmd.setDocId(docId);
        if (params.url) {
          cmd.setUrl(params.url);
          cmd.setFormat('docbuilder');
        } else if (isInBody) {
          yield storageBase.putObject(ctx, docId + '/script.docbuilder', req.body, req.body.length);
        } else if (isInMultipartBody) {
          yield storageBase.putObject(ctx, docId + '/script.docbuilder', multipartFile.buffer, multipartFile.buffer.length);
        }
        if (needCreateId) {
          const queueData = new commonDefines.TaskQueueData();
          queueData.setCtx(ctx);
          queueData.setCmd(cmd);
          yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);
        }
        const async = resolveAsync(ctx, req, params, 'builderRequest');
        const status = yield* convertByCmd(ctx, cmd, async, undefined, undefined, constants.QUEUE_PRIORITY_LOW);
        end = status.end;
        error = status.err;
        if (end) {
          urls = yield storageBase.getSignedUrls(ctx, utils.getBaseUrlByRequest(ctx, req), docId + '/output', commonDefines.c_oAscUrlTypes.Temporary);
        }
      } else if (error === constants.NO_ERROR) {
        error = constants.UNKNOWN;
      }
      ctx.logger.debug('End builderRequest request: urls = %j end = %s error = %s', urls, end, error);
      utils.fillResponseBuilder(res, docId, urls, end, error);
    } catch (e) {
      ctx.logger.error('Error builderRequest: %s', e.stack);
      utils.fillResponseBuilder(res, undefined, undefined, undefined, constants.UNKNOWN);
    } finally {
      ctx.logger.info('builderRequest end');
    }
  });
}
function convertTo(req, res) {
  return co(function* () {
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('convert-to start');
      let format = req.body['format'];
      if (req.params.format) {
        format = req.params.format;
      }
      //todo https://github.com/LibreOffice/core/blob/9d3366f5b392418dc83bc0adbe3d215cff4b3605/desktop/source/lib/init.cxx#L3478
      const password = req.body['Password'];
      if (password) {
        if (password.length > constants.PASSWORD_MAX_LENGTH) {
          ctx.logger.warn('convert-to Password too long actual = %s; max = %s', password.length, constants.PASSWORD_MAX_LENGTH);
          res.sendStatus(400);
          return;
        }
      }
      //by analogy with Password
      const passwordToOpen = req.body['PasswordToOpen'];
      if (passwordToOpen) {
        if (passwordToOpen.length > constants.PASSWORD_MAX_LENGTH) {
          ctx.logger.warn('convert-to PasswordToOpen too long actual = %s; max = %s', passwordToOpen.length, constants.PASSWORD_MAX_LENGTH);
          res.sendStatus(400);
          return;
        }
      }
      const pdfVer = req.body['PDFVer'];
      if (pdfVer && pdfVer.startsWith('PDF/A') && 'pdf' === format) {
        format = 'pdfa';
      }
      const fullSheetPreview = req.body['FullSheetPreview'];
      const lang = req.body['lang'];
      const outputFormat = formatChecker.getFormatFromString(format);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.warn('convert-to unexpected format = %s', format);
        res.sendStatus(400);
        return;
      }
      let docId, fileTo, status, originalname;
      if (req.files?.length > 0 && req.files[0].originalname && req.files[0].buffer) {
        const file = req.files[0];
        originalname = file.originalname;
        const filetype = path.extname(file.originalname).substring(1);
        if (filetype && !constants.EXTENTION_REGEX.test(filetype)) {
          ctx.logger.warn('convertRequest unexpected filetype = %s', filetype);
          res.sendStatus(400);
          return;
        }

        const task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'conv_', 8);
        docId = task.key;
        ctx.setDocId(docId);

        //todo stream
        const buffer = file.buffer;
        yield storageBase.putObject(ctx, docId + '/origin.' + filetype, buffer, buffer.length);

        const cmd = new commonDefines.InputCommand();
        cmd.setCommand('conv');
        cmd.setDocId(docId);
        cmd.setFormat(filetype);
        cmd.setOutputFormat(outputFormat);
        cmd.setCodepage(commonDefines.c_oAscCodePageUtf8);
        cmd.setDelimiter(getDelimiter(filetype, format));
        if (lang) {
          cmd.setLCID(utilsDocService.localeToLCID(lang));
        }
        if (fullSheetPreview) {
          cmd.appendJsonParams({
            spreadsheetLayout: {
              ignorePrintArea: true,
              fitToWidth: 1,
              fitToHeight: 1
            }
          });
        } else {
          cmd.appendJsonParams({
            spreadsheetLayout: {
              ignorePrintArea: true,
              fitToWidth: 0,
              fitToHeight: 0,
              scale: 100
            }
          });
        }
        if (password) {
          const encryptedPassword = yield utils.encryptPassword(ctx, password);
          cmd.setSavePassword(encryptedPassword);
        }
        if (passwordToOpen) {
          const encryptedPassword = yield utils.encryptPassword(ctx, passwordToOpen);
          cmd.setPassword(encryptedPassword);
        }

        fileTo = constants.OUTPUT_NAME;
        const outputExt = formatChecker.getStringFromFormat(outputFormat);
        if (outputExt) {
          fileTo += '.' + outputExt;
        }

        const queueData = new commonDefines.TaskQueueData();
        queueData.setCtx(ctx);
        queueData.setCmd(cmd);
        queueData.setToFile(fileTo);
        queueData.setFromOrigin(true);
        yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);

        const async = false;
        status = yield* convertByCmd(ctx, cmd, async, fileTo);
      }
      if (status && status.end && constants.NO_ERROR === status.err) {
        const filename = path.basename(originalname, path.extname(originalname)) + path.extname(fileTo);
        const streamObj = yield storage.createReadStream(ctx, `${docId}/${fileTo}`);
        res.setHeader('Content-Disposition', utils.getContentDisposition(filename, null, constants.CONTENT_DISPOSITION_INLINE));
        res.setHeader('Content-Length', streamObj.contentLength);
        res.setHeader('Content-Type', mime.getType(filename));
        yield utils.pipeHttpStreams(streamObj.readStream, res);
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
// Output-affecting params fingerprint for the content-addressed docId (hashed as paramsDigest).
function buildConvFromFileFingerprint(params, basics) {
  return JSON.stringify({
    filetype: basics.filetype,
    outputFormat: basics.outputFormat,
    oformAsPdf: !!basics.oformAsPdf,
    codePage: params.codePage ?? null,
    delimiter: params.delimiter ?? null,
    delimiterChar: params.delimiterChar ?? null,
    region: params.region ?? null,
    documentLayout: params.documentLayout ?? null,
    spreadsheetLayout: params.spreadsheetLayout ?? null,
    pdfLayout: params.pdfLayout ?? null,
    watermark: params.watermark ?? null,
    thumbnail: params.thumbnail ?? null,
    documentRenderer: params.documentRenderer ?? null,
    title: params.title ?? null,
    password: params.password ?? null,
    engine: commonDefines.buildVersion + '.' + commonDefines.buildNumber
  });
}
// Content-addressed from-file docId: a key replaces the file hash, else the file bytes hash in.
// The key path takes filetype from explicit params only, so a no-file poll reproduces the docId.
function buildConvFromFileDocId(params, basics, opt_bodyDigest) {
  const idFiletype = params.key ? params.filetype || params.fileType || '' : basics.filetype;
  const paramsDigest = buildParamsDigest(buildConvFromFileFingerprint(params, {...basics, filetype: idFiletype}));
  return params.key
    ? buildConvDocIdFromDigests(params.key, paramsDigest, undefined)
    : buildConvDocIdFromDigests(undefined, paramsDigest, opt_bodyDigest);
}
async function convertFromCommandBody(req, res, opt_params, opt_isDecoded) {
  const ctx = new operationContext.Context();
  // ready result streams the bytes (sync, async cache hit, completed poll); JSON only for not-ready (endConvert:false) and errors
  const isJson = true;
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    // params come only from the resolved params/token source; no unsigned scalar fallback
    // no start/end log here: the route wrapper frames the request
    const params = opt_params || {};
    if (params.key) {
      ctx.setDocId(params.key);
    }
    const file = req.file;
    const hasFile = !!(file && file.originalname && file.buffer);
    // polling: a second request without a file must carry the key to resolve the same docId
    if (!hasFile && !params.key) {
      ctx.logger.warn('convert-from-command-body missing both multipart file and key');
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
      return;
    }
    // hash the file only on the no-key path (the key path does not need the body hash); see buildConvFromFileDocId
    const bodyDigest = hasFile && !params.key ? buildBodyDigest(file.buffer) : undefined;
    const prepared = await prepareConvertCommand(ctx, params, {
      isDecoded: opt_isDecoded,
      fallbackFileName: hasFile ? file.originalname : undefined,
      buildDocId: basics => buildConvFromFileDocId(params, basics, bodyDigest)
    });
    if (!prepared.valid) {
      ctx.logger.warn('convert-from-command-body unexpected %s = %j', prepared.reason, prepared.value);
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
      return;
    }
    const {cmd, docId, basics, fileTo} = prepared;
    ctx.setDocId(docId);
    // link the caller key to the content-addressed docId so logs are searchable by either
    if (params.key) {
      ctx.logger.info('convert-from-command-body resolved key=%s docId=%s', params.key, docId);
    }

    let status;
    if (hasFile) {
      const async = resolveAsync(ctx, req, params, 'convert-from-command-body');
      await storageBase.putObject(ctx, `${docId}/origin.${basics.filetype}`, file.buffer, file.buffer.length);
      status = await co(convertByCmd(ctx, cmd, async, fileTo, undefined, undefined, undefined, undefined, true));
    } else {
      // polling by key: report task status, never enqueue
      const selectRes = await taskResult.select(ctx, docId);
      status = await co(getConvertStatus(ctx, docId, cmd.getPassword(), selectRes, true));
    }

    if (status && status.end && constants.NO_ERROR === status.err) {
      const fileToPath = await co(getConvertPath(ctx, docId, fileTo, cmd.getOutputFormat()));
      const sourceName = params.title || (file && file.originalname) || path.basename(fileToPath);
      const filename = path.basename(sourceName, path.extname(sourceName)) + path.extname(fileToPath);
      const streamObj = await storage.createReadStream(ctx, fileToPath);
      res.setHeader('Content-Disposition', utils.getContentDisposition(filename, null, constants.CONTENT_DISPOSITION_INLINE));
      res.setHeader('Content-Length', streamObj.contentLength);
      res.setHeader('Content-Type', mime.getType(filename));
      await utils.pipeHttpStreams(streamObj.readStream, res);
      return;
    }

    utils.fillResponse(req, res, status, isJson);
  } catch (err) {
    ctx.logger.error('convert-from-command-body error:%s', err.stack);
    if (!res.headersSent) {
      utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.UNKNOWN), isJson);
    }
  }
}
function convertAndEdit(ctx, wopiParams, filetypeFrom, filetypeTo) {
  return co(function* () {
    try {
      ctx.logger.info('convert-and-edit start');

      const task = yield* taskResult.addRandomKeyTask(ctx, undefined, 'conv_', 8);
      const docId = task.key;
      const outputFormat = formatChecker.getFormatFromString(filetypeTo);
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === outputFormat) {
        ctx.logger.debug('convert-and-edit unknown outputFormat %s', filetypeTo);
        return;
      }

      const cmd = new commonDefines.InputCommand();
      cmd.setCommand('conv');
      cmd.setDocId(docId);
      cmd.setUrl('dummy-url');
      cmd.setWopiParams(wopiParams);
      cmd.setFormat(filetypeFrom);
      cmd.setOutputFormat(outputFormat);

      let fileTo = constants.OUTPUT_NAME;
      const outputExt = formatChecker.getStringFromFormat(outputFormat);
      if (outputExt) {
        fileTo += '.' + outputExt;
      }

      const queueData = new commonDefines.TaskQueueData();
      queueData.setCtx(ctx);
      queueData.setCmd(cmd);
      queueData.setToFile(fileTo);
      yield* docsCoServer.addTask(queueData, constants.QUEUE_PRIORITY_LOW);

      const async = true;
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
  return co(function* () {
    const isJson = true;
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('convert-and-edit-handler start');

      let wopiSrc = req.query['wopisrc'];
      const access_token = req.query['access_token'];
      const targetext = req.query['targetext'];
      let docId = req.query['docid'];
      ctx.setDocId(docId);
      if (
        !(wopiSrc && access_token && access_token && targetext && docId) ||
        constants.AVS_OFFICESTUDIO_FILE_UNKNOWN === formatChecker.getFormatFromString(targetext)
      ) {
        ctx.logger.debug(
          'convert-and-edit-handler invalid params: WOPISrc=%s; hasAccessToken=%s; targetext=%s; docId=%s',
          wopiSrc,
          !!access_token,
          targetext,
          docId
        );
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.CONVERT_PARAMS), isJson);
        return;
      }
      // this token is always minted by getConverterHtml, so require it regardless of token.enable.browser
      const token = req.query['token'];
      // the derived key and the payload rule are bound by one policy
      const checkJwtRes = yield docsCoServer.checkJwt(ctx, token, constants.JWT_PURPOSE_WOPI_CONVERT);
      if (checkJwtRes.decoded) {
        docId = checkJwtRes.decoded.docId;
        // take the callback target from the signed token, never from the query
        wopiSrc = checkJwtRes.decoded.wopiSrc;
      } else {
        ctx.logger.debug('convert-and-edit-handler invalid token');
        utils.fillResponse(req, res, new commonDefines.ConvertStatus(constants.VKEY), isJson);
        return;
      }
      ctx.setDocId(docId);

      const selectRes = yield taskResult.select(ctx, docId);
      const status = yield* getConvertStatus(ctx, docId, undefined, selectRes);
      if (status.end && constants.NO_ERROR === status.err) {
        const fileTo = `${docId}/${constants.OUTPUT_NAME}.${targetext}`;

        const metadata = yield storage.headObject(ctx, fileTo);
        const streamFactory = () => storage.createReadStream(ctx, fileTo);
        const putRelativeRes = yield wopiClient.putRelativeFile(
          ctx,
          wopiSrc,
          access_token,
          null,
          streamFactory,
          metadata.ContentLength,
          `.${targetext}`,
          undefined,
          true
        );
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
exports.convertFromCommandBody = convertFromCommandBody;
exports.buildConvFromFileDocId = buildConvFromFileDocId;
exports.convertAndEdit = convertAndEdit;
exports.getConverterHtmlHandler = getConverterHtmlHandler;
exports.builder = builderRequest;
// test-only surface: production code reaches this through convertRequest and builderRequest
exports.isSignedSource = isSignedSource;
