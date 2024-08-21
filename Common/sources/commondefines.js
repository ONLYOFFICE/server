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

const config = require("config");
const constants = require('./constants');

function InputCommand(data, copyExplicit) {
  //must be set explicitly to prevent vulnerability(downloadAs(with url) creates request to integrator with authorization)
  this['withAuthorization'] = undefined;//bool
  this['externalChangeInfo'] = undefined;//zero DB changes case: set password, undo all changes
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
    this['tokenHistory'] = data['tokenHistory'];
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
    this['docconnectionid'] = data['docconnectionid'];
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
    this['closeonerror'] = data['closeonerror'];
    this['serverVersion'] = data['serverVersion'];
    this['rediskey'] = data['rediskey'];
    this['nobase64'] = data['nobase64'];
    this['forgotten'] = data['forgotten'];
    this['status_info_in'] = data['status_info_in'];
    this['attempt'] = data['attempt'];
    this['convertToOrigin'] = data['convertToOrigin'];
    this['isSaveAs'] = data['isSaveAs'];
    this['saveAsPath'] = data['saveAsPath'];
    if (copyExplicit) {
      this['withAuthorization'] = data['withAuthorization'];
      this['externalChangeInfo'] = data['externalChangeInfo'];
      this['wopiParams'] = data['wopiParams'];
      this['builderParams'] = data['builderParams'];
      this['userconnectiondocid'] = data['userconnectiondocid'];
      this['originformat'] = data['originformat'];
    }
  } else {
    this['c'] = undefined;//string command
    this['id'] = undefined;//string document id
    this['userid'] = undefined;//string
    this['userindex'] = undefined;
    this['username'] = undefined;
    this['tokenSession'] = undefined;//string validate
    this['tokenDownload'] = undefined;//string validate
    this['tokenHistory'] = undefined;//string validate
    this['data'] = undefined;//string
    //to open
    this['editorid'] = undefined;//int
    this['format'] = undefined;//string extention
    this['url'] = undefined;//string
    this['title'] = undefined;//string filename
    // to save
    this['outputformat'] = undefined;//int
    this['outputpath'] = undefined;//int internal
    this['savetype'] = undefined;//int part type
    this['saveindex'] = undefined;//int part index
    //nullable
    this['codepage'] = undefined;
    this['delimiter'] = undefined;
    this['delimiterChar'] = undefined;
    this['embeddedfonts'] = undefined;//bool
    this['mailmergesend'] = undefined;
    this['thumbnail'] = undefined;
    //private
    this['status'] = undefined;//int
    this['status_info'] = undefined;//int
    this['savekey'] = undefined;//int document id to save
    this['userconnectionid'] = undefined;//string internal
    this['responsekey'] = undefined;
    this['docconnectionid'] = undefined;//string internal
    this['jsonparams'] = undefined;//string
    this['lcid'] = undefined;
    this['useractionid'] = undefined;
    this['useractionindex'] = undefined;
    this['forcesave'] = undefined;
    this['userdata'] = undefined;
    this['formdata'] = undefined;
    this['inline'] = undefined;//content disposition
    this['password'] = undefined;
    this['savepassword'] = undefined;
    this['withoutPassword'] = undefined;
    this['outputurls'] = undefined;
    this['closeonerror'] = undefined;
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
  }
}
InputCommand.prototype = {
  fillFromConnection: function(conn) {
    this['id'] = conn.docId;
  },
  getCommand: function() {
    return this['c'];
  },
  setCommand: function(data) {
    this['c'] = data;
  },
  getDocId: function() {
    return this['id'];
  },
  setDocId: function(data) {
    this['id'] = data;
  },
  getUserId: function() {
    return this['userid'];
  },
  setUserId: function(data) {
    this['userid'] = data;
  },
  getUserIndex: function() {
    return this['userindex'];
  },
  setUserIndex: function(data) {
    this['userindex'] = data;
  },
  getUserName: function() {
    return this['username'];
  },
  setUserName: function(data) {
    this['username'] = data;
  },
  getTokenSession: function() {
    return this['tokenSession'];
  },
  getTokenDownload: function() {
    return this['tokenDownload'];
  },
  getTokenHistory: function() {
    return this['tokenHistory'];
  },
  getData: function() {
    return this['data'];
  },
  setData: function(data) {
    this['data'] = data;
  },
  getFormat: function() {
    return this['format'];
  },
  setFormat: function(data) {
    this['format'] = data;
  },
  getOriginFormat: function() {
    return this['originformat'];
  },
  setOriginFormat: function(data) {
    this['originformat'] = data;
  },
  getUrl: function() {
    return this['url'];
  },
  setUrl: function(data) {
    this['url'] = data;
  },
  getTitle: function() {
    return this['title'];
  },
  setTitle: function(data) {
    this['title'] = data;
  },
  getOutputFormat: function() {
    return this['outputformat'];
  },
  setOutputFormat: function(data) {
    this['outputformat'] = data;
  },
  getOutputPath: function() {
    return this['outputpath'];
  },
  setOutputPath: function(data) {
    this['outputpath'] = data;
  },
  getSaveType: function() {
    return this['savetype'];
  },
  setSaveType: function(data) {
    this['savetype'] = data;
  },
  getSaveIndex: function() {
    return this['saveindex'];
  },
  setSaveIndex: function(data) {
    this['saveindex'] = data;
  },
  getCodepage: function() {
    return this['codepage'];
  },
  setCodepage: function(data) {
    this['codepage'] = data;
  },
  getDelimiter: function() {
    return this['delimiter'];
  },
  setDelimiter: function(data) {
    this['delimiter'] = data;
  },
  getDelimiterChar: function() {
    return this['delimiterChar'];
  },
  setDelimiterChar: function(data) {
    this['delimiterChar'] = data;
  },
  getEmbeddedFonts: function() {
    return this['embeddedfonts'];
  },
  setEmbeddedFonts: function(data) {
    this['embeddedfonts'] = data;
  },
  getMailMergeSend: function() {
    return this['mailmergesend'];
  },
  setMailMergeSend: function(data) {
    this['mailmergesend'] = data;
  },
  getThumbnail: function() {
    return this['thumbnail'];
  },
  setThumbnail: function(data) {
    this['thumbnail'] = data;
  },
  getTextParams: function() {
    return this['textParams'];
  },
  setTextParams: function(data) {
    this['textParams'] = data;
  },
  getStatus: function() {
    return this['status'];
  },
  setStatus: function(data) {
    this['status'] = data;
  },
  getStatusInfo: function() {
    return this['status_info'];
  },
  setStatusInfo: function(data) {
    this['status_info'] = data;
  },
  getSaveKey: function() {
    return this['savekey'];
  },
  setSaveKey: function(data) {
    this['savekey'] = data;
  },
  getForgotten: function() {
    return this['forgotten'];
  },
  setForgotten: function(data) {
    this['forgotten'] = data;
  },
  getUserConnectionId: function() {
    return this['userconnectionid'];
  },
  setUserConnectionId: function(data) {
    this['userconnectionid'] = data;
  },
  getUserConnectionDocId: function() {
    return this['userconnectiondocid'];
  },
  setUserConnectionDocId: function(data) {
    this['userconnectiondocid'] = data;
  },
  getResponseKey: function() {
    return this['responsekey'];
  },
  setResponseKey: function(data) {
    this['responsekey'] = data;
  },
  getDocConnectionId: function() {
    return this['docconnectionid'];
  },
  setDocConnectionId: function(data) {
    this['docconnectionid'] = data;
  },
  getJsonParams: function() {
    return this['jsonparams'];
  },
  appendJsonParams: function (data) {
    if (this['jsonparams']) {
      config.util.extendDeep(this['jsonparams'], data);
    } else {
      this['jsonparams'] = data;
    }
  },
  getLCID: function() {
    return this['lcid'];
  },
  setLCID: function(data) {
    this['lcid'] = data;
  },
  getUserActionId: function() {
    return this['useractionid'];
  },
  setUserActionId: function(data) {
    this['useractionid'] = data;
  },
  getUserActionIndex: function() {
    return this['useractionindex'];
  },
  setUserActionIndex: function(data) {
    this['useractionindex'] = data;
  },
  /**
   * @return {CForceSaveData | null}
   */
  getForceSave: function() {
    return this['forcesave'];
  },
  /**
   * @param {CForceSaveData} data
   */
  setForceSave: function(data) {
    this['forcesave'] = data;
  },
  getUserData: function() {
    return this['userdata'];
  },
  setUserData: function(data) {
    this['userdata'] = data;
  },
  getFormData: function() {
    return this['formdata'];
  },
  setFormData: function(data) {
    this['formdata'] = data;
  },
  getInline: function() {
    return this['inline'];
  },
  setInline: function(data) {
    this['inline'] = data;
  },
  getPassword: function() {
    return this['password'];
  },
  setPassword: function(data) {
    this['password'] = data;
  },
  getSavePassword: function() {
    return this['savepassword'];
  },
  setSavePassword: function(data) {
    this['savepassword'] = data;
  },
  getWithoutPassword: function() {
    return this['withoutPassword'];
  },
  setWithoutPassword: function(data) {
    this['withoutPassword'] = data;
  },
  setOutputUrls: function(data) {
    this['outputurls'] = data;
  },
  getOutputUrls: function() {
    return this['outputurls'];
  },
  getCloseOnError: function() {
    return this['closeonerror'];
  },
  setCloseOnError: function(data) {
    this['closeonerror'] = data;
  },
  getServerVersion: function() {
    return this['serverVersion'];
  },
  setServerVersion: function(data) {
    this['serverVersion'] = data;
  },
  getRedisKey: function() {
    return this['rediskey'];
  },
  setRedisKey: function(data) {
    this['rediskey'] = data;
  },
  getNoBase64: function() {
    return this['nobase64'];
  },
  setNoBase64: function(data) {
    this['nobase64'] = data;
  },
  getStatusInfoIn: function() {
    return this['status_info_in'];
  },
  setStatusInfoIn: function(data) {
    this['status_info_in'] = data;
  },
  getAttempt: function() {
    return this['attempt'];
  },
  setAttempt: function(data) {
    this['attempt'] = data;
  },
  getWithAuthorization: function() {
    return this['withAuthorization'];
  },
  setWithAuthorization: function(data) {
    this['withAuthorization'] = data;
  },
  getExternalChangeInfo: function() {
    return this['externalChangeInfo'];
  },
  setExternalChangeInfo: function(data) {
    this['externalChangeInfo'] = data;
  },
  getBuilderParams: function() {
    return this['builderParams'];
  },
  setBuilderParams: function(data) {
    this['builderParams'] = data;
  },
  getWopiParams: function() {
    return this['wopiParams'];
  },
  setWopiParams: function(data) {
    this['wopiParams'] = data;
  },
  getConvertToOrigin: function() {
    return this['convertToOrigin'];
  },
  setConvertToOrigin: function(data) {
    this['convertToOrigin'] = data;
  },
  getIsSaveAs: function() {
    return this['isSaveAs'];
  },
  setIsSaveAs: function(data) {
    this['isSaveAs'] = data;
  },
  getSaveAsPath: function() {
    return this['saveAsPath'];
  },
  setSaveAsPath: function(data) {
    this['saveAsPath'] = data;
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
CForceSaveData.prototype.getType = function() {
  return this['type']
};
CForceSaveData.prototype.setType = function(v) {
  this['type'] = v;
};
CForceSaveData.prototype.getTime = function() {
  return this['time']
};
CForceSaveData.prototype.setTime = function(v) {
  this['time'] = v;
};
CForceSaveData.prototype.getIndex = function() {
  return this['index']
};
CForceSaveData.prototype.setIndex = function(v) {
  this['index'] = v;
};
CForceSaveData.prototype.getAuthorUserId = function() {
  return this['authoruserid'];
};
CForceSaveData.prototype.setAuthorUserId = function(v) {
  this['authoruserid'] = v;
};
CForceSaveData.prototype.getAuthorUserIndex = function() {
  return this['authoruserindex'];
};
CForceSaveData.prototype.setAuthorUserIndex = function(v) {
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
CThumbnailData.prototype.getFormat = function() {
  return this['format']
};
CThumbnailData.prototype.setFormat = function(v) {
  this['format'] = v;
};
CThumbnailData.prototype.getAspect = function() {
  return this['aspect']
};
CThumbnailData.prototype.setAspect = function(v) {
  this['aspect'] = v;
};
CThumbnailData.prototype.getFirst = function() {
  return this['first']
};
CThumbnailData.prototype.setFirst = function(v) {
  this['first'] = v;
};
CThumbnailData.prototype.getWidth = function() {
  return this['width']
};
CThumbnailData.prototype.setWidth = function(v) {
  this['width'] = v;
};
CThumbnailData.prototype.getHeight = function() {
  return this['height']
};
CThumbnailData.prototype.setHeight = function(v) {
  this['height'] = v;
};
function CTextParams(obj) {
  if (obj) {
    this['association'] = obj['association'];
  } else {
    this['association'] = null;
  }
}
CTextParams.prototype.getAssociation = function() {
  return this['association']
};
CTextParams.prototype.setAssociation = function(v) {
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
CMailMergeSendData.prototype.getFrom = function() {
  return this['from']
};
CMailMergeSendData.prototype.setFrom = function(v) {
  this['from'] = v;
};
CMailMergeSendData.prototype.getTo = function() {
  return this['to']
};
CMailMergeSendData.prototype.setTo = function(v) {
  this['to'] = v;
};
CMailMergeSendData.prototype.getSubject = function() {
  return this['subject']
};
CMailMergeSendData.prototype.setSubject = function(v) {
  this['subject'] = v;
};
CMailMergeSendData.prototype.getMailFormat = function() {
  return this['mailFormat']
};
CMailMergeSendData.prototype.setMailFormat = function(v) {
  this['mailFormat'] = v;
};
CMailMergeSendData.prototype.getFileName = function() {
  return this['fileName']
};
CMailMergeSendData.prototype.setFileName = function(v) {
  this['fileName'] = v;
};
CMailMergeSendData.prototype.getMessage = function() {
  return this['message']
};
CMailMergeSendData.prototype.setMessage = function(v) {
  this['message'] = v;
};
CMailMergeSendData.prototype.getRecordFrom = function() {
  return this['recordFrom']
};
CMailMergeSendData.prototype.setRecordFrom = function(v) {
  this['recordFrom'] = v;
};
CMailMergeSendData.prototype.getRecordTo = function() {
  return this['recordTo']
};
CMailMergeSendData.prototype.setRecordTo = function(v) {
  this['recordTo'] = v;
};
CMailMergeSendData.prototype.getRecordCount = function() {
  return this['recordCount']
};
CMailMergeSendData.prototype.setRecordCount = function(v) {
  this['recordCount'] = v;
};
CMailMergeSendData.prototype.getRecordErrorCount = function() {
  return this['recordErrorCount']
};
CMailMergeSendData.prototype.setRecordErrorCount = function(v) {
  this['recordErrorCount'] = v;
};
CMailMergeSendData.prototype.getUserId = function() {
  return this['userId']
};
CMailMergeSendData.prototype.setUserId = function(v) {
  this['userId'] = v;
};
CMailMergeSendData.prototype.getUrl = function() {
  return this['url']
};
CMailMergeSendData.prototype.setUrl = function(v) {
  this['url'] = v;
};
CMailMergeSendData.prototype.getBaseUrl = function() {
  return this['baseUrl']
};
CMailMergeSendData.prototype.setBaseUrl = function(v) {
  this['baseUrl'] = v;
};
CMailMergeSendData.prototype.getJsonKey = function() {
  return this['jsonkey']
};
CMailMergeSendData.prototype.setJsonKey = function(v) {
  this['jsonkey'] = v;
};
CMailMergeSendData.prototype.getIsJsonKey = function() {
  return this['isJson']
};
CMailMergeSendData.prototype.setIsJsonKey = function(v) {
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
  getCtx : function() {
    return this['ctx'];
  },
  setCtx : function(data) {
    return this['ctx'] = data;
  },
  getCmd : function() {
    return this['cmd'];
  },
  setCmd : function(data) {
    return this['cmd'] = data;
  },
  getToFile : function() {
    return this['toFile'];
  },
  setToFile : function(data) {
    return this['toFile'] = data;
  },
  getFromOrigin : function() {
    return this['fromOrigin'];
  },
  setFromOrigin : function(data) {
    return this['fromOrigin'] = data;
  },
  getFromSettings : function() {
    return this['fromSettings'];
  },
  setFromSettings : function(data) {
    return this['fromSettings'] = data;
  },
  getFromChanges : function() {
    return this['fromChanges'];
  },
  setFromChanges : function(data) {
    return this['fromChanges'] = data;
  },
  getPaid : function() {
    return this['paid'];
  },
  setPaid : function(data) {
    return this['paid'] = data;
  },
  getDataKey : function() {
    return this['dataKey'];
  },
  setDataKey : function(data) {
    return this['dataKey'] = data;
  },
  getVisibilityTimeout : function() {
    return this['visibilityTimeout'];
  },
  setVisibilityTimeout : function(data) {
    return this['visibilityTimeout'] = data;
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
OutputSfcData.prototype.getKey = function() {
  return this['key'];
};
OutputSfcData.prototype.setKey = function(data) {
  return this['key'] = data;
};
OutputSfcData.prototype.getStatus = function() {
  return this['status'];
};
OutputSfcData.prototype.setStatus = function(data) {
  return this['status'] = data;
};
OutputSfcData.prototype.getUrl = function() {
  return this['url'];
};
OutputSfcData.prototype.setUrl = function(data) {
  return this['url'] = data;
};
OutputSfcData.prototype.getExtName = function() {
  return this['filetype'];
};
OutputSfcData.prototype.setExtName = function(data) {
  return this['filetype'] = data.substring(1);
};
OutputSfcData.prototype.getChangeUrl = function() {
  return this['changesurl'];
};
OutputSfcData.prototype.setChangeUrl = function(data) {
  return this['changesurl'] = data;
};
OutputSfcData.prototype.getChangeHistory = function() {
  return this['history'];
};
OutputSfcData.prototype.setChangeHistory = function(data) {
  return this['history'] = data;
};
OutputSfcData.prototype.getUsers = function() {
  return this['users'];
};
OutputSfcData.prototype.setUsers = function(data) {
  return this['users'] = data;
};
OutputSfcData.prototype.getMailMerge = function() {
  return this['mailMerge'];
};
OutputSfcData.prototype.setMailMerge = function(data) {
  return this['mailMerge'] = data;
};
OutputSfcData.prototype.getActions = function() {
  return this['actions'];
};
OutputSfcData.prototype.setActions = function(data) {
  return this['actions'] = data;
};
OutputSfcData.prototype.getUserData= function() {
  return this['userdata'];
};
OutputSfcData.prototype.setUserData = function(data) {
  return this['userdata'] = data;
};
OutputSfcData.prototype.getFormsDataUrl= function() {
  return this['formsdataurl'];
};
OutputSfcData.prototype.setFormsDataUrl = function(data) {
  return this['formsdataurl'] = data;
};
OutputSfcData.prototype.getLastSave = function() {
  return this['lastsave']
};
OutputSfcData.prototype.setLastSave = function(v) {
  this['lastsave'] = v;
};
OutputSfcData.prototype.getNotModified = function() {
  return this['notmodified']
};
OutputSfcData.prototype.setNotModified = function(v) {
  this['notmodified'] = v;
};
OutputSfcData.prototype.getForceSaveType = function() {
  return this['forcesavetype']
};
OutputSfcData.prototype.setForceSaveType = function(v) {
  this['forcesavetype'] = v;
};
OutputSfcData.prototype.getEncrypted = function() {
  return this['encrypted']
};
OutputSfcData.prototype.setEncrypted = function(v) {
  this['encrypted'] = v;
};
OutputSfcData.prototype.getToken = function() {
  return this['token']
};
OutputSfcData.prototype.setToken = function(v) {
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
      case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML :
        this['type'] = 0;
        break;
      case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX :
        this['type'] = 1;
        break;
      case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF :
        this['type'] = 2;
        break;
      default :
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
OutputMailMerge.prototype.getRecordIndex = function() {
  return this['recordIndex'];
};
OutputMailMerge.prototype.setRecordIndex = function(data) {
  return this['recordIndex'] = data;
};
OutputMailMerge.prototype.getRecordErrorCount = function() {
  return this['recordErrorCount'];
};
OutputMailMerge.prototype.setRecordErrorCount = function(data) {
  return this['recordErrorCount'] = data;
};
OutputMailMerge.prototype.getTo = function() {
  return this['to'];
};
OutputMailMerge.prototype.setTo = function(data) {
  return this['to'] = data;
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
ConvertStatus.prototype.setExtName = function(extname) {
  this.filetype = extname.substring(1);
};
ConvertStatus.prototype.setUrl = function(url) {
  this.url = url;
  this.end = true;
};
const c_oPublishType = {
  drop : 0,
  releaseLock : 1,
  participantsState : 2,
  message : 3,
  getLock : 4,
  changes : 5,
  auth : 6,
  receiveTask : 7,
  warning: 8,
  cursor: 9,
  shutdown: 10,
  meta: 11,
  forceSave: 12,
  closeConnection: 13,
  changesNotify: 14,
  changeConnecitonInfo: 15,
  rpc: 16
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
  [ 0,    28596, "ISO-8859-6",       "Arabic (ISO 8859-6)" ],
  [ 1,    720,   "DOS-720",          "Arabic (OEM 720)" ],
  [ 2,    1256,  "windows-1256",     "Arabic (Windows)" ],

  [ 3,    28594, "ISO-8859-4",       "Baltic (ISO 8859-4)" ],
  [ 4,    28603, "ISO-8859-13",      "Baltic (ISO 8859-13)" ],
  [ 5,    775,   "IBM775",           "Baltic (OEM 775)" ],
  [ 6,    1257,  "windows-1257",     "Baltic (Windows)" ],

  [ 7,    28604, "ISO-8859-14",      "Celtic (ISO 8859-14)" ],

  [ 8,    28595, "ISO-8859-5",       "Cyrillic (ISO 8859-5)" ],
  [ 9,    20866, "KOI8-R",           "Cyrillic (KOI8-R)" ],
  [ 10,   21866, "KOI8-U",           "Cyrillic (KOI8-U)" ],
  [ 11,   10007, "x-mac-cyrillic",   "Cyrillic (Mac)" ],
  [ 12,   855,   "IBM855",           "Cyrillic (OEM 855)" ],
  [ 13,   866,   "cp866",            "Cyrillic (OEM 866)" ],
  [ 14,   1251,  "windows-1251",     "Cyrillic (Windows)" ],

  [ 15,   852,   "IBM852",           "Central European (OEM 852)" ],
  [ 16,   1250,  "windows-1250",     "Central European (Windows)" ],

  [ 17,   950,   "Big5",             "Chinese (Big5 Traditional)" ],
  [ 18,   936,   "GB2312",           "Central (GB2312 Simplified)" ],

  [ 19,   28592, "ISO-8859-2",       "Eastern European (ISO 8859-2)" ],

  [ 20,   28597, "ISO-8859-7",       "Greek (ISO 8859-7)" ],
  [ 21,   737,   "IBM737",           "Greek (OEM 737)" ],
  [ 22,   869,   "IBM869",           "Greek (OEM 869)" ],
  [ 23,   1253,  "windows-1253",     "Greek (Windows)" ],

  [ 24,   28598, "ISO-8859-8",       "Hebrew (ISO 8859-8)" ],
  [ 25,   862,   "DOS-862",          "Hebrew (OEM 862)" ],
  [ 26,   1255,  "windows-1255",     "Hebrew (Windows)" ],

  [ 27,   932,   "Shift_JIS",        "Japanese (Shift-JIS)" ],

  [ 28,   949,   "KS_C_5601-1987",   "Korean (Windows)" ],
  [ 29,   51949, "EUC-KR",           "Korean (EUC)" ],

  [ 30,   861,   "IBM861",           "North European (Icelandic OEM 861)" ],
  [ 31,   865,   "IBM865",           "North European (Nordic OEM 865)" ],

  [ 32,   874,   "windows-874",      "Thai (TIS-620)" ],

  [ 33,   28593, "ISO-8859-3",       "Turkish (ISO 8859-3)" ],
  [ 34,   28599, "ISO-8859-9",       "Turkish (ISO 8859-9)" ],
  [ 35,   857,   "IBM857",           "Turkish (OEM 857)" ],
  [ 36,   1254,  "windows-1254",     "Turkish (Windows)" ],

  [ 37,   28591, "ISO-8859-1",       "Western European (ISO-8859-1)" ],
  [ 38,   28605, "ISO-8859-15",      "Western European (ISO-8859-15)" ],
  [ 39,   850,   "IBM850",           "Western European (OEM 850)" ],
  [ 40,   858,   "IBM858",           "Western European (OEM 858)" ],
  [ 41,   860,   "IBM860",           "Western European (OEM 860 : Portuguese)" ],
  [ 42,   863,   "IBM863",           "Western European (OEM 863 : French)" ],
  [ 43,   437,   "IBM437",           "Western European (OEM-US)" ],
  [ 44,   1252,  "windows-1252",     "Western European (Windows)" ],

  [ 45,   1258,  "windows-1258",     "Vietnamese (Windows)" ],

  [ 46,   65001, "UTF-8",            "Unicode (UTF-8)" ],
  [ 47,   65000, "UTF-7",            "Unicode (UTF-7)" ],

  [ 48,   1200, "UTF-16",            "Unicode (UTF-16)" ],
  [ 49,   1201, "UTF-16BE",          "Unicode (UTF-16 Big Endian)" ],

  [ 50,   12000, "UTF-32",           "Unicode (UTF-32)" ],
  [ 51,   12001, "UTF-32BE",         "Unicode (UTF-32 Big Endian)" ]
];
const c_oAscEncodingsMap = {"437": 43, "720": 1, "737": 21, "775": 5, "850": 39, "852": 15, "855": 12, "857": 35, "858": 40, "860": 41, "861": 30, "862": 25, "863": 42, "865": 31, "866": 13, "869": 22, "874": 32, "932": 27, "936": 18, "949": 28, "950": 17, "1200": 48, "1201": 49, "1250": 16, "1251": 14, "1252": 44, "1253": 23, "1254": 36, "1255": 26, "1256": 2, "1257": 6, "1258": 45, "10007": 11, "12000": 50, "12001": 51, "20866": 9, "21866": 10, "28591": 37, "28592": 19, "28593": 33, "28594": 3, "28595": 8, "28596": 0, "28597": 20, "28598": 24, "28599": 34, "28603": 4, "28604": 7, "28605": 38, "51949": 29, "65000": 47, "65001": 46}
const c_oAscCodePageUtf8 = 46;//65001
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
