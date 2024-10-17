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

const constants = require('../../../Common/sources/constants');

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

DocumentAdditional.prototype.setShardKey = function(shardKey) {
  let additional = new DocumentAdditional();
  additional.data.push({shardKey});
  return additional.toSQLInsert();
};
DocumentAdditional.prototype.getShardKey = function(str) {
  let res;
  let val = new DocumentAdditional();
  val.fromString(str);
  val.data.forEach((elem) => {
    if (elem.shardKey) {
      res = elem.shardKey;
    }
  });
  return res;
};

DocumentAdditional.prototype.setWopiSrc = function(wopiSrc) {
  let additional = new DocumentAdditional();
  additional.data.push({wopiSrc});
  return additional.toSQLInsert();
};
DocumentAdditional.prototype.getWopiSrc = function(str) {
  let res;
  let val = new DocumentAdditional();
  val.fromString(str);
  val.data.forEach((elem) => {
    if (elem.wopiSrc) {
      res = elem.wopiSrc;
    }
  });
  return res;
};

module.exports = {
  UserCallback,
  DocumentPassword,
  DocumentAdditional
}