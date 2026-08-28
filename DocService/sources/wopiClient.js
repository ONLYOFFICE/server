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

const crypto = require('crypto');
const path = require('path');
const {pipeline} = require('node:stream/promises');
const {URL} = require('url');
const co = require('co');
const config = require('config');
const {createReadStream} = require('fs');
const {stat, lstat, readdir} = require('fs/promises');
const utf7 = require('utf7');
const mimeDB = require('mime-db');
const xmlbuilder2 = require('xmlbuilder2');
const utils = require('./../../Common/sources/utils');
const constants = require('./../../Common/sources/constants');
const jwtService = require('./jwtService');
const commonDefines = require('./../../Common/sources/commondefines');
const wopiUtils = require('./wopiUtils');
const wopiEgress = require('./wopiEgress');
const newFileTemplateUtils = require('./newFileTemplateUtils');
const templateLocale = require('./../../Common/sources/templateLocale');
const documentFormats = require('./../../Common/sources/documentFormats');
const operationContext = require('./../../Common/sources/operationContext');
const sqlBase = require('./databaseConnectors/baseConnector');
const taskResult = require('./taskresult');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const mime = require('mime');
const license = require('./../../Common/sources/license');

const cfgTokenOutboxAlgorithm = config.get('services.CoAuthoring.token.outbox.algorithm');
const cfgTokenOutboxExpires = config.get('services.CoAuthoring.token.outbox.expires');
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
const cfgDocumentFormatsFile = config.get('services.CoAuthoring.server.documentFormatsFile');

let templatesFolderExtsCache = null;
const templateFilesSizeCache = Object.create(null);
let shutdownFlag = false;
// domain-separates this input format from future hashed derivations, not from the arbitrary keys the old formula issued
const WOPI_DOC_ID_HASH_DOMAIN = 'wopi/doc-id/v2';

//patch mimeDB
if (!mimeDB['application/vnd.visio2013']) {
  mimeDB['application/vnd.visio2013'] = {extensions: ['vsdx', 'vstx', 'vssx', 'vsdm', 'vstm', 'vssm']};
}

const mimeTypesByExt = (function () {
  const mimeTypesByExt = {};
  for (const mimeType in mimeDB) {
    if (Object.hasOwn(mimeDB, mimeType)) {
      const val = mimeDB[mimeType];
      if (val.extensions) {
        val.extensions.forEach(value => {
          if (!mimeTypesByExt[value]) {
            mimeTypesByExt[value] = [];
          }
          mimeTypesByExt[value].push(mimeType);
        });
      }
    }
  }
  return mimeTypesByExt;
})();

async function getTemplatesFolderExts(ctx) {
  //find available template files
  if (templatesFolderExtsCache === null) {
    const tenNewFileTemplate = ctx.getCfg('services.CoAuthoring.server.newFileTemplate', cfgNewFileTemplate);
    const dirContent = await readdir(`${tenNewFileTemplate}/${constants.TEMPLATES_DEFAULT_LOCALE}/`, {withFileTypes: true});
    // the seed has a null prototype, so a lookup answers for the folder contents only and never for an inherited member
    templatesFolderExtsCache = dirContent
      .filter(dirObject => dirObject.isFile())
      .reduce((result, item) => {
        const ext = path.extname(item.name).substring(1);
        result[ext] = ext;
        return result;
      }, Object.create(null));
  }
  return templatesFolderExtsCache;
}

function discovery(req, res) {
  return co(function* () {
    const xml = xmlbuilder2.create({version: '1.0', encoding: 'utf-8'});
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('wopiDiscovery start');
      const tenWopiWopiZone = ctx.getCfg('wopi.wopiZone', cfgWopiWopiZone);
      // Get formats from JSON file, with config override if non-empty array
      const formats = yield documentFormats.getAllFormats(ctx, cfgDocumentFormatsFile);
      const getFormats = (cfgKey, cfgDefault, fileKey) => {
        const cfgValue = ctx.getCfg(cfgKey, cfgDefault);
        return Array.isArray(cfgValue) && cfgValue.length > 0 ? cfgValue : formats[fileKey];
      };
      const tenWopiPdfView = getFormats('wopi.pdfView', cfgWopiPdfView, 'pdfView');
      const tenWopiPdfEdit = getFormats('wopi.pdfEdit', cfgWopiPdfEdit, 'pdfEdit');
      const tenWopiWordView = getFormats('wopi.wordView', cfgWopiWordView, 'wordView');
      const tenWopiWordEdit = getFormats('wopi.wordEdit', cfgWopiWordEdit, 'wordEdit');
      const tenWopiCellView = getFormats('wopi.cellView', cfgWopiCellView, 'cellView');
      const tenWopiCellEdit = getFormats('wopi.cellEdit', cfgWopiCellEdit, 'cellEdit');
      const tenWopiSlideView = getFormats('wopi.slideView', cfgWopiSlideView, 'slideView');
      const tenWopiSlideEdit = getFormats('wopi.slideEdit', cfgWopiSlideEdit, 'slideEdit');
      const tenWopiDiagramView = getFormats('wopi.diagramView', cfgWopiDiagramView, 'diagramView');
      const tenWopiDiagramEdit = getFormats('wopi.diagramEdit', cfgWopiDiagramEdit, 'diagramEdit');
      const tenWopiForms = getFormats('wopi.forms', cfgWopiForms, 'forms');
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
      const names = ['Word', 'Excel', 'PowerPoint', 'Pdf'];
      const favIconUrls = [tenWopiFavIconUrlWord, tenWopiFavIconUrlCell, tenWopiFavIconUrlSlide, tenWopiFavIconUrlPdf];
      const exts = [
        {targetext: 'docx', view: tenWopiWordView, edit: tenWopiWordEdit},
        {targetext: 'xlsx', view: tenWopiCellView, edit: tenWopiCellEdit},
        {targetext: 'pptx', view: tenWopiSlideView, edit: tenWopiSlideEdit},
        {targetext: null, view: tenWopiPdfView, edit: tenWopiPdfEdit}
      ];
      const documentTypes = [`word`, `cell`, `slide`, `pdf`];
      //todo check sdkjs-ooxml addon
      const addVisio =
        (tenWopiDiagramView.length > 0 || tenWopiDiagramEdit.length > 0) &&
        (constants.PACKAGE_TYPE_OS !== license.packageType || process.env?.NODE_ENV?.startsWith('development-'));
      if (addVisio) {
        names.push('Visio');
        favIconUrls.push(tenWopiFavIconUrlDiagram);
        exts.push({targetext: null, view: tenWopiDiagramView, edit: tenWopiDiagramEdit});
        documentTypes.push(`diagram`);
      }

      const templatesFolderExtsCache = yield getTemplatesFolderExts(ctx);
      const formsExts = tenWopiForms.reduce((result, item) => {
        result[item] = item;
        return result;
      }, {});

      const templateStart = `${baseUrl}/hosting/wopi`;
      let templateEnd = `&lt;rs=DC_LLCC&amp;&gt;&lt;dchat=DISABLE_CHAT&amp;&gt;&lt;embed=EMBEDDED&amp;&gt;`;
      templateEnd += `&lt;fs=FULLSCREEN&amp;&gt;&lt;hid=HOST_SESSION_ID&amp;&gt;&lt;rec=RECORDING&amp;&gt;`;
      templateEnd += `&lt;sc=SESSION_CONTEXT&amp;&gt;&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;`;
      templateEnd += `&lt;wopisrc=WOPI_SOURCE&amp;&gt;&amp;`;
      const xmlZone = xml.ele('wopi-discovery').ele('net-zone', {name: tenWopiWopiZone});
      //start section for MS WOPI connectors
      for (let i = 0; i < names.length; ++i) {
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
          //read-only interactive preview for SharePoint details pane; reuses embedded view
          xmlApp.ele('action', {name: 'interactivepreview', ext: ext.view[j], urlsrc: urlTemplateEmbedView}).up();
          xmlApp.ele('action', {name: 'mobileView', ext: ext.view[j], urlsrc: urlTemplateMobileView}).up();
          if (ext.targetext) {
            const urlConvert = `${templateStart}/convert-and-edit/${ext.view[j]}/${ext.targetext}?${templateEnd}`;
            xmlApp.ele('action', {name: 'convert', ext: ext.view[j], targetext: ext.targetext, requires: 'update', urlsrc: urlConvert}).up();
          }
        }
        for (let j = 0; j < ext.edit.length; ++j) {
          xmlApp.ele('action', {name: 'view', ext: ext.edit[j], urlsrc: urlTemplateView}).up();
          xmlApp.ele('action', {name: 'embedview', ext: ext.edit[j], urlsrc: urlTemplateEmbedView}).up();
          //read-only interactive preview for SharePoint details pane; reuses embedded view
          xmlApp.ele('action', {name: 'interactivepreview', ext: ext.edit[j], urlsrc: urlTemplateEmbedView}).up();
          xmlApp.ele('action', {name: 'mobileView', ext: ext.edit[j], urlsrc: urlTemplateMobileView}).up();
          if (formsExts[ext.edit[j]]) {
            xmlApp.ele('action', {name: 'edit', ext: ext.edit[j], default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
            xmlApp.ele('action', {name: 'formsubmit', ext: ext.edit[j], requires: 'locks,update', urlsrc: urlTemplateFormSubmit}).up();
          } else {
            xmlApp.ele('action', {name: 'edit', ext: ext.edit[j], default: 'true', requires: 'locks,update', urlsrc: urlTemplateEdit}).up();
          }
          xmlApp.ele('action', {name: 'mobileEdit', ext: ext.edit[j], requires: 'locks,update', urlsrc: urlTemplateMobileEdit}).up();
          const editNewTemplateExt = newFileTemplateUtils.getNewFileTemplateExt(ext.edit[j]);
          if (templatesFolderExtsCache[editNewTemplateExt]) {
            xmlApp
              .ele('action', {
                name: 'editnew',
                ext: ext.edit[j],
                requires: 'locks,update',
                newext: newFileTemplateUtils.getNewFileCreatedExt(ext.edit[j]),
                urlsrc: urlTemplateEdit
              })
              .up();
          }
        }
        xmlApp.up();
      }
      //end section for MS WOPI connectors
      //start section for collabora nexcloud connectors
      for (let i = 0; i < exts.length; ++i) {
        const ext = exts[i];
        const urlTemplateView = `${templateStart}/${documentTypes[i]}/view?${templateEnd}`;
        const urlTemplateEmbedView = `${templateStart}/${documentTypes[i]}/view?embed=1&amp;${templateEnd}`;
        const urlTemplateMobileView = `${templateStart}/${documentTypes[i]}/view?mobile=1&amp;${templateEnd}`;
        const urlTemplateEdit = `${templateStart}/${documentTypes[i]}/edit?${templateEnd}`;
        const urlTemplateMobileEdit = `${templateStart}/${documentTypes[i]}/edit?mobile=1&amp;${templateEnd}`;
        const urlTemplateFormSubmit = `${templateStart}/${documentTypes[i]}/edit?formsubmit=1&amp;${templateEnd}`;
        const mimeTypesDuplicate = new Set(); //to remove duplicates for each editor(allow html for word and excel)
        for (let j = 0; j < ext.view.length; ++j) {
          const mimeTypes = mimeTypesByExt[ext.view[j]];
          if (mimeTypes) {
            mimeTypes.forEach(value => {
              if (mimeTypesDuplicate.has(value)) {
                return;
              } else {
                mimeTypesDuplicate.add(value);
              }
              const xmlApp = xmlZone.ele('app', {name: value});
              xmlApp.ele('action', {name: 'view', ext: '', default: 'true', urlsrc: urlTemplateView}).up();
              xmlApp.ele('action', {name: 'embedview', ext: '', urlsrc: urlTemplateEmbedView}).up();
              //read-only interactive preview for SharePoint details pane; reuses embedded view
              xmlApp.ele('action', {name: 'interactivepreview', ext: '', urlsrc: urlTemplateEmbedView}).up();
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
            mimeTypes.forEach(value => {
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
              const editNewTemplateExt = newFileTemplateUtils.getNewFileTemplateExt(ext.edit[j]);
              if (templatesFolderExtsCache[editNewTemplateExt]) {
                xmlApp
                  .ele('action', {
                    name: 'editnew',
                    ext: '',
                    requires: 'locks,update',
                    newext: newFileTemplateUtils.getNewFileCreatedExt(ext.edit[j]),
                    urlsrc: urlTemplateEdit
                  })
                  .up();
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
        xmlDiscovery
          .ele('proof-key', {
            oldvalue: tenWopiPublicKeyOld,
            oldmodulus: tenWopiModulusOld,
            oldexponent: exponentOld,
            value: tenWopiPublicKey,
            modulus: tenWopiModulus,
            exponent
          })
          .up();
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
  return co(function* () {
    const output = {
      'convert-to': {available: true, endpoint: '/lool/convert-to'},
      hasMobileSupport: true,
      hasProxyPrefix: false,
      hasTemplateSaveAs: false,
      hasTemplateSource: true,
      productVersion: commonDefines.buildVersion
    };
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('collaboraCapabilities start');
    } catch (err) {
      ctx.logger.error('collaboraCapabilities error:%s', err.stack);
    } finally {
      utils.fillResponseSimple(res, JSON.stringify(output), 'application/json');
      ctx.logger.info('collaboraCapabilities end');
    }
  });
}
function isWopiCallback(url) {
  return url && url.startsWith('{');
}
function isWopiUnlockMarker(url) {
  return isWopiCallback(url) && !!JSON.parse(url).unlockId;
}
function isWopiModifiedMarker(url) {
  if (isWopiCallback(url)) {
    const obj = JSON.parse(url);
    return obj.fileInfo && obj.fileInfo.LastModifiedTime;
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
  let fileType = fileInfo.BaseFileName ? fileInfo.BaseFileName.substr(fileInfo.BaseFileName.lastIndexOf('.') + 1) : '';
  fileType = fileInfo.FileExtension ? fileInfo.FileExtension.substr(1) : fileType;
  return fileType.toLowerCase();
}

/**
 * Returns WOPI spec-compliant error message for HTTP status code
 * @param {number} statusCode - HTTP status code
 * @returns {string} Error message according to WOPI specification
 */
function getWopiErrorMessage(statusCode) {
  switch (statusCode) {
    case 400:
      return 'Bad Request - malformed or invalid request';
    case 401:
      return 'Invalid access token';
    case 403:
      return 'Access forbidden';
    case 404:
      return 'Resource not found or user unauthorized';
    case 409:
      return 'Conflict - lock mismatch or file version conflict';
    case 412:
      return 'Precondition Failed - lock token mismatch';
    case 413:
      return 'Payload Too Large - file size exceeds limits';
    case 500:
      return 'Internal server error or invalid proof keys';
    case 501:
      return 'Not Implemented - operation not supported';
    case 507:
      return 'Insufficient Storage - not enough storage space';
    default:
      return 'Unknown error';
  }
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
  return co(function* () {
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
            if (fileInfoVersion !== cacheVersion || fileInfoModified !== cacheModified) {
              const mask = new taskResult.TaskResultData();
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
  let body = null;
  if (postRes?.body) {
    try {
      //collabora nexcloud connector
      body = JSON.parse(postRes.body);
    } catch (e) {
      ctx.logger.debug('wopi PutFile body parse error: %s', e.stack);
    }
  }
  return body;
}
/**
 * @param {object} fileInfo
 * @param {number} size
 * @param {object|null} info
 */
function applyFileInfo(fileInfo, size, info) {
  fileInfo.Size = size;
  if (info?.LastModifiedTime != null) {
    fileInfo.LastModifiedTime = info.LastModifiedTime;
  }
}
/**
 * @param {object} ctx
 * @param {string} lang
 * @param {string} ui
 * @param {string} fileType
 * @returns {Promise<{filePath: string, size: number, templateFileType: string}>}
 */
async function getNewFileTemplateMeta(ctx, lang, ui, fileType) {
  const tenNewFileTemplate = ctx.getCfg('services.CoAuthoring.server.newFileTemplate', cfgNewFileTemplate);
  const locales = await templateLocale.readTemplateFolders(tenNewFileTemplate);
  // Try lang first, then ui; ui is a real fallback when lang is present but unsupported.
  const locale = templateLocale.resolveTemplateLocale([lang, ui], locales, constants.TEMPLATES_DEFAULT_LOCALE);
  const templateFileType = newFileTemplateUtils.getNewFileTemplateExt(fileType);
  // the same test discovery uses to advertise editnew, so a host can only ask for a template we told it exists
  const templatesFolderExts = await getTemplatesFolderExts(ctx);
  if (!templatesFolderExts[templateFileType]) {
    throw new Error(`new file template: "${templateFileType}" is not an advertised template extension`);
  }
  const templateRoot = path.resolve(tenNewFileTemplate);
  const filePath = path.join(templateRoot, locale, `new.${templateFileType}`);
  // independent of the check above, so a later refactor that widens the accepted file type cannot reach outside the folder
  if (!filePath.startsWith(templateRoot + path.sep)) {
    throw new Error(`new file template: "${filePath}" escapes "${templateRoot}"`);
  }
  if (!templateFilesSizeCache[filePath]) {
    templateFilesSizeCache[filePath] = lstat(filePath).catch(err => {
      delete templateFilesSizeCache[filePath];
      throw err;
    });
  }
  const stat = await templateFilesSizeCache[filePath];
  return {filePath, size: stat.size, templateFileType};
}
/**
 * @param {object} ctx
 * @param {object} fileInfo
 * @param {string} wopiSrc
 * @param {string} access_token
 * @param {number} access_token_ttl
 * @param {string} lang
 * @param {string} ui
 * @param {string} fileType
 */
async function checkAndReplaceEmptyFile(ctx, fileInfo, wopiSrc, access_token, access_token_ttl, lang, ui, fileType) {
  // TODO: throw error if format not supported?
  if (fileInfo.Size !== 0 || !fileType.length) {
    return;
  }
  const {filePath, size, templateFileType} = await getNewFileTemplateMeta(ctx, lang, ui, fileType);

  // Canonical WOPI editnew flow: unlocked PutFile on zero-byte file (spec createnew).
  // X-WOPI-Lock is not included during document creation per WOPI spec.
  const wopiParams = getWopiParams(undefined, fileInfo, wopiSrc, access_token, access_token_ttl);
  const postRes = await putFile(ctx, wopiParams, undefined, createReadStream(filePath), size, fileInfo.UserId, false, false, false, {
    returnErrorDetails: true,
    contentTypeExt: templateFileType
  });

  if (!postRes?.putFileError) {
    if (postRes) {
      //update Size; collabora nexcloud connector
      applyFileInfo(fileInfo, size, parsePutFileResponse(ctx, postRes));
    }
    return;
  }

  if (postRes.statusCode !== 409) {
    ctx.logger.error('checkAndReplaceEmptyFile: PutFile failed with status=%d', postRes.statusCode);
    return;
  }

  // 409 on an unlocked zero-byte PutFile means another session already initialized the file.
  // Re-fetch to confirm and pick up the size set by the winning session.
  ctx.logger.debug(
    'checkAndReplaceEmptyFile: 409 X-WOPI-Lock=%s X-WOPI-LockFailureReason=%s',
    postRes.responseHeaders?.['x-wopi-lock'],
    postRes.responseHeaders?.['x-wopi-lockfailurereason']
  );
  const {fileInfo: updatedFileInfo} = await checkFileInfo(ctx, wopiSrc, access_token);
  if (updatedFileInfo && !updatedFileInfo.error && updatedFileInfo.Size > 0) {
    applyFileInfo(fileInfo, updatedFileInfo.Size, updatedFileInfo);
    ctx.logger.info('checkAndReplaceEmptyFile: concurrent create-new 409 resolved - file initialized by another session');
    return;
  }

  // Reread still shows Size=0: winner session is mid-write or reread failed.
  ctx.logger.warn('checkAndReplaceEmptyFile: 409 on create-new PutFile but file is still zero-byte after reread');
}
// only the fragment is dropped, because it never reaches the host; every other part of the url is what the launch named
function getWopiResourceIdentity(wopiSrc) {
  const parsed = new URL(wopiSrc);
  if ('http:' !== parsed.protocol && 'https:' !== parsed.protocol) {
    throw new TypeError(`wopiSrc is not an http(s) url: ${parsed.protocol}`);
  }
  parsed.hash = '';
  return parsed.href;
}
// the launch address identifies the document for the whole session; the working address may move with a redirect
function getDocIdIdentity(userAuth) {
  return userAuth.wopiSrcOriginal ?? userAuth.wopiSrc;
}
// a wopi host is a separate authority, so the document identity is the whole address it was launched from
function createDocId(ctx, wopiSrc, mode, fileInfo) {
  // a document nobody can address must fail the open rather than share a key with the next unusable one
  const resource = getWopiResourceIdentity(wopiSrc);
  //todo change docId to avoid empty cache after editors are gone
  // every mode other than view edits the same document, the way the rest of the flow reads it
  const isView = 'view' === mode;
  const parts = [WOPI_DOC_ID_HASH_DOMAIN, isView ? 'view' : 'edit', resource];
  if (isView) {
    // the old key interpolated the value into a string, so a numeric version keeps naming the same document
    const version = fileInfo.LastModifiedTime || fileInfo.Version;
    if (undefined === version || null === version || '' === version) {
      throw new TypeError('wopi CheckFileInfo reports no version to separate the view cache by');
    }
    parts.push(String(version));
  }
  // a fixed array of strings serializes unambiguously, so no field can be shifted into the next one
  return `wopi_${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('base64url')}`;
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
    return await lock(ctx, 'LOCK', lockId, fileInfo, userAuth);
  }
  return {error: false, statusCode: undefined};
}

/**
 * Prepares document for editing by creating document ID and validating cache
 * @param {operationContext.Context} ctx - The operation context
 * @param {Object} fileInfo - File information from WOPI
 * @param {Object} userAuth - User authentication object, carrying the launch address the document key is derived from
 * @param {string} fileType - File type
 * @param {string} baseUrl - Base URL for internal file endpoints
 * @param {Object} params - Parameters object to update
 * @returns {Promise<boolean>} Promise resolving to success result
 */
async function prepareDocumentForEditing(ctx, fileInfo, userAuth, fileType, baseUrl, params) {
  let retryInViewMode = false;

  do {
    // a redirect only moves where the file is fetched from, it never renames the document it identifies
    const docId = createDocId(ctx, getDocIdIdentity(userAuth), userAuth.mode, fileInfo);
    params.key = docId;
    if ('view' === userAuth.mode) {
      //todo rename operation requires lock
      fileInfo.SupportsRename = false;
    }

    // Check and invalidate cache
    const checkRes = await checkAndInvalidateCache(ctx, docId, fileInfo);
    if (!checkRes.success) {
      params.fileInfo = {};
      return false;
    }

    if (!shutdownFlag) {
      const preOpenRes = await preOpen(ctx, checkRes.lockId, docId, fileInfo, userAuth, baseUrl, fileType);
      if (preOpenRes.error && userAuth.mode !== 'view' && !retryInViewMode) {
        ctx.logger.warn('prepareDocumentForEditing error: lock failed, fallback to view mode');
        userAuth.mode = 'view';
        userAuth.forcedViewMode = true;
        retryInViewMode = true;
        continue;
      } else if (preOpenRes.error) {
        params.statusCode = preOpenRes.statusCode;
        return false;
      }
    }

    break;
  } while (retryInViewMode);

  return true;
}

function getEditorHtml(req, res) {
  return co(function* () {
    const params = {
      statusCode: undefined,
      key: undefined,
      apiQuery: '',
      fileInfo: {},
      userAuth: {},
      queryParams: req.query,
      token: undefined,
      documentType: undefined,
      docs_api_config: {}
    };
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
      const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
      const tenWopiFileInfoBlockList = ctx.getCfg('wopi.fileInfoBlockList', cfgWopiFileInfoBlockList);

      let wopiSrc = req.query['wopisrc'];
      const fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);
      const usid = req.query['usid'] || crypto.randomUUID();
      ctx.setUserSessionId(usid);

      ctx.logger.info('wopiEditor start');
      ctx.logger.debug(`wopiEditor req.url:%s`, req.url);
      ctx.logger.debug(`wopiEditor req.query:%j`, req.query);
      ctx.logger.debug(`wopiEditor req.body:%j`, req.body);
      params.apiQuery = `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}`;
      params.documentType = req.params.documentType;
      let mode = req.params.mode;
      const sc = req.query['sc'];
      const lang = req.query['lang'];
      const ui = req.query['ui'];
      const access_token = req.body['access_token'] || '';
      const access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      const docs_api_config = req.body['docs_api_config'];
      if (docs_api_config) {
        params.docs_api_config = JSON.parse(docs_api_config);
      }
      // Create user authentication object
      const userAuth = (params.userAuth = {
        wopiSrc,
        // kept for the lifetime of the session, so a redirect can never move the document identity
        wopiSrcOriginal: wopiSrc,
        access_token,
        access_token_ttl,
        userSessionId: usid,
        mode,
        forcedViewMode: false
      });

      const {fileInfo, redirectedWopiSrc} = yield checkFileInfo(ctx, wopiSrc, access_token, sc);
      params.fileInfo = fileInfo;
      if (!fileInfo || fileInfo.error) {
        if (fileInfo?.error) params.statusCode = fileInfo.statusCode;
        params.fileInfo = {};
        return;
      }
      if (redirectedWopiSrc) {
        ctx.logger.info('wopiEditor: updating wopiSrc after redirect %s -> %s', wopiSrc, redirectedWopiSrc);
        wopiSrc = redirectedWopiSrc;
        userAuth.wopiSrc = wopiSrc;
      }
      const fileType = getFileTypeByInfo(fileInfo);
      if (!shutdownFlag) {
        yield checkAndReplaceEmptyFile(ctx, fileInfo, wopiSrc, access_token, access_token_ttl, lang, ui, fileType);
      }

      const canEdit = fileInfo.UserCanOnlyComment || fileInfo.UserCanWrite || fileInfo.UserCanReview;
      if (!canEdit && userAuth.mode !== 'view') {
        ctx.logger.warn('wopiEditor: edit mode is not allowed, fallback to view mode');
        userAuth.mode = 'view';
        userAuth.forcedViewMode = true;
      }

      // Prepare document for editing (docId, cache validation)
      const prepareResult = yield prepareDocumentForEditing(ctx, fileInfo, userAuth, fileType, utils.getBaseUrlByRequest(ctx, req), params);
      if (!prepareResult) {
        params.fileInfo = {};
        return;
      }

      mode = userAuth.mode;
      ctx.setDocId(params.key);

      tenWopiFileInfoBlockList.forEach(item => {
        delete params.fileInfo[item];
      });

      params.token = yield jwtService.signToken(ctx, constants.JWT_PURPOSE_BROWSER_OPEN, params, tenTokenOutboxAlgorithm, tenTokenOutboxExpires);
    } catch (err) {
      ctx.logger.error('wopiEditor error: %s', err.stack);
      params.fileInfo = {};
    } finally {
      ctx.logger.debug('wopiEditor render params=%j', params);
      try {
        res.render('editor-wopi', params);
      } catch (err) {
        ctx.logger.error('wopiEditor error:%s', err.stack);
        res.sendStatus(400);
      }
      ctx.logger.info('wopiEditor end');
    }
  });
}
// sign with a key derived from the purpose so this token cannot pass as an inbox token
async function signConvertStatusToken(ctx, docId, wopiSrc) {
  const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
  const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);
  return await jwtService.signToken(ctx, constants.JWT_PURPOSE_WOPI_CONVERT, {docId, wopiSrc}, tenTokenOutboxAlgorithm, tenTokenOutboxExpires);
}
function getConverterHtml(req, res) {
  return co(function* () {
    const params = {statusHandler: undefined};
    const ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      const tenWopiHost = ctx.getCfg('wopi.host', cfgWopiHost);

      let wopiSrc = req.query['wopisrc'];
      const fileId = wopiSrc.substring(wopiSrc.lastIndexOf('/') + 1);
      ctx.setDocId(fileId);
      ctx.logger.info('convert-and-edit start');

      const access_token = req.body['access_token'] || '';
      const access_token_ttl = parseInt(req.body['access_token_ttl']) || 0;
      const ext = req.params.ext;
      const targetext = req.params.targetext;

      if (!(wopiSrc && access_token && access_token_ttl && ext && targetext)) {
        ctx.logger.debug(
          'convert-and-edit invalid params: WOPISrc=%s; hasAccessToken=%s; access_token_ttl=%s; ext=%s; targetext=%s',
          wopiSrc,
          !!access_token,
          access_token_ttl,
          ext,
          targetext
        );
        return;
      }

      const {fileInfo, redirectedWopiSrc} = yield checkFileInfo(ctx, wopiSrc, access_token);
      if (!fileInfo || fileInfo.error) {
        return;
      }
      if (redirectedWopiSrc) wopiSrc = redirectedWopiSrc;

      const wopiParams = getWopiParams(undefined, fileInfo, wopiSrc, access_token, access_token_ttl);

      const docId = yield converterService.convertAndEdit(ctx, wopiParams, ext, targetext);
      if (docId) {
        const baseUrl = tenWopiHost || utils.getBaseUrlByRequest(ctx, req);
        params.statusHandler = `${baseUrl}/hosting/wopi/convert-and-edit-handler`;
        params.statusHandler += `?${constants.SHARD_KEY_WOPI_NAME}=${encodeURIComponent(wopiSrc)}&access_token=${encodeURIComponent(access_token)}`;
        params.statusHandler += `&targetext=${encodeURIComponent(targetext)}&docId=${encodeURIComponent(docId)}`;
        const token = yield signConvertStatusToken(ctx, docId, wopiSrc);

        params.statusHandler += `&token=${encodeURIComponent(token)}`;
      }
    } catch (err) {
      ctx.logger.error('convert-and-edit error:%s', err.stack);
    } finally {
      ctx.logger.debug('convert-and-edit render params=%j', params);
      try {
        res.render('convert-and-edit-wopi', params);
      } catch (err) {
        ctx.logger.error('convert-and-edit error:%s', err.stack);
        res.sendStatus(400);
      }
      ctx.logger.info('convert-and-edit end');
    }
  });
}
function putFile(ctx, wopiParams, data, dataStream, dataSize, userLastChangeId, isModifiedByUser, isAutosave, isExitSave, optOptions) {
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
      //collabora nexcloud connector sets only UserCanWrite=true
      const canEdit = fileInfo.UserCanOnlyComment || fileInfo.UserCanWrite || fileInfo.UserCanReview;
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
        let contentTypeExt;
        if (typeof optOptions === 'object' && optOptions !== null) {
          contentTypeExt = optOptions.contentTypeExt;
        } else if (typeof optOptions === 'string') {
          contentTypeExt = optOptions;
        }
        headers['Content-Type'] = mime.getType(contentTypeExt || getFileTypeByInfo(fileInfo));

        ctx.logger.debug('wopi PutFile request uri=%s headers=%j', uri, headers);
        if (typeof dataStream === 'function') {
          const streamObj = yield dataStream();
          dataStream = streamObj.readStream;
        }
        postRes = yield wopiEgress.post(ctx, uri, {
          timeout: tenCallbackRequestTimeout,
          headers,
          data,
          dataStream,
          dataSize
        });
        ctx.logger.debug('wopi PutFile response headers=%j', postRes.response.headers);
        ctx.logger.debug('wopi PutFile response body:%s', postRes.body);
      } else {
        ctx.logger.warn('wopi SupportsUpdate = %s or canEdit = %s', fileInfo?.SupportsUpdate, canEdit);
      }
    } catch (err) {
      const errorMsg = getWopiErrorMessage(err.statusCode);
      const returnErrorDetails =
        typeof optOptions === 'object' && optOptions !== null ? optOptions.returnErrorDetails : typeof optOptions === 'boolean' && optOptions;
      if (returnErrorDetails) {
        ctx.logger.debug('wopi PutFile error status=%d (%s):%s', err.statusCode, errorMsg, err.stack);
        postRes = {putFileError: true, statusCode: err.statusCode || 0, responseHeaders: err.response?.headers};
      } else {
        ctx.logger.error('wopi PutFile error status=%d (%s):%s', err.statusCode, errorMsg, err.stack);
      }
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
      const headers = {'X-WOPI-Override': 'PUT_RELATIVE', 'X-WOPI-SuggestedTarget': utf7.encode(suggestedTarget || suggestedExt)};
      if (isFileConversion) {
        headers['X-WOPI-FileConversion'] = isFileConversion;
      }
      yield wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      headers['Content-Type'] = mime.getType(suggestedExt);

      ctx.logger.debug('wopi putRelativeFile request uri=%s headers=%j', uri, headers);
      if (typeof dataStream === 'function') {
        const streamObj = yield dataStream();
        dataStream = streamObj.readStream;
      }
      const postRes = yield wopiEgress.post(ctx, uri, {
        timeout: tenCallbackRequestTimeout,
        headers,
        data,
        dataStream,
        dataSize
      });
      ctx.logger.debug('wopi putRelativeFile response headers=%j', postRes.response.headers);
      ctx.logger.debug('wopi putRelativeFile response body:%s', postRes.body);
      res = JSON.parse(postRes.body);
    } catch (err) {
      const errorMsg = getWopiErrorMessage(err.statusCode);
      ctx.logger.error('wopi putRelativeFile error status=%d (%s):%s', err.statusCode, errorMsg, err.stack);
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
    if (fileInfo && fileInfo.SupportsRename) {
      const fileNameMaxLength = fileInfo.FileNameMaxLength || 255;
      name = name.substring(0, fileNameMaxLength);
      const commonInfo = wopiParams.commonInfo;

      const headers = {'X-WOPI-Override': 'RENAME_FILE', 'X-WOPI-Lock': commonInfo.lockId, 'X-WOPI-RequestedName': utf7.encode(name)};
      await wopiUtils.fillStandardHeaders(ctx, headers, uri, userAuth.access_token);

      ctx.logger.debug('wopi RenameFile request uri=%s headers=%j', uri, headers);
      const postRes = await wopiEgress.post(ctx, uri, {timeout: tenCallbackRequestTimeout, headers});
      ctx.logger.debug('wopi RenameFile response headers=%j body=%s', postRes.response.headers, postRes.body);
      if (postRes.body) {
        res = JSON.parse(postRes.body);
      } else {
        //sharepoint send empty body(2016 allways, 2019 with same name)
        res = {Name: name};
      }
    } else {
      ctx.logger.info('wopi SupportsRename = false');
    }
  } catch (err) {
    const errorMsg = getWopiErrorMessage(err.statusCode);
    ctx.logger.error('wopi RenameFile error status=%d (%s):%s', err.statusCode, errorMsg, err.stack);
  } finally {
    ctx.logger.info('wopi RenameFile end');
  }
  return res;
}

async function refreshFile(ctx, wopiParams, baseUrl) {
  let res;
  try {
    ctx.logger.info('wopi RefreshFile start');
    const userAuth = wopiParams.userAuth;
    if (!userAuth) {
      return;
    }
    const tenTokenOutboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.outbox.algorithm', cfgTokenOutboxAlgorithm);
    const tenTokenOutboxExpires = ctx.getCfg('services.CoAuthoring.token.outbox.expires', cfgTokenOutboxExpires);

    const {fileInfo, redirectedWopiSrc} = await checkFileInfo(ctx, userAuth.wopiSrc, userAuth.access_token);
    if (!fileInfo || fileInfo.error) {
      return;
    }
    if (redirectedWopiSrc) userAuth.wopiSrc = redirectedWopiSrc;
    const fileType = getFileTypeByInfo(fileInfo);

    res = {userAuth, fileInfo, queryParams: undefined};
    const prepareResult = await prepareDocumentForEditing(ctx, fileInfo, userAuth, fileType, baseUrl, res);
    if (!prepareResult) {
      return;
    }
    res.token = await jwtService.signToken(ctx, constants.JWT_PURPOSE_BROWSER_OPEN, res, tenTokenOutboxAlgorithm, tenTokenOutboxExpires);
  } catch (err) {
    res = undefined;
    ctx.logger.error('wopi error RefreshFile:%s', err.stack);
  } finally {
    ctx.logger.info('wopi RefreshFile end');
  }
  return res;
}
/**
 * Checks file info from WOPI server (implements CheckFileInfo operation)
 * @see https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo
 * @param {operationContext.Context} ctx - The operation context
 * @param {string} wopiSrc - The WOPI source URL
 * @param {string} access_token - Access token
 * @param {string} opt_sc - Optional session context
 * @returns {Promise<Object>} File info object or error object
 *   - Success: File info object with properties
 *   - Error: {error: true, statusCode: 401|404|500}
 */
async function checkFileInfo(ctx, wopiSrc, access_token, opt_sc) {
  try {
    ctx.logger.info('wopi checkFileInfo start');
    const tenDownloadTimeout = ctx.getCfg('FileConverter.converter.downloadTimeout', cfgDownloadTimeout);
    const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
    const headers = opt_sc ? {'X-WOPI-SessionContext': opt_sc} : {};
    await wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
    ctx.logger.debug('wopi GET request uri=%s headers=%j', uri, headers);
    const getRes = await wopiEgress.download(ctx, uri, {timeout: tenDownloadTimeout, headers, kind: 'checkFileInfo', access_token});
    let redirectedWopiSrc;
    if (getRes.wopiFinalUri !== uri) {
      const rUrl = new URL(getRes.wopiFinalUri);
      rUrl.search = '';
      redirectedWopiSrc = rUrl.toString();
      ctx.logger.info('wopi checkFileInfo redirect: %s -> %s', wopiSrc, redirectedWopiSrc);
    }
    ctx.logger.debug('wopi checkFileInfo headers=%j body=%s', getRes.response.headers, getRes.body);
    return {fileInfo: JSON.parse(getRes.body), redirectedWopiSrc};
  } catch (err) {
    ctx.logger.error('wopi checkFileInfo error status=%d (%s):%s', err.statusCode, getWopiErrorMessage(err.statusCode), err.stack);
    return {fileInfo: {error: true, statusCode: err.statusCode}};
  } finally {
    ctx.logger.info('wopi checkFileInfo end');
  }
}
async function lock(ctx, command, lockId, fileInfo, userAuth) {
  const res = {error: false, statusCode: undefined};
  try {
    ctx.logger.info('wopi %s start', command);
    const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

    if (fileInfo && fileInfo.SupportsLocks) {
      if (!userAuth) {
        res.error = true;
        return res;
      }
      const wopiSrc = userAuth.wopiSrc;
      const access_token = userAuth.access_token;
      const uri = `${wopiSrc}?access_token=${encodeURIComponent(access_token)}`;
      const headers = {'X-WOPI-Override': command, 'X-WOPI-Lock': lockId};
      await wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi %s request uri=%s headers=%j', command, uri, headers);
      const postRes = await wopiEgress.post(ctx, uri, {timeout: tenCallbackRequestTimeout, headers});
      ctx.logger.debug('wopi %s response headers=%j', command, postRes.response.headers);
    } else {
      ctx.logger.info('wopi %s SupportsLocks = false', command);
    }
  } catch (err) {
    res.error = true;
    res.statusCode = err.statusCode;
    const errorMsg = getWopiErrorMessage(err.statusCode);
    ctx.logger.error('wopi %s error status=%d (%s):%s', command, err.statusCode, errorMsg, err.stack);
  } finally {
    ctx.logger.info('wopi %s end', command);
  }
  return res;
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
      const headers = {'X-WOPI-Override': 'UNLOCK', 'X-WOPI-Lock': lockId};
      await wopiUtils.fillStandardHeaders(ctx, headers, uri, access_token);
      ctx.logger.debug('wopi Unlock request uri=%s headers=%j', uri, headers);
      const postRes = await wopiEgress.post(ctx, uri, {timeout: tenCallbackRequestTimeout, headers});
      ctx.logger.debug('wopi Unlock response headers=%j', postRes.response.headers);
    } else {
      ctx.logger.info('wopi SupportsLocks = false');
    }
    res = true;
  } catch (err) {
    const errorMsg = getWopiErrorMessage(err.statusCode);
    ctx.logger.error('wopi Unlock error status=%d (%s):%s', err.statusCode, errorMsg, err.stack);
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
  return buffer.toString('base64');
}

function getWopiParams(lockId, fileInfo, wopiSrc, access_token, access_token_ttl) {
  const commonInfo = {lockId, fileInfo};
  const userAuth = {
    wopiSrc,
    access_token,
    access_token_ttl,
    userSessionId: null,
    mode: null
  };
  return {commonInfo, userAuth, LastModifiedTime: null};
}

async function dummyCheckFileInfo(req, res) {
  //static output for performance reason
  res.json({
    BaseFileName: 'sample.docx',
    OwnerId: 'userId',
    Size: 100, //no need to set actual size for test
    UserId: 'userId', //test ignores
    UserFriendlyName: 'user',
    Version: 0,
    UserCanWrite: true,
    SupportsGetLock: true,
    SupportsLocks: true,
    SupportsUpdate: true
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

    await pipeline(createReadStream(tenWopiDummySampleFilePath), res);
  } catch (err) {
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
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

exports._checkFileInfoForTesting = checkFileInfo;
exports._getNewFileTemplateMetaForTesting = getNewFileTemplateMeta;
exports.discovery = discovery;
exports.collaboraCapabilities = collaboraCapabilities;
exports.parseWopiCallback = parseWopiCallback;
exports.getEditorHtml = getEditorHtml;
exports.getConverterHtml = getConverterHtml;
exports.signConvertStatusToken = signConvertStatusToken;
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
exports._createDocIdForTesting = createDocId;
exports._getDocIdIdentityForTesting = getDocIdIdentity;
