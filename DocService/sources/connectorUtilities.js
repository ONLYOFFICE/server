const constants = require('./../../Common/sources/constants');

function UserCallback() {
  this.userIndex = undefined;
  this.callback = undefined;
}
UserCallback.prototype.fromValues = function(userIndex, callback){
  if(null !== userIndex){
    this.userIndex = userIndex;
  }
  if(null !== callback){
    this.callback = callback;
  }
};
UserCallback.prototype.delimiter = constants.CHAR_DELIMITER;
UserCallback.prototype.toSQLInsert = function(){
  return this.delimiter + JSON.stringify(this);
};
UserCallback.prototype.getCallbackByUserIndex = function(ctx, callbacksStr, opt_userIndex) {
  ctx.logger.debug("getCallbackByUserIndex: userIndex = %s callbacks = %s", opt_userIndex, callbacksStr);
  if (!callbacksStr || !callbacksStr.startsWith(UserCallback.prototype.delimiter)) {
    let index = callbacksStr.indexOf(UserCallback.prototype.delimiter);
    if (-1 === index) {
      //old format
      return callbacksStr;
    } else {
      //mix of old and new format
      callbacksStr = callbacksStr.substring(index);
    }
  }
  let callbacks = callbacksStr.split(UserCallback.prototype.delimiter);
  let callbackUrl = "";
  for (let i = 1; i < callbacks.length; ++i) {
    let callback = JSON.parse(callbacks[i]);
    callbackUrl = callback.callback;
    if (callback.userIndex === opt_userIndex) {
      break;
    }
  }
  return callbackUrl;
};
UserCallback.prototype.getCallbacks = function(ctx, callbacksStr) {
  ctx.logger.debug("getCallbacks: callbacks = %s", callbacksStr);
  if (!callbacksStr || !callbacksStr.startsWith(UserCallback.prototype.delimiter)) {
    let index = callbacksStr.indexOf(UserCallback.prototype.delimiter);
    if (-1 === index) {
      //old format
      return [callbacksStr];
    } else {
      //mix of old and new format
      callbacksStr = callbacksStr.substring(index);
    }
  }
  let callbacks = callbacksStr.split(UserCallback.prototype.delimiter);
  let res = [];
  for (let i = 1; i < callbacks.length; ++i) {
    let callback = JSON.parse(callbacks[i]);
    res.push(callback.callback);
  }
  return res;
};
exports.UserCallback = UserCallback;

function DocumentPassword() {
  this.password = undefined;
  this.change = undefined;
}
DocumentPassword.prototype.fromString = function(passwordStr){
  var parsed = JSON.parse(passwordStr);
  this.fromValues(parsed.password, parsed.change);
};
DocumentPassword.prototype.fromValues = function(password, change){
  if(null !== password){
    this.password = password;
  }
  if(null !== change) {
    this.change = change;
  }
};
DocumentPassword.prototype.delimiter = constants.CHAR_DELIMITER;
DocumentPassword.prototype.toSQLInsert = function(){
  return this.delimiter + JSON.stringify(this);
};
DocumentPassword.prototype.isInitial = function(){
  return !this.change;
};
DocumentPassword.prototype.getDocPassword = function(ctx, docPasswordStr) {
  let res = {initial: undefined, current: undefined, change: undefined};
  if (docPasswordStr) {
    ctx.logger.debug("getDocPassword: passwords = %s", docPasswordStr);
    let passwords = docPasswordStr.split(UserCallback.prototype.delimiter);

    for (let i = 1; i < passwords.length; ++i) {
      let password = new DocumentPassword();
      password.fromString(passwords[i]);
      if (password.isInitial()) {
        res.initial = password.password;
      } else {
        res.change = password.change;
      }
      res.current = password.password;
    }
  }
  return res;
};
DocumentPassword.prototype.getCurPassword = function(ctx, docPasswordStr) {
  let docPassword = this.getDocPassword(ctx, docPasswordStr);
  return docPassword.current;
};
DocumentPassword.prototype.hasPasswordChanges = function(ctx, docPasswordStr) {
  let docPassword = this.getDocPassword(ctx, docPasswordStr);
  return docPassword.initial !== docPassword.current;
};
exports.DocumentPassword = DocumentPassword;

function DocumentAdditional() {
  this.data = [];
}
DocumentAdditional.prototype.delimiter = constants.CHAR_DELIMITER;
DocumentAdditional.prototype.toSQLInsert = function() {
  if (this.data.length) {
    let vals = this.data.map((currentValue) => {
      return JSON.stringify(currentValue);
    });
    return this.delimiter + vals.join(this.delimiter);
  } else {
    return null;
  }
};
DocumentAdditional.prototype.fromString = function(str) {
  if (!str) {
    return;
  }
  let vals = str.split(this.delimiter).slice(1);
  this.data = vals.map((currentValue) => {
    return JSON.parse(currentValue);
  });
};
DocumentAdditional.prototype.setOpenedAt = function(time, timezoneOffset) {
  let additional = new DocumentAdditional();
  additional.data.push({time: time, timezoneOffset: timezoneOffset});
  return additional.toSQLInsert();
};
DocumentAdditional.prototype.getOpenedAt = function(str) {
  let res;
  let val = new DocumentAdditional();
  val.fromString(str);
  val.data.forEach((elem) => {
    if (undefined !== elem.timezoneOffset) {
      res = elem.time - (elem.timezoneOffset * 60 * 1000);
    }
  });
  return res;
};
exports.DocumentAdditional = DocumentAdditional;