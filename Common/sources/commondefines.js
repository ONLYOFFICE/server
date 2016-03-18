/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU 
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html). 
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that 
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display 
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains 
 * relevant author attributions when distributing the software. If the display of the logo in its graphic 
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE" 
 * in every copy of the program you distribute. 
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
*/
﻿var constants = require('./constants');

function InputCommand(data) {
  if (data) {
    this['c'] = data['c'];
    this['id'] = data['id'];
    this['userid'] = data['userid'];
    this['vkey'] = data['vkey'];
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
    this['embeddedfonts'] = data['embeddedfonts'];
    this['viewmode'] = data['viewmode'];
    if (data['mailmergesend']) {
      this['mailmergesend'] = new CMailMergeSendData(data['mailmergesend']);
    } else {
      this['mailmergesend'] = undefined;
    }
    this['status'] = data['status'];
    this['status_info'] = data['status_info'];
    this['savekey'] = data['savekey'];
    this['userconnectionid'] = data['userconnectionid'];
    this['docconnectionid'] = data['docconnectionid'];
    this['doctparams'] = data['doctparams'];
    this['useractionid'] = data['useractionid'];
    this['lastsave'] = data['lastsave'];
    this['userdata'] = data['userdata'];
  } else {
    this['c'] = undefined;//string command
    this['id'] = undefined;//string document id
    this['userid'] = undefined;//string
    this['vkey'] = undefined;//string validate
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
    this['embeddedfonts'] = undefined;//bool
    this['viewmode'] = undefined;//bool
    this['mailmergesend'] = undefined;
    //private
    this['status'] = undefined;//int
    this['status_info'] = undefined;//int
    this['savekey'] = undefined;//int document id to save
    this['userconnectionid'] = undefined;//string internal
    this['docconnectionid'] = undefined;//string internal
    this['doctparams'] = undefined;//int doctRenderer
    this['useractionid'] = undefined;
    this['lastsave'] = undefined;//string key
    this['userdata'] = undefined;
  }
}
InputCommand.prototype = {
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
  getVKey: function() {
    return this['vkey'];
  },
  setVKey: function(data) {
    this['vkey'] = data;
  },
  getData: function() {
    return this['data'];
  },
  setData: function(data) {
    this['data'] = data;
  },
  getEditorId: function() {
    return this['editorid'];
  },
  setEditorId: function(data) {
    this['editorid'] = data;
  },
  getFormat: function() {
    return this['format'];
  },
  setFormat: function(data) {
    this['format'] = data;
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
  getEmbeddedFonts: function() {
    return this['embeddedfonts'];
  },
  setEmbeddedFonts: function(data) {
    this['embeddedfonts'] = data;
  },
  getViewMode: function() {
    return this['viewmode'];
  },
  setViewMode: function(data) {
    this['viewmode'] = data;
  },
  getMailMergeSend: function() {
    return this['mailmergesend'];
  },
  setMailMergeSend: function(data) {
    this['mailmergesend'] = data;
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
  getUserConnectionId: function() {
    return this['userconnectionid'];
  },
  setUserConnectionId: function(data) {
    this['userconnectionid'] = data;
  },
  getDocConnectionId: function() {
    return this['docconnectionid'];
  },
  setDocConnectionId: function(data) {
    this['docconnectionid'] = data;
  },
  getDoctParams: function() {
    return this['doctparams'];
  },
  setDoctParams: function(data) {
    this['doctparams'] = data;
  },
  getUserActionId: function() {
    return this['useractionid'];
  },
  setUserActionId: function(data) {
    this['useractionid'] = data;
  },
  getLastSave: function() {
    return this['lastsave'];
  },
  setLastSave: function(data) {
    this['lastsave'] = data;
  },
  getUserData: function() {
    return this['userdata'];
  },
  setUserData: function(data) {
    this['userdata'] = data;
  }
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
    this['userId'] = obj['userId'];
    this['url'] = obj['url'];
    this['baseUrl'] = obj['baseUrl'];
    this['jsonkey'] = obj['jsonkey'];
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
    this['userId'] = null;
    this['url'] = null;
    this['baseUrl'] = null;
    this['jsonkey'] = null;
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
function TaskQueueData(data) {
  if (data) {
    this['cmd'] = new InputCommand(data['cmd']);
    this['toFile'] = data['toFile'];
    this['fromOrigin'] = data['fromOrigin'];
    this['fromSettings'] = data['fromSettings'];
    this['fromChanges'] = data['fromChanges'];
    this['paid'] = data['paid'];

    this['dataKey'] = data['dataKey'];
    this['visibilityTimeout'] = data['visibilityTimeout'];
  } else {
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

function OutputSfcData() {
  this['key'] = undefined;
  this['status'] = undefined;
  this['url'] = undefined;
  this['changesurl'] = undefined;
  this['changeshistory'] = undefined;
  this['users'] = [];
  this['actions'] = [];
  this['mailMerge'] = undefined;
  this['userdata'] = undefined;
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
OutputSfcData.prototype.getChangeUrl = function() {
  return this['changesurl'];
};
OutputSfcData.prototype.setChangeUrl = function(data) {
  return this['changesurl'] = data;
};
OutputSfcData.prototype.getChangeHistory = function() {
  return this['changeshistory'];
};
OutputSfcData.prototype.setChangeHistory = function(data) {
  return this['changeshistory'] = data;
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
function OutputMailMerge(mailMergeSendData) {
  if (mailMergeSendData) {
    this['from'] = mailMergeSendData.getFrom();
    this['message'] = mailMergeSendData.getMessage();
    this['subject'] = mailMergeSendData.getSubject();
    this['title'] = mailMergeSendData.getFileName();
    var mailFormat = mailMergeSendData.getMailFormat();
    switch (mailFormat) {
      case constants.AVS_OFFICESTUDIO_FILE_OTHER_HTMLZIP :
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
  }
}
OutputMailMerge.prototype.getRecordIndex = function() {
  return this['recordIndex'];
};
OutputMailMerge.prototype.setRecordIndex = function(data) {
  return this['recordIndex'] = data;
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
var c_oPublishType = {
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
  expireDoc: 10
};
var c_oAscCsvDelimiter = {
  None: 0,
  Tab: 1,
  Semicolon: 2,
  Сolon: 3,
  Comma: 4,
  Space: 5
};
var c_oAscEncodings = [
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
var c_oAscEncodingsMap = {"437": 43, "720": 1, "737": 21, "775": 5, "850": 39, "852": 15, "855": 12, "857": 35, "858": 40, "860": 41, "861": 30, "862": 25, "863": 42, "865": 31, "866": 13, "869": 22, "874": 32, "932": 27, "936": 18, "949": 28, "950": 17, "1200": 48, "1201": 49, "1250": 16, "1251": 14, "1252": 44, "1253": 23, "1254": 36, "1255": 26, "1256": 2, "1257": 6, "1258": 45, "10007": 11, "12000": 50, "12001": 51, "20866": 9, "21866": 10, "28591": 37, "28592": 19, "28593": 33, "28594": 3, "28595": 8, "28596": 0, "28597": 20, "28598": 24, "28599": 34, "28603": 4, "28604": 7, "28605": 38, "51949": 29, "65000": 47, "65001": 46}
var c_oAscCodePageUtf8 = 46;//65001
var c_oAscUserAction = {
  Out: 0,
  In: 1,
  AllIn: 2
};
var c_oAscServerCommandErrors = {
  NoError: 0,
  DocumentIdError: 1,
  ParseError: 2,
  CommandError: 3,
  NotModify: 4
};

exports.TaskQueueData = TaskQueueData;
exports.CMailMergeSendData = CMailMergeSendData;
exports.InputCommand = InputCommand;
exports.OutputSfcData = OutputSfcData;
exports.OutputMailMerge = OutputMailMerge;
exports.OutputAction = OutputAction;
exports.c_oPublishType = c_oPublishType;
exports.c_oAscCsvDelimiter = c_oAscCsvDelimiter;
exports.c_oAscEncodings = c_oAscEncodings;
exports.c_oAscEncodingsMap = c_oAscEncodingsMap;
exports.c_oAscCodePageUtf8 = c_oAscCodePageUtf8;
exports.c_oAscUserAction = c_oAscUserAction;
exports.c_oAscServerCommandErrors = c_oAscServerCommandErrors;
