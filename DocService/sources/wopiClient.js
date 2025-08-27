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
const {URL} = require('url');
const co = require('co');
const jwt = require('jsonwebtoken');
const config = require('config');
const { createReadStream } = require('fs');
const { stat, lstat, readdir } = require('fs/promises');
const utf7 = require('utf7');
const mimeDB = require('mime-db');
const xmlbuilder2 = require('xmlbuilder2');
const utils = require('./../../Common/sources/utils');
const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');
const wopiUtils = require('./wopiUtils');
const operationContext = require('./../../Common/sources/operationContext');
const tenantManager = require('./../../Common/sources/tenantManager');
const sqlBase = require('./databaseConnectors/baseConnector');
const taskResult = require('./taskresult');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const mime = require('mime');
const license = require('./../../Common/sources/license');

const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgCallbackRequestTimeout = config.get('services.CoAuthoring.server.callbackRequestTimeout');
const cfgNewFileTemplate = config.get('services.CoAuthoring.server.newFileTemplate');
const cfgDownloadTimeout = config.get('FileConverter.converter.downloadTimeout');
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
const cfgWopiDiagramView = config.get('wopi.diagramView');
const cfgWopiDiagramEdit = config.get('wopi.diagramEdit');
const cfgWopiForms = config.get('wopi.forms');
const cfgWopiFavIconUrlWord = config.get('wopi.favIconUrlWord');
const cfgWopiFavIconUrlCell = config.get('wopi.favIconUrlCell');
const cfgWopiFavIconUrlSlide = config.get('wopi.favIconUrlSlide');
const cfgWopiFavIconUrlPdf = config.get('wopi.favIconUrlPdf');
const cfgWopiFavIconUrlDiagram = config.get('wopi.favIconUrlDiagram');
const cfgWopiPublicKey = config.get('wopi.publicKey');
const cfgWopiModulus = config.get('wopi.modulus');
const cfgWopiExponent = config.get('wopi.exponent');
const cfgWopiPublicKeyOld = config.get('wopi.publicKeyOld');
const cfgWopiModulusOld = config.get('wopi.modulusOld');
const cfgWopiExponentOld = config.get('wopi.exponentOld');
const cfgWopiHost = config.get('wopi.host');
const cfgWopiDummySampleFilePath = config.get('wopi.dummy.sampleFilePath');

let templatesFolderLocalesCache = null;
let templatesFolderExtsCache = null;
const templateFilesSizeCache = {};
let shutdownFlag = false;

//patch mimeDB
if (!mimeDB["application/vnd.visio2013"]) {
  mimeDB["application/vnd.visio2013"] = {extensions: ["vsdx", "vstx", "vssx", "vsdm", "vstm", "vssm"]};
}

const mimeTypesByExt = (function() {
  const mimeTypesByExt = {};
  for (const mimeType in mimeDB) {
    if (mimeDB.hasOwnProperty(mimeType)) {
      const val = mimeDB[mimeType];
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
      .reduce((result, item, _index, _array) => {
        const ext = path.extname(item.name).substring(1);
        result[ext] = ext;
        return result;
      }, {});
  }
  return templatesFolderExtsCache;
}

function discovery(req, res) {
  return co(function*() {
    const xml = xmlbuilder2.create({version: '1.0', encoding: 'utf-8'});
    const ctx = new operationContext.Context();
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
      const tenWopiDiagramView = ctx.getCfg('wopi.diagramView', cfgWopiDiagramView);
      const tenWopiDiagramEdit = ctx.getCfg('wopi.diagramEdit', cfgWopiDiagramEdit);
      const tenWopiForms = ctx.getCfg('wopi.forms', cfgWopiForms);
      const tenWopiFavIconUrlWord = ctx.getCfg('wopi.favIconUrlWord', cfgWopiFavIconUrlWord);
      const tenWopiFavIconUrlCell = ctx.getCfg('wopi.favIconUrlCell', cfgWopiFavIconUrlCell);
      const tenWopiFavIconUrlSlide = ctx.getCfg('wopi.favIconUrlSlide', cfgWopiFavIconUrlSlide);
      const tenWopiFavIconUrlPdf = ctx.getCfg('wopi.favIconUrlPdf', cfgWopiFavIconUrlPdf);
      const tenWopiFavIconUrlDiagram = ctx.getCfg('wopi.favIconUrlDiagram', cfgWopiFavIconUrlDiagram);
      const tenWopiPublicKey = ctx.getCfg('wopi.publicKey', cfgWopiPublicKey);
      const tenWopiModulus = ctx.getCfg('wopi.modulus', cfgWopiModulus);
      const tenWopiExponent = ctx.getCfg('wopi.exponent', cfgWopiExponent);
      const tenWopiPublicKeyOld = ctx.getCfg('wopi.publicKeyOld', cfgWopiPublicKeyOld);
      const tenWopiModulusOld = ctx.getCfg('wopi.modulusOld', cfgWopiModulusOld);
      const tenWopiExponentOld = ctx.getCfg('wopi.exponentOld', cfgWopiExponentOld);
      const tenWopiHost = ctx.getCfg('wopi.host', cfgWopiHost);

      const baseUrl = tenWopiHost || utils.getBaseUrlByRequest(ctx, req);
      const names = ['Word','Excel','PowerPoint','Pdf'];
      const favIconUrls = [tenWopiFavIconUrlWord, tenWopiFavIconUrlCell, tenWopiFavIconUrlSlide, tenWopiFavIconUrlPdf];
      const exts = [
        {targetext: 'docx', view: tenWopiWordView, edit: tenWopiWordEdit},
        {targetext: 'xlsx', view: tenWopiCellView, edit: tenWopiCellEdit},
        {targetext: 'pptx', view: tenWopiSlideView, edit: tenWopiSlideEdit},
        {targetext: null, view: tenWopiPdfView, edit: tenWopiPdfEdit}
      ];
      const documentTypes = [`word`, `cell`, `slide`, `pdf`];
      //todo check sdkjs-ooxml addon
      const addVisio = (tenWopiDiagramView.length > 0 || tenWopiDiagramEdit.length > 0)
        && (constants.PACKAGE_TYPE_OS !== license.packageType || process.env?.NODE_ENV?.startsWith("development-"));
      if (addVisio) {
        names.push('Visio');
        favIconUrls.push(tenWopiFavIconUrlDiagram);
        exts.push({targetext: null, view: tenWopiDiagramView, edit: tenWopiDiagramEdit});
        documentTypes.push(`diagram`);
      }

      const templatesFolderExtsCache = yield getTemplatesFolderExts(ctx);
      const formsExts = tenWopiForms.reduce((result, item, _index, _array) => {
        result[item] = item;
        return result;
      }, {});

      const templateStart = `${baseUrl}/hosting/wopi`;
      let templateEnd = `&lt;rs=DC_LLCC&amp;&gt;&lt;dchat=DISABLE_CHAT&amp;&gt;&lt;embed=EMBEDDED&amp;&gt;`;
      templateEnd += `&lt;fs=FULLSCREEN&amp;&gt;&lt;hid=HOST_SESSION_ID&amp;&gt;&lt;rec=RECORDING&amp;&gt;`;
      templateEnd += `&lt;sc=SESSION_CONTEXT&amp;&gt;&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;`;
      templateEnd += `&lt;wopisrc=WOPI_SOURCE&amp;&gt;&amp;`;
      const xmlZone = xml.ele('wopi-discovery').ele('net-zone', { name: tenWopiWopiZone });
      //start section for MS WOPI connectors
      for(let i = 0; i < names.length; ++i) {
        const name = names[i];
        let favIconUrl = favIconUrls[i];
        if (!(favIconUrl.startsWith('http://') || favIconUrl.startsWith('https://'))) {
          favIconUrl = baseUrl + favIconUrl;
        }
        const ext = exts[i];
        const urlTemplateView = `${templateStart}/${documentTypes[i]}/view?${templateEnd}`;
        const urlTemplateEmbedView = `${templateStart}/${documentTypes[i]}/view?embed=1&amp;${templateEnd}`;
        const urlTemplateMobileView = `${templateStart}/${documentTypes[i]}/view?mobile=1&amp;${templateEnd}`;
        const urlTemplateEdit = `${templateStart}/${documentTypes[i]}/edit?${templateEnd}`;
        const urlTemplateMobileEdit = `${templateStart}/${documentTypes[i]}/edit?mobile=1&amp;${templateEnd}`;
        const urlTemplateFormSubmit = `${templateStart}/${documentTypes[i]}/edit?formsubmit=1&amp;${templateEnd}`;
        const xmlApp = xmlZone.ele('app', {name, favIconUrl});
        for (let j = 0; j < ext.view.length; ++j) {
          xmlApp.ele('action', {name: 'view', ext: ext.view[j], default: 'true', urlsrc: urlTemplateView}).up();
          xmlApp.ele('action', {name: 'embedview', ext: ext.view[j], urlsrc: urlTemplateEmbedView}).up();
          xmlApp.ele('action', {name: 'mobileView', ext: ext.view[j], urlsrc: urlTemplateMobileView}).up();
          if (ext.targetext) {
            const urlConvert = `${templateStart}/convert-and-edit/${ext.view[j]}/${ext.targetext}?${templateEnd}`;
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
        const ext = exts[i];
        const urlTemplateView = `${templateStart}/${documentTypes[i]}/view?${templateEnd}`;
        const urlTemplateEmbedView = `${templateStart}/${documentTypes[i]}/view?embed=1&amp;${templateEnd}`;
        const urlTemplateMobileView = `${templateStart}/${documentTypes[i]}/view?mobile=1&amp;${templateEnd}`;
        const urlTemplateEdit = `${templateStart}/${documentTypes[i]}/edit?${templateEnd}`;
        const urlTemplateMobileEdit = `${templateStart}/${documentTypes[i]}/edit?mobile=1&amp;${templateEnd}`;
        const urlTemplateFormSubmit = `${templateStart}/${documentTypes[i]}/edit?formsubmit=1&amp;${templateEnd}`;
        const mimeTypesDuplicate = new Set();//to remove duplicates for each editor(allow html for word and excel)
        for (let j = 0; j < ext.view.length; ++j) {
          const mimeTypes = mimeTypesByExt[ext.view[j]];
          if (mimeTypes) {
            mimeTypes.forEach((value) => {
              if (mimeTypesDuplicate.has(value)) {
                return;
              } else {
                mimeTypesDuplicate.add(value);
              }
              const xmlApp = xmlZone.ele('app', {name: value});
              xmlApp.ele('action', {name: 'view', ext: '', default: 'true', urlsrc: urlTemplateView}).up();
              xmlApp.ele('action', {name: 'embedview', ext: '', urlsrc: urlTemplateEmbedView}).up();
              xmlApp.ele('action', {name: 'mobileView', ext: '', urlsrc: urlTemplateMobileView}).up();
              if (ext.targetext) {
                const urlConvert = `${templateStart}/convert-and-edit/${ext.view[j]}/${ext.targetext}?${templateEnd}`;
                xmlApp.ele('action', {name: 'convert', ext: '', targetext: ext.targetext, requires: 'update', urlsrc: urlConvert}).up();
              }
              xmlApp.up();
            });
          }
        }
        mimeTypesDuplicate.clear();
        for (let j = 0; j < ext.edit.length; ++j) {
          const mimeTypes = mimeTypesByExt[ext.edit[j]];
          if (mimeTypes) {
            mimeTypes.forEach((value) => {
              if (mimeTypesDuplicate.has(value)) {
                return;
              } else {
                mimeTypesDuplicate.add(value);
              }
              const xmlApp = xmlZone.ele('app', {name: value});
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
      const xmlApp = xmlZone.ele('app', {name: 'Capabilities'});
      xmlApp.ele('action', {ext: '', name: 'getinfo', requires: 'locks,update', urlsrc: `${baseUrl}/hosting/capabilities`}).up();
      xmlApp.up();
      //end section for collabora nexcloud connectors
      const xmlDiscovery = xmlZone.up();
      if (tenWopiPublicKeyOld && tenWopiPublicKey) {
        const exponent = numberToBase64(tenWopiExponent);
        const exponentOld = numberToBase64(tenWopiExponentOld);
        xmlDiscovery.ele('proof-key', {
          oldvalue: tenWopiPublicKeyOld, oldmodulus: tenWopiModulusOld, oldexponent: exponentOld,
          value: tenWopiPublicKey, modulus: tenWopiModulus, exponent
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
    const output = {
      "convert-to": {"available": true, "endpoint":"/lool/convert-to"}, "hasMobileSupport": true, "hasProxyPrefix": false, "hasTemplateSaveAs": false,
      "hasTemplateSource": true, "productVersion": commonDefines.buildVersion
    };
    const ctx = new operationContext.Context();
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
    const obj = JSON.parse(url);
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

function isWopiJwtToken(decoded) {
  return !!decoded.fileInfo;
}
function setIsShutdown(val) {
  shutdownFlag = val;
}
function getLastModifiedTimeFromCallbacks(callbacks) {
  for (let i = callbacks.length; i >= 0; --i) {
    const callback = callbacks[i];
    const lastModifiedTime = isWopiModifiedMarker(callback);
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
      const commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, opt_url, 1);
      if (isWopiCallback(commonInfoStr)) {
        commonInfo = JSON.parse(commonInfoStr);
        if (commonInfo.fileInfo) {
          lastModifiedTime = commonInfo.fileInfo.LastModifiedTime;
          if (lastModifiedTime) {
            const callbacks = sqlBase.UserCallback.prototype.getCallbacks(ctx, opt_url);
            lastModifiedTime = getLastModifiedTimeFromCallbacks(callbacks);
          }
        } else {
          commonInfo = null;
        }
      }
    }
    wopiParams = {commonInfo, userAuth, LastModifiedTime: lastModifiedTime};
    ctx.logger.debug('parseWopiCallback wopiParams:%j', wopiParams);
  }
  return wopiParams;
}
function checkAndInvalidateCache(ctx, docId, fileInfo) {
  return co(function*() {
    const res = {success: true, lockId: undefined};
    const selectRes = yield taskResult.select(ctx, docId);
    if (selectRes.length > 0) {
      const row = selectRes[0];
      if (row.callback) {
        const commonInfoStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback, 1);
        if (isWopiCallback(commonInfoStr)) {
          const commonInfo = JSON.parse(commonInfoStr);
          res.lockId = commonInfo.lockId;
          ctx.logger.debug('wopiEditor lockId from DB lockId=%s', res.lockId);
          const unlockMarkStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback);
          ctx.logger.debug('wopiEditor commonInfoStr=%s', commonInfoStr);
          ctx.logger.debug('wopiEditor unlockMarkStr=%s', unlockMarkStr);
          const hasUnlockMarker = isWopiUnlockMarker(unlockMarkStr);
          const isUpdateVersion = commonDefines.FileStatus.UpdateVersion === row.status;
          ctx.logger.debug('wopiEditor hasUnlockMarker=%s isUpdateVersion=%s', hasUnlockMarker, isUpdateVersion);
          if (hasUnlockMarker || isUpdateVersion) {
            const fileInfoVersion = fileInfo.Version;
            const cacheVersion = commonInfo.fileInfo.Version;
            const fileInfoModified = fileInfo.LastModifiedTime;
            const cacheModified = commonInfo.fileInfo.LastModifiedTime;
            ctx.logger.debug('wopiEditor version fileInfo=%s; cache=%s', fileInfoVersion, cacheVersion);
            ctx.logger.debug('wopiEditor LastModifiedTime fileInfo=%s; cache=%s', fileInfoModified, cacheModified);
            if (fileInfoVersion !== cacheVersion || (fileInfoModified !== cacheModified)) {
              var mask = new taskResult.TaskResultData();
              mask.tenant = ctx.tenant;
              mask.key = docId;
              mask.last_open_date = row.last_open_date;
              //cleanupRes can be false in case of simultaneous opening. it is OK
              const cleanupRes = yield canvasService.cleanupCacheIf(ctx, mask);
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
    const postRes = await putFile(ctx, wopiParams, undefined, templateFileStream, templateFileInfo.size, fileInfo.UserId, false, false, false);
    if (postRes) {
      //update Size
      fileInfo.Size = templateFileInfo.size;
      const body = parsePutFileResponse(ctx, postRes);
      //collabora nexcloud connector
      if (body?.LastModifiedTime) {
        //update LastModifiedTime
        fileInfo.LastModifiedTime = body.LastModifiedTime;
      }
    }
  }
}
function createDocId(ctx, wopiSrc, mode, fileInfo) {
  const fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
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
  return docId;
}
async function preOpen(ctx, lockId, docId, fileInfo, userAuth, baseUrl, fileType) {
  //todo move to lock and common info saving to websocket connection
  //save common info
  if (undefined === lockId) {
    //Use deterministic(not random) lockId to fix issues with forgotten openings due to integrator failures
    lockId = docId;
    const commonInfo = JSON.stringify({lockId, fileInfo});
    await canvasService.commandOpenStartPromise(ctx, docId, baseUrl, commonInfo, fileType);
  }
  //Lock
  if ('view' !== userAuth.mode) {
    const lockRes = await lock(ctx, 'LOCK', lockId, fileInfo, userAuth);
    return !!lockRes;
  }
  return true;
}
function getEditorHtml(req, res) {
  return co(function*() {
    const params = {key: undefined, apiQuery: '', fileInfo: {}, userAuth: {}, queryParams: req.query, token: undefined, documentType: undefined, docs_api_config: {}};
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
      const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
      const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
      const tenWopiFileInfoBlockList = ctx.getCfg('wopi.fileInfoBlockList', cfgWopiFileInfoBlockList);

      const wopiSrc = req.query['wopisrc'];
      const fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);

      ctx.logger.info('wopiEditor start');
      ctx.logger.debug(`wopiEditor req.url:%s`, req.url);
      ctx.logger.debug(`wopiEditor req.query:%j`, req.query);
      ctx.logger.debug(`wopiEditor req.body:%j`, req.body);
      params.apiQuery = `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}`;
      params.documentType = req.params.documentType;
      let mode = req.params.mode;
      const sc = req.query['sc'];
      const hostSessionId = req.query['hid'];
      const lang = req.query['lang'];
      const ui = req.query['ui'];
      const access_token = req.body['access_token'] || "";
      const access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      const docs_api_config = req.body['docs_api_config'];
      if (docs_api_config) {
        params.docs_api_config = JSON.parse(docs_api_config);
      }


      const fileInfo = params.fileInfo = yield checkFileInfo(ctx, wopiSrc, access_token, sc);
      if (!fileInfo) {
        params.fileInfo = {};
        return;
      }
      const fileType = getFileTypeByInfo(fileInfo);
      if (!shutdownFlag) {
        yield checkAndReplaceEmptyFile(ctx, fileInfo, wopiSrc, access_token, access_token_ttl, lang, ui, fileType);
      }

      const canEdit = (fileInfo.UserCanOnlyComment || fileInfo.UserCanWrite || fileInfo.UserCanReview);
      if (!canEdit) {
        mode = 'view';
      }
      //docId
      const docId = createDocId(ctx, wopiSrc, mode, fileInfo);
      ctx.setDocId(fileId);
      ctx.logger.debug(`wopiEditor`);
      params.key = docId;
      const userAuth = params.userAuth = {
        wopiSrc, access_token, access_token_ttl,
        hostSessionId, userSessionId: docId, mode
      };

      //check and invalidate cache
      const checkRes = yield checkAndInvalidateCache(ctx, docId, fileInfo);
      if (!checkRes.success) {
        params.fileInfo = {};
        return;
      }
      if (!shutdownFlag) {
        const preOpenRes = yield preOpen(ctx, checkRes.lockId, docId, fileInfo, userAuth, utils.getBaseUrlByRequest(ctx, req), fileType);
        if (!preOpenRes) {
          params.fileInfo = {};
          return;
        }
      }

      tenWopiFileInfoBlockList.forEach((item) => {
        delete params.fileInfo[item];
      });

      if (tenTokenEnableBrowser) {
        const options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
        const secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Browser);
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
    const params = {statusHandler: undefined};
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
      const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
      const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
      const tenWopiHost = ctx.getCfg('wopi.host', cfgWopiHost);

      const wopiSrc = req.query['wopisrc'];
      const fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);
      ctx.logger.info('convert-and-edit start');

      const access_token = req.body['access_token'] || "";
      const access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      const ext = req.params.ext;
      const targetext = req.params.targetext;

      if (!(wopiSrc && access_token && access_token_ttl && ext && targetext)) {
        ctx.logger.debug('convert-and-edit invalid params: WOPISrc=%s; access_token=%s; access_token_ttl=%s; ext=%s; targetext=%s', wopiSrc, access_token, access_token_ttl, ext, targetext);
        return;
      }

      const fileInfo = yield checkFileInfo(ctx, wopiSrc, access_token);
      if (!fileInfo) {
        ctx.logger.info('convert-and-edit checkFileInfo error');
        return;
      }

      const wopiParams = getWopiParams(undefined, fileInfo, wopiSrc, access_token, access_token_ttl);

      const docId = yield converterService.convertAndEdit(ctx, wopiParams, ext, targetext);
      if (docId) {
        const baseUrl = tenWopiHost || utils.getBaseUrlByRequest(ctx, req);
        params.statusHandler = `${baseUrl}/hosting/wopi/convert-and-edit-handler`;
        params.statusHandler += `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}&access_token=${encodeURIComponent(access_token)}`;
        params.statusHandler += `&targetext=${encodeURIComponent(targetext)}&docId=${encodeURIComponent(docId)}`;
        if (tenTokenEnableBrowser) {
          const tokenData = {docId};
          const options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
          const secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Browser);
          const token = jwt.sign(tokenData, secret, options);

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
      const fileInfo = wopiParams.commonInfo.fileInfo;
      const userAuth = wopiParams.userAuth;
      const uri = `${userAuth.wopiSrc}/contents?access_token=${encodeURIComponent(userAuth.access_token)}`;
      const filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return postRes;
      }

      //collabora nexcloud connector sets only UserCanWrite=true
      const canEdit = (fileInfo.UserCanOnlyComment || fileInfo.UserCanWrite || fileInfo.UserCanReview);
      if (fileInfo && (fileInfo.SupportsUpdate || canEdit)) {
        const commonInfo = wopiParams.commonInfo;
        //todo add all the users who contributed changes to the document in this PutFile request to X-WOPI-Editors
        const headers = {'X-WOPI-Override': 'PUT', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-Editors': userLastChangeId};
        yield wopiUtils.fillStandardHeaders(ctx, headers, uri, userAuth.access_token);
        headers['X-LOOL-WOPI-IsModifiedByUser'] = isModifiedByUser;
        headers['X-LOOL-WOPI-IsAutosave'] = isAutosave;
        headers['X-LOOL-WOPI-IsExitSave'] = isExitSave;
        if (wopiParams.LastModifiedTime) {
          //collabora nexcloud connector
          headers['X-LOOL-WOPI-Timestamp'] = wopiParams.LastModifiedTime;
        }
        headers['Content-Type'] = mime.getType(getFileTypeByInfo(fileInfo));

        ctx.logger.debug('wopi PutFile request uri=%s headers=%j', uri, headers);
        //isInJwtToken is true because it passed checkIpFilter for wopi
        const isInJwtToken = true;
        postRes = yield utils.postRequestPromise(ctx, uri, data, dataStream, dataSize, tenCallbackRequestTimeout, undefined, isInJwtToken, headers);
        ctx.logger.debug('wopi PutFile response headers=%j', postRes.response.headers);
        ctx.logger.debug('wopi PutFile response body:%s', postRes.body);
      } else {
        ctx.logger.warn('wopi SupportsUpdate = %s or canEdit = %s', fileInfo?.SupportsUpdate, canEdit);
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

      const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
      const filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return res;
      }

      const headers = {'X-WOPI-Override': 'PUT_RELATIVE', 'X-WOPI-SuggestedTarget': utf7.encode(suggestedTarget || suggestedExt)};
      if (isFileConversion) {
        headers['X-WOPI-FileConversion'] = isFileConversion;
      }
      yield wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      headers['Content-Type'] = mime.getType(suggestedExt);

      ctx.logger.debug('wopi putRelativeFile request uri=%s headers=%j', uri, headers);
      //isInJwtToken is true because it passed checkIpFilter for wopi
      const isInJwtToken = true;
      const postRes = yield utils.postRequestPromise(ctx, uri, data, dataStream, dataSize, tenCallbackRequestTimeout, undefined, isInJwtToken, headers);
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
/**
 * Renames a file using the WOPI protocol
 * @param {operationContext.Context} ctx - The operation context.
 * @param {object} wopiParams - The WOPI parameters.
 * @param {string} name - The new name for the file.
 * @returns {Promise<{Name: string}|undefined>}
 */
async function renameFile(ctx, wopiParams, name) {
  let res = undefined;
  try {
    ctx.logger.info('wopi RenameFile start');
    const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

    if (!wopiParams.userAuth || !wopiParams.commonInfo) {
      return res;
    }
    const fileInfo = wopiParams.commonInfo.fileInfo;
    const userAuth = wopiParams.userAuth;
    const uri = `${userAuth.wopiSrc}?access_token=${encodeURIComponent(userAuth.access_token)}`;
    const filterStatus = await checkIpFilter(ctx, uri);
    if (0 !== filterStatus) {
      return res;
    }

    if (fileInfo && fileInfo.SupportsRename) {
      const fileNameMaxLength = fileInfo.FileNameMaxLength || 255;
      name = name.substring(0, fileNameMaxLength);
      const commonInfo = wopiParams.commonInfo;

      const headers = {'X-WOPI-Override': 'RENAME_FILE', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-RequestedName': utf7.encode(name)};
      await wopiUtils.fillStandardHeaders(ctx, headers, uri, userAuth.access_token);

      ctx.logger.debug('wopi RenameFile request uri=%s headers=%j', uri, headers);
      //isInJwtToken is true because it passed checkIpFilter for wopi
      const isInJwtToken = true;
      const postRes = await utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, isInJwtToken, headers);
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
}

async function refreshFile(ctx, wopiParams, baseUrl) {
  let res = {};
  try {
    ctx.logger.info('wopi RefreshFile start');
    const userAuth = wopiParams.userAuth;
    if (!userAuth) {
      return;
    }
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
    const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);

    const fileInfo = await checkFileInfo(ctx, userAuth.wopiSrc, userAuth.access_token);
    const fileType = getFileTypeByInfo(fileInfo);
    const docId = createDocId(ctx, userAuth.wopiSrc, userAuth.mode, res.fileInfo);
    res.key = docId;
    res.userAuth = userAuth;
    res.fileInfo = fileInfo;
    res.queryParams = undefined;
    if (tenTokenEnableBrowser) {
      const options = {algorithm: tenTokenOutboxAlgorithm, expiresIn: tenTokenOutboxExpires};
      const secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Browser);
      res.token = jwt.sign(res, secret, options);
    }
    const checkRes = await checkAndInvalidateCache(ctx, docId, fileInfo);
    if (!checkRes.success) {
      res = {};
      return;
    }
    const preOpenRes = await preOpen(ctx, checkRes.lockId, docId, fileInfo, userAuth, baseUrl, fileType);
    if (!preOpenRes) {
      res = {};
    }
  } catch (err) {
    ctx.logger.error('wopi error RefreshFile:%s', err.stack);
  } finally {
    ctx.logger.info('wopi RefreshFile end');
  }
  return res;
}
function checkFileInfo(ctx, wopiSrc, access_token, opt_sc) {
  return co(function* () {
    let fileInfo = undefined;
    try {
      ctx.logger.info('wopi checkFileInfo start');
      const tenDownloadTimeout = ctx.getCfg('FileConverter.converter.downloadTimeout', cfgDownloadTimeout);

      const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
      const filterStatus = yield checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return fileInfo;
      }
      const headers = {};
      if (opt_sc) {
        headers['X-WOPI-SessionContext'] = opt_sc;
      }
      yield wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi checkFileInfo request uri=%s headers=%j', uri, headers);
      //isInJwtToken is true because it passed checkIpFilter for wopi
      const isInJwtToken = true;
      const getRes = yield utils.downloadUrlPromise(ctx, uri, tenDownloadTimeout, undefined, undefined, isInJwtToken, headers);
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
        const wopiSrc = userAuth.wopiSrc;
        const access_token = userAuth.access_token;
        const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
        const filterStatus = yield checkIpFilter(ctx, uri);
        if (0 !== filterStatus) {
          return false;
        }

        const headers = {"X-WOPI-Override": command, "X-WOPI-Lock": lockId};
        yield wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
        ctx.logger.debug('wopi %s request uri=%s headers=%j', command, uri, headers);
        //isInJwtToken is true because it passed checkIpFilter for wopi
        const isInJwtToken = true;
        const postRes = yield utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, isInJwtToken, headers);
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
    const fileInfo = wopiParams.commonInfo.fileInfo;
    if (fileInfo && fileInfo.SupportsLocks) {
      const wopiSrc = wopiParams.userAuth.wopiSrc;
      const lockId = wopiParams.commonInfo.lockId;
      const access_token = wopiParams.userAuth.access_token;
      const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
      const filterStatus = await checkIpFilter(ctx, uri);
      if (0 !== filterStatus) {
        return;
      }

      const headers = {"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": lockId};
      await wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi Unlock request uri=%s headers=%j', uri, headers);
      //isInJwtToken is true because it passed checkIpFilter for wopi
      const isInJwtToken = true;
      const postRes = await utils.postRequestPromise(ctx, uri, undefined, undefined, undefined, tenCallbackRequestTimeout, undefined, isInJwtToken, headers);
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

function checkIpFilter(ctx, uri){
  return co(function* () {
    const urlParsed = new URL(uri);
    const filterStatus = yield* utils.checkHostFilter(ctx, urlParsed.hostname);
    if (0 !== filterStatus) {
      ctx.logger.warn('wopi checkIpFilter error: url = %s', uri);
    }
    return filterStatus;
  });
}
function getWopiParams(lockId, fileInfo, wopiSrc, access_token, access_token_ttl) {
  const commonInfo = {lockId, fileInfo};
  const userAuth = {
    wopiSrc, access_token, access_token_ttl,
    hostSessionId: null, userSessionId: null, mode: null
  };
  return {commonInfo, userAuth, LastModifiedTime: null};
}

async function dummyCheckFileInfo(req, res) {
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
}

async function dummyGetFile(req, res) {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  try {
    await ctx.initTenantCache();

    const tenWopiDummySampleFilePath = ctx.getCfg('wopi.dummy.sampleFilePath', cfgWopiDummySampleFilePath);
    const sampleFileStat = await stat(tenWopiDummySampleFilePath);
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
exports.refreshFile = refreshFile;
exports.lock = lock;
exports.unlock = unlock;
exports.getWopiUnlockMarker = getWopiUnlockMarker;
exports.getWopiModifiedMarker = getWopiModifiedMarker;
exports.getFileTypeByInfo = getFileTypeByInfo;
exports.isWopiJwtToken = isWopiJwtToken;
exports.setIsShutdown = setIsShutdown;
exports.dummyCheckFileInfo = dummyCheckFileInfo;
exports.dummyGetFile = dummyGetFile;
exports.dummyOk = dummyOk;
