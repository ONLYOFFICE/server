var constants = require('./constants');

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

function ErrorWithResult() {
  this.errorCode = constants.NO_ERROR;
  this.data = null;
}

exports.TaskQueueData = TaskQueueData;
exports.CMailMergeSendData = CMailMergeSendData;
exports.InputCommand = InputCommand;
exports.ErrorWithResult = ErrorWithResult;
