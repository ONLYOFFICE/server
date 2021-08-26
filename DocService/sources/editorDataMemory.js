/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');

function EditorData() {
  this.data = {};
  this.forceSaveTimer = {};
  this.uniqueUser = {};
  this.shutdown = {};
  this.stat = [];
}

EditorData.prototype._getDocumentData = function(docId) {
  let options = this.data[docId];
  if (!options) {
    this.data[docId] = options = {};
  }
  return options;
};
EditorData.prototype._checkAndLock = function(name, docId, fencingToken, ttl) {
  let data = this._getDocumentData(docId);
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
EditorData.prototype._checkAndUnlock = function(name, docId, fencingToken) {
  let data = this._getDocumentData(docId);
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

EditorData.prototype.addPresence = function(docId, userId, userInfo) {
  return Promise.resolve();
};
EditorData.prototype.removePresence = function(docId, userId) {
  return Promise.resolve();
};
EditorData.prototype.getPresence = function(docId, connections) {
  let hvals = [];
  for (let i = 0; i < connections.length; ++i) {
    if (connections[i].docId === docId) {
      hvals.push(utils.getConnectionInfoStr(connections[i]));
    }
  }
  return Promise.resolve(hvals);
};

EditorData.prototype.lockSave = function(docId, userId, ttl) {
  return this._checkAndLock('lockSave', docId, userId, ttl);
};
EditorData.prototype.unlockSave = function(docId, userId) {
  return this._checkAndUnlock('lockSave', docId, userId);
};
EditorData.prototype.lockAuth = function(docId, userId, ttl) {
  return this._checkAndLock('lockAuth', docId, userId, ttl);
};
EditorData.prototype.unlockAuth = function(docId, userId) {
  return this._checkAndUnlock('lockAuth', docId, userId);
};

EditorData.prototype.getDocumentPresenceExpired = function(now) {
  return Promise.resolve([]);
};
EditorData.prototype.removePresenceDocument = function(docId) {
  return Promise.resolve();
};

EditorData.prototype.addLocks = function(docId, locks) {
  let data = this._getDocumentData(docId);
  if (!data.locks) {
    data.locks = [];
  }
  data.locks = data.locks.concat(locks);
  return Promise.resolve();
};
EditorData.prototype.removeLocks = function(docId) {
  let data = this._getDocumentData(docId);
  data.locks = undefined;
  return Promise.resolve();
};
EditorData.prototype.getLocks = function(docId) {
  let data = this._getDocumentData(docId);
  return Promise.resolve(data.locks || []);
};

EditorData.prototype.addMessage = function(docId, msg) {
  let data = this._getDocumentData(docId);
  if (!data.messages) {
    data.messages = [];
  }
  data.messages.push(msg);
  return Promise.resolve();
};
EditorData.prototype.removeMessages = function(docId) {
  let data = this._getDocumentData(docId);
  data.messages = undefined;
  return Promise.resolve();
};
EditorData.prototype.getMessages = function(docId) {
  let data = this._getDocumentData(docId);
  return Promise.resolve(data.messages || []);
};

EditorData.prototype.setSaved = function(docId, status) {
  let data = this._getDocumentData(docId);
  data.saved = status;
  return Promise.resolve();
};
EditorData.prototype.getdelSaved = function(docId) {
  let data = this._getDocumentData(docId);
  let res = data.saved;
  data.saved = undefined;
  return Promise.resolve(res);
};
EditorData.prototype.setForceSave = function(docId, time, index, baseUrl, changeInfo) {
  let data = this._getDocumentData(docId);
  data.forceSave = {time: time, index: index, baseUrl: baseUrl, changeInfo: changeInfo, started: false, ended: false};
  return Promise.resolve();
};
EditorData.prototype.getForceSave = function(docId) {
  let data = this._getDocumentData(docId);
  return Promise.resolve(data.forceSave || null);
};
EditorData.prototype.checkAndStartForceSave = function(docId) {
  let data = this._getDocumentData(docId);
  let res;
  if (data.forceSave && !data.forceSave.started) {
    data.forceSave.started = true;
    data.forceSave.ended = false;
    res = data.forceSave;
  }
  return Promise.resolve(res);
};
EditorData.prototype.checkAndSetForceSave = function(docId, time, index, started, ended) {
  let data = this._getDocumentData(docId);
  let res;
  if (data.forceSave && time === data.forceSave.time && index === data.forceSave.index) {
    data.forceSave.started = started;
    data.forceSave.ended = ended;
    res = data.forceSave;
  }
  return Promise.resolve(res);
};
EditorData.prototype.removeForceSave = function(docId) {
  let data = this._getDocumentData(docId);
  data.forceSave = undefined;
  return Promise.resolve();
};

EditorData.prototype.cleanDocumentOnExit = function(docId) {
  delete this.data[docId];
  delete this.forceSaveTimer[docId];
  return Promise.resolve();
};

EditorData.prototype.addForceSaveTimerNX = function(docId, expireAt) {
  if (!this.forceSaveTimer[docId]) {
    this.forceSaveTimer[docId] = expireAt;
  }
  return Promise.resolve();
};
EditorData.prototype.getForceSaveTimer = function(now) {
  let res = [];
  for (let docId in this.forceSaveTimer) {
    if (this.forceSaveTimer.hasOwnProperty(docId)) {
      if (this.forceSaveTimer[docId] < now) {
        res.push(docId);
        delete this.forceSaveTimer[docId];
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.addPresenceUniqueUser = function(userId, expireAt, userInfo) {
  this.uniqueUser[userId] = {expireAt: expireAt, userInfo: userInfo};
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueUser = function(nowUTC) {
  let res = [];
  for (let userId in this.uniqueUser) {
    if (this.uniqueUser.hasOwnProperty(userId)) {
      if (this.uniqueUser[userId].expireAt > nowUTC) {
        let elem = this.uniqueUser[userId];
        let newElem = {userid: userId, expire: new Date(elem.expireAt * 1000)};
        Object.assign(newElem, elem.userInfo);
        res.push(newElem);
      } else {
        delete this.uniqueUser[userId];
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.setEditorConnections = function(countEdit, countView, now, precision) {
  this.stat.push({time: now, edit: countEdit, view: countView});
  let i = 0;
  while (i < this.stat.length && this.stat[i] < now - precision[precision.length - 1].val) {
    i++;
  }
  this.stat.splice(0, i);
  return Promise.resolve();
};
EditorData.prototype.getEditorConnections = function() {
  return Promise.resolve(this.stat);
};
EditorData.prototype.setEditorConnectionsCountByShard = function(shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.incrEditorConnectionsCountByShard = function(shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.getEditorConnectionsCount = function(connections) {
  let count = 0;
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (!(conn.isCloseCoAuthoring || (conn.user && conn.user.view))) {
      count++;
    }
  }
  return Promise.resolve(count);
};
EditorData.prototype.setViewerConnectionsCountByShard = function(shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.incrViewerConnectionsCountByShard = function(shardId, count) {
  return Promise.resolve();
};
EditorData.prototype.getViewerConnectionsCount = function(connections) {
  let count = 0;
  for (let i = 0; i < connections.length; ++i) {
    let conn = connections[i];
    if (conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
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
  return Promise.resolve(false);
};

EditorData.prototype.isConnected = function() {
  return true;
};
EditorData.prototype.ping = function() {
  return Promise.resolve();
};

module.exports = EditorData;
