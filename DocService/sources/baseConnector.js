/*
 * (c) Copyright Ascensio System SIA 2010-2023
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

var sqlDataBaseType = {
	mySql		: 'mysql',
	mariaDB		: 'mariadb',
	postgreSql	: 'postgres',
	dameng	: 'dameng'
};

var bottleneck = require("bottleneck");
var config = require('config');
var configSql = config.get('services.CoAuthoring.sql');

var baseConnector;
switch (configSql.get('type')) {
  case sqlDataBaseType.mySql:
  case sqlDataBaseType.mariaDB:
    baseConnector = require('./mySqlBaseConnector');
    break;
  case sqlDataBaseType.dameng:
    baseConnector = require('./damengBaseConnector');
    break;
  default:
    baseConnector = require('./postgreSqlBaseConnector');
    break;
}
let constants = require('./../../Common/sources/constants');

const cfgTableResult = configSql.get('tableResult');
const cfgTableChanges = configSql.get('tableChanges');

var g_oCriticalSection = {};
let isSupportFastInsert = !!baseConnector.insertChanges;
let addSqlParam = baseConnector.addSqlParameter;
var maxPacketSize = configSql.get('max_allowed_packet'); // The default size for a query to the database is 1Mb - 1 (because it does not write 1048575, but writes 1048574)
const cfgBottleneckGetChanges = config.get('bottleneck.getChanges');

let reservoirMaximum = cfgBottleneckGetChanges.reservoirIncreaseMaximum || cfgBottleneckGetChanges.reservoirRefreshAmount;
let group = new bottleneck.Group(cfgBottleneckGetChanges);

function getChangesSize(changes) {
  return changes.reduce((accumulator, currentValue) => accumulator + currentValue.change_data.length, 0);
}

exports.baseConnector = baseConnector;
exports.insertChangesPromiseCompatibility = function (ctx, objChanges, docId, index, user) {
  return new Promise(function(resolve, reject) {
    _insertChangesCallback(ctx, 0, objChanges, docId, index, user, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.insertChangesPromiseFast = function (ctx, objChanges, docId, index, user) {
  return new Promise(function(resolve, reject) {
    baseConnector.insertChanges(ctx, cfgTableChanges, 0, objChanges, docId, index, user, function(error, result, isSupported) {
      isSupportFastInsert = isSupported;
      if (error) {
        if (!isSupportFastInsert) {
          resolve(exports.insertChangesPromiseCompatibility(ctx, objChanges, docId, index, user));
        } else {
          reject(error);
        }
      } else {
        resolve(result);
      }
    });
  });
};
exports.insertChangesPromise = function (ctx, objChanges, docId, index, user) {
  if (isSupportFastInsert) {
    return exports.insertChangesPromiseFast(ctx, objChanges, docId, index, user);
  } else {
    return exports.insertChangesPromiseCompatibility(ctx, objChanges, docId, index, user);
  }

};
function _getDateTime2(oDate) {
  return oDate.toISOString().slice(0, 19).replace('T', ' ');
}

exports.getDateTime = _getDateTime2;

function _insertChangesCallback (ctx, startIndex, objChanges, docId, index, user, callback) {
  var sqlCommand = `INSERT INTO ${cfgTableChanges} VALUES`;
  var i = startIndex, l = objChanges.length, lengthUtf8Current = sqlCommand.length, lengthUtf8Row = 0, values = [];
  if (i === l)
    return;

  for (; i < l; ++i, ++index) {
    //44 - length of "($1001,... $1007),"
    //4 is max utf8 bytes per symbol
    lengthUtf8Row = 44 + 4 * (docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[i].change.length) + 4 + 8;
    if (lengthUtf8Row + lengthUtf8Current >= maxPacketSize && i > startIndex) {
      sqlCommand += ';';
      (function(tmpStart, tmpIndex) {
        baseConnector.sqlQuery(ctx, sqlCommand, function() {
          // do not remove lock, but we continue to add
          _insertChangesCallback(ctx, tmpStart, objChanges, docId, tmpIndex, user, callback);
        }, undefined, undefined, values);
      })(i, index);
      return;
    }
    let p0 = addSqlParam(ctx.tenant, values);
    let p1 = addSqlParam(docId, values);
    let p2 = addSqlParam(index, values);
    let p3 = addSqlParam(user.id, values);
    let p4 = addSqlParam(user.idOriginal, values);
    let p5 = addSqlParam(user.username, values);
    let p6 = addSqlParam(objChanges[i].change, values);
    let p7 = addSqlParam(objChanges[i].time, values);
    if (i > startIndex) {
      sqlCommand += ',';
    }
    sqlCommand += `(${p0},${p1},${p2},${p3},${p4},${p5},${p6},${p7})`;
    lengthUtf8Current += lengthUtf8Row;
  }

  sqlCommand += ';';
  baseConnector.sqlQuery(ctx, sqlCommand, callback, undefined, undefined, values);
}
exports.deleteChangesCallback = function(ctx, docId, deleteIndex, callback) {
  let sqlCommand, values = [];
  let p1 = addSqlParam(ctx.tenant, values);
  let p2 = addSqlParam(docId, values);
  if (null !== deleteIndex) {
    let sqlParam2 = addSqlParam(deleteIndex, values);
    sqlCommand = `DELETE FROM ${cfgTableChanges} WHERE tenant=${p1} AND id=${p2} AND change_id >= ${sqlParam2};`;
  } else {
    sqlCommand = `DELETE FROM ${cfgTableChanges} WHERE tenant=${p1} AND id=${p2};`;
  }
  baseConnector.sqlQuery(ctx, sqlCommand, callback, undefined, undefined, values);
};
exports.deleteChangesPromise = function (ctx, docId, deleteIndex) {
  return new Promise(function(resolve, reject) {
    exports.deleteChangesCallback(ctx, docId, deleteIndex, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.deleteChanges = function (ctx, docId, deleteIndex) {
	lockCriticalSection(docId, function () {_deleteChanges(ctx, docId, deleteIndex);});
};
function _deleteChanges (ctx, docId, deleteIndex) {
  exports.deleteChangesCallback(ctx, docId, deleteIndex, function () {unLockCriticalSection(docId);});
}
exports.getChangesIndex = function(ctx, docId, callback) {
  let values = [];
  let p1 = addSqlParam(ctx.tenant, values);
  let p2 = addSqlParam(docId, values);
  var sqlCommand = `SELECT MAX(change_id) as change_id FROM ${cfgTableChanges} WHERE tenant=${p1} AND id=${p2};`;
  baseConnector.sqlQuery(ctx, sqlCommand, callback, undefined, undefined, values);
};
exports.getChangesIndexPromise = function(ctx, docId) {
  return new Promise(function(resolve, reject) {
    exports.getChangesIndex(ctx, docId, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.getChangesPromise = function (ctx, docId, optStartIndex, optEndIndex, opt_time) {
  let limiter = group.key(`${ctx.tenant}\t${docId}\tchanges`);
  return limiter.schedule(() => {
    return new Promise(function(resolve, reject) {
      let values = [];
      let sqlParam = addSqlParam(ctx.tenant, values);
      let sqlWhere = `tenant=${sqlParam}`;
      sqlParam = addSqlParam(docId, values);
      sqlWhere += ` AND id=${sqlParam}`;
      if (null != optStartIndex) {
        sqlParam = addSqlParam(optStartIndex, values);
        sqlWhere += ` AND change_id>=${sqlParam}`;
      }
      if (null != optEndIndex) {
        sqlParam = addSqlParam(optEndIndex, values);
        sqlWhere += ` AND change_id<${sqlParam}`;
      }
      if (null != opt_time) {
        if (!(opt_time instanceof Date)) {
          opt_time = new Date(opt_time);
        }
        sqlParam = addSqlParam(opt_time, values);
        sqlWhere += ` AND change_date<=${sqlParam}`;
      }
      sqlWhere += ' ORDER BY change_id ASC';
      var sqlCommand = `SELECT * FROM ${cfgTableChanges} WHERE ${sqlWhere};`;

      baseConnector.sqlQuery(ctx, sqlCommand, function(error, result) {
        if (error) {
          reject(error);
        } else {
          if (reservoirMaximum > 0) {
            let size = Math.min(getChangesSize(result), reservoirMaximum);
            let cur = limiter.incrementReservoir(-size).then((cur) => {
              ctx.logger.debug("getChangesPromise bottleneck reservoir cur=%s", cur);
              resolve(result);
            });
          } else {
            resolve(result);
          }
        }
      }, undefined, undefined, values);
    });
  });
};

exports.isLockCriticalSection = function (id) {
	return !!(g_oCriticalSection[id]);
};

// critical section
function lockCriticalSection (id, callback) {
	if (g_oCriticalSection[id]) {
		// wait
		g_oCriticalSection[id].push(callback);
		return;
	}
	// lock
	g_oCriticalSection[id] = [];
	g_oCriticalSection[id].push(callback);
	callback();
}
function unLockCriticalSection (id) {
	var arrCallbacks = g_oCriticalSection[id];
	arrCallbacks.shift();
	if (0 < arrCallbacks.length)
		arrCallbacks[0]();
	else
		delete g_oCriticalSection[id];
}
exports.healthCheck = function (ctx) {
  return new Promise(function(resolve, reject) {
  	//SELECT 1; usefull for H2, MySQL, Microsoft SQL Server, PostgreSQL, SQLite
  	//http://stackoverflow.com/questions/3668506/efficient-sql-test-query-or-validation-query-that-will-work-across-all-or-most
    baseConnector.sqlQuery(ctx, 'SELECT 1;', function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};

exports.getEmptyCallbacks = function(ctx) {
  return new Promise(function(resolve, reject) {
    const sqlCommand = `SELECT DISTINCT t1.tenant, t1.id FROM ${cfgTableChanges} t1 LEFT JOIN ${cfgTableResult} t2 ON t2.tenant = t1.tenant AND t2.id = t1.id WHERE t2.callback = '';`;
    baseConnector.sqlQuery(ctx, sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};
exports.getTableColumns = function(ctx, tableName) {
  if (baseConnector.getTableColumns) {
    return baseConnector.getTableColumns(ctx, tableName);
  } else {
    return new Promise(function(resolve, reject) {
      const sqlCommand = `SELECT column_name FROM information_schema.COLUMNS WHERE TABLE_NAME = '${tableName}';`;
      baseConnector.sqlQuery(ctx, sqlCommand, function(error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  }
};
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
