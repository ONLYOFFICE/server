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

const config = require('config');
const constants = require('./constants');

function InputCommand(data, copyExplicit) {
  //must be set explicitly to prevent vulnerability(downloadAs(with url) creates request to integrator with authorization)
  this['withAuthorization'] = undefined; //bool
  this['externalChangeInfo'] = undefined; //zero DB changes case: set password, undo all changes
  this['wopiParams'] = undefined;
  this['builderParams'] = undefined;
  this['userconnectiondocid'] = undefined;
  if (data) {
    this['c'] = data['c'];
    this['id'] = data['id'];
    this['userid'] = data['userid'];
    this['userindex'] = data['userindex'];
    this['username'] = data['username'];
    this['tokenSession'] = data['tokenSession'];
    this['tokenDownload'] = data['tokenDownload'];
    this['data'] = data['data'];
    this['editorid'] = data['editorid'];
    this['format'] = data['format'];
    this['url'] = data['url'];
    this['title'] = data['title'];
    this['outputformat'] = data['outputformat'];
    this['outputpath'] = data['outputpath'];
    this['savetype'] = data['savetype'];
    this['saveindex'] = data['saveindex'];
    this['codepage'] = data['codepage'];
    this['delimiter'] = data['delimiter'];
    this['delimiterChar'] = data['delimiterChar'];
    this['embeddedfonts'] = data['embeddedfonts'];
    if (data['mailmergesend']) {
      this['mailmergesend'] = new CMailMergeSendData(data['mailmergesend']);
    } else {
      this['mailmergesend'] = undefined;
    }
    if (data['thumbnail']) {
      this['thumbnail'] = new CThumbnailData(data['thumbnail']);
    } else {
      this['thumbnail'] = undefined;
    }
    if (data['textParams']) {
      this['textParams'] = new CTextParams(data['textParams']);
    } else {
      this['textParams'] = undefined;
    }
    this['status'] = data['status'];
    this['status_info'] = data['status_info'];
    this['savekey'] = data['savekey'];
    this['userconnectionid'] = data['userconnectionid'];
    this['responsekey'] = data['responsekey'];
    this['jsonparams'] = data['jsonparams'];
    this['lcid'] = data['lcid'];
    this['useractionid'] = data['useractionid'];
    this['useractionindex'] = data['useractionindex'];
    if (data['forcesave']) {
      this['forcesave'] = new CForceSaveData(data['forcesave']);
    } else {
      this['forcesave'] = undefined;
    }
    this['userdata'] = data['userdata'];
    this['formdata'] = data['formdata'];
    this['inline'] = data['inline'];
    this['password'] = data['password'];
    this['savepassword'] = data['savepassword'];
    this['withoutPassword'] = data['withoutPassword'];
    this['outputurls'] = data['outputurls'];
    this['serverVersion'] = data['serverVersion'];
    this['rediskey'] = data['rediskey'];
    this['nobase64'] = data['nobase64'];
    this['forgotten'] = data['forgotten'];
    this['status_info_in'] = data['status_info_in'];
    this['attempt'] = data['attempt'];
    this['convertToOrigin'] = data['convertToOrigin'];
    this['isSaveAs'] = data['isSaveAs'];
    this['saveAsPath'] = data['saveAsPath'];
    this['oformAsPdf'] = data['oformAsPdf'];
    if (copyExplicit) {
      this['withAuthorization'] = data['withAuthorization'];
      this['externalChangeInfo'] = data['externalChangeInfo'];
      this['wopiParams'] = data['wopiParams'];
      this['builderParams'] = data['builderParams'];
      this['userconnectiondocid'] = data['userconnectiondocid'];
      this['originformat'] = data['originformat'];
    }
  } else {
    this['c'] = undefined; //string command
    this['id'] = undefined; //string document id
    this['userid'] = undefined; //string
    this['userindex'] = undefined;
    this['username'] = undefined;
    this['tokenSession'] = undefined; //string validate
    this['tokenDownload'] = undefined; //string validate
    this['data'] = undefined; //string
    //to open
    this['editorid'] = undefined; //int
    this['format'] = undefined; //string extention
    this['url'] = undefined; //string
    this['title'] = undefined; //string filename
    // to save
    this['outputformat'] = undefined; //int
    this['outputpath'] = undefined; //int internal
    this['savetype'] = undefined; //int part type
    this['saveindex'] = undefined; //int part index
    //nullable
    this['codepage'] = undefined;
    this['delimiter'] = undefined;
    this['delimiterChar'] = undefined;
    this['embeddedfonts'] = undefined; //bool
    this['mailmergesend'] = undefined;
    this['thumbnail'] = undefined;
    //private
    this['status'] = undefined; //int
    this['status_info'] = undefined; //int
    this['savekey'] = undefined; //int document id to save
    this['userconnectionid'] = undefined; //string internal
    this['responsekey'] = undefined;
    this['jsonparams'] = undefined; //string
    this['lcid'] = undefined;
    this['useractionid'] = undefined;
    this['useractionindex'] = undefined;
    this['forcesave'] = undefined;
    this['userdata'] = undefined;
    this['formdata'] = undefined;
    this['inline'] = undefined; //content disposition
    this['password'] = undefined;
    this['savepassword'] = undefined;
    this['withoutPassword'] = undefined;
    this['outputurls'] = undefined;
    this['serverVersion'] = undefined;
    this['rediskey'] = undefined;
    this['nobase64'] = true;
    this['forgotten'] = undefined;
    this['status_info_in'] = undefined;
    this['attempt'] = undefined;
    this['convertToOrigin'] = undefined;
    this['originformat'] = undefined;
    this['isSaveAs'] = undefined;
    this['saveAsPath'] = undefined;
    this['oformAsPdf'] = undefined;
  }
}
InputCommand.prototype = {
  fillFromConnection(conn) {
    this['id'] = conn.docId;
  },
  getCommand() {
    return this['c'];
  },
  setCommand(data) {
    this['c'] = data;
  },
  getDocId() {
    return this['id'];
  },
  setDocId(data) {
    this['id'] = data;
  },
  getUserId() {
    return this['userid'];
  },
  setUserId(data) {
    this['userid'] = data;
  },
  getUserIndex() {
    return this['userindex'];
  },
  setUserIndex(data) {
    this['userindex'] = data;
  },
  getUserName() {
    return this['username'];
  },
  setUserName(data) {
    this['username'] = data;
  },
  getTokenSession() {
    return this['tokenSession'];
  },
  getTokenDownload() {
    return this['tokenDownload'];
  },
  getData() {
    return this['data'];
  },
  setData(data) {
    this['data'] = data;
  },
  getFormat() {
    return this['format'];
  },
  setFormat(data) {
    this['format'] = data;
  },
  getOriginFormat() {
    return this['originformat'];
  },
  setOriginFormat(data) {
    this['originformat'] = data;
  },
  getUrl() {
    return this['url'];
  },
  setUrl(data) {
    this['url'] = data;
  },
  getTitle() {
    return this['title'];
  },
  setTitle(data) {
    this['title'] = data;
  },
  getOutputFormat() {
    return this['outputformat'];
  },
  setOutputFormat(data) {
    this['outputformat'] = data;
  },
  getOutputPath() {
    return this['outputpath'];
  },
  setOutputPath(data) {
    this['outputpath'] = data;
  },
  getSaveType() {
    return this['savetype'];
  },
  setSaveType(data) {
    this['savetype'] = data;
  },
  getSaveIndex() {
    return this['saveindex'];
  },
  setSaveIndex(data) {
    this['saveindex'] = data;
  },
  getCodepage() {
    return this['codepage'];
  },
  setCodepage(data) {
    this['codepage'] = data;
  },
  getDelimiter() {
    return this['delimiter'];
  },
  setDelimiter(data) {
    this['delimiter'] = data;
  },
  getDelimiterChar() {
    return this['delimiterChar'];
  },
  setDelimiterChar(data) {
    this['delimiterChar'] = data;
  },
  getEmbeddedFonts() {
    return this['embeddedfonts'];
  },
  setEmbeddedFonts(data) {
    this['embeddedfonts'] = data;
  },
  getMailMergeSend() {
    return this['mailmergesend'];
  },
  setMailMergeSend(data) {
    this['mailmergesend'] = data;
  },
  getThumbnail() {
    return this['thumbnail'];
  },
  setThumbnail(data) {
    this['thumbnail'] = data;
  },
  getTextParams() {
    return this['textParams'];
  },
  setTextParams(data) {
    this['textParams'] = data;
  },
  getStatus() {
    return this['status'];
  },
  setStatus(data) {
    this['status'] = data;
  },
  getStatusInfo() {
    return this['status_info'];
  },
  setStatusInfo(data) {
    this['status_info'] = data;
  },
  getSaveKey() {
    return this['savekey'];
  },
  setSaveKey(data) {
    this['savekey'] = data;
  },
  getForgotten() {
    return this['forgotten'];
  },
  setForgotten(data) {
    this['forgotten'] = data;
  },
  getUserConnectionId() {
    return this['userconnectionid'];
  },
  setUserConnectionId(data) {
    this['userconnectionid'] = data;
  },
  getUserConnectionDocId() {
    return this['userconnectiondocid'];
  },
  setUserConnectionDocId(data) {
    this['userconnectiondocid'] = data;
  },
  getResponseKey() {
    return this['responsekey'];
  },
  setResponseKey(data) {
    this['responsekey'] = data;
  },
  getJsonParams() {
    return this['jsonparams'];
  },
  appendJsonParams(data) {
    if (this['jsonparams']) {
      config.util.extendDeep(this['jsonparams'], data);
    } else {
      this['jsonparams'] = data;
    }
  },
  getLCID() {
    return this['lcid'];
  },
  setLCID(data) {
    this['lcid'] = data;
  },
  getUserActionId() {
    return this['useractionid'];
  },
  setUserActionId(data) {
    this['useractionid'] = data;
  },
  getUserActionIndex() {
    return this['useractionindex'];
  },
  setUserActionIndex(data) {
    this['useractionindex'] = data;
  },
  /**
   * @return {CForceSaveData | null}
   */
  getForceSave() {
    return this['forcesave'];
  },
  /**
   * @param {CForceSaveData} data
   */
  setForceSave(data) {
    this['forcesave'] = data;
  },
  getUserData() {
    return this['userdata'];
  },
  setUserData(data) {
    this['userdata'] = data;
  },
  getFormData() {
    return this['formdata'];
  },
  setFormData(data) {
    this['formdata'] = data;
  },
  getInline() {
    return this['inline'];
  },
  setInline(data) {
    this['inline'] = data;
  },
  getPassword() {
    return this['password'];
  },
  setPassword(data) {
    this['password'] = data;
  },
  getSavePassword() {
    return this['savepassword'];
  },
  setSavePassword(data) {
    this['savepassword'] = data;
  },
  getWithoutPassword() {
    return this['withoutPassword'];
  },
  setWithoutPassword(data) {
    this['withoutPassword'] = data;
  },
  setOutputUrls(data) {
    this['outputurls'] = data;
  },
  getOutputUrls() {
    return this['outputurls'];
  },
  getServerVersion() {
    return this['serverVersion'];
  },
  setServerVersion(data) {
    this['serverVersion'] = data;
  },
  getRedisKey() {
    return this['rediskey'];
  },
  setRedisKey(data) {
    this['rediskey'] = data;
  },
  getNoBase64() {
    return this['nobase64'];
  },
  setNoBase64(data) {
    this['nobase64'] = data;
  },
  getStatusInfoIn() {
    return this['status_info_in'];
  },
  setStatusInfoIn(data) {
    this['status_info_in'] = data;
  },
  getAttempt() {
    return this['attempt'];
  },
  setAttempt(data) {
    this['attempt'] = data;
  },
  getWithAuthorization() {
    return this['withAuthorization'];
  },
  setWithAuthorization(data) {
    this['withAuthorization'] = data;
  },
  getExternalChangeInfo() {
    return this['externalChangeInfo'];
  },
  setExternalChangeInfo(data) {
    this['externalChangeInfo'] = data;
  },
  getBuilderParams() {
    return this['builderParams'];
  },
  setBuilderParams(data) {
    this['builderParams'] = data;
  },
  getWopiParams() {
    return this['wopiParams'];
  },
  setWopiParams(data) {
    this['wopiParams'] = data;
  },
  getConvertToOrigin() {
    return this['convertToOrigin'];
  },
  setConvertToOrigin(data) {
    this['convertToOrigin'] = data;
  },
  getIsSaveAs() {
    return this['isSaveAs'];
  },
  setIsSaveAs(data) {
    this['isSaveAs'] = data;
  },
  getSaveAsPath() {
    return this['saveAsPath'];
  },
  setSaveAsPath(data) {
    this['saveAsPath'] = data;
  },
  getOformAsPdf() {
    return this['oformAsPdf'];
  },
  setOformAsPdf(data) {
    this['oformAsPdf'] = data;
  }
};

function CForceSaveData(obj) {
  if (obj) {
    this['type'] = obj['type'];
    this['time'] = obj['time'];
    this['index'] = obj['index'];
    this['authoruserid'] = obj['authoruserid'];
    this['authoruserindex'] = obj['authoruserindex'];
  } else {
    this['type'] = null;
    this['time'] = null;
    this['index'] = null;
    this['authoruserid'] = null;
    this['authoruserindex'] = null;
  }
}
CForceSaveData.prototype.getType = function () {
  return this['type'];
};
CForceSaveData.prototype.setType = function (v) {
  this['type'] = v;
};
CForceSaveData.prototype.getTime = function () {
  return this['time'];
};
CForceSaveData.prototype.setTime = function (v) {
  this['time'] = v;
};
CForceSaveData.prototype.getIndex = function () {
  return this['index'];
};
CForceSaveData.prototype.setIndex = function (v) {
  this['index'] = v;
};
CForceSaveData.prototype.getAuthorUserId = function () {
  return this['authoruserid'];
};
CForceSaveData.prototype.setAuthorUserId = function (v) {
  this['authoruserid'] = v;
};
CForceSaveData.prototype.getAuthorUserIndex = function () {
  return this['authoruserindex'];
};
CForceSaveData.prototype.setAuthorUserIndex = function (v) {
  this['authoruserindex'] = v;
};

function CThumbnailData(obj) {
  if (obj) {
    this['format'] = obj['format'];
    this['aspect'] = obj['aspect'];
    this['first'] = obj['first'];
    this['width'] = obj['width'];
    this['height'] = obj['height'];
  } else {
    this['format'] = null;
    this['aspect'] = null;
    this['first'] = null;
    this['width'] = null;
    this['height'] = null;
  }
}
CThumbnailData.prototype.getFormat = function () {
  return this['format'];
};
CThumbnailData.prototype.setFormat = function (v) {
  this['format'] = v;
};
CThumbnailData.prototype.getAspect = function () {
  return this['aspect'];
};
CThumbnailData.prototype.setAspect = function (v) {
  this['aspect'] = v;
};
CThumbnailData.prototype.getFirst = function () {
  return this['first'];
};
CThumbnailData.prototype.setFirst = function (v) {
  this['first'] = v;
};
CThumbnailData.prototype.getWidth = function () {
  return this['width'];
};
CThumbnailData.prototype.setWidth = function (v) {
  this['width'] = v;
};
CThumbnailData.prototype.getHeight = function () {
  return this['height'];
};
CThumbnailData.prototype.setHeight = function (v) {
  this['height'] = v;
};
function CTextParams(obj) {
  if (obj) {
    this['association'] = obj['association'];
  } else {
    this['association'] = null;
  }
}
CTextParams.prototype.getAssociation = function () {
  return this['association'];
};
CTextParams.prototype.setAssociation = function (v) {
  this['association'] = v;
};

function CMailMergeSendData(obj) {
  if (obj) {
    this['from'] = obj['from'];
    this['to'] = obj['to'];
    this['subject'] = obj['subject'];
    this['mailFormat'] = obj['mailFormat'];
    this['fileName'] = obj['fileName'];
    this['message'] = obj['message'];
    this['recordFrom'] = obj['recordFrom'];
    this['recordTo'] = obj['recordTo'];
    this['recordCount'] = obj['recordCount'];
    this['recordErrorCount'] = obj['recordErrorCount'];
    this['userId'] = obj['userId'];
    this['url'] = obj['url'];
    this['baseUrl'] = obj['baseUrl'];
    this['jsonkey'] = obj['jsonkey'];
    this['isJson'] = obj['isJson'];
  } else {
    this['from'] = null;
    this['to'] = null;
    this['subject'] = null;
    this['mailFormat'] = null;
    this['fileName'] = null;
    this['message'] = null;
    this['recordFrom'] = null;
    this['recordTo'] = null;
    this['recordCount'] = null;
    this['recordErrorCount'] = null;
    this['userId'] = null;
    this['url'] = null;
    this['baseUrl'] = null;
    this['jsonkey'] = null;
    this['isJson'] = null;
  }
}
CMailMergeSendData.prototype.getFrom = function () {
  return this['from'];
};
CMailMergeSendData.prototype.setFrom = function (v) {
  this['from'] = v;
};
CMailMergeSendData.prototype.getTo = function () {
  return this['to'];
};
CMailMergeSendData.prototype.setTo = function (v) {
  this['to'] = v;
};
CMailMergeSendData.prototype.getSubject = function () {
  return this['subject'];
};
CMailMergeSendData.prototype.setSubject = function (v) {
  this['subject'] = v;
};
CMailMergeSendData.prototype.getMailFormat = function () {
  return this['mailFormat'];
};
CMailMergeSendData.prototype.setMailFormat = function (v) {
  this['mailFormat'] = v;
};
CMailMergeSendData.prototype.getFileName = function () {
  return this['fileName'];
};
CMailMergeSendData.prototype.setFileName = function (v) {
  this['fileName'] = v;
};
CMailMergeSendData.prototype.getMessage = function () {
  return this['message'];
};
CMailMergeSendData.prototype.setMessage = function (v) {
  this['message'] = v;
};
CMailMergeSendData.prototype.getRecordFrom = function () {
  return this['recordFrom'];
};
CMailMergeSendData.prototype.setRecordFrom = function (v) {
  this['recordFrom'] = v;
};
CMailMergeSendData.prototype.getRecordTo = function () {
  return this['recordTo'];
};
CMailMergeSendData.prototype.setRecordTo = function (v) {
  this['recordTo'] = v;
};
CMailMergeSendData.prototype.getRecordCount = function () {
  return this['recordCount'];
};
CMailMergeSendData.prototype.setRecordCount = function (v) {
  this['recordCount'] = v;
};
CMailMergeSendData.prototype.getRecordErrorCount = function () {
  return this['recordErrorCount'];
};
CMailMergeSendData.prototype.setRecordErrorCount = function (v) {
  this['recordErrorCount'] = v;
};
CMailMergeSendData.prototype.getUserId = function () {
  return this['userId'];
};
CMailMergeSendData.prototype.setUserId = function (v) {
  this['userId'] = v;
};
CMailMergeSendData.prototype.getUrl = function () {
  return this['url'];
};
CMailMergeSendData.prototype.setUrl = function (v) {
  this['url'] = v;
};
CMailMergeSendData.prototype.getBaseUrl = function () {
  return this['baseUrl'];
};
CMailMergeSendData.prototype.setBaseUrl = function (v) {
  this['baseUrl'] = v;
};
CMailMergeSendData.prototype.getJsonKey = function () {
  return this['jsonkey'];
};
CMailMergeSendData.prototype.setJsonKey = function (v) {
  this['jsonkey'] = v;
};
CMailMergeSendData.prototype.getIsJsonKey = function () {
  return this['isJson'];
};
CMailMergeSendData.prototype.setIsJsonKey = function (v) {
  this['isJson'] = v;
};
function TaskQueueData(data) {
  if (data) {
    this['ctx'] = data['ctx'];
    this['cmd'] = new InputCommand(data['cmd'], true);
    this['toFile'] = data['toFile'];
    this['fromOrigin'] = data['fromOrigin'];
    this['fromSettings'] = data['fromSettings'];
    this['fromChanges'] = data['fromChanges'];
    this['paid'] = data['paid'];

    this['dataKey'] = data['dataKey'];
    this['visibilityTimeout'] = data['visibilityTimeout'];
  } else {
    this['ctx'] = undefined;
    this['cmd'] = undefined;
    this['toFile'] = undefined;
    this['fromOrigin'] = undefined;
    this['fromSettings'] = undefined;
    this['fromChanges'] = undefined;
    this['paid'] = undefined;

    this['dataKey'] = undefined;
    this['visibilityTimeout'] = undefined;
  }
}
TaskQueueData.prototype = {
  getCtx() {
    return this['ctx'];
  },
  setCtx(data) {
    return (this['ctx'] = data);
  },
  getCmd() {
    return this['cmd'];
  },
  setCmd(data) {
    return (this['cmd'] = data);
  },
  getToFile() {
    return this['toFile'];
  },
  setToFile(data) {
    return (this['toFile'] = data);
  },
  getFromOrigin() {
    return this['fromOrigin'];
  },
  setFromOrigin(data) {
    return (this['fromOrigin'] = data);
  },
  getFromSettings() {
    return this['fromSettings'];
  },
  setFromSettings(data) {
    return (this['fromSettings'] = data);
  },
  getFromChanges() {
    return this['fromChanges'];
  },
  setFromChanges(data) {
    return (this['fromChanges'] = data);
  },
  getPaid() {
    return this['paid'];
  },
  setPaid(data) {
    return (this['paid'] = data);
  },
  getDataKey() {
    return this['dataKey'];
  },
  setDataKey(data) {
    return (this['dataKey'] = data);
  },
  getVisibilityTimeout() {
    return this['visibilityTimeout'];
  },
  setVisibilityTimeout(data) {
    return (this['visibilityTimeout'] = data);
  }
};

function OutputSfcData(key) {
  this['key'] = key;
  this['status'] = undefined;
  this['url'] = undefined;
  this['changesurl'] = undefined;
  this['history'] = undefined;
  this['users'] = undefined;
  this['actions'] = undefined;
  this['mailMerge'] = undefined;
  this['userdata'] = undefined;
  this['formdata'] = undefined;
  this['lastsave'] = undefined;
  this['notmodified'] = undefined;
  this['forcesavetype'] = undefined;
  this['encrypted'] = undefined;

  this['token'] = undefined;
}
OutputSfcData.prototype.getKey = function () {
  return this['key'];
};
OutputSfcData.prototype.setKey = function (data) {
  return (this['key'] = data);
};
OutputSfcData.prototype.getStatus = function () {
  return this['status'];
};
OutputSfcData.prototype.setStatus = function (data) {
  return (this['status'] = data);
};
OutputSfcData.prototype.getUrl = function () {
  return this['url'];
};
OutputSfcData.prototype.setUrl = function (data) {
  return (this['url'] = data);
};
OutputSfcData.prototype.getExtName = function () {
  return this['filetype'];
};
OutputSfcData.prototype.setExtName = function (data) {
  return (this['filetype'] = data.substring(1));
};
OutputSfcData.prototype.getChangeUrl = function () {
  return this['changesurl'];
};
OutputSfcData.prototype.setChangeUrl = function (data) {
  return (this['changesurl'] = data);
};
OutputSfcData.prototype.getChangeHistory = function () {
  return this['history'];
};
OutputSfcData.prototype.setChangeHistory = function (data) {
  return (this['history'] = data);
};
OutputSfcData.prototype.getUsers = function () {
  return this['users'];
};
OutputSfcData.prototype.setUsers = function (data) {
  return (this['users'] = data);
};
OutputSfcData.prototype.getMailMerge = function () {
  return this['mailMerge'];
};
OutputSfcData.prototype.setMailMerge = function (data) {
  return (this['mailMerge'] = data);
};
OutputSfcData.prototype.getActions = function () {
  return this['actions'];
};
OutputSfcData.prototype.setActions = function (data) {
  return (this['actions'] = data);
};
OutputSfcData.prototype.getUserData = function () {
  return this['userdata'];
};
OutputSfcData.prototype.setUserData = function (data) {
  return (this['userdata'] = data);
};
OutputSfcData.prototype.getFormsDataUrl = function () {
  return this['formsdataurl'];
};
OutputSfcData.prototype.setFormsDataUrl = function (data) {
  return (this['formsdataurl'] = data);
};
OutputSfcData.prototype.getLastSave = function () {
  return this['lastsave'];
};
OutputSfcData.prototype.setLastSave = function (v) {
  this['lastsave'] = v;
};
OutputSfcData.prototype.getNotModified = function () {
  return this['notmodified'];
};
OutputSfcData.prototype.setNotModified = function (v) {
  this['notmodified'] = v;
};
OutputSfcData.prototype.getForceSaveType = function () {
  return this['forcesavetype'];
};
OutputSfcData.prototype.setForceSaveType = function (v) {
  this['forcesavetype'] = v;
};
OutputSfcData.prototype.getEncrypted = function () {
  return this['encrypted'];
};
OutputSfcData.prototype.setEncrypted = function (v) {
  this['encrypted'] = v;
};
OutputSfcData.prototype.getToken = function () {
  return this['token'];
};
OutputSfcData.prototype.setToken = function (v) {
  this['token'] = v;
};

function OutputMailMerge(mailMergeSendData) {
  if (mailMergeSendData) {
    this['from'] = mailMergeSendData.getFrom();
    this['message'] = mailMergeSendData.getMessage();
    this['subject'] = mailMergeSendData.getSubject();
    this['title'] = mailMergeSendData.getFileName();
    const mailFormat = mailMergeSendData.getMailFormat();
    switch (mailFormat) {
      case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML:
        this['type'] = 0;
        break;
      case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX:
        this['type'] = 1;
        break;
      case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF:
        this['type'] = 2;
        break;
      default:
        this['type'] = 0;
        break;
    }
    this['recordCount'] = mailMergeSendData.getRecordCount();
    this['recordErrorCount'] = mailMergeSendData.getRecordErrorCount();
    this['to'] = null;
    this['recordIndex'] = null;
  } else {
    this['from'] = null;
    this['message'] = null;
    this['subject'] = null;
    this['title'] = null;
    this['to'] = null;
    this['type'] = null;
    this['recordCount'] = null;
    this['recordIndex'] = null;
    this['recordErrorCount'] = null;
  }
}
OutputMailMerge.prototype.getRecordIndex = function () {
  return this['recordIndex'];
};
OutputMailMerge.prototype.setRecordIndex = function (data) {
  return (this['recordIndex'] = data);
};
OutputMailMerge.prototype.getRecordErrorCount = function () {
  return this['recordErrorCount'];
};
OutputMailMerge.prototype.setRecordErrorCount = function (data) {
  return (this['recordErrorCount'] = data);
};
OutputMailMerge.prototype.getTo = function () {
  return this['to'];
};
OutputMailMerge.prototype.setTo = function (data) {
  return (this['to'] = data);
};
function OutputAction(type, userid) {
  this['type'] = type;
  this['userid'] = userid;
}

function ConvertStatus(err, url, filetype) {
  this.err = err;
  this.url = url;
  this.filetype = filetype;
  this.end = !!url;
}
ConvertStatus.prototype.setExtName = function (extname) {
  this.filetype = extname.substring(1);
};
ConvertStatus.prototype.setUrl = function (url) {
  this.url = url;
  this.end = true;
};
const c_oPublishType = {
  drop: 0,
  releaseLock: 1,
  participantsState: 2,
  message: 3,
  getLock: 4,
  changes: 5,
  auth: 6,
  receiveTask: 7,
  warning: 8,
  cursor: 9,
  shutdown: 10,
  meta: 11,
  forceSave: 12,
  closeConnection: 13,
  changesNotify: 14,
  changeConnecitonInfo: 15,
  rpc: 16,
  updateVersion: 17
};
const c_oAscCsvDelimiter = {
  None: 0,
  Tab: 1,
  Semicolon: 2,
  Colon: 3,
  Comma: 4,
  Space: 5
};
const c_oAscEncodings = [
  [0, 28596, 'ISO-8859-6', 'Arabic (ISO 8859-6)'],
  [1, 720, 'DOS-720', 'Arabic (OEM 720)'],
  [2, 1256, 'windows-1256', 'Arabic (Windows)'],

  [3, 28594, 'ISO-8859-4', 'Baltic (ISO 8859-4)'],
  [4, 28603, 'ISO-8859-13', 'Baltic (ISO 8859-13)'],
  [5, 775, 'IBM775', 'Baltic (OEM 775)'],
  [6, 1257, 'windows-1257', 'Baltic (Windows)'],

  [7, 28604, 'ISO-8859-14', 'Celtic (ISO 8859-14)'],

  [8, 28595, 'ISO-8859-5', 'Cyrillic (ISO 8859-5)'],
  [9, 20866, 'KOI8-R', 'Cyrillic (KOI8-R)'],
  [10, 21866, 'KOI8-U', 'Cyrillic (KOI8-U)'],
  [11, 10007, 'x-mac-cyrillic', 'Cyrillic (Mac)'],
  [12, 855, 'IBM855', 'Cyrillic (OEM 855)'],
  [13, 866, 'cp866', 'Cyrillic (OEM 866)'],
  [14, 1251, 'windows-1251', 'Cyrillic (Windows)'],

  [15, 852, 'IBM852', 'Central European (OEM 852)'],
  [16, 1250, 'windows-1250', 'Central European (Windows)'],

  [17, 950, 'Big5', 'Chinese (Big5 Traditional)'],
  [18, 936, 'GB2312', 'Central (GB2312 Simplified)'],

  [19, 28592, 'ISO-8859-2', 'Eastern European (ISO 8859-2)'],

  [20, 28597, 'ISO-8859-7', 'Greek (ISO 8859-7)'],
  [21, 737, 'IBM737', 'Greek (OEM 737)'],
  [22, 869, 'IBM869', 'Greek (OEM 869)'],
  [23, 1253, 'windows-1253', 'Greek (Windows)'],

  [24, 28598, 'ISO-8859-8', 'Hebrew (ISO 8859-8)'],
  [25, 862, 'DOS-862', 'Hebrew (OEM 862)'],
  [26, 1255, 'windows-1255', 'Hebrew (Windows)'],

  [27, 932, 'Shift_JIS', 'Japanese (Shift-JIS)'],

  [28, 949, 'KS_C_5601-1987', 'Korean (Windows)'],
  [29, 51949, 'EUC-KR', 'Korean (EUC)'],

  [30, 861, 'IBM861', 'North European (Icelandic OEM 861)'],
  [31, 865, 'IBM865', 'North European (Nordic OEM 865)'],

  [32, 874, 'windows-874', 'Thai (TIS-620)'],

  [33, 28593, 'ISO-8859-3', 'Turkish (ISO 8859-3)'],
  [34, 28599, 'ISO-8859-9', 'Turkish (ISO 8859-9)'],
  [35, 857, 'IBM857', 'Turkish (OEM 857)'],
  [36, 1254, 'windows-1254', 'Turkish (Windows)'],

  [37, 28591, 'ISO-8859-1', 'Western European (ISO-8859-1)'],
  [38, 28605, 'ISO-8859-15', 'Western European (ISO-8859-15)'],
  [39, 850, 'IBM850', 'Western European (OEM 850)'],
  [40, 858, 'IBM858', 'Western European (OEM 858)'],
  [41, 860, 'IBM860', 'Western European (OEM 860 : Portuguese)'],
  [42, 863, 'IBM863', 'Western European (OEM 863 : French)'],
  [43, 437, 'IBM437', 'Western European (OEM-US)'],
  [44, 1252, 'windows-1252', 'Western European (Windows)'],

  [45, 1258, 'windows-1258', 'Vietnamese (Windows)'],

  [46, 65001, 'UTF-8', 'Unicode (UTF-8)'],
  [47, 65000, 'UTF-7', 'Unicode (UTF-7)'],

  [48, 1200, 'UTF-16', 'Unicode (UTF-16)'],
  [49, 1201, 'UTF-16BE', 'Unicode (UTF-16 Big Endian)'],

  [50, 12000, 'UTF-32', 'Unicode (UTF-32)'],
  [51, 12001, 'UTF-32BE', 'Unicode (UTF-32 Big Endian)']
];
const c_oAscEncodingsMap = {
  437: 43,
  720: 1,
  737: 21,
  775: 5,
  850: 39,
  852: 15,
  855: 12,
  857: 35,
  858: 40,
  860: 41,
  861: 30,
  862: 25,
  863: 42,
  865: 31,
  866: 13,
  869: 22,
  874: 32,
  932: 27,
  936: 18,
  949: 28,
  950: 17,
  1200: 48,
  1201: 49,
  1250: 16,
  1251: 14,
  1252: 44,
  1253: 23,
  1254: 36,
  1255: 26,
  1256: 2,
  1257: 6,
  1258: 45,
  10007: 11,
  12000: 50,
  12001: 51,
  20866: 9,
  21866: 10,
  28591: 37,
  28592: 19,
  28593: 33,
  28594: 3,
  28595: 8,
  28596: 0,
  28597: 20,
  28598: 24,
  28599: 34,
  28603: 4,
  28604: 7,
  28605: 38,
  51949: 29,
  65000: 47,
  65001: 46
};
const c_oAscCodePageUtf8 = 46; //65001
const c_oAscUserAction = {
  Out: 0,
  In: 1,
  ForceSaveButton: 2
};
const c_oAscServerCommandErrors = {
  NoError: 0,
  DocumentIdError: 1,
  ParseError: 2,
  UnknownError: 3,
  NotModified: 4,
  UnknownCommand: 5,
  Token: 6,
  TokenExpire: 7
};
const c_oAscForceSaveTypes = {
  Command: 0,
  Button: 1,
  Timeout: 2,
  Form: 3,
  Internal: 4
};
const c_oAscUrlTypes = {
  Session: 0,
  Temporary: 1
};
const c_oAscSecretType = {
  Browser: 0,
  Inbox: 1,
  Outbox: 2,
  Session: 3
};
const c_oAscQueueType = {
  rabbitmq: 'rabbitmq',
  activemq: 'activemq'
};
const c_oAscUnlockRes = {
  Locked: 0,
  Unlocked: 1,
  Empty: 2
};
const FileStatus = {
  None: 0,
  Ok: 1,
  WaitQueue: 2,
  NeedParams: 3,
  Err: 5,
  ErrToReload: 6,
  SaveVersion: 7,
  UpdateVersion: 8,
  NeedPassword: 9
};

const buildVersion = '4.1.2';
const buildNumber = 37;

exports.TaskQueueData = TaskQueueData;
exports.CMailMergeSendData = CMailMergeSendData;
exports.CThumbnailData = CThumbnailData;
exports.CTextParams = CTextParams;
exports.CForceSaveData = CForceSaveData;
exports.InputCommand = InputCommand;
exports.OutputSfcData = OutputSfcData;
exports.OutputMailMerge = OutputMailMerge;
exports.OutputAction = OutputAction;
exports.ConvertStatus = ConvertStatus;
exports.c_oPublishType = c_oPublishType;
exports.c_oAscCsvDelimiter = c_oAscCsvDelimiter;
exports.c_oAscEncodings = c_oAscEncodings;
exports.c_oAscEncodingsMap = c_oAscEncodingsMap;
exports.c_oAscCodePageUtf8 = c_oAscCodePageUtf8;
exports.c_oAscUserAction = c_oAscUserAction;
exports.c_oAscServerCommandErrors = c_oAscServerCommandErrors;
exports.c_oAscForceSaveTypes = c_oAscForceSaveTypes;
exports.c_oAscUrlTypes = c_oAscUrlTypes;
exports.c_oAscSecretType = c_oAscSecretType;
exports.c_oAscQueueType = c_oAscQueueType;
exports.c_oAscUnlockRes = c_oAscUnlockRes;
exports.FileStatus = FileStatus;
exports.buildVersion = buildVersion;
exports.buildNumber = buildNumber;
