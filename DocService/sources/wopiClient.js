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
const { pipeline } = require('node:stream/promises');
const crypto = require('crypto');
let util = require('util');
const {URL} = require('url');
const co = require('co');
const jwt = require('jsonwebtoken');
const config = require('config');
const { createReadStream } = require('fs');
const { stat, lstat, readdir } = require('fs/promises');
const utf7 = require('utf7');
const mimeDB = require('mime-db');
const xmlbuilder2 = require('xmlbuilder2');
const logger = require('./../../Common/sources/logger');
const utils = require('./../../Common/sources/utils');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const formatChecker = require('./../../Common/sources/formatchecker');
const operationContext = require('./../../Common/sources/operationContext');
const tenantManager = require('./../../Common/sources/tenantManager');
const sqlBase = require('./databaseConnectors/baseConnector');
const taskResult = require('./taskresult');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const mime = require('mime');

const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgCallbackRequestTimeout = config.get('services.CoAuthoring.server.callbackRequestTimeout');
const cfgNewFileTemplate = config.get('services.CoAuthoring.server.newFileTemplate');
const cfgDownloadTimeout = config.get('FileConverter.converter.downloadTimeout');
const cfgMaxDownloadBytes = config.get('FileConverter.converter.maxDownloadBytes');
const cfgWopiFileInfoBlockList = config.get('wopi.fileInfoBlockList');
const cfgWopiWopiZone = config.get('wopi.wopiZone');
const cfgWopiPdfView = config.get('wopi.pdfView');
const cfgWopiPdfEdit = config.get('wopi.pdfEdit');
const cfgWopiWordView = config.get('wopi.wordView');
const cfgWopiWordEdit = config.get('wopi.wordEdit');
const cfgWopiCellView = config.get('wopi.cellView');
const cfgWopiCellEdit = config.get('wopi.cellEdit');
const cfgWopiSlideView = config.get('wopi.slideView');
const cfgWopiSlideEdit = config.get('wopi.slideEdit');
const cfgWopiForms = config.get('wopi.forms');
const cfgWopiFavIconUrlWord = config.get('wopi.favIconUrlWord');
const cfgWopiFavIconUrlCell = config.get('wopi.favIconUrlCell');
const cfgWopiFavIconUrlSlide = config.get('wopi.favIconUrlSlide');
const cfgWopiFavIconUrlPdf = config.get('wopi.favIconUrlPdf');
const cfgWopiPublicKey = config.get('wopi.publicKey');
const cfgWopiModulus = config.get('wopi.modulus');
const cfgWopiExponent = config.get('wopi.exponent');
const cfgWopiPrivateKey = config.get('wopi.privateKey');
const cfgWopiPublicKeyOld = config.get('wopi.publicKeyOld');
const cfgWopiModulusOld = config.get('wopi.modulusOld');
const cfgWopiExponentOld = config.get('wopi.exponentOld');
const cfgWopiPrivateKeyOld = config.get('wopi.privateKeyOld');
const cfgWopiHost = config.get('wopi.host');
const cfgWopiDummySampleFilePath = config.get('wopi.dummy.sampleFilePath');

let cryptoSign = util.promisify(crypto.sign);

let templatesFolderLocalesCache = null;
let templatesFolderExtsCache = null;
const templateFilesSizeCache = {};
let shutdownFlag = false;

let mimeTypesByExt = (function() {
  let mimeTypesByExt = {};
  for (let mimeType in mimeDB) {
    if (mimeDB.hasOwnProperty(mimeType)) {
      let val = mimeDB[mimeType];
      if (val.extensions) {
        val.extensions.forEach((value) => {
          if (!mimeTypesByExt[value]) {
            mimeTypesByExt[value] = [];
          }
          mimeTypesByExt[value].push(mimeType);
        })
      }
    }
  }
  return mimeTypesByExt;
})();

async function getTemplatesFolderExts(ctx){
  //find available template files
  if (templatesFolderExtsCache === null) {
    const tenNewFileTemplate = ctx.getCfg('services.CoAuthoring.server.newFileTemplate', cfgNewFileTemplate);
    const dirContent = await readdir(`${tenNewFileTemplate}/${constants.TEMPLATES_DEFAULT_LOCALE}/`, { withFileTypes: true });
    templatesFolderExtsCache = dirContent
      .filter(dirObject => dirObject.isFile())
      .reduce((result, item, index, array) => {
        let ext = path.extname(item.name).substring(1);
        result[ext] = ext;
        return result;
      }, {});
  }
  return templatesFolderExtsCache;
}

function discovery(req, res) {
  return co(function*() {
    const xml = xmlbuilder2.create({version: '1.0', encoding: 'utf-8'});
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('wopiDiscovery start');
      const tenWopiWopiZone = ctx.getCfg('wopi.wopiZone', cfgWopiWopiZone);
      const tenWopiPdfView = ctx.getCfg('wopi.pdfView', cfgWopiPdfView);
      const tenWopiPdfEdit = ctx.getCfg('wopi.pdfEdit', cfgWopiPdfEdit);
      const tenWopiWordView = ctx.getCfg('wopi.wordView', cfgWopiWordView);
      const tenWopiWordEdit = ctx.getCfg('wopi.wordEdit', cfgWopiWordEdit);
      const tenWopiCellView = ctx.getCfg('wopi.cellView', cfgWopiCellView);
      const tenWopiCellEdit = ctx.getCfg('wopi.cellEdit', cfgWopiCellEdit);
      const tenWopiSlideView = ctx.getCfg('wopi.slideView', cfgWopiSlideView);
      const tenWopiSlideEdit = ctx.getCfg('wopi.slideEdit', cfgWopiSlideEdit);
      const tenWopiForms = ctx.getCfg('wopi.forms', cfgWopiForms);
      const tenWopiFavIconUrlWord = ctx.getCfg('wopi.favIconUrlWord', cfgWopiFavIconUrlWord);
      const tenWopiFavIconUrlCell = ctx.getCfg('wopi.favIconUrlCell', cfgWopiFavIconUrlCell);
      const tenWopiFavIconUrlSlide = ctx.getCfg('wopi.favIconUrlSlide', cfgWopiFavIconUrlSlide);
      const tenWopiFavIconUrlPdf = ctx.getCfg('wopi.favIconUrlSlide', cfgWopiFavIconUrlPdf);
      const tenWopiPublicKey = ctx.getCfg('wopi.publicKey', cfgWopiPublicKey);
      const tenWopiModulus = ctx.getCfg('wopi.modulus', cfgWopiModulus);
      const tenWopiExponent = ctx.getCfg('wopi.exponent', cfgWopiExponent);
      const tenWopiPublicKeyOld = ctx.getCfg('wopi.publicKeyOld', cfgWopiPublicKeyOld);
      const tenWopiModulusOld = ctx.getCfg('wopi.modulusOld', cfgWopiModulusOld);
      const tenWopiExponentOld = ctx.getCfg('wopi.exponentOld', cfgWopiExponentOld);
      const tenWopiHost = ctx.getCfg('wopi.host', cfgWopiHost);

      let baseUrl = tenWopiHost || utils.getBaseUrlByRequest(ctx, req);
      let names = ['Word','Excel','PowerPoint','Pdf'];
      let favIconUrls = [tenWopiFavIconUrlWord, tenWopiFavIconUrlCell, tenWopiFavIconUrlSlide, tenWopiFavIconUrlPdf];
      let exts = [
        {targetext: 'docx', view: tenWopiWordView, edit: tenWopiWordEdit},
        {targetext: 'xlsx', view: tenWopiCellView, edit: tenWopiCellEdit},
        {targetext: 'pptx', view: tenWopiSlideView, edit: tenWopiSlideEdit},
        {targetext: null, view: tenWopiPdfView, edit: tenWopiPdfEdit}
      ];
      let documentTypes = [`word`, `cell`, `slide`, `pdf`];

      let templatesFolderExtsCache = yield getTemplatesFolderExts(ctx);
      let formsExts = tenWopiForms.reduce((result, item, index, array) => {
        result[item] = item;
        return result;
      }, {});

      let templateStart = `${baseUrl}/hosting/wopi`;
      let templateEnd = `&lt;rs=DC_LLCC&amp;&gt;&lt;dchat=DISABLE_CHAT&amp;&gt;&lt;embed=EMBEDDED&amp;&gt;`;
      templateEnd += `&lt;fs=FULLSCREEN&amp;&gt;&lt;hid=HOST_SESSION_ID&amp;&gt;&lt;rec=RECORDING&amp;&gt;`;
      templateEnd += `&lt;sc=SESSION_CONTEXT&amp;&gt;&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;`;
      templateEnd += `&lt;wopisrc=WOPI_SOURCE&amp;&gt;&amp;`;
      let xmlZone = xml.ele('wopi-discovery').ele('net-zone', { name: tenWopiWopiZone });
      //start section for MS WOPI connectors
      for(let i = 0; i < names.length; ++i) {
        let name = names[i];
        let favIconUrl = favIconUrls[i];
        if (!(favIconUrl.startsWith('http://') || favIconUrl.startsWith('https://'))) {
          favIconUrl = baseUrl + favIconUrl;
        }
        let ext = exts[i];
        let urlTemplateView = `${templateStart}/${documentTypes[i]}/view?${templateEnd}`;
        let urlTemplateEmbedView = `${templateStart}/${documentTypes[i]}/view?embed=1&amp;${templateEnd}`;
        let urlTemplateMobileView = `${templateStart}/${documentTypes[i]}/view?mobile=1&amp;${templateEnd}`;
        let urlTemplateEdit = `${templateStart}/${documentTypes[i]}/edit?${templateEnd}`;
        let urlTemplateMobileEdit = `${templateStart}/${documentTypes[i]}/edit?mobile=1&amp;${templateEnd}`;
        let urlTemplateFormSubmit = `${templateStart}/${documentTypes[i]}/edit?formsubmit=1&amp;${templateEnd}`;
        let xmlApp = xmlZone.ele('app', {name: name, favIconUrl: favIconUrl});
        for (let j = 0; j < ext.view.length; ++j) {
          xmlApp.ele('action', {name: 'view', ext: ext.view[j], default: 'true', urlsrc: urlTemplateView}).up();
          xmlApp.ele('action', {name: 'embedview', ext: ext.view[j], urlsrc: urlTemplateEmbedView}).up();
          xmlApp.ele('action', {name: 'mobileView', ext: ext.view[j], urlsrc: urlTemplateMobileView}).up();
          if (ext.targetext) {
            let urlConvert = `${templateStart}/convert-and-edit/${ext.view[j]}/${ext.targetext}?${templateEnd}`;
            xmlApp.ele('action', {name: 'convert', ext: ext.view[j], targetext: ext.targetext, requires: 'update', urlsrc: urlConvert}).up();
          }
        }
        for (let j = 0; j < ext.edit.length; ++j) {
          xmlApp.ele('action', {name: 'view', ext: ext.edit[j], urlsrc: urlTemplateView}).up();
          xmlApp.ele('action', {name: 'embedview', ext: ext.edit[j], urlsrc: urlTemplateEmbedView}).up();
          xmlApp.ele('action', {name: 'mobileView', ext: ext.edit[j], urlsrc: urlTemplateMobileView}).up();
          if (formsExts[ext.edit[j]]) {
            xmlApp.ele('action', {name: 'edit', ext: ext.edit[j], default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
            xmlApp.ele('action', {name: 'formsubmit', ext: ext.edit[j], requires: 'locks,update', urlsrc: urlTemplateFormSubmit}).up();
          } else {
            xmlApp.ele('action', {name: 'edit', ext: ext.edit[j], default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
          }
          xmlApp.ele('action', {name: 'mobileEdit', ext: ext.edit[j], requires: 'locks,update', urlsrc: urlTemplateMobileEdit}).up();
          if (templatesFolderExtsCache[ext.edit[j]]) {
            xmlApp.ele('action', {name: 'editnew', ext: ext.edit[j], requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
          }
        }
        xmlApp.up();
      }
      //end section for MS WOPI connectors
      //start section for collabora nexcloud connectors
      for(let i = 0; i < exts.length; ++i) {
        let ext = exts[i];
        let urlTemplateView = `${templateStart}/${documentTypes[i]}/view?${templateEnd}`;
        let urlTemplateEmbedView = `${templateStart}/${documentTypes[i]}/view?embed=1&amp;${templateEnd}`;
        let urlTemplateMobileView = `${templateStart}/${documentTypes[i]}/view?mobile=1&amp;${templateEnd}`;
        let urlTemplateEdit = `${templateStart}/${documentTypes[i]}/edit?${templateEnd}`;
        let urlTemplateMobileEdit = `${templateStart}/${documentTypes[i]}/edit?mobile=1&amp;${templateEnd}`;
        let urlTemplateFormSubmit = `${templateStart}/${documentTypes[i]}/edit?formsubmit=1&amp;${templateEnd}`;
        for (let j = 0; j < ext.view.length; ++j) {
          let mimeTypes = mimeTypesByExt[ext.view[j]];
          if (mimeTypes) {
            mimeTypes.forEach((value) => {
              let xmlApp = xmlZone.ele('app', {name: value});
              xmlApp.ele('action', {name: 'view', ext: '', default: 'true', urlsrc: urlTemplateView}).up();
              xmlApp.ele('action', {name: 'embedview', ext: '', urlsrc: urlTemplateEmbedView}).up();
              xmlApp.ele('action', {name: 'mobileView', ext: '', urlsrc: urlTemplateMobileView}).up();
              if (ext.targetext) {
                let urlConvert = `${templateStart}/convert-and-edit/${ext.view[j]}/${ext.targetext}?${templateEnd}`;
                xmlApp.ele('action', {name: 'convert', ext: '', targetext: ext.targetext, requires: 'update', urlsrc: urlConvert}).up();
              }
              xmlApp.up();
            });
          }
        }
        for (let j = 0; j < ext.edit.length; ++j) {
          let mimeTypes = mimeTypesByExt[ext.edit[j]];
          if (mimeTypes) {
            mimeTypes.forEach((value) => {
              let xmlApp = xmlZone.ele('app', {name: value});
              if (formsExts[ext.edit[j]]) {
                xmlApp.ele('action', {name: 'edit', ext: '', default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
                xmlApp.ele('action', {name: 'formsubmit', ext: '', requires: 'locks,update', urlsrc: urlTemplateFormSubmit}).up();
              } else {
                xmlApp.ele('action', {name: 'edit', ext: '', default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
              }
              xmlApp.ele('action', {name: 'mobileEdit', ext: '', requires: 'locks,update', urlsrc: urlTemplateMobileEdit}).up();
              if (templatesFolderExtsCache[ext.edit[j]]) {
                xmlApp.ele('action', {name: 'editnew', ext: '', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
              }
              xmlApp.up();
            });
          }
        }
      }
      let xmlApp = xmlZone.ele('app', {name: 'Capabilities'});
      xmlApp.ele('action', {ext: '', name: 'getinfo', requires: 'locks,update', urlsrc: `${baseUrl}/hosting/capabilities`}).up();
      xmlApp.up();
      //end section for collabora nexcloud connectors
      let xmlDiscovery = xmlZone.up();
      if (tenWopiPublicKeyOld && tenWopiPublicKey) {
        let exponent = numberToBase64(tenWopiExponent);
        let exponentOld = numberToBase64(tenWopiExponentOld);
        xmlDiscovery.ele('proof-key', {
          oldvalue: tenWopiPublicKeyOld, oldmodulus: tenWopiModulusOld, oldexponent: exponentOld,
          value: tenWopiPublicKey, modulus: tenWopiModulus, exponent: exponent
        }).up();
      }
      xmlDiscovery.up();
    } catch (err) {
      ctx.logger.error('wopiDiscovery error:%s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/xml');
      res.send(xml.end());
      ctx.logger.info('wopiDiscovery end');
    }
  });
}
function collaboraCapabilities(req, res) {
  return co(function*() {
    let output = {
      "convert-to": {"available": true, "endpoint":"/lool/convert-to"}, "hasMobileSupport": true, "hasProxyPrefix": false, "hasTemplateSaveAs": false,
      "hasTemplateSource": true, "productVersion": commonDefines.buildVersion
    };
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('collaboraCapabilities start');
    } catch (err) {
      ctx.logger.error('collaboraCapabilities error:%s', err.stack);
    } finally {
      utils.fillResponseSimple(res, JSON.stringify(output), "application/json");
      ctx.logger.info('collaboraCapabilities end');
    }
  });
}
function isWopiCallback(url) {
  return url && url.startsWith("{");
}
function isWopiUnlockMarker(url) {
  return isWopiCallback(url) && !!JSON.parse(url).unlockId;
}
function isWopiModifiedMarker(url) {
  if (isWopiCallback(url)) {
    let obj = JSON.parse(url);
    return obj.fileInfo && obj.fileInfo.LastModifiedTime
  }
}
function getWopiUnlockMarker(wopiParams) {
  if (!wopiParams.userAuth || !wopiParams.commonInfo) {
    return;
  }
  return JSON.stringify(Object.assign({unlockId: wopiParams.commonInfo.lockId}, wopiParams.userAuth));
}
function getWopiModifiedMarker(wopiParams, lastModifiedTime) {
  return JSON.stringify(Object.assign({fileInfo: {LastModifiedTime: lastModifiedTime}}, wopiParams.userAuth));
}
function getFileTypeByInfo(fileInfo) {
  let fileType = fileInfo.BaseFileName ? fileInfo.BaseFileName.substr(fileInfo.BaseFileName.lastIndexOf('.') + 1) : "";
  fileType = fileInfo.FileExtension ? fileInfo.FileExtension.substr(1) : fileType;
  return fileType.toLowerCase();
}
async function getWopiFileUrl(ctx, fileInfo, userAuth) {
  const tenMaxDownloadBytes = ctx.getCfg('FileConverter.converter.maxDownloadBytes', cfgMaxDownloadBytes);
  let url;
  let headers = {'X-WOPI-MaxExpectedSize': tenMaxDownloadBytes};
  if (fileInfo?.FileUrl) {
    //Requests to the FileUrl can not be signed using proof keys. The FileUrl is used exactly as provided by the host, so it does not necessarily include the access token, which is required to construct the expected proof.
    url = fileInfo.FileUrl;
  } else if (fileInfo?.TemplateSource) {
    url = fileInfo.TemplateSource;
  } else if (userAuth) {
    url = `${userAuth.wopiSrc}/contents?access_token=${userAuth.access_token}`;
    await fillStandardHeaders(ctx, headers, url, userAuth.access_token);
  }
  ctx.logger.debug('getWopiFileUrl url=%s; headers=%j', url, headers);
  return {url, headers};
}
function isWopiJwtToken(decoded) {
  return !!decoded.fileInfo;
}
function setIsShutdown(val) {
  shutdownFlag = val;
}
function getLastModifiedTimeFromCallbacks(callbacks) {
  for (let i = callbacks.length; i >= 0; --i) {
    let callback = callbacks[i];
    let lastModifiedTime = isWopiModifiedMarker(callback);
    if (lastModifiedTime) {
      return lastModifiedTime;
    }
  }
}
function isCorrectUserAuth(userAuth) {
  return undefined !== userAuth.wopiSrc;
}
function parseWopiCallback(ctx, userAuthStr, opt_url) {
  let wopiParams = null;
  if (isWopiCallback(userAuthStr)) {
    let userAuth = JSON.parse(userAuthStr);
    if (!isCorrectUserAuth(userAuth)) {
      userAuth = null;
    }
    let commonInfo = null;
    let lastModifiedTime = null;
    if (opt_url) {
      let commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, opt_url, 1);
      if (isWopiCallback(commonInfoStr)) {
        commonInfo = JSON.parse(commonInfoStr);
        if (commonInfo.fileInfo) {
          lastModifiedTime = commonInfo.fileInfo.LastModifiedTime;
          if (lastModifiedTime) {
            let callbacks = sqlBase.UserCallback.prototype.getCallbacks(ctx, opt_url);
            lastModifiedTime = getLastModifiedTimeFromCallbacks(callbacks);
          }
        } else {
          commonInfo = null;
        }
      }
    }
    wopiParams = {commonInfo: commonInfo, userAuth: userAuth, LastModifiedTime: lastModifiedTime};
    ctx.logger.debug('parseWopiCallback wopiParams:%j', wopiParams);
  }
  return wopiParams;
}
function checkAndInvalidateCache(ctx, docId, fileInfo) {
  return co(function*() {
    let res = {success: true, lockId: undefined};
    let selectRes = yield taskResult.select(ctx, docId);
    if (selectRes.length > 0) {
      let row = selectRes[0];
      if (row.callback) {
        let commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback, 1);
        if (isWopiCallback(commonInfoStr)) {
          let commonInfo = JSON.parse(commonInfoStr);
          res.lockId = commonInfo.lockId;
          ctx.logger.debug('wopiEditor lockId from DB lockId=%s', res.lockId);
          let unlockMarkStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
          ctx.logger.debug('wopiEditor commonInfoStr=%s', commonInfoStr);
          ctx.logger.debug('wopiEditor unlockMarkStr=%s', unlockMarkStr);
          let hasUnlockMarker = isWopiUnlockMarker(unlockMarkStr);
          let isUpdateVersion = commonDefines.FileStatus.UpdateVersion === row.status;
          ctx.logger.debug('wopiEditor hasUnlockMarker=%s isUpdateVersion=%s', hasUnlockMarker, isUpdateVersion);
          if (hasUnlockMarker || isUpdateVersion) {
            let fileInfoVersion = fileInfo.Version;
            let cacheVersion = commonInfo.fileInfo.Version;
            let fileInfoModified = fileInfo.LastModifiedTime;
            let cacheModified = commonInfo.fileInfo.LastModifiedTime;
            ctx.logger.debug('wopiEditor version fileInfo=%s; cache=%s', fileInfoVersion, cacheVersion);
            ctx.logger.debug('wopiEditor LastModifiedTime fileInfo=%s; cache=%s', fileInfoModified, cacheModified);
            if (fileInfoVersion !== cacheVersion || (fileInfoModified !== cacheModified)) {
              var mask = new taskResult.TaskResultData();
              mask.tenant = ctx.tenant;
              mask.key = docId;
              mask.last_open_date = row.last_open_date;
              //cleanupRes can be false in case of simultaneous opening. it is OK
              let cleanupRes = yield canvasService.cleanupCacheIf(ctx, mask);
              ctx.logger.debug('wopiEditor cleanupRes=%s', cleanupRes);
              res.lockId = undefined;
            }
          }
        } else {
          res.success = false;
          ctx.logger.warn('wopiEditor attempt to open not wopi record');
        }
      }
    }
    return res;
  });
}
function parsePutFileResponse(ctx, postRes) {
  let body = null
  if (postRes.body) {
    try {
      //collabora nexcloud connector
      body = JSON.parse(postRes.body);
    } catch (e) {
      ctx.logger.debug('wopi PutFile body parse error: %s', e.stack);
    }
  }
  return body;
}
async function checkAndReplaceEmptyFile(ctx, fileInfo, wopiSrc, access_token, access_token_ttl, lang, ui, fileType) {
  // TODO: throw error if format not supported?
  if (fileInfo.Size === 0 && fileType.length !== 0) {
    const tenNewFileTemplate = ctx.getCfg('services.CoAuthoring.server.newFileTemplate', cfgNewFileTemplate);

    //Create new files using Office for the web
    const wopiParams = getWopiParams(undefined, fileInfo, wopiSrc, access_token, access_token_ttl);

    if (templatesFolderLocalesCache === null) {
      const dirContent = await readdir(`${tenNewFileTemplate}/`, {withFileTypes: true});
      templatesFolderLocalesCache = dirContent.filter(dirObject => dirObject.isDirectory())
        .map(dirObject => dirObject.name);
    }

    const localePrefix = lang || ui || 'en';
    let locale = constants.TEMPLATES_FOLDER_LOCALE_COLLISON_MAP[localePrefix] ??
      templatesFolderLocalesCache.find(locale => locale.startsWith(localePrefix));
    if (locale === undefined) {
      locale = constants.TEMPLATES_DEFAULT_LOCALE;
    }

    const filePath = `${tenNewFileTemplate}/${locale}/new.${fileType}`;
    if (!templateFilesSizeCache[filePath]) {
      templateFilesSizeCache[filePath] = await lstat(filePath);
    }

    const templateFileInfo = templateFilesSizeCache[filePath];
    const templateFileStream = createReadStream(filePath);
    let postRes = await putFile(ctx, wopiParams, undefined, templateFileStream, templateFileInfo.size, fileInfo.UserId, false, false, false);
    if (postRes) {
      //update Size
      fileInfo.Size = templateFileInfo.size;
      let body = parsePutFileResponse(ctx, postRes);
      //collabora nexcloud connector
      if (body?.LastModifiedTime) {
        //update LastModifiedTime
        fileInfo.LastModifiedTime = body.LastModifiedTime;
      }
    }
  }
}
function getEditorHtml(req, res) {
  return co(function*() {
    let params = {key: undefined, apiQuery: '', fileInfo: {}, userAuth: {}, queryParams: req.query, token: undefined, documentType: undefined, docs_api_config: {}};
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
      const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
      const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
      const tenWopiFileInfoBlockList = ctx.getCfg('wopi.fileInfoBlockList', cfgWopiFileInfoBlockList);

      let wopiSrc = req.query['wopisrc'];
      let fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);

      ctx.logger.info('wopiEditor start');
      ctx.logger.debug(`wopiEditor req.url:%s`, req.url);
      ctx.logger.debug(`wopiEditor req.query:%j`, req.query);
      ctx.logger.debug(`wopiEditor req.body:%j`, req.body);
      params.apiQuery = `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}`;
      params.documentType = req.params.documentType;
      let mode = req.params.mode;
      let sc = req.query['sc'];
      let hostSessionId = req.query['hid'];
      let lang = req.query['lang'];
      let ui = req.query['ui'];
      let access_token = req.body['access_token'] || "";
      let access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      let docs_api_config = req.body['docs_api_config'];
      if (docs_api_config) {
        params.docs_api_config = JSON.parse(docs_api_config);
      }


      let fileInfo = params.fileInfo = yield checkFileInfo(ctx, wopiSrc, access_token, sc);
      if (!fileInfo) {
        params.fileInfo = {};
        return;
      }
      const fileType = getFileTypeByInfo(fileInfo);
      if (!shutdownFlag) {
        yield checkAndReplaceEmptyFile(ctx, fileInfo, wopiSrc, access_token, access_token_ttl, lang, ui, fileType);
      }

      if (!fileInfo.UserCanWrite) {
        mode = 'view';
      }
      //docId
      let docId = undefined;
      if ('view' !== mode) {
        docId = `${fileId}`;
      } else {
        //todo rename operation requires lock
        fileInfo.SupportsRename = false;
        //todo change docId to avoid empty cache after editors are gone
        if (fileInfo.LastModifiedTime) {
          docId = `view.${fileId}.${fileInfo.LastModifiedTime}`;
        } else {
          docId = `view.${fileId}.${fileInfo.Version}`;
        }
      }
      docId = docId.replace(constants.DOC_ID_REPLACE_REGEX, '_').substring(0, constants.DOC_ID_MAX_LENGTH);
      ctx.logger.debug(`wopiEditor`);
      params.key = docId;
      let userAuth = params.userAuth = {
        wopiSrc: wopiSrc, access_token: access_token, access_token_ttl: access_token_ttl,
        hostSessionId: hostSessionId, userSessionId: docId, mode: mode
      };

      //check and invalidate cache
      let checkRes = yield checkAndInvalidateCache(ctx, docId, fileInfo);
      let lockId = checkRes.lockId;
      if (!checkRes.success) {
        params.fileInfo = {};
        return;
      }
      if (!shutdownFlag) {
        //save common info
        if (undefined === lockId) {
          //Use deterministic(not random) lockId to fix issues with forgotten openings due to integrator failures
          lockId = docId;
          let commonInfo = JSON.stringify({lockId: lockId, fileInfo: fileInfo});
          yield canvasService.commandOpenStartPromise(ctx, docId, utils.getBaseUrlByRequest(ctx, req), commonInfo, fileType);
        }

        //Lock
        if ('view' !== mode) {
          let lockRes = yield lock(ctx, 'LOCK', lockId, fileInfo, userAuth);
          if (!lockRes) {
            params.fileInfo = {};
            return;
          }
        }
      }

      tenWopiFileInfoBlockList.forEach((item) => {
        delete params.fileInfo[item];
      });

      if (tenTokenEnableBrowser) {
        let options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
        let secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Browser);
        params.token = jwt.sign(params, secret, options);
      }
    } catch (err) {
      ctx.logger.error('wopiEditor error:%s', err.stack);
      params.fileInfo = {};
    } finally {
      ctx.logger.debug('wopiEditor render params=%j', params);
      try {
        res.render("editor-wopi", params);
      } catch (err) {
        ctx.logger.error('wopiEditor error:%s', err.stack);
        res.sendStatus(400);
      }
      ctx.logger.info('wopiEditor end');
    }
  });
}
function getConverterHtml(req, res) {
  return co(function*() {
    let params = {statusHandler: undefined};
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
      const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
      const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
      const tenWopiHost = ctx.getCfg('wopi.host', cfgWopiHost);

      let wopiSrc = req.query['wopisrc'];
      let fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);
      ctx.logger.info('convert-and-edit start');

      let access_token = req.body['access_token'] || "";
      let access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      let ext = req.params.ext;
      let targetext = req.params.targetext;

      if (!(wopiSrc && access_token && access_token_ttl && ext && targetext)) {
        ctx.logger.debug('convert-and-edit invalid params: WOPISrc=%s; access_token=%s; access_token_ttl=%s; ext=%s; targetext=%s', wopiSrc, access_token, access_token_ttl, ext, targetext);
        return;
      }

      let fileInfo = yield checkFileInfo(ctx, wopiSrc, access_token);
      if (!fileInfo) {
        ctx.logger.info('convert-and-edit checkFileInfo error');
        return;
      }

      let wopiParams = getWopiParams(undefined, fileInfo, wopiSrc, access_token, access_token_ttl);

      let docId = yield converterService.convertAndEdit(ctx, wopiParams, ext, targetext);
      if (docId) {
        let baseUrl = tenWopiHost || utils.getBaseUrlByRequest(ctx, req);
        params.statusHandler = `${baseUrl}/hosting/wopi/convert-and-edit-handler`;
        params.statusHandler += `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}&access_token=${encodeURIComponent(access_token)}`;
        params.statusHandler += `&targetext=${encodeURIComponent(targetext)}&docId=${encodeURIComponent(docId)}`;
        if (tenTokenEnableBrowser) {
          let tokenData = {docId: docId};
          let options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
          let secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Browser);
          let token = jwt.sign(tokenData, secret, options);

          params.statusHandler += `&token=${encodeURIComponent(token)}`;
        }
      }
    } catch (err) {
      ctx.logger.error('convert-and-edit error:%s', err.stack);
    } finally {
      ctx.logger.debug('convert-and-edit render params=%j', params);
      try {
        res.render("convert-and-edit-wopi", params);
      } catch (err) {
        ctx.logger.error('convert-and-edit error:%s', err.stack);
        res.sendStatus(400);
      }
      ctx.logger.info('convert-and-edit end');
    }
  });
}
function putFile(ctx, wopiParams, data, dataStream, dataSize, userLastChangeId, isModifiedByUser, isAutosave, isExitSave) {
  return co(function* () {
    let postRes = null;
    try {
      ctx.logger.info('wopi PutFile start');
      const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

      if (!wopiParams.userAuth || !wopiParams.commonInfo) {
        return postRes;
      }
      let fileInfo = wopiParams.commonInfo.fileInfo;
      let userAuth = wopiParams.userAuth;
      let uri = `${userAuth.wopiSrc}/contents?access_token=${userAuth.access_token}`;
      let filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return postRes;
      }

      //collabora nexcloud connector sets only UserCanWrite=true
      if (fileInfo && (fileInfo.SupportsUpdate || fileInfo.UserCanWrite)) {
        let commonInfo = wopiParams.commonInfo;
        //todo add all the users who contributed changes to the document in this PutFile request to X-WOPI-Editors
        let headers = {'X-WOPI-Override': 'PUT', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-Editors': userLastChangeId};
        yield fillStandardHeaders(ctx, headers, uri, userAuth.access_token);
        headers['X-LOOL-WOPI-IsModifiedByUser'] = isModifiedByUser;
        headers['X-LOOL-WOPI-IsAutosave'] = isAutosave;
        headers['X-LOOL-WOPI-IsExitSave'] = isExitSave;
        if (wopiParams.LastModifiedTime) {
          //collabora nexcloud connector
          headers['X-LOOL-WOPI-Timestamp'] = wopiParams.LastModifiedTime;
        }
        headers['Content-Type'] = mime.getType(getFileTypeByInfo(fileInfo));

        ctx.logger.debug('wopi PutFile request uri=%s headers=%j', uri, headers);
        postRes = yield utils.postRequestPromise(ctx, uri, data, dataStream, dataSize, tenCallbackRequestTimeout, undefined, headers);
        ctx.logger.debug('wopi PutFile response headers=%j', postRes.response.headers);
        ctx.logger.debug('wopi PutFile response body:%s', postRes.body);
      } else {
        ctx.logger.warn('wopi SupportsUpdate = false or UserCanWrite = false');
      }
    } catch (err) {
      ctx.logger.error('wopi error PutFile:%s', err.stack);
    } finally {
      ctx.logger.info('wopi PutFile end');
    }
    return postRes;
  });
}
function putRelativeFile(ctx, wopiSrc, access_token, data, dataStream, dataSize, suggestedExt, suggestedTarget, isFileConversion) {
  return co(function* () {
    let res = undefined;
    try {
      ctx.logger.info('wopi putRelativeFile start');
      const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

      let uri = `${wopiSrc}?access_token=${access_token}`;
      let filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return res;
      }

      let headers = {'X-WOPI-Override': 'PUT_RELATIVE', 'X-WOPI-SuggestedTarget': utf7.encode(suggestedTarget || suggestedExt)};
      if (isFileConversion) {
        headers['X-WOPI-FileConversion'] = isFileConversion;
      }
      yield fillStandardHeaders(ctx, headers, uri, access_token);
      headers['Content-Type'] = mime.getType(suggestedExt);

      ctx.logger.debug('wopi putRelativeFile request uri=%s headers=%j', uri, headers);
      let postRes = yield utils.postRequestPromise(ctx, uri, data, dataStream, dataSize, tenCallbackRequestTimeout, undefined, headers);
      ctx.logger.debug('wopi putRelativeFile response headers=%j', postRes.response.headers);
      ctx.logger.debug('wopi putRelativeFile response body:%s', postRes.body);
      res = JSON.parse(postRes.body);
    } catch (err) {
      ctx.logger.error('wopi error putRelativeFile:%s', err.stack);
    } finally {
      ctx.logger.info('wopi putRelativeFile end');
    }
    return res;
  });
}
function renameFile(ctx, wopiParams, name) {
  return co(function* () {
    let res = undefined;
    try {
      ctx.logger.info('wopi RenameFile start');
      const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

      if (!wopiParams.userAuth || !wopiParams.commonInfo) {
        return res;
      }
      let fileInfo = wopiParams.commonInfo.fileInfo;
      let userAuth = wopiParams.userAuth;
      let uri = `${userAuth.wopiSrc}?access_token=${userAuth.access_token}`;
      let filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return res;
      }

      if (fileInfo && fileInfo.SupportsRename) {
        let fileNameMaxLength = fileInfo.FileNameMaxLength || 255;
        name = name.substring(0, fileNameMaxLength);
        let commonInfo = wopiParams.commonInfo;

        let headers = {'X-WOPI-Override': 'RENAME_FILE', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-RequestedName': utf7.encode(name)};
        yield fillStandardHeaders(ctx, headers, uri, userAuth.access_token);

        ctx.logger.debug('wopi RenameFile request uri=%s headers=%j', uri, headers);
        let postRes = yield utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, headers);
        ctx.logger.debug('wopi RenameFile response headers=%j body=%s', postRes.response.headers, postRes.body);
        if (postRes.body) {
          res = JSON.parse(postRes.body);
        } else {
          //sharepoint send empty body(2016 allways, 2019 with same name)
          res = {"Name": name};
        }
      } else {
        ctx.logger.info('wopi SupportsRename = false');
      }
    } catch (err) {
      ctx.logger.error('wopi error RenameFile:%s', err.stack);
    } finally {
      ctx.logger.info('wopi RenameFile end');
    }
    return res;
  });
}
function checkFileInfo(ctx, wopiSrc, access_token, opt_sc) {
  return co(function* () {
    let fileInfo = undefined;
    try {
      ctx.logger.info('wopi checkFileInfo start');
      const tenDownloadTimeout = ctx.getCfg('FileConverter.converter.downloadTimeout', cfgDownloadTimeout);

      let uri = `${encodeURI(wopiSrc)}?access_token=${encodeURIComponent(access_token)}`;
      let filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return fileInfo;
      }
      let headers = {};
      if (opt_sc) {
        headers['X-WOPI-SessionContext'] = opt_sc;
      }
      yield fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi checkFileInfo request uri=%s headers=%j', uri, headers);
      //todo false? (true because it passed checkIpFilter for wopi)
      //todo use directIfIn
      let isInJwtToken = true;
      let getRes = yield utils.downloadUrlPromise(ctx, uri, tenDownloadTimeout, undefined, undefined, isInJwtToken, headers);
      ctx.logger.debug(`wopi checkFileInfo headers=%j body=%s`, getRes.response.headers, getRes.body);
      fileInfo = JSON.parse(getRes.body);
    } catch (err) {
      ctx.logger.error('wopi error checkFileInfo:%s', err.stack);
    } finally {
      ctx.logger.info('wopi checkFileInfo end');
    }
    return fileInfo;
  });
}
function lock(ctx, command, lockId, fileInfo, userAuth) {
  return co(function* () {
    let res = true;
    try {
      ctx.logger.info('wopi %s start', command);
      const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

      if (fileInfo && fileInfo.SupportsLocks) {
        if (!userAuth) {
          return false;
        }
        let wopiSrc = userAuth.wopiSrc;
        let access_token = userAuth.access_token;
        let uri = `${wopiSrc}?access_token=${access_token}`;
        let filterStatus = yield checkIpFilter(ctx, uri);
        if (0 !== filterStatus) {
          return false;
        }

        let headers = {"X-WOPI-Override": command, "X-WOPI-Lock": lockId};
        yield fillStandardHeaders(ctx, headers, uri, access_token);
        ctx.logger.debug('wopi %s request uri=%s headers=%j', command, uri, headers);
        let postRes = yield utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, headers);
        ctx.logger.debug('wopi %s response headers=%j', command, postRes.response.headers);
      } else {
        ctx.logger.info('wopi %s SupportsLocks = false', command);
      }
    } catch (err) {
      res = false;
      ctx.logger.error('wopi error %s:%s', command, err.stack);
    } finally {
      ctx.logger.info('wopi %s end', command);
    }
    return res;
  });
}
async function unlock(ctx, wopiParams) {
  let res = false;
  try {
    ctx.logger.info('wopi Unlock start');
    const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

    if (!wopiParams.userAuth || !wopiParams.commonInfo) {
      return;
    }
    let fileInfo = wopiParams.commonInfo.fileInfo;
    if (fileInfo && fileInfo.SupportsLocks) {
      let wopiSrc = wopiParams.userAuth.wopiSrc;
      let lockId = wopiParams.commonInfo.lockId;
      let access_token = wopiParams.userAuth.access_token;
      let uri = `${wopiSrc}?access_token=${access_token}`;
      let filterStatus = await checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return;
      }

      let headers = {"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": lockId};
      await fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi Unlock request uri=%s headers=%j', uri, headers);
      let postRes = await utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, headers);
      ctx.logger.debug('wopi Unlock response headers=%j', postRes.response.headers);
    } else {
      ctx.logger.info('wopi SupportsLocks = false');
    }
    res = true;
  } catch (err) {
    ctx.logger.error('wopi error Unlock:%s', err.stack);
  } finally {
    ctx.logger.info('wopi Unlock end');
  }
  return res;
}
function generateProofBuffer(url, accessToken, timeStamp) {
  const accessTokenBytes = Buffer.from(accessToken, 'utf8');
  const urlBytes = Buffer.from(url.toUpperCase(), 'utf8');

  let offset = 0;
  let buffer = Buffer.alloc(4 + accessTokenBytes.length + 4 + urlBytes.length + 4 + 8);
  buffer.writeUInt32BE(accessTokenBytes.length, offset);
  offset += 4;
  accessTokenBytes.copy(buffer, offset, 0, accessTokenBytes.length);
  offset += accessTokenBytes.length;
  buffer.writeUInt32BE(urlBytes.length, offset);
  offset += 4;
  urlBytes.copy(buffer, offset, 0, urlBytes.length);
  offset += urlBytes.length;
  buffer.writeUInt32BE(8, offset);
  offset += 4;
  buffer.writeBigUInt64BE(timeStamp, offset);
  return buffer;
}

async function generateProofSign(url, accessToken, timeStamp, privateKey) {
  let data = generateProofBuffer(url, accessToken, timeStamp);
  let sign = await cryptoSign('RSA-SHA256', data, privateKey);
  return sign.toString('base64');
}

function numberToBase64(val) {
  // Convert to hexadecimal
  let hexString = val.toString(16);
  //Ensure the hexadecimal string has an even length
  if (hexString.length % 2 !== 0) {
    hexString = '0' + hexString;
  }
  //Convert the hexadecimal string to a buffer
  const buffer = Buffer.from(hexString, 'hex');
  return  buffer.toString('base64');
}

async function fillStandardHeaders(ctx, headers, url, access_token) {
  let timeStamp = utils.getDateTimeTicks(new Date());
  const tenWopiPrivateKey = ctx.getCfg('wopi.privateKey', cfgWopiPrivateKey);
  const tenWopiPrivateKeyOld = ctx.getCfg('wopi.privateKeyOld', cfgWopiPrivateKeyOld);
  if (tenWopiPrivateKey && tenWopiPrivateKeyOld) {
    headers['X-WOPI-Proof'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKey);
    headers['X-WOPI-ProofOld'] = await generateProofSign(url, access_token, timeStamp, tenWopiPrivateKeyOld);
    headers['X-WOPI-TimeStamp'] = timeStamp;
    headers['X-WOPI-ClientVersion'] = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
    // todo
    // headers['X-WOPI-CorrelationId '] = "";
    // headers['X-WOPI-SessionId'] = "";
  }
  headers['Authorization'] = `Bearer ${access_token}`;
}

function checkIpFilter(ctx, uri){
  return co(function* () {
    let urlParsed = new URL(uri);
    let filterStatus = yield* utils.checkHostFilter(ctx, urlParsed.hostname);
    if (0 !== filterStatus) {
      ctx.logger.warn('wopi checkIpFilter error: url = %s', uri);
    }
    return filterStatus;
  });
}
function getWopiParams(lockId, fileInfo, wopiSrc, access_token, access_token_ttl) {
  let commonInfo = {lockId: lockId, fileInfo: fileInfo};
  let userAuth = {
    wopiSrc: wopiSrc, access_token: access_token, access_token_ttl: access_token_ttl,
    hostSessionId: null, userSessionId: null, mode: null
  };
  return {commonInfo: commonInfo, userAuth: userAuth, LastModifiedTime: null};
}

async function dummyCheckFileInfo(req, res) {
  if (true) {
    //static output for performance reason
    res.json({
      BaseFileName: "sample.docx",
      OwnerId: "userId",
      Size: 100,//no need to set actual size for test
      UserId: "userId",//test ignores
      UserFriendlyName: "user",
      Version: 0,
      UserCanWrite: true,
      SupportsGetLock: true,
      SupportsLocks: true,
      SupportsUpdate: true,
    });
  } else {
    let fileInfo;
    let ctx = new operationContext.Context();
    ctx.initFromRequest(req);
    try {
      await ctx.initTenantCache();
      const tenWopiDummySampleFilePath = ctx.getCfg('wopi.dummy.sampleFilePath', cfgWopiDummySampleFilePath);
      let access_token = req.query['access_token'];
      ctx.logger.debug('dummyCheckFileInfo access_token:%s', access_token);
      let sampleFileStat = await stat(tenWopiDummySampleFilePath);

      fileInfo = JSON.parse(Buffer.from(access_token, 'base64').toString('ascii'));
      fileInfo.BaseFileName = path.basename(tenWopiDummySampleFilePath);
      fileInfo.Size = sampleFileStat.size;
    } catch (err) {
      ctx.logger.error('dummyCheckFileInfo error:%s', err.stack);
    } finally {
      if (fileInfo) {
        res.json(fileInfo);
      } else {
        res.sendStatus(400)
      }
    }
  }
}

async function dummyGetFile(req, res) {
  let ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  try {
    await ctx.initTenantCache();

    const tenWopiDummySampleFilePath = ctx.getCfg('wopi.dummy.sampleFilePath', cfgWopiDummySampleFilePath);
    let sampleFileStat = await stat(tenWopiDummySampleFilePath);
    res.setHeader('Content-Length', sampleFileStat.size);
    res.setHeader('Content-Type', mime.getType(tenWopiDummySampleFilePath));

    await pipeline(
      createReadStream(tenWopiDummySampleFilePath),
      res,
    );
  } catch (err) {
    if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
      //xhr.abort case
      ctx.logger.debug('dummyGetFile error: %s', err.stack);
    } else {
      ctx.logger.error('dummyGetFile error:%s', err.stack);
    }
  } finally {
    if (!res.headersSent) {
      res.sendStatus(400);
    }
  }
}
function dummyOk(req, res) {
  res.sendStatus(200);
}

exports.checkIpFilter = checkIpFilter;
exports.discovery = discovery;
exports.collaboraCapabilities = collaboraCapabilities;
exports.parseWopiCallback = parseWopiCallback;
exports.getEditorHtml = getEditorHtml;
exports.getConverterHtml = getConverterHtml;
exports.putFile = putFile;
exports.parsePutFileResponse = parsePutFileResponse;
exports.putRelativeFile = putRelativeFile;
exports.renameFile = renameFile;
exports.lock = lock;
exports.unlock = unlock;
exports.fillStandardHeaders = fillStandardHeaders;
exports.getWopiUnlockMarker = getWopiUnlockMarker;
exports.getWopiModifiedMarker = getWopiModifiedMarker;
exports.getFileTypeByInfo = getFileTypeByInfo;
exports.getWopiFileUrl = getWopiFileUrl;
exports.isWopiJwtToken = isWopiJwtToken;
exports.setIsShutdown = setIsShutdown;
exports.dummyCheckFileInfo = dummyCheckFileInfo;
exports.dummyGetFile = dummyGetFile;
exports.dummyOk = dummyOk;
