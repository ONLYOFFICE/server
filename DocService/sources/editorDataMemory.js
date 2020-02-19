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

function EditorData() {
  this.data = {};
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
  let res = true;
  if (data[name] && now < data[name].expireAt && fencingToken !== data[name].fencingToken) {
    res = false;
  } else {
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
EditorData.prototype.lockForceSaveTimer = function(docId, ttl) {
  return this._checkAndLock('lockForceSaveTimer', docId, 1, ttl);
};
EditorData.prototype.unlockForceSaveTimer = function(docId) {
  return this._checkAndUnlock('lockForceSaveTimer', docId, 1);
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

EditorData.prototype.setLastSave = function(docId, time, index) {
  let data = this._getDocumentData(docId);
  data.lastSave = {time: time, index: index};
  return Promise.resolve();
};
EditorData.prototype.getLastSave = function(docId) {
  let data = this._getDocumentData(docId);
  return Promise.resolve(data.lastSave);
};
EditorData.prototype.removeLastSave = function(docId) {
  let data = this._getDocumentData(docId);
  data.lastSave = undefined;
  return Promise.resolve();
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
EditorData.prototype.setForceSave = function(docId, key, val) {
  let data = this._getDocumentData(docId);
  if (!data.forceSave) {
    data.forceSave = {};
  }
  data.forceSave[key] = val;
  return Promise.resolve();
};
EditorData.prototype.setForceSaveNX = function(docId, key, val) {
  let res = false;
  let data = this._getDocumentData(docId);
  if (!data.forceSave) {
    data.forceSave = {};
  }
  if (!data.forceSave[key]) {
    data.forceSave[key] = val;
    res = true;
  }
  return Promise.resolve(res);
};
EditorData.prototype.getForceSave = function(docId, key) {
  let data = this._getDocumentData(docId);
  if (!data.forceSave) {
    data.forceSave = {};
  }
  return Promise.resolve(data.forceSave[key]);
};
EditorData.prototype.removeForceSaveKey = function(docId, key) {
  let data = this._getDocumentData(docId);
  if (!data.forceSave) {
    data.forceSave = {};
  }
  delete data.forceSave[key];
  return Promise.resolve();
};
EditorData.prototype.removeForceSave = function(docId) {
  let data = this._getDocumentData(docId);
  if (!data.forceSave) {
    data.forceSave = {};
  }
  data.forceSave = undefined;
  return Promise.resolve();
};

EditorData.prototype.cleanDocumentOnExit = function(docId) {
  delete this.data[docId];
  return Promise.resolve();
};

EditorData.prototype.addForceSaveTimer = function(docId, expireAt) {
  if (!this.data.forceSaveTimer) {
    this.data.forceSaveTimer = {};
  }
  this.data.forceSaveTimer[docId] = expireAt;
  return Promise.resolve();
};
EditorData.prototype.getForceSaveTimer = function(now) {
  if (!this.data.forceSaveTimer) {
    this.data.forceSaveTimer = {};
  }
  let res = [];
  for (let docId in this.data.forceSaveTimer) {
    if (this.data.forceSaveTimer.hasOwnProperty(docId)) {
      if (this.data.forceSaveTimer[docId] < now) {
        res.push(docId);
        delete this.data.forceSaveTimer[docId];
      }
    }
  }
  return Promise.resolve(res);
};

EditorData.prototype.addPresenceUniqueUser = function(userId, expireAt) {
  if (!this.data.uniqueUser) {
    this.data.uniqueUser = {};
  }
  this.data.uniqueUser[userId] = expireAt;
  return Promise.resolve();
};
EditorData.prototype.getPresenceUniqueUser = function(nowUTC) {
  if (!this.data.uniqueUser) {
    this.data.uniqueUser = {};
  }
  let res = [];
  for (let userId in this.data.uniqueUser) {
    if (this.data.uniqueUser.hasOwnProperty(userId)) {
      if (this.data.uniqueUser[userId] > nowUTC) {
        res.push(userId);
      } else {
        delete this.data.uniqueUser[userId];
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
