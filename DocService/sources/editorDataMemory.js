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
const config = require('config');
const ms = require('ms');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const tenantManager = require('./../../Common/sources/tenantManager');

const cfgExpMonthUniqueUsers = ms(config.get('services.CoAuthoring.expire.monthUniqueUsers'));

function EditorData() {
  this.data = {};
  this.forceSaveTimer = {};
  this.uniqueUser = {};
  this.uniqueUsersOfMonth = {};
  this.uniqueViewUser = {};
  this.uniqueViewUsersOfMonth = {};
  this.shutdown = {};
  this.stat = {};
}
EditorData.prototype.connect = function() {
  return Promise.resolve();
};
EditorData.prototype._getDocumentData = function(ctx, docId) {
  let tenantData = this.data[ctx.tenant];
  if (!tenantData) {
    this.data[ctx.tenant] = tenantData = {};
  }
  let options = tenantData[docId];
  if (!options) {
    tenantData[docId] = options = {};
  }
  return options;
};
EditorData.prototype._checkAndLock = function(ctx, name, docId, fencingToken, ttl) {
  let data = this._getDocumentData(ctx, docId);
  const now = Date.now();
  let res = true;
  if (data[name] && now < data[name].expireAt && fencingToken !== data[name].fencingToken) {
    res = false;
  } else {
    const expireAt = now + ttl * 1000;
    data[name] = {fencingToken: fencingToken, expireAt: expireAt};
  }
  return Promise.resolve(res);
};
EditorData.prototype._checkAndUnlock = function(ctx, name, docId, fencingToken) {
  let data = this._getDocumentData(ctx, docId);
  const now = Date.now();
  let res;
  if (data[name] && now < data[name].expireAt) {
    if (fencingToken === data[name].fencingToken) {
      res = commonDefines.c_oAscUnlockRes.Unlocked;
      delete data[name];
    } else {
      res = commonDefines.c_oAscUnlockRes.Locked;
    }
  } else {
    res = commonDefines.c_oAscUnlockRes.Empty;
    delete data[name];
  }
  return Promise.resolve(res);
};

EditorData.prototype.addPresence = function(ctx, docId, userId, userInfo) {
  return Promise.resolve();
};
EditorData.prototype.removePresence = function(ctx, docId, userId) {
  return Promise.resolve();
};
EditorData.prototype.getPresence = function(ctx, docId, connections) {
  let hvals = [];
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (conn.docId === docId && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
      hvals.push(utils.getConnectionInfoStr(conn));
    }
  }
  return Promise.resolve(hvals);
};

EditorData.prototype.lockSave = function(ctx, docId, userId, ttl) {
  return this._checkAndLock(ctx, 'lockSave', docId, userId, ttl);
};
EditorData.prototype.unlockSave = function(ctx, docId, userId) {
  return this._checkAndUnlock(ctx, 'lockSave', docId, userId);
};
EditorData.prototype.lockAuth = function(ctx, docId, userId, ttl) {
  return this._checkAndLock(ctx, 'lockAuth', docId, userId, ttl);
};
EditorData.prototype.unlockAuth = function(ctx, docId, userId) {
  return this._checkAndUnlock(ctx, 'lockAuth', docId, userId);
};

EditorData.prototype.getDocumentPresenceExpired = function(now) {
  return Promise.resolve([]);
};
EditorData.prototype.removePresenceDocument = function(ctx, docId) {
  return Promise.resolve();
};

EditorData.prototype.addLocks = function(ctx, docId, locks) {
  let data = this._getDocumentData(ctx, docId);
  if (!data.locks) {
    data.locks = [];
  }
  data.locks = data.locks.concat(locks);
  return Promise.resolve();
};
EditorData.prototype.removeLocks = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  data.locks = undefined;
  return Promise.resolve();
};
EditorData.prototype.getLocks = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  return Promise.resolve(data.locks || []);
};

EditorData.prototype.addMessage = function(ctx, docId, msg) {
  let data = this._getDocumentData(ctx, docId);
  if (!data.messages) {
    data.messages = [];
  }
  data.messages.push(msg);
  return Promise.resolve();
};
EditorData.prototype.removeMessages = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  data.messages = undefined;
  return Promise.resolve();
};
EditorData.prototype.getMessages = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  return Promise.resolve(data.messages || []);
};

EditorData.prototype.setSaved = function(ctx, docId, status) {
  let data = this._getDocumentData(ctx, docId);
  data.saved = status;
  return Promise.resolve();
};
EditorData.prototype.getdelSaved = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  let res = data.saved;
  data.saved = undefined;
  return Promise.resolve(res);
};
EditorData.prototype.setForceSave = function(ctx, docId, time, index, baseUrl, changeInfo, convertInfo) {
  let data = this._getDocumentData(ctx, docId);
  data.forceSave = {time, index, baseUrl, changeInfo, started: false, ended: false, convertInfo};
  return Promise.resolve();
};
EditorData.prototype.getForceSave = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  return Promise.resolve(data.forceSave || null);
};
EditorData.prototype.checkAndStartForceSave = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  let res;
  if (data.forceSave && !data.forceSave.started) {
    data.forceSave.started = true;
    data.forceSave.ended = false;
    res = data.forceSave;
  }
  return Promise.resolve(res);
};
EditorData.prototype.checkAndSetForceSave = function(ctx, docId, time, index, started, ended, convertInfo) {
  let data = this._getDocumentData(ctx, docId);
  let res;
  if (data.forceSave && time === data.forceSave.time && index === data.forceSave.index) {
    data.forceSave.started = started;
    data.forceSave.ended = ended;
    data.forceSave.convertInfo = convertInfo;
    res = data.forceSave;
  }
  return Promise.resolve(res);
};
EditorData.prototype.removeForceSave = function(ctx, docId) {
  let data = this._getDocumentData(ctx, docId);
  data.forceSave = undefined;
  return Promise.resolve();
};

EditorData.prototype.cleanDocumentOnExit = function(ctx, docId) {
  let tenantData = this.data[ctx.tenant];
  if (tenantData) {
    delete tenantData[docId];
  }
  let tenantTimer = this.forceSaveTimer[ctx.tenant];
  if (tenantTimer) {
    delete tenantTimer[docId];
  }
  return Promise.resolve();
};

EditorData.prototype.addForceSaveTimerNX = function(ctx, docId, expireAt) {
  let tenantTimer = this.forceSaveTimer[ctx.tenant];
  if (!tenantTimer) {
    this.forceSaveTimer[ctx.tenant] = tenantTimer = {};
  }
  if (!tenantTimer[docId]) {
    tenantTimer[docId] = expireAt;
  }
  return Promise.resolve();
};
EditorData.prototype.getForceSaveTimer = function(now) {
  let res = [];
  for (let tenant in this.forceSaveTimer) {
    if (this.forceSaveTimer.hasOwnProperty(tenant)) {
      let tenantTimer = this.forceSaveTimer[tenant];
      for (let docId in tenantTimer) {
        if (tenantTimer.hasOwnProperty(docId)) {
          if (tenantTimer[docId] < now) {
            res.push([tenant, docId]);
            delete tenantTimer[docId];
          }
        }
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.addPresenceUniqueUser = function(ctx, userId, expireAt, userInfo) {
  let tenantUser = this.uniqueUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUser[ctx.tenant] = tenantUser = {};
  }
  tenantUser[userId] = {expireAt: expireAt, userInfo: userInfo};
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueUser = function(ctx, nowUTC) {
  let res = [];
  let tenantUser = this.uniqueUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUser[ctx.tenant] = tenantUser = {};
  }
  for (let userId in tenantUser) {
    if (tenantUser.hasOwnProperty(userId)) {
      if (tenantUser[userId].expireAt > nowUTC) {
        let elem = tenantUser[userId];
        let newElem = {userid: userId, expire: new Date(elem.expireAt * 1000)};
        Object.assign(newElem, elem.userInfo);
        res.push(newElem);
      } else {
        delete tenantUser[userId];
      }
    }
  }
  return Promise.resolve(res);
};
EditorData.prototype.addPresenceUniqueUsersOfMonth = function(ctx, userId, period, userInfo) {
  let tenantUser = this.uniqueUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  if(!tenantUser[period]) {
    let expireAt = Date.now() + cfgExpMonthUniqueUsers;
    tenantUser[period] = {expireAt: expireAt, data: {}};
  }
  tenantUser[period].data[userId] = userInfo;
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueUsersOfMonth = function(ctx) {
  let res = {};
  let nowUTC = Date.now();
  let tenantUser = this.uniqueUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  for (let periodId in tenantUser) {
    if (tenantUser.hasOwnProperty(periodId)) {
      if (tenantUser[periodId].expireAt <= nowUTC) {
        delete tenantUser[periodId];
      } else {
        let date = new Date(parseInt(periodId)).toISOString();
        res[date] = tenantUser[periodId].data;
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.addPresenceUniqueViewUser = function(ctx, userId, expireAt, userInfo) {
  let tenantUser = this.uniqueViewUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUser[ctx.tenant] = tenantUser = {};
  }
  tenantUser[userId] = {expireAt: expireAt, userInfo: userInfo};
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueViewUser = function(ctx, nowUTC) {
  let res = [];
  let tenantUser = this.uniqueViewUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUser[ctx.tenant] = tenantUser = {};
  }
  for (let userId in tenantUser) {
    if (tenantUser.hasOwnProperty(userId)) {
      if (tenantUser[userId].expireAt > nowUTC) {
        let elem = tenantUser[userId];
        let newElem = {userid: userId, expire: new Date(elem.expireAt * 1000)};
        Object.assign(newElem, elem.userInfo);
        res.push(newElem);
      } else {
        delete tenantUser[userId];
      }
    }
  }
  return Promise.resolve(res);
};
EditorData.prototype.addPresenceUniqueViewUsersOfMonth = function(ctx, userId, period, userInfo) {
  let tenantUser = this.uniqueViewUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  if(!tenantUser[period]) {
    let expireAt = Date.now() + cfgExpMonthUniqueUsers;
    tenantUser[period] = {expireAt: expireAt, data: {}};
  }
  tenantUser[period].data[userId] = userInfo;
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueViewUsersOfMonth = function(ctx) {
  let res = {};
  let nowUTC = Date.now();
  let tenantUser = this.uniqueViewUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  for (let periodId in tenantUser) {
    if (tenantUser.hasOwnProperty(periodId)) {
      if (tenantUser[periodId].expireAt <= nowUTC) {
        delete tenantUser[periodId];
      } else {
        let date = new Date(parseInt(periodId)).toISOString();
        res[date] = tenantUser[periodId].data;
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.setEditorConnections = function(ctx, countEdit, countLiveView, countView, now, precision) {
  let tenantStat = this.stat[ctx.tenant];
  if (!tenantStat) {
    this.stat[ctx.tenant] = tenantStat = [];
  }
  tenantStat.push({time: now, edit: countEdit, liveview: countLiveView, view: countView});
  let i = 0;
  while (i < tenantStat.length && tenantStat[i] < now - precision[precision.length - 1].val) {
    i++;
  }
  tenantStat.splice(0, i);
  return Promise.resolve();
};
EditorData.prototype.getEditorConnections = function(ctx) {
  let tenantStat = this.stat[ctx.tenant];
  if (!tenantStat) {
    this.stat[ctx.tenant] = tenantStat = [];
  }
  return Promise.resolve(tenantStat);
};
EditorData.prototype.setEditorConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.incrEditorConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.getEditorConnectionsCount = function(ctx, connections) {
  let count = 0;
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (!(conn.isCloseCoAuthoring || (conn.user && conn.user.view)) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
      count++;
    }
  }
  return Promise.resolve(count);
};
EditorData.prototype.setViewerConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.incrViewerConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.getViewerConnectionsCount = function(ctx, connections) {
  let count = 0;
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (conn.isCloseCoAuthoring || (conn.user && conn.user.view) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
      count++;
    }
  }
  return Promise.resolve(count);
};
EditorData.prototype.setLiveViewerConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.incrLiveViewerConnectionsCountByShard = function(ctx, shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.getLiveViewerConnectionsCount = function(ctx, connections) {
  let count = 0;
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (utils.isLiveViewer(conn) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
      count++;
    }
  }
  return Promise.resolve(count);
};

EditorData.prototype.addShutdown = function(key, docId) {
  if (!this.shutdown[key]) {
    this.shutdown[key] = {};
  }
  this.shutdown[key][docId] = 1;
  return Promise.resolve();
};
EditorData.prototype.removeShutdown = function(key, docId) {
  if (!this.shutdown[key]) {
    this.shutdown[key] = {};
  }
  delete this.shutdown[key][docId];
  return Promise.resolve();
};
EditorData.prototype.getShutdownCount = function(key) {
  let count = 0;
  if (this.shutdown[key]) {
    for (let docId in this.shutdown[key]) {
      if (this.shutdown[key].hasOwnProperty(docId)) {
        count++;
      }
    }
  }
  return Promise.resolve(count);
};
EditorData.prototype.cleanupShutdown = function(key) {
  delete this.shutdown[key];
  return Promise.resolve();
};

EditorData.prototype.setLicense = function(key, val) {
  return Promise.resolve();
};
EditorData.prototype.getLicense = function(key) {
  return Promise.resolve(null);
};
EditorData.prototype.removeLicense = function(key) {
  return Promise.resolve();
};

EditorData.prototype.isConnected = function() {
  return true;
};
EditorData.prototype.ping = function() {
  return Promise.resolve();
};
EditorData.prototype.close = function() {
  return Promise.resolve();
};

module.exports = EditorData;
