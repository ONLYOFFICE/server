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
    msSql       : 'mssql',
	postgreSql	: 'postgres',
	dameng	: 'dameng',
    oracle: 'oracle'
};

const connectorUtilities = require('./connectorUtilities');
var bottleneck = require("bottleneck");
var config = require('config');
var configSql = config.get('services.CoAuthoring.sql');
const dbType = configSql.get('type');

var baseConnector;
switch (dbType) {
  case sqlDataBaseType.mySql:
  case sqlDataBaseType.mariaDB:
    baseConnector = require('./mySqlBaseConnector');
    break;
  case sqlDataBaseType.msSql:
    baseConnector = require('./msSqlServerConnector');
    break;
  case sqlDataBaseType.dameng:
    baseConnector = require('./damengBaseConnector');
    break;
  case sqlDataBaseType.oracle:
    baseConnector = require('./oracleBaseConnector');
    break;
  default:
    baseConnector = require('./postgreSqlBaseConnector');
    break;
}

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

  const indexBytes = 4;
  const timeBytes = 8;
  for (; i < l; ++i, ++index) {
    //49 - length of "($1001,... $1008),"
    //4 is max utf8 bytes per symbol
    lengthUtf8Row = 49 + 4 * (ctx.tenant.length + docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[i].change.length) + indexBytes + timeBytes;
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
    let sql;
    switch (dbType) {
      case sqlDataBaseType.oracle: {
        sql = 'SELECT 1 FROM DUAL';
        break;
      }
      default: {
        sql = 'SELECT 1;';
      }
    }

    baseConnector.sqlQuery(ctx, sql, function(error, result) {
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
exports.UserCallback = connectorUtilities.UserCallback;
exports.DocumentPassword = connectorUtilities.DocumentPassword;
exports.DocumentAdditional = connectorUtilities.DocumentAdditional;