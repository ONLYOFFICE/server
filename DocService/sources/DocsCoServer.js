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

/*
 -------------------------------------------------- --view-mode----------------------------------------------------- ------------
 * 1) For the view mode, we update the page (without a quick transition) so that the user is not considered editable and does not
 * held the document for assembly (if you do not wait, then the quick transition from view to edit is incomprehensible when the document has already been assembled)
 * 2) If the user is in view mode, then he does not participate in editing (only in chat). When opened, it receives
 * all current changes in the document at the time of opening. For view-mode we do not accept changes and do not send them
 * view-users (because it is not clear what to do in a situation where 1-user has made changes,
 * saved and made undo).
 *---------------------------------------------------------------- -------------------------------------------------- --------------------
 *------------------------------------------------Scheme save------------------------------------------------- ------
 * a) One user - the first time changes come without an index, then changes come with an index, you can do
 * undo-redo (history is not rubbed). If autosave is enabled, then it is for any action (no more than 5 seconds).
 * b) As soon as the second user enters, co-editing begins. A lock is placed on the document so that
 * the first user managed to save the document (or send unlock)
 * c) When there are 2 or more users, each save rubs the history and is sent in its entirety (no index). If
 * autosave is enabled, it is saved no more than once every 10 minutes.
 * d) When the user is left alone, after accepting someone else's changes, point 'a' begins
 *---------------------------------------------------------------- -------------------------------------------------- --------------------
 *-------------------------------------------- Scheme of working with the server- -------------------------------------------------- -
 * a) When everyone leaves, after the cfgAscSaveTimeOutDelay time, the assembly command is sent to the document server.
 * b) If the status '1' comes to CommandService.ashx, then it was possible to save and raise the version. Clear callbacks and
 * changes from base and from memory.
 * c) If a status other than '1' arrives (this can include both the generation of the file and the work of an external subscriber
 * with the finished result), then three callbacks, and leave the changes. Because you can go to the old
 * version and get uncompiled changes. We also reset the status of the file to unassembled so that it can be
 * open without version error message.
 *---------------------------------------------------------------- -------------------------------------------------- --------------------
 *------------------------------------------------Start server------------------------------------------------- ---------
 * 1) Loading information about the collector
 * 2) Loading information about callbacks
 * 3) We collect only those files that have a callback and information for building
 *---------------------------------------------------------------- -------------------------------------------------- --------------------
 *------------------------------------------------Reconnect when disconnected--- ------------------------------------
 * 1) Check the file for assembly. If it starts, then stop.
 * 2) If the assembly has already completed, then we send the user a notification that it is impossible to edit further
 * 3) Next, check the time of the last save and lock-and user. If someone has already managed to save or
 * lock objects, then we can't edit further.
 *---------------------------------------------------------------- -------------------------------------------------- --------------------
 * */

'use strict';

const { Server } = require("socket.io");
const _ = require('underscore');
const url = require('url');
const os = require('os');
const cluster = require('cluster');
const crypto = require('crypto');
const pathModule = require('path');
const co = require('co');
const jwt = require('jsonwebtoken');
const ms = require('ms');
const deepEqual  = require('deep-equal');
const bytes = require('bytes');
const storage = require('./../../Common/sources/storage-base');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const utilsDocService = require('./utilsDocService');
const commonDefines = require('./../../Common/sources/commondefines');
const statsDClient = require('./../../Common/sources/statsdclient');
const config = require('config');
const sqlBase = require('./databaseConnectors/baseConnector');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const taskResult = require('./taskresult');
const gc = require('./gc');
const shutdown = require('./shutdown');
const pubsubService = require('./pubsubRabbitMQ');
const wopiClient = require('./wopiClient');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const operationContext = require('./../../Common/sources/operationContext');
const tenantManager = require('./../../Common/sources/tenantManager');
const { notificationTypes, ...notificationService } = require('../../Common/sources/notificationService');

const cfgEditorDataStorage = config.get('services.CoAuthoring.server.editorDataStorage');
const cfgEditorStatStorage = config.get('services.CoAuthoring.server.editorStatStorage');
const editorDataStorage = require('./' + cfgEditorDataStorage);
const editorStatStorage = require('./' + (cfgEditorStatStorage || cfgEditorDataStorage));
const util = require("util");

const cfgEditSingleton =  config.get('services.CoAuthoring.server.edit_singleton');
const cfgEditor =  config.get('services.CoAuthoring.editor');
const cfgCallbackRequestTimeout = config.get('services.CoAuthoring.server.callbackRequestTimeout');
//The waiting time to document assembly when all out(not 0 in case of F5 in the browser)
const cfgAscSaveTimeOutDelay = config.get('services.CoAuthoring.server.savetimeoutdelay');

const cfgPubSubMaxChanges = config.get('services.CoAuthoring.pubsub.maxChanges');

const cfgExpSaveLock = config.get('services.CoAuthoring.expire.saveLock');
const cfgExpLockDoc = config.get('services.CoAuthoring.expire.lockDoc');
const cfgExpSessionIdle = config.get('services.CoAuthoring.expire.sessionidle');
const cfgExpSessionAbsolute = config.get('services.CoAuthoring.expire.sessionabsolute');
const cfgExpSessionCloseCommand = config.get('services.CoAuthoring.expire.sessionclosecommand');
const cfgExpUpdateVersionStatus = config.get('services.CoAuthoring.expire.updateVersionStatus');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgTokenEnableRequestInbox = config.get('services.CoAuthoring.token.enable.request.inbox');
const cfgTokenSessionAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenSessionExpires = config.get('services.CoAuthoring.token.session.expires');
const cfgTokenInboxHeader = config.get('services.CoAuthoring.token.inbox.header');
const cfgTokenInboxPrefix = config.get('services.CoAuthoring.token.inbox.prefix');
const cfgTokenVerifyOptions = config.get('services.CoAuthoring.token.verifyOptions');
const cfgForceSaveEnable = config.get('services.CoAuthoring.autoAssembly.enable');
const cfgForceSaveInterval = config.get('services.CoAuthoring.autoAssembly.interval');
const cfgQueueRetentionPeriod = config.get('queue.retentionPeriod');
const cfgForgottenFiles = config.get('services.CoAuthoring.server.forgottenfiles');
const cfgForgottenFilesName = config.get('services.CoAuthoring.server.forgottenfilesname');
const cfgMaxRequestChanges = config.get('services.CoAuthoring.server.maxRequestChanges');
const cfgWarningLimitPercents = config.get('license.warning_limit_percents');
const cfgNotificationRuleLicenseLimitEdit = config.get('notification.rules.licenseLimitEdit.template');
const cfgNotificationRuleLicenseLimitLiveViewer = config.get('notification.rules.licenseLimitLiveViewer.template');
const cfgErrorFiles = config.get('FileConverter.converter.errorfiles');
const cfgOpenProtectedFile = config.get('services.CoAuthoring.server.openProtectedFile');
const cfgIsAnonymousSupport = config.get('services.CoAuthoring.server.isAnonymousSupport');
const cfgTokenRequiredParams = config.get('services.CoAuthoring.server.tokenRequiredParams');
const cfgImageSize = config.get('services.CoAuthoring.server.limits_image_size');
const cfgTypesUpload = config.get('services.CoAuthoring.utils.limits_image_types_upload');
const cfgForceSaveUsingButtonWithoutChanges = config.get('services.CoAuthoring.server.forceSaveUsingButtonWithoutChanges');
//todo tenant
const cfgExpDocumentsCron = config.get('services.CoAuthoring.expire.documentsCron');
const cfgRefreshLockInterval = ms(config.get('wopi.refreshLockInterval'));
const cfgSocketIoConnection = config.get('services.CoAuthoring.socketio.connection');
const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');
const cfgTableChanges = config.get('services.CoAuthoring.sql.tableChanges');

const EditorTypes = {
  document : 0,
  spreadsheet : 1,
  presentation : 2
};

const defaultHttpPort = 80, defaultHttpsPort = 443;	// Default ports (for http and https)
//todo remove editorDataStorage constructor usage after 8.1
const editorData = editorDataStorage.EditorData ? new editorDataStorage.EditorData() : new editorDataStorage();
const editorStat = editorStatStorage.EditorStat ? new editorStatStorage.EditorStat() : new editorDataStorage();
const clientStatsD = statsDClient.getClient();
let connections = []; // Active connections
let lockDocumentsTimerId = {};//to drop connection that can't unlockDocument
let pubsub;
let queue;
let shutdownFlag = false;
let expDocumentsStep = gc.getCronStep(cfgExpDocumentsCron);

const MIN_SAVE_EXPIRATION = 60000;
const HEALTH_CHECK_KEY_MAX = 10000;
const SHARD_ID = crypto.randomBytes(16).toString('base64');//16 as guid

const PRECISION = [{name: 'hour', val: ms('1h')}, {name: 'day', val: ms('1d')}, {name: 'week', val: ms('7d')},
  {name: 'month', val: ms('31d')},
];

function getIsShutdown() {
  return shutdownFlag;
}

function getEditorConfig(ctx) {
  let tenEditor = ctx.getCfg('services.CoAuthoring.editor', cfgEditor);
  tenEditor = JSON.parse(JSON.stringify(tenEditor));
  tenEditor['reconnection']['delay'] = ms(tenEditor['reconnection']['delay']);
  tenEditor['websocketMaxPayloadSize'] = bytes.parse(tenEditor['websocketMaxPayloadSize']);
  tenEditor['maxChangesSize'] = bytes.parse(tenEditor['maxChangesSize']);
  return tenEditor;
}
function getForceSaveExpiration(ctx) {
  const tenForceSaveInterval = ms(ctx.getCfg('services.CoAuthoring.autoAssembly.interval', cfgForceSaveInterval));
  const tenQueueRetentionPeriod = ctx.getCfg('queue.retentionPeriod', cfgQueueRetentionPeriod);

  return Math.min(Math.max(tenForceSaveInterval, MIN_SAVE_EXPIRATION), tenQueueRetentionPeriod * 1000);
}

function DocumentChanges(docId) {
  this.docId = docId;
  this.arrChanges = [];

  return this;
}
DocumentChanges.prototype.getLength = function() {
  return this.arrChanges.length;
};
DocumentChanges.prototype.push = function(change) {
  this.arrChanges.push(change);
};
DocumentChanges.prototype.splice = function(start, deleteCount) {
  this.arrChanges.splice(start, deleteCount);
};
DocumentChanges.prototype.slice = function(start, end) {
  return this.arrChanges.splice(start, end);
};
DocumentChanges.prototype.concat = function(item) {
  this.arrChanges = this.arrChanges.concat(item);
};

const c_oAscServerStatus = {
  NotFound: 0,
  Editing: 1,
  MustSave: 2,
  Corrupted: 3,
  Closed: 4,
  MailMerge: 5,
  MustSaveForce: 6,
  CorruptedForce: 7
};

const c_oAscChangeBase = {
  No: 0,
  Delete: 1,
  All: 2
};

const c_oAscLockTimeOutDelay = 500;	// Timeout to save when database is clamped

const c_oAscRecalcIndexTypes = {
  RecalcIndexAdd: 1,
  RecalcIndexRemove: 2
};

/**
 * lock types
 * @const
 */
const c_oAscLockTypes = {
  kLockTypeNone: 1, // no one has locked this object
  kLockTypeMine: 2, // this object is locked by the current user
  kLockTypeOther: 3, // this object is locked by another (not the current) user
  kLockTypeOther2: 4, // this object is locked by another (not the current) user (updates have already arrived)
  kLockTypeOther3: 5 // this object has been locked (updates have arrived) and is now locked again
};

const c_oAscLockTypeElem = {
  Range: 1,
  Object: 2,
  Sheet: 3
};
const c_oAscLockTypeElemSubType = {
  DeleteColumns: 1,
  InsertColumns: 2,
  DeleteRows: 3,
  InsertRows: 4,
  ChangeProperties: 5
};

const c_oAscLockTypeElemPresentation = {
  Object: 1,
  Slide: 2,
  Presentation: 3
};

function CRecalcIndexElement(recalcType, position, bIsSaveIndex) {
  if (!(this instanceof CRecalcIndexElement)) {
    return new CRecalcIndexElement(recalcType, position, bIsSaveIndex);
  }

  this._recalcType = recalcType; // Type of changes (removal or addition)
  this._position = position; // The position where the changes happened
  this._count = 1; // We consider all changes as the simplest
  this.m_bIsSaveIndex = !!bIsSaveIndex; // These are indexes from other users' changes (that we haven't applied yet)

  return this;
}

CRecalcIndexElement.prototype = {
  constructor: CRecalcIndexElement,

  // recalculate for others
  getLockOther: function(position, type) {
    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
    if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      true === this.m_bIsSaveIndex) {
      // We haven't applied someone else's changes yet (so insert doesn't need to be rendered)
      // RecalcIndexRemove (because we flip it for proper processing, from another user
      // RecalcIndexAdd arrived
      return null;
    } else if (position === this._position &&
      c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
      // For the user who deleted the column, draw previously locked cells in this column
      // no need
      return null;
    } else if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // Recalculation for others (save only)
  getLockSaveOther: function(position, type) {
    if (this.m_bIsSaveIndex) {
      return position;
    }

    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
    if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      true === this.m_bIsSaveIndex) {
      // We haven't applied someone else's changes yet (so insert doesn't need to be rendered)
      // RecalcIndexRemove (because we flip it for proper processing, from another user
      // RecalcIndexAdd arrived
      return null;
    } else if (position === this._position &&
      c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
      // For the user who deleted the column, draw previously locked cells in this column
      // no need
      return null;
    } else if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // recalculate for ourselves
  getLockMe: function(position) {
    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
    if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // Only when other users change (for recalculation)
  getLockMe2: function(position) {
    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
    if (true !== this.m_bIsSaveIndex || position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  }
};

function CRecalcIndex() {
  if (!(this instanceof CRecalcIndex)) {
    return new CRecalcIndex();
  }

  this._arrElements = [];		// CRecalcIndexElement array

  return this;
}

CRecalcIndex.prototype = {
  constructor: CRecalcIndex,
  add: function(recalcType, position, count, bIsSaveIndex) {
    for (var i = 0; i < count; ++i)
      this._arrElements.push(new CRecalcIndexElement(recalcType, position, bIsSaveIndex));
  },
  clear: function() {
    this._arrElements.length = 0;
  },

  getLockOther: function(position, type) {
    var newPosition = position;
    var count = this._arrElements.length;
    for (var i = 0; i < count; ++i) {
      newPosition = this._arrElements[i].getLockOther(newPosition, type);
      if (null === newPosition) {
        break;
      }
    }

    return newPosition;
  },
  // Recalculation for others (save only)
  getLockSaveOther: function(position, type) {
    var newPosition = position;
    var count = this._arrElements.length;
    for (var i = 0; i < count; ++i) {
      newPosition = this._arrElements[i].getLockSaveOther(newPosition, type);
      if (null === newPosition) {
        break;
      }
    }

    return newPosition;
  },
  // recalculate for ourselves
  getLockMe: function(position) {
    var newPosition = position;
    var count = this._arrElements.length;
    for (var i = count - 1; i >= 0; --i) {
      newPosition = this._arrElements[i].getLockMe(newPosition);
      if (null === newPosition) {
        break;
      }
    }

    return newPosition;
  },
  // Only when other users change (for recalculation)
  getLockMe2: function(position) {
    var newPosition = position;
    var count = this._arrElements.length;
    for (var i = count - 1; i >= 0; --i) {
      newPosition = this._arrElements[i].getLockMe2(newPosition);
      if (null === newPosition) {
        break;
      }
    }

    return newPosition;
  }
};

function updatePresenceCounters(ctx, conn, val) {
  return co(function* () {
    let aggregationCtx;
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      //aggregated server stats
      aggregationCtx = new operationContext.Context();
      aggregationCtx.init(tenantManager.getDefautTenant(), ctx.docId, ctx.userId);
      //yield ctx.initTenantCache(); //no need.only global config
    }
    if (utils.isLiveViewer(conn)) {
      yield editorStat.incrLiveViewerConnectionsCountByShard(ctx, SHARD_ID, val);
      if (aggregationCtx) {
        yield editorStat.incrLiveViewerConnectionsCountByShard(aggregationCtx, SHARD_ID, val);
      }
      if (clientStatsD) {
        let countLiveView = yield editorStat.getLiveViewerConnectionsCount(ctx, connections);
        clientStatsD.gauge('expireDoc.connections.liveview', countLiveView);
      }
    } else if (conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
      yield editorStat.incrViewerConnectionsCountByShard(ctx, SHARD_ID, val);
      if (aggregationCtx) {
        yield editorStat.incrViewerConnectionsCountByShard(aggregationCtx, SHARD_ID, val);
      }
      if (clientStatsD) {
        let countView = yield editorStat.getViewerConnectionsCount(ctx, connections);
        clientStatsD.gauge('expireDoc.connections.view', countView);
      }
    } else {
      yield editorStat.incrEditorConnectionsCountByShard(ctx, SHARD_ID, val);
      if (aggregationCtx) {
        yield editorStat.incrEditorConnectionsCountByShard(aggregationCtx, SHARD_ID, val);
      }
      if (clientStatsD) {
        let countEditors = yield editorStat.getEditorConnectionsCount(ctx, connections);
        clientStatsD.gauge('expireDoc.connections.edit', countEditors);
      }
    }
  });
}
function addPresence(ctx, conn, updateCunters) {
  return co(function* () {
    yield editorData.addPresence(ctx, conn.docId, conn.user.id, utils.getConnectionInfoStr(conn));
    if (updateCunters) {
      yield updatePresenceCounters(ctx, conn, 1);
    }
  });
}
async function updatePresence(ctx, conn) {
  if (editorData.updatePresence) {
    return await editorData.updatePresence(ctx, conn.docId, conn.user.id);
  } else {
    //todo remove if after 7.6. code for backward compatibility, because redis in separate repo
    return await editorData.addPresence(ctx, conn.docId, conn.user.id, utils.getConnectionInfoStr(conn));
  }
}
function removePresence(ctx, conn) {
  return co(function* () {
    yield editorData.removePresence(ctx, conn.docId, conn.user.id);
    yield updatePresenceCounters(ctx, conn, -1);
  });
}

let changeConnectionInfo = co.wrap(function*(ctx, conn, cmd) {
  if (!conn.denyChangeName && conn.user) {
    yield publish(ctx, {type: commonDefines.c_oPublishType.changeConnecitonInfo, ctx: ctx, docId: conn.docId, useridoriginal: conn.user.idOriginal, cmd: cmd});
    return true;
  }
  return false;
});
function signToken(ctx, payload, algorithm, expiresIn, secretElem) {
  return co(function*() {
    var options = {algorithm: algorithm, expiresIn: expiresIn};
    let secret = yield tenantManager.getTenantSecret(ctx, secretElem);
    return jwt.sign(payload, secret, options);
  });
}
function needSendChanges (conn){
  return !conn.user?.view || utils.isLiveViewer(conn);
}
function fillJwtByConnection(ctx, conn) {
  return co(function*() {
    const tenTokenSessionAlgorithm = ctx.getCfg('services.CoAuthoring.token.session.algorithm', cfgTokenSessionAlgorithm);
    const tenTokenSessionExpires = ms(ctx.getCfg('services.CoAuthoring.token.session.expires', cfgTokenSessionExpires));

    var payload = {document: {}, editorConfig: {user: {}}};
    var doc = payload.document;
    doc.key = conn.docId;
    doc.permissions = conn.permissions;
    doc.ds_encrypted = conn.encrypted;
    var edit = payload.editorConfig;
    //todo
    //edit.callbackUrl = callbackUrl;
    //edit.lang = conn.lang;
    //edit.mode = conn.mode;
    var user = edit.user;
    user.id = conn.user.idOriginal;
    user.name = conn.user.username;
    user.index = conn.user.indexUser;
    if (conn.coEditingMode) {
      edit.coEditing = {mode: conn.coEditingMode};
    }
    //no standart
    edit.ds_isCloseCoAuthoring = conn.isCloseCoAuthoring;
    edit.ds_isEnterCorrectPassword = conn.isEnterCorrectPassword;
    // presenter viewer opens with same session jwt. do not put sessionId to jwt
    // edit.ds_sessionId = conn.sessionId;
    edit.ds_sessionTimeConnect = conn.sessionTimeConnect;

    return yield signToken(ctx, payload, tenTokenSessionAlgorithm, tenTokenSessionExpires / 1000, commonDefines.c_oAscSecretType.Session);
  });
}

function sendData(ctx, conn, data) {
  conn.emit('message', data);
  const type = data ? data.type : null;
  ctx.logger.debug('sendData: type = %s', type);
}
function sendDataWarning(ctx, conn, msg) {
  sendData(ctx, conn, {type: "warning", message: msg});
}
function sendDataMessage(ctx, conn, msg) {
  if (!conn.permissions || false !== conn.permissions.chat) {
    sendData(ctx, conn, {type: "message", messages: msg});
  } else {
    ctx.logger.debug("sendDataMessage permissions.chat==false");
  }
}
function sendDataCursor(ctx, conn, msg) {
  sendData(ctx, conn, {type: "cursor", messages: msg});
}
function sendDataMeta(ctx, conn, msg) {
  sendData(ctx, conn, {type: "meta", messages: msg});
}
function sendDataSession(ctx, conn, msg) {
  sendData(ctx, conn, {type: "session", messages: msg});
}
function sendDataRefreshToken(ctx, conn, msg) {
  sendData(ctx, conn, {type: "refreshToken", messages: msg});
}
function sendDataRpc(ctx, conn, responseKey, data) {
  sendData(ctx, conn, {type: "rpc", responseKey: responseKey, data: data});
}
function sendDataDrop(ctx, conn, code, description) {
  sendData(ctx, conn, {type: "drop", code: code, description: description});
}
function sendDataDisconnectReason(ctx, conn, code, description) {
  sendData(ctx, conn, {type: "disconnectReason", code: code, description: description});
}

function sendReleaseLock(ctx, conn, userLocks) {
  sendData(ctx, conn, {type: "releaseLock", locks: _.map(userLocks, function(e) {
    return {
      block: e.block,
      user: e.user,
      time: Date.now(),
      changes: null
    };
  })});
}
function modifyConnectionForPassword(ctx, conn, isEnterCorrectPassword) {
  return co(function*() {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    if (isEnterCorrectPassword) {
      conn.isEnterCorrectPassword = true;
      if (tenTokenEnableBrowser) {
        let sessionToken = yield fillJwtByConnection(ctx, conn);
        sendDataRefreshToken(ctx, conn, sessionToken);
      }
    }
  });
}
function modifyConnectionEditorToView(ctx, conn) {
  if (conn.user) {
    conn.user.view = true;
  }
  delete conn.coEditingMode;
}
function getParticipants(docId, excludeClosed, excludeUserId, excludeViewer) {
  return _.filter(connections, function(el) {
    return el.docId === docId && el.isCloseCoAuthoring !== excludeClosed &&
      el.user.id !== excludeUserId && el.user.view !== excludeViewer;
  });
}
function getParticipantUser(docId, includeUserId) {
  return _.filter(connections, function(el) {
    return el.docId === docId && el.user.id === includeUserId;
  });
}


function* updateEditUsers(ctx, licenseInfo, userId, anonym, isLiveViewer) {
  if (!licenseInfo.usersCount) {
    return;
  }
  const now = new Date();
  const expireAt = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) / 1000 +
      licenseInfo.usersExpire - 1;
  let period = utils.getLicensePeriod(licenseInfo.startDate, now);
  if (isLiveViewer) {
    yield editorStat.addPresenceUniqueViewUser(ctx, userId, expireAt, {anonym: anonym});
    yield editorStat.addPresenceUniqueViewUsersOfMonth(ctx, userId, period, {anonym: anonym, firstOpenDate: now.toISOString()});
  } else {
    yield editorStat.addPresenceUniqueUser(ctx, userId, expireAt, {anonym: anonym});
    yield editorStat.addPresenceUniqueUsersOfMonth(ctx, userId, period, {anonym: anonym, firstOpenDate: now.toISOString()});
  }
}
function* getEditorsCount(ctx, docId, opt_hvals) {
  var elem, editorsCount = 0;
  var hvals;
  if(opt_hvals){
    hvals = opt_hvals;
  } else {
    hvals = yield editorData.getPresence(ctx, docId, connections);
  }
  for (var i = 0; i < hvals.length; ++i) {
    elem = JSON.parse(hvals[i]);
    if(!elem.view && !elem.isCloseCoAuthoring) {
      editorsCount++;
      break;
    }
  }
  return editorsCount;
}
function* hasEditors(ctx, docId, opt_hvals) {
  let editorsCount = yield* getEditorsCount(ctx, docId, opt_hvals);
  return editorsCount > 0;
}
function* isUserReconnect(ctx, docId, userId, connectionId) {
  var elem;
  var hvals = yield editorData.getPresence(ctx, docId, connections);
  for (var i = 0; i < hvals.length; ++i) {
    elem = JSON.parse(hvals[i]);
    if (userId === elem.id && connectionId !== elem.connectionId) {
      return true;
    }
  }
  return false;
}

let pubsubOnMessage = null;//todo move function
async function publish(ctx, data, optDocId, optUserId, opt_pubsub) {
  var needPublish = true;
  let hvals;
  if (optDocId && optUserId) {
    needPublish = false;
    hvals = await editorData.getPresence(ctx, optDocId, connections);
    for (var i = 0; i < hvals.length; ++i) {
      var elem = JSON.parse(hvals[i]);
      if (optUserId != elem.id) {
        needPublish = true;
        break;
      }
    }
  }
  if (needPublish) {
    var msg = JSON.stringify(data);
    var realPubsub = opt_pubsub ? opt_pubsub : pubsub;
    //don't use pubsub if all connections are local
    if (pubsubOnMessage && hvals && hvals.length === getLocalConnectionCount(ctx, optDocId)) {
      ctx.logger.debug("pubsub locally");
      //todo send connections from getLocalConnectionCount to pubsubOnMessage
      pubsubOnMessage(msg);
    } else if(realPubsub) {
      await realPubsub.publish(msg);
    }
  }
  return needPublish;
}
function* addTask(data, priority, opt_queue, opt_expiration) {
  var realQueue = opt_queue ? opt_queue : queue;
  yield realQueue.addTask(data, priority, opt_expiration);
}
function* addResponse(data, opt_queue) {
  var realQueue = opt_queue ? opt_queue : queue;
  yield realQueue.addResponse(data);
}
function* addDelayed(data, ttl, opt_queue) {
  var realQueue = opt_queue ? opt_queue : queue;
  yield realQueue.addDelayed(data, ttl);
}
function* removeResponse(data) {
  yield queue.removeResponse(data);
}

async function getOriginalParticipantsId(ctx, docId) {
  var result = [], tmpObject = {};
  var hvals = await editorData.getPresence(ctx, docId, connections);
  for (var i = 0; i < hvals.length; ++i) {
    var elem = JSON.parse(hvals[i]);
    if (!elem.view && !elem.isCloseCoAuthoring) {
      tmpObject[elem.idOriginal] = 1;
    }
  }
  for (var name in tmpObject) if (tmpObject.hasOwnProperty(name)) {
    result.push(name);
  }
  return result;
}

async function sendServerRequest(ctx, uri, dataObject, opt_checkAndFixAuthorizationLength) {
  const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);

  ctx.logger.debug('postData request: url = %s;data = %j', uri, dataObject);
  let auth;
  if (utils.canIncludeOutboxAuthorization(ctx, uri)) {
    let secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Outbox);
    let bodyToken = utils.fillJwtForRequest(ctx, dataObject, secret, true);
    auth = utils.fillJwtForRequest(ctx, dataObject, secret, false);
    let authLen = auth.length;
    if (opt_checkAndFixAuthorizationLength && !opt_checkAndFixAuthorizationLength(auth, dataObject)) {
      auth = utils.fillJwtForRequest(ctx, dataObject, secret, false);
      ctx.logger.warn('authorization too large. Use body token instead. size reduced from %d to %d', authLen, auth.length);
    }
    dataObject.setToken(bodyToken);
  }
  let headers = {'Content-Type': 'application/json'};
  let postRes = await utils.postRequestPromise(ctx, uri, JSON.stringify(dataObject), undefined, undefined, tenCallbackRequestTimeout, auth, headers);
  ctx.logger.debug('postData response: data = %s', postRes.body);
  return postRes.body;
}

function parseUrl(ctx, callbackUrl) {
  var result = null;
  try {
    //no need to do decodeURIComponent http://expressjs.com/en/4x/api.html#app.settings.table
    //by default express uses 'query parser' = 'extended', but even in 'simple' version decode is done
    //percent-encoded characters within the query string will be assumed to use UTF-8 encoding
    var parseObject = url.parse(callbackUrl);
    var isHttps = 'https:' === parseObject.protocol;
    var port = parseObject.port;
    if (!port) {
      port = isHttps ? defaultHttpsPort : defaultHttpPort;
    }
    result = {
      'https': isHttps,
      'host': parseObject.hostname,
      'port': port,
      'path': parseObject.path,
      'href': parseObject.href
    };
  } catch (e) {
    ctx.logger.error("error parseUrl %s: %s", callbackUrl, e.stack);
    result = null;
  }

  return result;
}

async function getCallback(ctx, id, opt_userIndex) {
  var callbackUrl = null;
  var baseUrl = null;
  let wopiParams = null;
  var selectRes = await taskResult.select(ctx, id);
  if (selectRes.length > 0) {
    var row = selectRes[0];
    if (row.callback) {
      callbackUrl = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback, opt_userIndex);
      wopiParams = wopiClient.parseWopiCallback(ctx, callbackUrl, row.callback);
    }
    if (row.baseurl) {
      baseUrl = row.baseurl;
    }
  }
  if (null != callbackUrl && null != baseUrl) {
    return {server: parseUrl(ctx, callbackUrl), baseUrl: baseUrl, wopiParams: wopiParams};
  } else {
    return null;
  }
}
function* getChangesIndex(ctx, docId) {
  var res = 0;
  var getRes = yield sqlBase.getChangesIndexPromise(ctx, docId);
  if (getRes && getRes.length > 0 && null != getRes[0]['change_id']) {
    res = getRes[0]['change_id'] + 1;
  }
  return res;
}

const hasChanges = co.wrap(function*(ctx, docId) {
  //todo check editorData.getForceSave in case of "undo all changes"
  let puckerIndex = yield* getChangesIndex(ctx, docId);
  if (0 === puckerIndex) {
    let selectRes = yield taskResult.select(ctx, docId);
    if (selectRes.length > 0 && selectRes[0].password) {
      return sqlBase.DocumentPassword.prototype.hasPasswordChanges(ctx, selectRes[0].password);
    }
    return false;
  }
  return true;
});
function* setForceSave(ctx, docId, forceSave, cmd, success, url) {
  let forceSaveType = forceSave.getType();
  let end = success;
  if (commonDefines.c_oAscForceSaveTypes.Form === forceSaveType || commonDefines.c_oAscForceSaveTypes.Internal === forceSaveType) {
    let forceSave = yield editorData.getForceSave(ctx, docId);
    end = forceSave.ended;
  }
  let convertInfo = new commonDefines.InputCommand(cmd, true);
  //remove request specific fields from cmd
  convertInfo.setUserConnectionDocId(undefined);
  convertInfo.setUserConnectionId(undefined);
  convertInfo.setResponseKey(undefined);
  convertInfo.setFormData(undefined);
  if (convertInfo.getForceSave()) {
    //type must be saved to distinguish c_oAscForceSaveTypes.Form
    //convertInfo.getForceSave().setType(undefined);
    convertInfo.getForceSave().setAuthorUserId(undefined);
    convertInfo.getForceSave().setAuthorUserIndex(undefined);
  }
  yield editorData.checkAndSetForceSave(ctx, docId, forceSave.getTime(), forceSave.getIndex(), end, end, convertInfo);

  if (commonDefines.c_oAscForceSaveTypes.Command !== forceSaveType) {
    let data = {type: forceSaveType, time: forceSave.getTime(), success: success};
    if(commonDefines.c_oAscForceSaveTypes.Form === forceSaveType || commonDefines.c_oAscForceSaveTypes.Internal === forceSaveType) {
      let code = success ? commonDefines.c_oAscServerCommandErrors.NoError : commonDefines.c_oAscServerCommandErrors.UnknownError;
      data = {code: code, time: null, inProgress: false};
      if (commonDefines.c_oAscForceSaveTypes.Internal === forceSaveType) {
        data.url = url;
      }
      let userId = cmd.getUserConnectionId();
      docId = cmd.getUserConnectionDocId() || docId;
      yield publish(ctx, {type: commonDefines.c_oPublishType.rpc, ctx, docId, userId, data, responseKey: cmd.getResponseKey()});
    } else {
      yield publish(ctx, {type: commonDefines.c_oPublishType.forceSave, ctx: ctx, docId: docId, data: data}, cmd.getUserConnectionId());
    }
  }
}
async function checkForceSaveCache(ctx, convertInfo) {
  let res = {hasCache: false, hasValidCache: false,  cmd: null};
  if (convertInfo) {
    res.hasCache = true;
    let cmd = new commonDefines.InputCommand(convertInfo, true);
    const saveKey = cmd.getDocId() + cmd.getSaveKey();
    const outputPath = cmd.getOutputPath();
    if (saveKey && outputPath) {
      const savePathDoc = saveKey + '/' + outputPath;
      const metadata  = await storage.headObject(ctx, savePathDoc);
      res.hasValidCache = !!metadata;
      res.cmd = cmd;
    }
  }
  return res;
}
async function applyForceSaveCache(ctx, docId, forceSave, type, opt_userConnectionId, opt_userConnectionDocId,
                                   opt_responseKey, opt_formdata, opt_userId, opt_userIndex) {
  let res = {ok: false, notModified: false, inProgress: false, startedForceSave: null};
  if (!forceSave) {
    res.notModified = true;
    return res;
  }
  let forceSaveCache = await checkForceSaveCache(ctx, forceSave.convertInfo);
  if (forceSaveCache.hasCache || forceSave.ended) {
    if (commonDefines.c_oAscForceSaveTypes.Form === type || commonDefines.c_oAscForceSaveTypes.Internal === type || !forceSave.ended) {
      //c_oAscForceSaveTypes.Form has uniqueue options {'documentLayout': {'isPrint': true}}; dont use it for other types
      let forceSaveCached = forceSaveCache.cmd?.getForceSave()?.getType();
      let cacheHasSameOptions = (commonDefines.c_oAscForceSaveTypes.Form === type &&
          commonDefines.c_oAscForceSaveTypes.Form === forceSaveCached) ||
        (commonDefines.c_oAscForceSaveTypes.Form !== type &&
          commonDefines.c_oAscForceSaveTypes.Form !== forceSaveCached)
      if (forceSaveCache.hasValidCache && cacheHasSameOptions) {
        let cmd = forceSaveCache.cmd;
        cmd.setUserConnectionDocId(opt_userConnectionDocId);
        cmd.setUserConnectionId(opt_userConnectionId);
        cmd.setResponseKey(opt_responseKey);
        cmd.setFormData(opt_formdata);
        if (cmd.getForceSave()) {
          cmd.getForceSave().setType(type);
          cmd.getForceSave().setAuthorUserId(opt_userId);
          cmd.getForceSave().setAuthorUserIndex(opt_userIndex);
        }
        //todo timeout because commandSfcCallback make request?
        await canvasService.commandSfcCallback(ctx, cmd, true, false);
        res.ok = true;
      } else {
        await editorData.checkAndSetForceSave(ctx, docId, forceSave.time, forceSave.index, false, false, null);
        res.startedForceSave = await editorData.checkAndStartForceSave(ctx, docId);
        res.ok = !!res.startedForceSave;
      }
    } else {
      res.notModified = true;
    }
  } else if (!forceSave.started) {
      res.startedForceSave = await editorData.checkAndStartForceSave(ctx, docId);
      res.ok = !!res.startedForceSave;
      return res;
  } else if (commonDefines.c_oAscForceSaveTypes.Form === type || commonDefines.c_oAscForceSaveTypes.Internal === type) {
    res.ok = true;
    res.inProgress = true;
  } else {
    res.notModified = true;
  }
  return res;
}
async function startForceSave(ctx, docId, type, opt_userdata, opt_formdata, opt_userId, opt_userConnectionId,
                              opt_userConnectionDocId, opt_userIndex, opt_responseKey, opt_baseUrl,
                              opt_queue, opt_pubsub, opt_conn, opt_initShardKey, opt_jsonParams, opt_changeInfo) {
  const tenForceSaveUsingButtonWithoutChanges = ctx.getCfg('services.CoAuthoring.server.forceSaveUsingButtonWithoutChanges', cfgForceSaveUsingButtonWithoutChanges);
  ctx.logger.debug('startForceSave start');
  let res = {code: commonDefines.c_oAscServerCommandErrors.NoError, time: null, inProgress: false};
  let startedForceSave;
  let hasEncrypted = false;
  if (!shutdownFlag) {
    let hvals = await editorData.getPresence(ctx, docId, connections);
    hasEncrypted = hvals.some((currentValue) => {
      return !!JSON.parse(currentValue).encrypted;
    });
    if (!hasEncrypted) {
      let forceSave = await editorData.getForceSave(ctx, docId);
      let forceSaveWithConnection = opt_conn && (commonDefines.c_oAscForceSaveTypes.Form === type ||
        (commonDefines.c_oAscForceSaveTypes.Button === type && tenForceSaveUsingButtonWithoutChanges));
      let startWithoutChanges = !forceSave && (forceSaveWithConnection || opt_changeInfo);
      if (startWithoutChanges) {
        //stub to send forms without changes
        let newChangesLastDate = new Date();
        newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding
        let newChangesLastTime = newChangesLastDate.getTime();
        let baseUrl = opt_baseUrl || "";
        let changeInfo = opt_changeInfo;
        if (opt_conn) {
          baseUrl = utils.getBaseUrlByConnection(ctx, opt_conn);
          changeInfo = getExternalChangeInfo(opt_conn.user, newChangesLastTime, opt_conn.lang);
        }
        await editorData.setForceSave(ctx, docId, newChangesLastTime, 0, baseUrl, changeInfo, null);
        forceSave = await editorData.getForceSave(ctx, docId);
      }
      let applyCacheRes = await applyForceSaveCache(ctx, docId, forceSave, type, opt_userConnectionId,
        opt_userConnectionDocId, opt_responseKey, opt_formdata, opt_userId, opt_userIndex);
      startedForceSave = applyCacheRes.startedForceSave;
      if (applyCacheRes.notModified) {
        let selectRes = await taskResult.select(ctx, docId);
        if (selectRes.length > 0) {
          res.code = commonDefines.c_oAscServerCommandErrors.NotModified;
        } else {
          res.code = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
        }
      } else if (!applyCacheRes.ok) {
        res.code = commonDefines.c_oAscServerCommandErrors.UnknownError;
      }
      res.inProgress = applyCacheRes.inProgress;
    }
  }

  ctx.logger.debug('startForceSave canStart: hasEncrypted = %s; applyCacheRes = %j; startedForceSave = %j', hasEncrypted, res, startedForceSave);
  if (startedForceSave) {
    let baseUrl = opt_baseUrl || startedForceSave.baseUrl;
    let forceSave = new commonDefines.CForceSaveData(startedForceSave);
    forceSave.setType(type);
    forceSave.setAuthorUserId(opt_userId);
    forceSave.setAuthorUserIndex(opt_userIndex);

    let priority;
    let expiration;
    if (commonDefines.c_oAscForceSaveTypes.Timeout === type) {
      priority = constants.QUEUE_PRIORITY_VERY_LOW;
      expiration = getForceSaveExpiration(ctx);
    } else {
      priority = constants.QUEUE_PRIORITY_LOW;
    }
    //start new convert
    let status = await converterService.convertFromChanges(ctx, docId, baseUrl, forceSave, startedForceSave.changeInfo,
      opt_userdata, opt_formdata, opt_userConnectionId, opt_userConnectionDocId, opt_responseKey, priority, expiration,
      opt_queue, undefined, opt_initShardKey, opt_jsonParams);
    if (constants.NO_ERROR === status.err) {
      res.time = forceSave.getTime();
      if (commonDefines.c_oAscForceSaveTypes.Timeout === type) {
        await publish(ctx, {
          type: commonDefines.c_oPublishType.forceSave, ctx: ctx, docId: docId,
          data: {type: type, time: forceSave.getTime(), start: true}
        }, undefined, undefined, opt_pubsub);
      }
    } else {
      res.code = commonDefines.c_oAscServerCommandErrors.UnknownError;
    }
    ctx.logger.debug('startForceSave convertFromChanges: status = %d', status.err);
  }
  ctx.logger.debug('startForceSave end');
  return res;
}
function getExternalChangeInfo(user, date, lang) {
  return {user_id: user.id, user_id_original: user.idOriginal, user_name: user.username, lang, change_date: date};
}
let resetForceSaveAfterChanges = co.wrap(function*(ctx, docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo) {
  const tenForceSaveEnable = ctx.getCfg('services.CoAuthoring.autoAssembly.enable', cfgForceSaveEnable);
  const tenForceSaveInterval = ms(ctx.getCfg('services.CoAuthoring.autoAssembly.interval', cfgForceSaveInterval));
  //last save
  if (newChangesLastTime) {
    yield editorData.setForceSave(ctx, docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo, null);
    if (tenForceSaveEnable) {
      let expireAt = newChangesLastTime + tenForceSaveInterval;
      yield editorData.addForceSaveTimerNX(ctx, docId, expireAt);
    }
  }
});
let saveRelativeFromChanges = co.wrap(function*(ctx, conn, responseKey, data) {
  const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

  let docId = data.docId;
  let token = data.token;
  let forceSaveRes;
  if (tenTokenEnableBrowser) {
    docId = null;
    let checkJwtRes = yield checkJwt(ctx, token, commonDefines.c_oAscSecretType.Browser);
    if (checkJwtRes.decoded) {
      docId = checkJwtRes.decoded.key;
    } else {
      ctx.logger.warn('Error saveRelativeFromChanges jwt: %s', checkJwtRes.description);
      forceSaveRes = {code: commonDefines.c_oAscServerCommandErrors.Token, time: null, inProgress: false};
    }
  }
  if (!forceSaveRes) {
    forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Internal, undefined, undefined, undefined, conn.user.id, conn.docId, undefined, responseKey);
  }
  if (commonDefines.c_oAscServerCommandErrors.NoError !== forceSaveRes.code || forceSaveRes.inProgress) {
    sendDataRpc(ctx, conn, responseKey, forceSaveRes);
  }
})
function* startRPC(ctx, conn, responseKey, data) {
  let docId = conn.docId;
  ctx.logger.debug('startRPC start responseKey:%s , %j', responseKey, data);
  switch (data.type) {
    case 'sendForm': {
      let forceSaveRes;
      if (conn.user) {
        //isPrint - to remove forms
        let jsonParams = {'documentLayout': {'isPrint': true}};
        forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Form, undefined,
          data.formdata, conn.user.idOriginal, conn.user.id, undefined, conn.user.indexUser,
          responseKey, undefined, undefined, undefined, conn, undefined, jsonParams);
      }
      if (!forceSaveRes || commonDefines.c_oAscServerCommandErrors.NoError !== forceSaveRes.code || forceSaveRes.inProgress) {
        sendDataRpc(ctx, conn, responseKey, forceSaveRes);
      }
      break;
    }
    case 'saveRelativeFromChanges': {
      yield saveRelativeFromChanges(ctx, conn, responseKey, data);
      break;
    }
    case 'wopi_RenameFile':
      let renameRes;
      let selectRes = yield taskResult.select(ctx, docId);
      let row = selectRes.length > 0 ? selectRes[0] : null;
      if (row) {
        if (row.callback) {
          let userIndex = utils.getIndexFromUserId(conn.user.id, conn.user.idOriginal);
          let uri = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, row.callback, userIndex);
          let wopiParams = wopiClient.parseWopiCallback(ctx, uri, row.callback);
          if (wopiParams) {
            renameRes = yield wopiClient.renameFile(ctx, wopiParams, data.name);
          }
        }
      }
      sendDataRpc(ctx, conn, responseKey, renameRes);
      break;
    case 'pathurls':
      let outputData = new canvasService.OutputData(data.type);
      yield* canvasService.commandPathUrls(ctx, conn, data.data, outputData);
      sendDataRpc(ctx, conn, responseKey, outputData);
      break;
  }
  ctx.logger.debug('startRPC end');
}
function handleDeadLetter(data, ack) {
  return co(function*() {
    let ctx = new operationContext.Context();
    try {
      var isRequeued = false;
      let task = new commonDefines.TaskQueueData(JSON.parse(data));
      if (task) {
        ctx.initFromTaskQueueData(task);
        yield ctx.initTenantCache();
        let cmd = task.getCmd();
        ctx.logger.warn('handleDeadLetter start: %s', data);
        let forceSave = cmd.getForceSave();
        if (forceSave && commonDefines.c_oAscForceSaveTypes.Timeout == forceSave.getType()) {
          let actualForceSave = yield editorData.getForceSave(ctx, cmd.getDocId());
          //check that there are no new changes
          if (actualForceSave && forceSave.getTime() === actualForceSave.time && forceSave.getIndex() === actualForceSave.index) {
            //requeue task
            yield* addTask(task, constants.QUEUE_PRIORITY_VERY_LOW, undefined, getForceSaveExpiration(ctx));
            isRequeued = true;
          }
        } else if (!forceSave && task.getFromChanges()) {
          yield* addTask(task, constants.QUEUE_PRIORITY_NORMAL, undefined);
          isRequeued = true;
        } else if(cmd.getAttempt()) {
          ctx.logger.warn('handleDeadLetter addResponse delayed = %d', cmd.getAttempt());
          yield* addResponse(task);
        } else {
          //simulate error response
          cmd.setStatusInfo(constants.CONVERT_DEAD_LETTER);
          canvasService.receiveTask(JSON.stringify(task), function(){});
        }
      }
      ctx.logger.warn('handleDeadLetter end: requeue = %s', isRequeued);
    } catch (err) {
      ctx.logger.error('handleDeadLetter error: %s', err.stack);
    } finally {
      ack();
    }
  });
}
/**
 * Sending status to know when the document started editing and when it ended
 * @param docId
 * @param {number} bChangeBase
 * @param callback
 * @param baseUrl
 */
async function sendStatusDocument(ctx, docId, bChangeBase, opt_userAction, opt_userIndex, opt_callback, opt_baseUrl, opt_userData, opt_forceClose) {
  if (!opt_callback) {
    var getRes = await getCallback(ctx, docId, opt_userIndex);
    if (getRes) {
      opt_callback = getRes.server;
      if (!opt_baseUrl) {
        opt_baseUrl = getRes.baseUrl;
      }
      if (getRes.wopiParams) {
        ctx.logger.debug('sendStatusDocument wopi stub');
        return opt_callback;
      }
    }
  }
  if (null == opt_callback) {
    return;
  }

  var status = c_oAscServerStatus.Editing;
  var participants = await getOriginalParticipantsId(ctx, docId);
  if (0 === participants.length) {
    let bHasChanges = await hasChanges(ctx, docId);
    if (!bHasChanges || opt_forceClose) {
      status = c_oAscServerStatus.Closed;
    }
  }

  if (c_oAscChangeBase.No !== bChangeBase) {
    //update callback even if the connection is closed to avoid script:
    //open->make changes->disconnect->subscription from community->reconnect
    if (c_oAscChangeBase.All === bChangeBase) {
      //always override callback to avoid expired callbacks
      var updateTask = new taskResult.TaskResultData();
      updateTask.tenant = ctx.tenant;
      updateTask.key = docId;
      updateTask.callback = opt_callback.href;
      updateTask.baseurl = opt_baseUrl;
      var updateIfRes = await taskResult.update(ctx, updateTask);
      if (updateIfRes.affectedRows > 0) {
        ctx.logger.debug('sendStatusDocument updateIf');
      } else {
        ctx.logger.debug('sendStatusDocument updateIf no effect');
      }
    }
  }

  var sendData = new commonDefines.OutputSfcData(docId);
  sendData.setStatus(status);
  if (c_oAscServerStatus.Closed !== status) {
    sendData.setUsers(participants);
  }
  if (opt_userAction) {
    sendData.setActions([opt_userAction]);
  }
  if (opt_userData) {
    sendData.setUserData(opt_userData);
  }
  var uri = opt_callback.href;
  var replyData = null;
  try {
    replyData = await sendServerRequest(ctx, uri, sendData);
  } catch (err) {
    replyData = null;
    ctx.logger.error('postData error: url = %s;data = %j %s', uri, sendData, err.stack);
  }
  await onReplySendStatusDocument(ctx, docId, replyData);
  return sendData;
}
function parseReplyData(ctx, replyData) {
  var res = null;
  if (replyData) {
    try {
      res = JSON.parse(replyData);
    } catch (e) {
      ctx.logger.error("error parseReplyData: data = %s %s", replyData, e.stack);
      res = null;
    }
  }
  return res;
}
let onReplySendStatusDocument = co.wrap(function*(ctx, docId, replyData) {
  var oData = parseReplyData(ctx, replyData);
  if (!(oData && commonDefines.c_oAscServerCommandErrors.NoError == oData.error)) {
    // Error subscribing to callback, send warning
    yield publish(ctx, {type: commonDefines.c_oPublishType.warning, ctx: ctx, docId: docId, description: 'Error on save server subscription!'});
  }
});
function* publishCloseUsersConnection(ctx, docId, users, isOriginalId, code, description) {
  if (Array.isArray(users)) {
    let usersMap = users.reduce(function(map, val) {
      map[val] = 1;
      return map;
    }, {});
    yield publish(ctx, {
                     type: commonDefines.c_oPublishType.closeConnection, ctx: ctx, docId: docId, usersMap: usersMap,
                     isOriginalId: isOriginalId, code: code, description: description
                   });
  }
}
function closeUsersConnection(ctx, docId, usersMap, isOriginalId, code, description) {
  //close
  let conn;
  for (let i = connections.length - 1; i >= 0; --i) {
    conn = connections[i];
    if (conn.docId === docId) {
      if (isOriginalId ? usersMap[conn.user.idOriginal] : usersMap[conn.user.id]) {
        sendDataDisconnectReason(ctx, conn, code, description);
        conn.disconnect(true);
      }
    }
  }
}
function* dropUsersFromDocument(ctx, docId, users) {
  if (Array.isArray(users)) {
    yield publish(ctx, {type: commonDefines.c_oPublishType.drop, ctx: ctx, docId: docId, users: users, description: ''});
  }
}

function dropUserFromDocument(ctx, docId, userId, description) {
  var elConnection;
  for (var i = 0, length = connections.length; i < length; ++i) {
    elConnection = connections[i];
    if (elConnection.docId === docId && userId === elConnection.user.idOriginal && !elConnection.isCloseCoAuthoring) {
      sendDataDrop(ctx, elConnection, description);
    }
  }
}
function getLocalConnectionCount(ctx, docId) {
  let tenant = ctx.tenant;
  return connections.reduce(function(count, conn) {
    if (conn.docId === docId && conn.tenant === ctx.tenant) {
      count++;
    }
    return count;
  }, 0);
}

// Event subscription:
function* bindEvents(ctx, docId, callback, baseUrl, opt_userAction, opt_userData) {
  // Subscribe to events:
  // - if there are no users and no changes, then send the status "closed" and do not add to the database
  // - if there are no users, but there are changes, then send the "editing" status without users, but add it to the database
  // - if there are users, then just add to the database
  var bChangeBase;
  var oCallbackUrl;
  if (!callback) {
    var getRes = yield getCallback(ctx, docId);
    if (getRes && !getRes.wopiParams) {
      oCallbackUrl = getRes.server;
      bChangeBase = c_oAscChangeBase.Delete;
    }
  } else {
    oCallbackUrl = parseUrl(ctx, callback);
    bChangeBase = c_oAscChangeBase.No;
    if (null !== oCallbackUrl) {
      let filterStatus = yield* utils.checkHostFilter(ctx, oCallbackUrl.host);
      if (filterStatus > 0) {
        ctx.logger.warn('checkIpFilter error: url = %s', callback);
        //todo add new error type
        oCallbackUrl = null;
      }
    }
  }
  if (null !== oCallbackUrl) {
    return yield sendStatusDocument(ctx, docId, bChangeBase, opt_userAction, undefined, oCallbackUrl, baseUrl, opt_userData);
  }
  return null;
}
let unlockWopiDoc = co.wrap(function*(ctx, docId, opt_userIndex) {
  //wopi unlock
  var getRes = yield getCallback(ctx, docId, opt_userIndex);
  if (getRes && getRes.wopiParams && getRes.wopiParams.userAuth && 'view' !== getRes.wopiParams.userAuth.mode) {
    let unlockRes = yield wopiClient.unlock(ctx, getRes.wopiParams);
    let unlockInfo = wopiClient.getWopiUnlockMarker(getRes.wopiParams);
    if (unlockInfo && unlockRes) {
      yield canvasService.commandOpenStartPromise(ctx, docId, undefined, unlockInfo);
    }
  }
});
function* cleanDocumentOnExit(ctx, docId, deleteChanges, opt_userIndex) {
  const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);

  //clean redis (redisKeyPresenceSet and redisKeyPresenceHash removed with last element)
  yield editorData.cleanDocumentOnExit(ctx, docId);
  //remove changes
  if (deleteChanges) {
    yield taskResult.restoreInitialPassword(ctx, docId);
    sqlBase.deleteChanges(ctx, docId, null);
    //delete forgotten after successful send on callbackUrl
    yield storage.deletePath(ctx, docId, tenForgottenFiles);
  }
  yield unlockWopiDoc(ctx, docId, opt_userIndex);
}
function* cleanDocumentOnExitNoChanges(ctx, docId, opt_userId, opt_userIndex, opt_forceClose) {
  var userAction = opt_userId ? new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, opt_userId) : null;
  // We send that everyone is gone and there are no changes (to set the status on the server about the end of editing)
  yield sendStatusDocument(ctx, docId, c_oAscChangeBase.No, userAction, opt_userIndex, undefined, undefined, undefined, opt_forceClose);
  //if the user entered the document, the connection was broken, all information was deleted on the server,
  //when the connection is restored, the userIndex will be saved and it will match the userIndex of the next user
  yield* cleanDocumentOnExit(ctx, docId, false, opt_userIndex);
}

function createSaveTimer(ctx, docId, opt_userId, opt_userIndex, opt_userLcid, opt_queue, opt_noDelay, opt_initShardKey) {
  return co(function*(){
    const tenAscSaveTimeOutDelay = ctx.getCfg('services.CoAuthoring.server.savetimeoutdelay', cfgAscSaveTimeOutDelay);

    var updateMask = new taskResult.TaskResultData();
    updateMask.tenant = ctx.tenant;
    updateMask.key = docId;
    updateMask.status = commonDefines.FileStatus.Ok;
    var updateTask = new taskResult.TaskResultData();
    updateTask.status = commonDefines.FileStatus.SaveVersion;
    updateTask.statusInfo = utils.getMillisecondsOfHour(new Date());
    var updateIfRes = yield taskResult.updateIf(ctx, updateTask, updateMask);
    if (updateIfRes.affectedRows > 0) {
      if(!opt_noDelay){
        yield utils.sleep(tenAscSaveTimeOutDelay);
      }
      while (true) {
        if (!sqlBase.isLockCriticalSection(docId)) {
          yield canvasService.saveFromChanges(ctx, docId, updateTask.statusInfo, null, opt_userId, opt_userIndex, opt_userLcid, opt_queue, opt_initShardKey);
          break;
        }
        yield utils.sleep(c_oAscLockTimeOutDelay);
      }
    } else {
      //if it didn't work, it means FileStatus=SaveVersion(someone else started building) or UpdateVersion(build completed)
      // in this case, nothing needs to be done
      ctx.logger.debug('createSaveTimer updateIf no effect');
    }
  });
}

function checkJwt(ctx, token, type) {
  return co(function*() {
    const tenTokenVerifyOptions = ctx.getCfg('services.CoAuthoring.token.verifyOptions', cfgTokenVerifyOptions);

    var res = {decoded: null, description: null, code: null, token: token};
    let secret = yield tenantManager.getTenantSecret(ctx, type);
    if (undefined == secret) {
      ctx.logger.warn('empty secret: token = %s', token);
    }
    try {
      res.decoded = jwt.verify(token, secret, tenTokenVerifyOptions);
      ctx.logger.debug('checkJwt success: decoded = %j', res.decoded);
    } catch (err) {
      ctx.logger.warn('checkJwt error: name = %s message = %s token = %s', err.name, err.message, token);
      if ('TokenExpiredError' === err.name) {
        res.code = constants.JWT_EXPIRED_CODE;
        res.description = constants.JWT_EXPIRED_REASON + err.message;
      } else if ('JsonWebTokenError' === err.name) {
        res.code = constants.JWT_ERROR_CODE;
        res.description = constants.JWT_ERROR_REASON + err.message;
      }
    }
    return res;
  });
}
function checkJwtHeader(ctx, req, opt_header, opt_prefix, opt_secretType) {
  return co(function*() {
    const tenTokenInboxHeader = ctx.getCfg('services.CoAuthoring.token.inbox.header', cfgTokenInboxHeader);
    const tenTokenInboxPrefix = ctx.getCfg('services.CoAuthoring.token.inbox.prefix', cfgTokenInboxPrefix);

    let header = opt_header || tenTokenInboxHeader;
    let prefix = opt_prefix || tenTokenInboxPrefix;
    let secretType = opt_secretType || commonDefines.c_oAscSecretType.Inbox;
    let authorization = req.get(header);
    if (authorization && authorization.startsWith(prefix)) {
      var token = authorization.substring(prefix.length);
      return yield checkJwt(ctx, token, secretType);
    }
    return null;
  });
}
function getRequestParams(ctx, req, opt_isNotInBody) {
  return co(function*(){
    const tenTokenEnableRequestInbox = ctx.getCfg('services.CoAuthoring.token.enable.request.inbox', cfgTokenEnableRequestInbox);
    const tenTokenRequiredParams = ctx.getCfg('services.CoAuthoring.server.tokenRequiredParams', cfgTokenRequiredParams);

    let res = {code: constants.NO_ERROR, description: "", isDecoded: false, params: undefined};
    if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      try {
        res.params = JSON.parse(req.body.toString('utf8'));
      } catch(err) {
        ctx.logger.debug('getRequestParams error parsing json body: %s', err.stack);
      }
    }
    if (!res.params) {
      res.params = req.query;
    }
    if (tenTokenEnableRequestInbox) {
      res.code = constants.VKEY;
      let checkJwtRes;
      if (res.params.token) {
        checkJwtRes = yield checkJwt(ctx, res.params.token, commonDefines.c_oAscSecretType.Inbox);
      } else {
        checkJwtRes = yield checkJwtHeader(ctx, req);
      }
      if (checkJwtRes) {
        if (checkJwtRes.decoded) {
          res.code = constants.NO_ERROR;
          res.isDecoded = true;
          if (tenTokenRequiredParams) {
            res.params = {};
          }
          Object.assign(res.params, checkJwtRes.decoded);
          if (!utils.isEmptyObject(checkJwtRes.decoded.payload)) {
            Object.assign(res.params, checkJwtRes.decoded.payload);
          }
          if (!utils.isEmptyObject(checkJwtRes.decoded.query)) {
            Object.assign(res.params, checkJwtRes.decoded.query);
          }
        } else if (constants.JWT_EXPIRED_CODE == checkJwtRes.code) {
          res.code = constants.VKEY_KEY_EXPIRE;
        }
        res.description = checkJwtRes.description;
      }
    }
    return res;
  });
}

function getLicenseNowUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
                  now.getUTCMinutes(), now.getUTCSeconds()) / 1000;
}
let getParticipantMap = co.wrap(function*(ctx, docId, opt_hvals) {
  const participantsMap = [];
  let hvals;
  if (opt_hvals) {
    hvals = opt_hvals;
  } else {
    hvals = yield editorData.getPresence(ctx, docId, connections);
  }
  for (let i = 0; i < hvals.length; ++i) {
    const elem = JSON.parse(hvals[i]);
    if (!elem.isCloseCoAuthoring) {
      participantsMap.push(elem);
    }
  }
  return participantsMap;
});

function getOpenFormatByEditor(editorType) {
  let res;
  switch (editorType) {
    case EditorTypes.spreadsheet:
      res = constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET;
      break;
    case EditorTypes.presentation:
      res = constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION;
      break;
    default:
      res = constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD;
      break;
  }
  return res;
}

async function isSchemaCompatible([tableName, tableSchema]) {
  const resultSchema = await sqlBase.getTableColumns(operationContext.global, tableName);

  if (resultSchema.length === 0) {
    operationContext.global.logger.error('DB table "%s" does not exist', tableName);
    return false;
  }

  const columnArray = resultSchema.map(row => row['column_name']);
  const hashedResult = new Set(columnArray);
  const schemaDiff = tableSchema.filter(column => !hashedResult.has(column));

  if (schemaDiff.length > 0) {
    operationContext.global.logger.error(`DB table "${tableName}" does not contain columns: ${schemaDiff}, columns info: ${columnArray}`);
    return false;
  }

  return true;
}

exports.c_oAscServerStatus = c_oAscServerStatus;
exports.editorData = editorData;
exports.editorStat = editorStat;
exports.sendData = sendData;
exports.modifyConnectionForPassword = modifyConnectionForPassword;
exports.parseUrl = parseUrl;
exports.parseReplyData = parseReplyData;
exports.sendServerRequest = sendServerRequest;
exports.createSaveTimer = createSaveTimer;
exports.changeConnectionInfo = changeConnectionInfo;
exports.signToken = signToken;
exports.publish = publish;
exports.addTask = addTask;
exports.addDelayed = addDelayed;
exports.removeResponse = removeResponse;
exports.hasEditors = hasEditors;
exports.getEditorsCountPromise = co.wrap(getEditorsCount);
exports.getCallback = getCallback;
exports.getIsShutdown = getIsShutdown;
exports.hasChanges = hasChanges;
exports.cleanDocumentOnExitPromise = co.wrap(cleanDocumentOnExit);
exports.cleanDocumentOnExitNoChangesPromise = co.wrap(cleanDocumentOnExitNoChanges);
exports.unlockWopiDoc = unlockWopiDoc;
exports.setForceSave = setForceSave;
exports.startForceSave = startForceSave;
exports.resetForceSaveAfterChanges = resetForceSaveAfterChanges;
exports.getExternalChangeInfo = getExternalChangeInfo;
exports.checkJwt = checkJwt;
exports.getRequestParams = getRequestParams;
exports.checkJwtHeader = checkJwtHeader;

async function encryptPasswordParams(ctx, data) {
  let dataWithPassword;
  if (data.type === 'openDocument' && data.message) {
    dataWithPassword = data.message;
  } else if (data.type === 'auth' && data.openCmd) {
    dataWithPassword = data.openCmd;
  }
  if (dataWithPassword && dataWithPassword.password) {
    if (dataWithPassword.password.length > constants.PASSWORD_MAX_LENGTH) {
      //todo send back error
      ctx.logger.warn('encryptPasswordParams password too long actual = %s; max = %s', dataWithPassword.password.length, constants.PASSWORD_MAX_LENGTH);
      dataWithPassword.password = null;
    } else {
      dataWithPassword.password = await utils.encryptPassword(ctx, dataWithPassword.password);
    }
  }
  if (dataWithPassword && dataWithPassword.savepassword) {
    if (dataWithPassword.savepassword.length > constants.PASSWORD_MAX_LENGTH) {
      //todo send back error
      ctx.logger.warn('encryptPasswordParams password too long actual = %s; max = %s', dataWithPassword.savepassword.length, constants.PASSWORD_MAX_LENGTH);
      dataWithPassword.savepassword = null;
    } else {
      dataWithPassword.savepassword = await utils.encryptPassword(ctx, dataWithPassword.savepassword);
    }
  }
}
exports.encryptPasswordParams = encryptPasswordParams;
exports.getOpenFormatByEditor = getOpenFormatByEditor;
exports.install = function(server, callbackFunction) {
  const io = new Server(server, cfgSocketIoConnection);

  io.use((socket, next) => {
    co(function*(){
      let ctx = new operationContext.Context();
      let res;
      let checkJwtRes;
      try {
        ctx.initFromConnection(socket);
        yield ctx.initTenantCache();
        ctx.logger.info('io.use start');
        const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

        let handshake = socket.handshake;
        if (tenTokenEnableBrowser) {
          let secretType = !!(handshake?.auth?.session) ? commonDefines.c_oAscSecretType.Session : commonDefines.c_oAscSecretType.Browser;
          let token = handshake?.auth?.session || handshake?.auth?.token;
          checkJwtRes = yield checkJwt(ctx, token, secretType);
          if (!checkJwtRes.decoded) {
            res = new Error("not authorized");
            res.data = { code: checkJwtRes.code, description: checkJwtRes.description };
          }
        }
      } catch (err) {
        ctx.logger.error('io.use error: %s', err.stack);
      } finally {
        ctx.logger.info('io.use end');
        next(res);
      }
    });
  });

  io.on('connection', async function(conn) {
    let ctx = new operationContext.Context();
    try {
      if (!conn) {
        operationContext.global.logger.error("null == conn");
        return;
      }
      ctx.initFromConnection(conn);
      await ctx.initTenantCache();
      if (constants.DEFAULT_DOC_ID === ctx.docId) {
        ctx.logger.error('io.on connection unexpected key use key pattern = "%s" url = %s', constants.DOC_ID_PATTERN, conn.handshake?.url);
        sendDataDisconnectReason(ctx, conn, constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
        conn.disconnect(true);
        return;
      }
      if (getIsShutdown()) {
        sendDataDisconnectReason(ctx, conn, constants.SHUTDOWN_CODE, constants.SHUTDOWN_REASON);
        conn.disconnect(true);
        return;
      }
      conn.baseUrl = utils.getBaseUrlByConnection(ctx, conn);
      conn.sessionIsSendWarning = false;
      conn.sessionTimeConnect = conn.sessionTimeLastAction = new Date().getTime();

      conn.on('message', function(data) {
        return co(function* () {
          var docId = 'null';
          let ctx = new operationContext.Context();
          try {
            ctx.initFromConnection(conn);
            yield ctx.initTenantCache();
            const tenErrorFiles = ctx.getCfg('FileConverter.converter.errorfiles', cfgErrorFiles);

            var startDate = null;
            if(clientStatsD) {
              startDate = new Date();
            }

            docId = conn.docId;
            ctx.logger.info('data.type = %s', data.type);
            if(getIsShutdown())
            {
              ctx.logger.debug('Server shutdown receive data');
              return;
            }
            if (conn.isCiriticalError && ('message' == data.type || 'getLock' == data.type || 'saveChanges' == data.type ||
              'isSaveLock' == data.type)) {
              ctx.logger.warn("conn.isCiriticalError send command: type = %s", data.type);
              sendDataDisconnectReason(ctx, conn, constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
              conn.disconnect(true);
              return;
            }
            if ((conn.isCloseCoAuthoring || (conn.user && conn.user.view)) &&
              ('getLock' == data.type || 'saveChanges' == data.type || 'isSaveLock' == data.type)) {
              ctx.logger.warn("conn.user.view||isCloseCoAuthoring access deny: type = %s", data.type);
              sendDataDisconnectReason(ctx, conn, constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
              conn.disconnect(true);
              return;
            }
            yield encryptPasswordParams(ctx, data);
            switch (data.type) {
              case 'auth'          :
                try {
                  yield* auth(ctx, conn, data);
                } catch(err){
                  ctx.logger.error('auth error: %s', err.stack);
                  sendDataDisconnectReason(ctx, conn, constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
                  conn.disconnect(true);
                  return;
                }
                break;
              case 'message'        :
                yield* onMessage(ctx, conn, data);
                break;
              case 'cursor'        :
                yield* onCursor(ctx, conn, data);
                break;
              case 'getLock'        :
                yield getLock(ctx, conn, data, false);
                break;
              case 'saveChanges'      :
                yield* saveChanges(ctx, conn, data);
                break;
              case 'isSaveLock'      :
                yield* isSaveLock(ctx, conn, data);
                break;
              case 'unSaveLock'      :
                yield* unSaveLock(ctx, conn, -1, -1, -1);
                break;	// The index is sent -1, because this is an emergency withdrawal without saving
              case 'getMessages'      :
                yield* getMessages(ctx, conn, data);
                break;
              case 'unLockDocument'    :
                yield* checkEndAuthLock(ctx, data.unlock, data.isSave, docId, conn.user.id, data.releaseLocks, data.deleteIndex, conn);
                break;
              case 'close':
                yield* closeDocument(ctx, conn);
                break;
              case 'versionHistory'          : {
                let cmd = new commonDefines.InputCommand(data.cmd);
                yield* versionHistory(ctx, conn, cmd);
                break;
              }
              case 'openDocument'      : {
                var cmd = new commonDefines.InputCommand(data.message);
                cmd.fillFromConnection(conn);
                yield canvasService.openDocument(ctx, conn, cmd);
                break;
              }
              case 'clientLog':
                let level = data.level?.toLowerCase();
                if("trace" === level || "debug" === level || "info" === level || "warn" === level || "error" === level ||  "fatal" === level) {
                  ctx.logger[level]("clientLog: %s", data.msg);
                }
                if ("error" === level && tenErrorFiles && docId) {
                  let destDir = 'browser/' + docId;
                  yield storage.copyPath(ctx, docId, destDir, undefined, tenErrorFiles);
                  yield* saveErrorChanges(ctx, docId, destDir);
                }
                break;
              case 'extendSession' :
                ctx.logger.debug("extendSession idletime: %d", data.idletime);
                conn.sessionIsSendWarning = false;
                conn.sessionTimeLastAction = new Date().getTime() - data.idletime;
                break;
              case 'forceSaveStart' :
                var forceSaveRes;
                if (conn.user) {
                  forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Button,
                    undefined, undefined, conn.user.idOriginal, conn.user.id,
                    undefined, conn.user.indexUser, undefined, undefined, undefined, undefined, conn);
                } else {
                  forceSaveRes = {code: commonDefines.c_oAscServerCommandErrors.UnknownError, time: null};
                }
                sendData(ctx, conn, {type: "forceSaveStart", messages: forceSaveRes});
                break;
              case 'rpc' :
                yield* startRPC(ctx, conn, data.responseKey, data.data);
                break;
              case 'authChangesAck' :
                delete conn.authChangesAck;
                break;
              default:
                ctx.logger.debug("unknown command %j", data);
                break;
            }
          } catch (e) {
            ctx.logger.error("error receiving response: type = %s %s", (data && data.type) ? data.type : 'null', e.stack);
          }
        });
      });
      conn.on("disconnect", function(reason) {
        return co(function* () {
          let ctx = new operationContext.Context();
          try {
            ctx.initFromConnection(conn);
            yield ctx.initTenantCache();
            yield* closeDocument(ctx, conn, reason);
          } catch (err) {
            ctx.logger.error('Error conn close: %s', err.stack);
          }
        });
      });

      _checkLicense(ctx, conn);
    } catch(err){
      ctx.logger.error('connection error: %s', err.stack);
      sendDataDisconnectReason(ctx, conn, constants.DROP_CODE, constants.DROP_REASON);
      conn.disconnect(true);
    }
  });
  io.engine.on("connection_error", (err) => {
    operationContext.global.logger.warn('io.connection_error code=%s, message=%s', err.code, err.message);
  });
  /**
   *
   * @param ctx
   * @param conn
   * @param reason - the reason of the disconnection (either client or server-side)
   */
  function* closeDocument(ctx, conn, reason) {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);

    ctx.logger.info("Connection closed or timed out: reason = %s", reason);
    var userLocks, reconnected = false, bHasEditors, bHasChanges;
    var docId = conn.docId;
    if (null == docId) {
      return;
    }
    var hvals;
    let participantsTimestamp;
    var tmpUser = conn.user;
    var isView = tmpUser.view;

    var isCloseCoAuthoringTmp = conn.isCloseCoAuthoring;
    if (reason) {
      //Notify that participant has gone
      connections = _.reject(connections, function(el) {
        return el.id === conn.id;//Delete this connection
      });
      //Check if it's not already reconnected
      reconnected = yield* isUserReconnect(ctx, docId, tmpUser.id, conn.id);
      if (reconnected) {
        ctx.logger.info("reconnected");
      } else {
        yield removePresence(ctx, conn);
        hvals = yield editorData.getPresence(ctx, docId, connections);
        participantsTimestamp = Date.now();
        if (hvals.length <= 0) {
          yield editorData.removePresenceDocument(ctx, docId);
        }
      }
    } else {
      if (!conn.isCloseCoAuthoring) {
        modifyConnectionEditorToView(ctx, conn);
        conn.isCloseCoAuthoring = true;
        yield addPresence(ctx, conn, true);
        if (tenTokenEnableBrowser) {
          let sessionToken = yield fillJwtByConnection(ctx, conn);
          sendDataRefreshToken(ctx, conn, sessionToken);
        }
      }
    }

    if (isCloseCoAuthoringTmp) {
      //we already close connection
      return;
    }

    if (!reconnected) {
      //revert old view to send event
      var tmpView = tmpUser.view;
      tmpUser.view = isView;
      let participants = yield getParticipantMap(ctx, docId, hvals);
      if (!participantsTimestamp) {
        participantsTimestamp = Date.now();
      }
      yield publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participants}, docId, tmpUser.id);
      tmpUser.view = tmpView;

      // For this user, we remove the lock from saving
      yield editorData.unlockSave(ctx, docId, conn.user.id);

      // editors only
      if (false === isView) {
        bHasEditors = yield* hasEditors(ctx, docId, hvals);
        bHasChanges = yield hasChanges(ctx, docId);

        let needSendStatus = true;
        if (conn.encrypted) {
          let selectRes = yield taskResult.select(ctx, docId);
          if (selectRes.length > 0) {
            var row = selectRes[0];
            if (commonDefines.FileStatus.UpdateVersion === row.status) {
              needSendStatus = false;
            }
          }
        }
        //Release locks
        userLocks = yield removeUserLocks(ctx, docId, conn.user.id);
        if (0 < userLocks.length) {
          //todo send nothing in case of close document
          //sendReleaseLock(conn, userLocks);
          yield publish(ctx, {type: commonDefines.c_oPublishType.releaseLock, ctx: ctx, docId: docId, userId: conn.user.id, locks: userLocks}, docId, conn.user.id);
        }

        // For this user, remove the Lock from the document
        yield* checkEndAuthLock(ctx, true, false, docId, conn.user.id);

        let userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
        // If we do not have users, then delete all messages
        if (!bHasEditors) {
          // Just in case, remove the lock
          yield editorData.unlockSave(ctx, docId, tmpUser.id);

          let needSaveChanges = bHasChanges;
          if (!needSaveChanges) {
            //start save changes if forgotten file exists.
            //more effective to send file without sfc, but this method is simpler by code
            let forgotten = yield storage.listObjects(ctx, docId, tenForgottenFiles);
            needSaveChanges = forgotten.length > 0;
            ctx.logger.debug('closeDocument hasForgotten %s', needSaveChanges);
          }
          if (needSaveChanges && !conn.encrypted) {
            // Send changes to save server
            let user_lcid = utilsDocService.localeToLCID(conn.lang);
            yield createSaveTimer(ctx, docId, tmpUser.idOriginal, userIndex, user_lcid, undefined, getIsShutdown());
          } else if (needSendStatus) {
            yield* cleanDocumentOnExitNoChanges(ctx, docId, tmpUser.idOriginal, userIndex);
          } else {
            yield* cleanDocumentOnExit(ctx, docId, false, userIndex);
          }
        } else if (needSendStatus) {
          yield sendStatusDocument(ctx, docId, c_oAscChangeBase.No, new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, tmpUser.idOriginal), userIndex);
        }
      }
      let sessionType = isView ? 'view' : 'edit';
      let sessionTimeMs = new Date().getTime() - conn.sessionTimeConnect;
      ctx.logger.debug(`closeDocument %s session time:%s`, sessionType, sessionTimeMs);
      if(clientStatsD) {
        clientStatsD.timing(`coauth.session.${sessionType}`, sessionTimeMs);
      }
    }
  }

  function* versionHistory(ctx, conn, cmd) {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

    var docIdOld = conn.docId;
    var docIdNew = cmd.getDocId();
    //check jwt
    if (tenTokenEnableBrowser) {
      var checkJwtRes = yield checkJwt(ctx, cmd.getTokenHistory(), commonDefines.c_oAscSecretType.Browser);
      if (checkJwtRes.decoded) {
        fillVersionHistoryFromJwt(ctx, checkJwtRes.decoded, cmd);
        docIdNew = cmd.getDocId();
        cmd.setWithAuthorization(true);
      } else {
        sendData(ctx, conn, {type: "expiredToken", code: checkJwtRes.code, description: checkJwtRes.description});
        return;
      }
    }
    if (docIdOld !== docIdNew) {
      //remove presence(other data was removed before in closeDocument)
      yield removePresence(ctx, conn);
      var hvals = yield editorData.getPresence(ctx, docIdOld, connections);
      if (hvals.length <= 0) {
        yield editorData.removePresenceDocument(ctx, docIdOld);
      }

      //apply new
      conn.docId = docIdNew;
      yield addPresence(ctx, conn, true);
      if (tenTokenEnableBrowser) {
        let sessionToken = yield fillJwtByConnection(ctx, conn);
        sendDataRefreshToken(ctx, conn, sessionToken);
      }
    }
    //open
    yield canvasService.openDocument(ctx, conn, cmd, null);
  }
  // Getting changes for the document (either from the cache or accessing the database, but only if there were saves)
  function* getDocumentChanges(ctx, docId, optStartIndex, optEndIndex) {
    // If during that moment, while we were waiting for a response from the database, everyone left, then nothing needs to be sent
    var arrayElements = yield sqlBase.getChangesPromise(ctx, docId, optStartIndex, optEndIndex);
    var j, element;
    var objChangesDocument = new DocumentChanges(docId);
    for (j = 0; j < arrayElements.length; ++j) {
      element = arrayElements[j];

      // We add GMT, because. we write UTC to the database, but the string without UTC is saved there and the time will be wrong when reading
      objChangesDocument.push({docid: docId, change: element['change_data'],
        time: element['change_date'].getTime(), user: element['user_id'],
        useridoriginal: element['user_id_original']});
    }
    return objChangesDocument;
  }

  async function removeUserLocks(ctx, docId, userId) {
    let locks = await editorData.getLocks(ctx, docId);
    let res = [];
    let toRemove = {};
    for (let lockId in locks) {
      let lock = locks[lockId];
      if (lock.user === userId) {
        toRemove[lockId] = lock;
        res.push(lock);
      }
    }
    await editorData.removeLocks(ctx, docId, toRemove);
    return res;
  }

	function* checkEndAuthLock(ctx, unlock, isSave, docId, userId, releaseLocks, deleteIndex, conn) {
		let result = false;

    if (null != deleteIndex && -1 !== deleteIndex) {
      let puckerIndex = yield* getChangesIndex(ctx, docId);
      const deleteCount = puckerIndex - deleteIndex;
      if (0 < deleteCount) {
        puckerIndex -= deleteCount;
        yield sqlBase.deleteChangesPromise(ctx, docId, deleteIndex);
      } else if (0 > deleteCount) {
        ctx.logger.error("Error checkEndAuthLock: deleteIndex: %s ; startIndex: %s ; deleteCount: %s",
                     deleteIndex, puckerIndex, deleteCount);
      }
    }

		if (unlock) {
			var unlockRes = yield editorData.unlockAuth(ctx, docId, userId);
			if (commonDefines.c_oAscUnlockRes.Unlocked === unlockRes) {
				const participantsMap = yield getParticipantMap(ctx, docId);
				yield publish(ctx, {
					type: commonDefines.c_oPublishType.auth,
                    ctx: ctx,
					docId: docId,
					userId: userId,
					participantsMap: participantsMap
				});

				result = true;
			}
		}

		//Release locks
		if (releaseLocks && conn) {
			const userLocks = yield removeUserLocks(ctx, docId, userId);
			if (0 < userLocks.length) {
				sendReleaseLock(ctx, conn, userLocks);
				yield publish(ctx, {
					type: commonDefines.c_oPublishType.releaseLock,
                    ctx: ctx,
					docId: docId,
					userId: userId,
					locks: userLocks
				}, docId, userId);
			}
		}
		if (isSave && conn) {
			// Automatically remove the lock ourselves
			yield* unSaveLock(ctx, conn, -1, -1, -1);
		}

		return result;
	}

  function* setLockDocumentTimer(ctx, docId, userId) {
    const tenExpLockDoc = ctx.getCfg('services.CoAuthoring.expire.lockDoc', cfgExpLockDoc);
    let timerId = setTimeout(function() {
      return co(function*() {
        try {
          ctx.logger.warn("lockDocumentsTimerId timeout");
          delete lockDocumentsTimerId[docId];
          //todo remove checkEndAuthLock(only needed for lost connections in redis)
          yield* checkEndAuthLock(ctx, true, false, docId, userId);
          yield* publishCloseUsersConnection(ctx, docId, [userId], false, constants.DROP_CODE, constants.DROP_REASON);
        } catch (e) {
          ctx.logger.error("lockDocumentsTimerId error: %s", e.stack);
        }
      });
    }, 1000 * tenExpLockDoc);
    lockDocumentsTimerId[docId] = {timerId: timerId, userId: userId};
    ctx.logger.debug("lockDocumentsTimerId set");
  }
  function cleanLockDocumentTimer(docId, lockDocumentTimer) {
    clearTimeout(lockDocumentTimer.timerId);
    delete lockDocumentsTimerId[docId];
  }

  function sendParticipantsState(ctx, participants, data) {
    _.each(participants, function(participant) {
      sendData(ctx, participant, {
        type: "connectState",
        participantsTimestamp: data.participantsTimestamp,
        participants: data.participants,
        waitAuth: !!data.waitAuthUserId
      });
    });
  }

  function sendFileError(ctx, conn, errorId, code) {
    ctx.logger.warn('error description: errorId = %s', errorId);
    conn.isCiriticalError = true;
    sendData(ctx, conn, {type: 'error', description: errorId, code: code});
  }

  function* sendFileErrorAuth(ctx, conn, sessionId, errorId, code) {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

    conn.sessionId = sessionId;//restore old
    //Kill previous connections
    connections = _.reject(connections, function(el) {
      return el.sessionId === sessionId;//Delete this connection
    });
    //closing could happen during async action
    if (constants.CONN_CLOSED !== conn.conn.readyState) {
      // We put it in an array, because we need to send data to open/save the document
      connections.push(conn);
      yield addPresence(ctx, conn, true);
      if (tenTokenEnableBrowser) {
        let sessionToken = yield fillJwtByConnection(ctx, conn);
        sendDataRefreshToken(ctx, conn, sessionToken);
      }
      sendFileError(ctx, conn, errorId, code);
    }
  }

  // Recalculation only for foreign Lock when saving on a client that added/deleted rows or columns
  function _recalcLockArray(userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
    let res = {};
    if (null == _locks) {
      return res;
    }
    var element = null, oRangeOrObjectId = null;
    var sheetId = -1;
    for (let lockId in _locks) {
      let isModify = false;
      let lock = _locks[lockId];
      // we do not count for ourselves
      if (userId === lock.user) {
        continue;
      }
      element = lock.block;
      if (c_oAscLockTypeElem.Range !== element["type"] ||
        c_oAscLockTypeElemSubType.InsertColumns === element["subType"] ||
        c_oAscLockTypeElemSubType.InsertRows === element["subType"]) {
        continue;
      }
      sheetId = element["sheetId"];

      oRangeOrObjectId = element["rangeOrObjectId"];

      if (oRecalcIndexColumns && oRecalcIndexColumns.hasOwnProperty(sheetId)) {
        // Column index recalculation
        oRangeOrObjectId["c1"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c1"]);
        oRangeOrObjectId["c2"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c2"]);
        isModify = true;
      }
      if (oRecalcIndexRows && oRecalcIndexRows.hasOwnProperty(sheetId)) {
        // row index recalculation
        oRangeOrObjectId["r1"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r1"]);
        oRangeOrObjectId["r2"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r2"]);
        isModify = true;
      }
      if (isModify) {
        res[lockId] = lock;
      }
    }
    return res;
  }

  function _addRecalcIndex(oRecalcIndex) {
    if (null == oRecalcIndex) {
      return null;
    }
    var nIndex = 0;
    var nRecalcType = c_oAscRecalcIndexTypes.RecalcIndexAdd;
    var oRecalcIndexElement = null;
    var oRecalcIndexResult = {};

    for (var sheetId in oRecalcIndex) {
      if (oRecalcIndex.hasOwnProperty(sheetId)) {
        if (!oRecalcIndexResult.hasOwnProperty(sheetId)) {
          oRecalcIndexResult[sheetId] = new CRecalcIndex();
        }
        for (; nIndex < oRecalcIndex[sheetId]._arrElements.length; ++nIndex) {
          oRecalcIndexElement = oRecalcIndex[sheetId]._arrElements[nIndex];
          if (true === oRecalcIndexElement.m_bIsSaveIndex) {
            continue;
          }
          nRecalcType = (c_oAscRecalcIndexTypes.RecalcIndexAdd === oRecalcIndexElement._recalcType) ?
            c_oAscRecalcIndexTypes.RecalcIndexRemove : c_oAscRecalcIndexTypes.RecalcIndexAdd;
          // Duplicate to return the result (we only need to recalculate by the last index
          oRecalcIndexResult[sheetId].add(nRecalcType, oRecalcIndexElement._position,
            oRecalcIndexElement._count, /*bIsSaveIndex*/true);
        }
      }
    }

    return oRecalcIndexResult;
  }

  function compareExcelBlock(newBlock, oldBlock) {
    // This is a lock to remove or add rows/columns
    if (null !== newBlock.subType && null !== oldBlock.subType) {
      return true;
    }

    // Ignore lock from ChangeProperties (only if it's not a leaf lock)
    if ((c_oAscLockTypeElemSubType.ChangeProperties === oldBlock.subType &&
      c_oAscLockTypeElem.Sheet !== newBlock.type) ||
      (c_oAscLockTypeElemSubType.ChangeProperties === newBlock.subType &&
        c_oAscLockTypeElem.Sheet !== oldBlock.type)) {
      return false;
    }

    var resultLock = false;
    if (newBlock.type === c_oAscLockTypeElem.Range) {
      if (oldBlock.type === c_oAscLockTypeElem.Range) {
        // We do not take into account lock from Insert
        if (c_oAscLockTypeElemSubType.InsertRows === oldBlock.subType || c_oAscLockTypeElemSubType.InsertColumns === oldBlock.subType) {
          resultLock = false;
        } else if (isInterSection(newBlock.rangeOrObjectId, oldBlock.rangeOrObjectId)) {
          resultLock = true;
        }
      } else if (oldBlock.type === c_oAscLockTypeElem.Sheet) {
        resultLock = true;
      }
    } else if (newBlock.type === c_oAscLockTypeElem.Sheet) {
      resultLock = true;
    } else if (newBlock.type === c_oAscLockTypeElem.Object) {
      if (oldBlock.type === c_oAscLockTypeElem.Sheet) {
        resultLock = true;
      } else if (oldBlock.type === c_oAscLockTypeElem.Object && oldBlock.rangeOrObjectId === newBlock.rangeOrObjectId) {
        resultLock = true;
      }
    }
    return resultLock;
  }

  function isInterSection(range1, range2) {
    if (range2.c1 > range1.c2 || range2.c2 < range1.c1 || range2.r1 > range1.r2 || range2.r2 < range1.r1) {
      return false;
    }
    return true;
  }

  function comparePresentationBlock(newBlock, oldBlock) {
    var resultLock = false;

    switch (newBlock.type) {
      case c_oAscLockTypeElemPresentation.Presentation:
        if (c_oAscLockTypeElemPresentation.Presentation === oldBlock.type) {
          resultLock = newBlock.val === oldBlock.val;
        }
        break;
      case c_oAscLockTypeElemPresentation.Slide:
        if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type) {
          resultLock = newBlock.val === oldBlock.val;
        }
        else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type) {
          resultLock = newBlock.val === oldBlock.slideId;
        }
        break;
      case c_oAscLockTypeElemPresentation.Object:
        if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type) {
          resultLock = newBlock.slideId === oldBlock.val;
        }
        else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type) {
          resultLock = newBlock.objId === oldBlock.objId;
        }
        break;
    }
    return resultLock;
  }

  function* authRestore(ctx, conn, sessionId) {
    conn.sessionId = sessionId;//restore old
    //Kill previous connections
    connections = _.reject(connections, function(el) {
      return el.sessionId === sessionId;//Delete this connection
    });

    yield* endAuth(ctx, conn, true);
  }

  function fillUsername(ctx, data) {
    let name;
    let user = data.user;
    if (user.firstname && user.lastname) {
      //as in web-apps/apps/common/main/lib/util/utils.js
      let isRu = (data.lang && /^ru/.test(data.lang));
      name = isRu ? user.lastname + ' ' + user.firstname : user.firstname + ' ' + user.lastname;
    } else {
      name = user.username || "Anonymous";
    }
    if (name.length > constants.USER_NAME_MAX_LENGTH) {
      ctx.logger.warn('fillUsername user name too long actual = %s; max = %s', name.length, constants.USER_NAME_MAX_LENGTH);
      name = name.substr(0, constants.USER_NAME_MAX_LENGTH);
    }
    return name;
  }
  function isEditMode(permissions, mode) {
    //like this.api.asc_setViewMode(!this.appOptions.isEdit && !this.appOptions.isRestrictedEdit);
    //https://github.com/ONLYOFFICE/web-apps/blob/4a7879b4f88f315fe94d9f7d97c0ed8aa9f82221/apps/documenteditor/main/app/controller/Main.js#L1743
    //todo permissions in embed editor
    //https://github.com/ONLYOFFICE/web-apps/blob/72b8350c71e7b314b63b8eec675e76156bb4a2e4/apps/documenteditor/forms/app/controller/ApplicationController.js#L627
    return (!mode || mode !== 'view') && (!permissions || permissions.edit !== false || permissions.review === true ||
        permissions.comment === true || permissions.fillForms === true);
    }
  function fillDataFromWopiJwt(decoded, data) {
    let res = true;
    var openCmd = data.openCmd;

    if (decoded.key) {
      data.docid = decoded.key;
    }
    if (decoded.userAuth) {
      data.documentCallbackUrl = JSON.stringify(decoded.userAuth);
      data.mode = decoded.userAuth.mode;
    }
    if (decoded.queryParams) {
      let queryParams = decoded.queryParams;
      data.lang = queryParams.lang || queryParams.ui || constants.TEMPLATES_DEFAULT_LOCALE;
    }
    if (wopiClient.isWopiJwtToken(decoded)) {
      let fileInfo = decoded.fileInfo;
      let queryParams = decoded.queryParams;
      if (openCmd) {
        openCmd.format = wopiClient.getFileTypeByInfo(fileInfo);
        openCmd.title = fileInfo.BreadcrumbDocName || fileInfo.BaseFileName;
      }
      let name = fileInfo.IsAnonymousUser ? "" : fileInfo.UserFriendlyName;
      if (name) {
        data.user.username = name;
        data.denyChangeName = true;
      }
      if (null != fileInfo.UserId) {
        data.user.id = fileInfo.UserId;
        if (openCmd) {
          openCmd.userid = fileInfo.UserId;
        }
      }
      let permissionsEdit = !fileInfo.ReadOnly && fileInfo.UserCanWrite && queryParams.formsubmit !== "1";
      let permissionsFillForm = permissionsEdit || queryParams.formsubmit === "1";
      let permissions = {
        edit: permissionsEdit,
        review: (fileInfo.SupportsReviewing === false) ? false : (fileInfo.UserCanReview === false ? false : fileInfo.UserCanReview),
        copy: fileInfo.CopyPasteRestrictions !== "CurrentDocumentOnly" && fileInfo.CopyPasteRestrictions !== "BlockAll",
        print: !fileInfo.DisablePrint && !fileInfo.HidePrintOption,
        chat: queryParams.dchat!=="1",
        fillForms: permissionsFillForm
      };
      //todo (review: undefiend)
      // res = deepEqual(data.permissions, permissions, {strict: true});
      if (!data.permissions) {
        data.permissions = {};
      }
      //not '=' because if it jwt from previous version, we must use values from data
      Object.assign(data.permissions, permissions);
    }

    //issuer for secret
    if (decoded.iss) {
      data.iss = decoded.iss;
    }
    return res;
  }
  function validateAuthToken(data, decoded) {
    var res = "";
    if (!decoded?.document?.key) {
      res = "document.key";
    } else if (data.permissions && !decoded?.document?.permissions) {
      res = "document.permissions";
    } else if (!decoded?.document?.url) {
      res = "document.url";
    } else if (data.documentCallbackUrl && !decoded?.editorConfig?.callbackUrl) {
      //todo callbackUrl required
      res = "editorConfig.callbackUrl";
    } else if (data.mode && 'view' !== data.mode && !decoded?.editorConfig?.mode) {//allow to restrict rights to 'view'
      res = "editorConfig.mode";
    }
    return res;
  }
  function fillDataFromJwt(ctx, decoded, data) {
    let res = true;
    var openCmd = data.openCmd;
    if (decoded.document) {
      var doc = decoded.document;
      if(null != doc.key){
        data.docid = doc.key;
        if(openCmd){
          openCmd.id = doc.key;
        }
      }
      if(doc.permissions) {
        res = deepEqual(data.permissions, doc.permissions, {strict: true});
        if (!res) {
          ctx.logger.warn('fillDataFromJwt token has modified permissions');
        }
        if(!data.permissions){
          data.permissions = {};
        }
        //not '=' because if it jwt from previous version, we must use values from data
        Object.assign(data.permissions, doc.permissions);
      }
      if(openCmd){
        if(null != doc.fileType) {
          openCmd.format = doc.fileType;
        }
        if(null != doc.title) {
          openCmd.title = doc.title;
        }
        if(null != doc.url) {
          openCmd.url = doc.url;
        }
      }
      if (null != doc.ds_encrypted) {
        data.encrypted = doc.ds_encrypted;
      }
    }
    if (decoded.editorConfig) {
      var edit = decoded.editorConfig;
      if (null != edit.callbackUrl) {
        data.documentCallbackUrl = edit.callbackUrl;
      }
      if (null != edit.lang) {
        data.lang = edit.lang;
      }
      //allow to restrict rights so don't use token mode in case of 'view'
      if (null != edit.mode && 'view' !== data.mode) {
        data.mode = edit.mode;
      }
      if (edit.coEditing?.mode) {
        data.coEditingMode = edit.coEditing.mode;
        if (edit.coEditing?.change) {
          data.coEditingMode = 'fast';
        }
        //offline viewer for pdf|djvu|xps|oxps and embeded
        let type = constants.VIEWER_ONLY.exec(decoded.document?.fileType);
        if ((type && typeof type[1] === 'string') || "embedded" === decoded.type) {
          data.coEditingMode = 'strict';
        }
      }
      if (null != edit.ds_isCloseCoAuthoring) {
        data.isCloseCoAuthoring = edit.ds_isCloseCoAuthoring;
      }
      data.isEnterCorrectPassword = edit.ds_isEnterCorrectPassword;
      data.denyChangeName = edit.ds_denyChangeName;
      // data.sessionId = edit.ds_sessionId;
      data.sessionTimeConnect = edit.ds_sessionTimeConnect;
      if (edit.user) {
        var dataUser = data.user;
        var user = edit.user;
        if (user.id) {
          dataUser.id = user.id;
          if (openCmd) {
            openCmd.userid = user.id;
          }
        }
        if (null != user.index) {
          dataUser.indexUser = user.index;
        }
        if (user.firstname) {
          dataUser.firstname = user.firstname;
        }
        if (user.lastname) {
          dataUser.lastname = user.lastname;
        }
        if (user.name) {
          dataUser.username = user.name;
        }
        if (user.group) {
          //like in Common.Utils.fillUserInfo(web-apps/apps/common/main/lib/util/utils.js)
          dataUser.username = user.group.toString() + String.fromCharCode(160) + dataUser.username;
        }
      }
      if (edit.user && edit.user.name) {
        data.denyChangeName = true;
      }
    }

    //todo make required fields
    if (decoded.url || decoded.payload|| (decoded.key && !wopiClient.isWopiJwtToken(decoded))) {
      ctx.logger.warn('fillDataFromJwt token has invalid format');
      res = false;
    }

    //issuer for secret
    if (decoded.iss) {
      data.iss = decoded.iss;
    }
    return res;
  }
  function fillVersionHistoryFromJwt(ctx, decoded, cmd) {
    if (decoded.changesUrl && decoded.previous) {
      let versionMatch = cmd.getServerVersion() === commonDefines.buildVersion;
      let openPreviousVersion = cmd.getDocId() === decoded.previous.key;
      if (versionMatch && openPreviousVersion) {
        cmd.setUrl(decoded.previous.url);
        cmd.setDocId(decoded.previous.key);
      } else {
        ctx.logger.warn('fillVersionHistoryFromJwt serverVersion mismatch or mismatch between previous url and changes. serverVersion=%s docId=%s', cmd.getServerVersion(), cmd.getDocId());
        cmd.setUrl(decoded.url);
        cmd.setDocId(decoded.key);
      }
    } else {
      cmd.setUrl(decoded.url);
      cmd.setDocId(decoded.key);
    }
  }

  function* auth(ctx, conn, data) {
    const tenExpUpdateVersionStatus = ms(ctx.getCfg('services.CoAuthoring.expire.updateVersionStatus', cfgExpUpdateVersionStatus));
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenIsAnonymousSupport = ctx.getCfg('services.CoAuthoring.server.isAnonymousSupport', cfgIsAnonymousSupport);
    const tenTokenRequiredParams = ctx.getCfg('services.CoAuthoring.server.tokenRequiredParams', cfgTokenRequiredParams);

    //TODO: Do authorization etc. check md5 or query db
    ctx.logger.debug('auth time: %d', data.time);
    if (data.token && data.user) {
      ctx.setUserId(data.user.id);
      let [licenseInfo] = yield tenantManager.getTenantLicense(ctx);
      let isDecoded = false;
      //check jwt
      if (tenTokenEnableBrowser) {
        let secretType = !!data.jwtSession ? commonDefines.c_oAscSecretType.Session : commonDefines.c_oAscSecretType.Browser;
        const checkJwtRes = yield checkJwt(ctx, data.jwtSession || data.jwtOpen, secretType);
        if (checkJwtRes.decoded) {
          isDecoded = true;
          let decoded = checkJwtRes.decoded;
          let fillDataFromJwtRes = false;
          if (wopiClient.isWopiJwtToken(decoded)) {
            //wopi
            fillDataFromJwtRes = fillDataFromWopiJwt(decoded, data);
          } else if (decoded.editorConfig && undefined !== decoded.editorConfig.ds_sessionTimeConnect) {
            //reconnection
            fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
          } else {
            //opening
            let validationErr = validateAuthToken(data, decoded);
            if (!validationErr) {
              fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
            } else if (tenTokenRequiredParams) {
              ctx.logger.error("auth missing required parameter %s (since 7.1 version)", validationErr);
              sendDataDisconnectReason(ctx, conn, constants.JWT_ERROR_CODE, constants.JWT_ERROR_REASON);
              conn.disconnect(true);
              return;
            } else {
              ctx.logger.warn("auth missing required parameter %s (since 7.1 version)", validationErr);
              fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
            }
          }
          if(!fillDataFromJwtRes) {
            ctx.logger.warn("fillDataFromJwt return false");
            sendDataDisconnectReason(ctx, conn, constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
            conn.disconnect(true);
            return;
          }
        } else {
          sendDataDisconnectReason(ctx, conn, checkJwtRes.code, checkJwtRes.description);
          conn.disconnect(true);
          return;
        }
      }
      ctx.setUserId(data.user.id);

      let docId = data.docid;
      const user = data.user;

      let wopiParams = null, wopiParamsFull = null, openedAtStr;
      if (data.documentCallbackUrl) {
        wopiParams = wopiClient.parseWopiCallback(ctx, data.documentCallbackUrl);
        if (wopiParams && wopiParams.userAuth) {
          conn.access_token_ttl = wopiParams.userAuth.access_token_ttl;
        }
      }
      let cmd = null;
      if (data.openCmd) {
        cmd = new commonDefines.InputCommand(data.openCmd);
        cmd.setDocId(docId);
        if (isDecoded) {
          cmd.setWithAuthorization(true);
        }
      }
      //todo minimize select calls on opening
      let result = yield taskResult.select(ctx, docId);
      let resultRow = result.length > 0 ? result[0] : null;
      if (wopiParams) {
        if (resultRow && resultRow.callback) {
          wopiParamsFull = wopiClient.parseWopiCallback(ctx, data.documentCallbackUrl, resultRow.callback);
          cmd?.setWopiParams(wopiParamsFull);
        }
        if (!wopiParamsFull || !wopiParamsFull.userAuth || !wopiParamsFull.commonInfo) {
          ctx.logger.warn('invalid wopi callback (maybe postgres<9.5) %j', wopiParams);
          sendDataDisconnectReason(ctx, conn, constants.DROP_CODE, constants.DROP_REASON);
          conn.disconnect(true);
          return;
        }
      }
      //get user index
      const bIsRestore = null != data.sessionId;
      let upsertRes = null;
      let curIndexUser, documentCallback;
      if (bIsRestore) {
        // If we restore, we also restore the index
        curIndexUser = user.indexUser;
      } else {
        if (data.documentCallbackUrl && !wopiParams) {
          documentCallback = url.parse(data.documentCallbackUrl);
          let filterStatus = yield* utils.checkHostFilter(ctx, documentCallback.hostname);
          if (0 !== filterStatus) {
            ctx.logger.warn('checkIpFilter error: url = %s', data.documentCallbackUrl);
            sendDataDisconnectReason(ctx, conn, constants.DROP_CODE, constants.DROP_REASON);
            conn.disconnect(true);
            return;
          }
        }
        let format = data.openCmd && data.openCmd.format;
        upsertRes = yield canvasService.commandOpenStartPromise(ctx, docId, utils.getBaseUrlByConnection(ctx, conn), data.documentCallbackUrl, format);
        curIndexUser = upsertRes.insertId;
        //todo update additional in commandOpenStartPromise
        if ((upsertRes.isInsert || (wopiParams && 2 === curIndexUser)) && (undefined !== data.timezoneOffset || ctx.shardKey || ctx.wopiSrc)) {
          //todo insert in commandOpenStartPromise. insert here for database compatibility
          if (false === canvasService.hasAdditionalCol) {
            let selectRes = yield taskResult.select(ctx, docId);
            canvasService.hasAdditionalCol = selectRes.length > 0 && undefined !== selectRes[0].additional;
          }
          if (canvasService.hasAdditionalCol) {
            let task = new taskResult.TaskResultData();
            task.tenant = ctx.tenant;
            task.key = docId;
            if (undefined !== data.timezoneOffset) {
              //todo duplicate created_at because CURRENT_TIMESTAMP uses server timezone
              openedAtStr = sqlBase.DocumentAdditional.prototype.setOpenedAt(Date.now(), data.timezoneOffset);
              task.additional = openedAtStr;
            }
            if (ctx.shardKey) {
              task.additional += sqlBase.DocumentAdditional.prototype.setShardKey(ctx.shardKey);
            }
            if (ctx.wopiSrc) {
              task.additional += sqlBase.DocumentAdditional.prototype.setWopiSrc(ctx.wopiSrc);
            }
            yield taskResult.update(ctx, task);
          } else {
            ctx.logger.warn('auth unknown column "additional"');
          }
        }
      }
      if (constants.CONN_CLOSED === conn.conn.readyState) {
        //closing could happen during async action
        return;
      }

      const curUserIdOriginal = String(user.id);
      const curUserId = curUserIdOriginal + curIndexUser;
      conn.tenant = tenantManager.getTenantByConnection(ctx, conn);
      conn.docId = data.docid;
      conn.permissions = data.permissions;
      conn.user = {
        id: curUserId,
        idOriginal: curUserIdOriginal,
        username: fillUsername(ctx, data),
        indexUser: curIndexUser,
        view: !isEditMode(data.permissions, data.mode)
      };
      if (conn.user.view && utils.isLiveViewerSupport(licenseInfo)) {
        conn.coEditingMode = data.coEditingMode;
      }
      conn.isCloseCoAuthoring = data.isCloseCoAuthoring;
      conn.isEnterCorrectPassword = data.isEnterCorrectPassword;
      conn.denyChangeName = data.denyChangeName;
      conn.editorType = data['editorType'];
      if (data.sessionTimeConnect) {
        conn.sessionTimeConnect = data.sessionTimeConnect;
      }
      if (data.sessionTimeIdle >= 0) {
        conn.sessionTimeLastAction = new Date().getTime() - data.sessionTimeIdle;
      }
      conn.unsyncTime = null;
      conn.encrypted = data.encrypted;
      conn.lang = data.lang;
      conn.supportAuthChangesAck = data.supportAuthChangesAck;

      const c_LR = constants.LICENSE_RESULT;
      conn.licenseType = c_LR.Success;
      let isLiveViewer = utils.isLiveViewer(conn);
      if (!conn.user.view || isLiveViewer) {
        let licenseType = yield* _checkLicenseAuth(ctx, licenseInfo, conn.user.idOriginal, isLiveViewer);
        let aggregationCtx, licenseInfoAggregation;
        if ((c_LR.Success === licenseType || c_LR.SuccessLimit === licenseType) && tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
          //check server aggregation license
          aggregationCtx = new operationContext.Context();
          aggregationCtx.init(tenantManager.getDefautTenant(), ctx.docId, ctx.userId);
          //yield ctx.initTenantCache(); //no need
          licenseInfoAggregation = tenantManager.getServerLicense();
          licenseType = yield* _checkLicenseAuth(aggregationCtx, licenseInfoAggregation, `${ctx.tenant}:${ conn.user.idOriginal}`, isLiveViewer);
        }
        conn.licenseType = licenseType;
        if ((c_LR.Success !== licenseType && c_LR.SuccessLimit !== licenseType) || (!tenIsAnonymousSupport && data.IsAnonymousUser)) {
          if (!tenIsAnonymousSupport && data.IsAnonymousUser) {
            //do not modify the licenseType because this information is already sent in _checkLicense
            ctx.logger.error('auth: access to editor or live viewer is denied for anonymous users');
          }
          modifyConnectionEditorToView(ctx, conn);
        } else {
          //don't check IsAnonymousUser via jwt because substituting it doesn't lead to any trouble
          yield* updateEditUsers(ctx, licenseInfo, conn.user.idOriginal, !!data.IsAnonymousUser, isLiveViewer);
          if (aggregationCtx && licenseInfoAggregation) {
            //update server aggregation license
            yield* updateEditUsers(aggregationCtx, licenseInfoAggregation, `${ctx.tenant}:${ conn.user.idOriginal}`, !!data.IsAnonymousUser, isLiveViewer);
          }
        }
      }

      // Situation when the user is already disabled from co-authoring
      if (bIsRestore && data.isCloseCoAuthoring) {
        conn.sessionId = data.sessionId;//restore old
        // delete previous connections
        connections = _.reject(connections, function(el) {
          return el.sessionId === data.sessionId;//Delete this connection
        });
        //closing could happen during async action
        if (constants.CONN_CLOSED !== conn.conn.readyState) {
          // We put it in an array, because we need to send data to open/save the document
          connections.push(conn);
          yield addPresence(ctx, conn, true);
          // Sending a formal authorization to confirm the connection
          yield* sendAuthInfo(ctx, conn, bIsRestore, undefined);
          if (cmd) {
            yield canvasService.openDocument(ctx, conn, cmd, upsertRes, bIsRestore);
          }
        }
        return;
      }
      if (conn.user.idOriginal.length > constants.USER_ID_MAX_LENGTH) {
        //todo refactor DB and remove restrictions
        ctx.logger.warn('auth user id too long actual = %s; max = %s', curUserIdOriginal.length, constants.USER_ID_MAX_LENGTH);
        yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'User id too long');
        return;
      }
      if (!conn.user.view) {
        var status = result && result.length > 0 ? result[0]['status'] : null;
        if (commonDefines.FileStatus.Ok === status) {
          // Everything is fine, the status does not need to be updated
        } else if (commonDefines.FileStatus.SaveVersion === status ||
          (!bIsRestore && commonDefines.FileStatus.UpdateVersion === status &&
          Date.now() - result[0]['status_info'] * 60000 > tenExpUpdateVersionStatus)) {
          let newStatus = commonDefines.FileStatus.Ok;
          if (commonDefines.FileStatus.UpdateVersion === status) {
            ctx.logger.warn("UpdateVersion expired");
            //FileStatus.None to open file again from new url
            newStatus = commonDefines.FileStatus.None;
          }
          // Update the status of the file (the build is in progress, you need to stop it)
          var updateMask = new taskResult.TaskResultData();
          updateMask.tenant = ctx.tenant;
          updateMask.key = docId;
          updateMask.status = status;
          updateMask.statusInfo = result[0]['status_info'];
          var updateTask = new taskResult.TaskResultData();
          updateTask.status = newStatus;
          updateTask.statusInfo = constants.NO_ERROR;
          var updateIfRes = yield taskResult.updateIf(ctx, updateTask, updateMask);
          if (!(updateIfRes.affectedRows > 0)) {
            // error version
            yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
            return;
          }
        } else if (commonDefines.FileStatus.UpdateVersion === status) {
          if (bIsRestore) {
            // error version
            yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
            return;
          } else {
            modifyConnectionEditorToView(ctx, conn);
            conn.isCiriticalError = true;
          }
        } else if (commonDefines.FileStatus.None === status && conn.encrypted) {
          //ok
        } else if (bIsRestore) {
          // Other error
          let code = null === status ? constants.NO_CACHE_CODE : undefined;
          yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Other error', code);
          return;
        }
      }
      //Set the unique ID
      if (bIsRestore) {
        ctx.logger.info("restored old session: id = %s", data.sessionId);

        if (!conn.user.view) {
          // Stop the assembly (suddenly it started)
          // When reconnecting, we need to check for file assembly
          try {
            var puckerIndex = yield* getChangesIndex(ctx, docId);
            var bIsSuccessRestore = true;
            if (puckerIndex > 0) {
              let objChangesDocument = yield* getDocumentChanges(ctx, docId, puckerIndex - 1, puckerIndex);
              var change = objChangesDocument.arrChanges[objChangesDocument.getLength() - 1];
              if (change) {
                if (change['change']) {
                  if (change['user'] !== curUserId) {
                    bIsSuccessRestore = 0 === (((data['lastOtherSaveTime'] - change['time']) / 1000) >> 0);
                  }
                }
              } else {
                bIsSuccessRestore = false;
              }
            }

            if (bIsSuccessRestore) {
              // check locks
              var arrayBlocks = data['block'];
              var getLockRes = yield getLock(ctx, conn, data, true);
              if (arrayBlocks && (0 === arrayBlocks.length || getLockRes)) {
                let wopiLockRes = true;
                if (wopiParamsFull) {
                  wopiLockRes = yield wopiClient.lock(ctx, 'LOCK', wopiParamsFull.commonInfo.lockId,
                    wopiParamsFull.commonInfo.fileInfo, wopiParamsFull.userAuth);
                }
                if (wopiLockRes) {
                  yield* authRestore(ctx, conn, data.sessionId);
                } else {
                  yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Restore error. Wopi lock error.', constants.RESTORE_CODE);
                }
              } else {
                yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Restore error. Locks not checked.', constants.RESTORE_CODE);
              }
            } else {
              yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Restore error. Document modified.', constants.RESTORE_CODE);
            }
          } catch (err) {
            ctx.logger.error("DataBase error: %s", err.stack);
            yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'DataBase error', constants.RESTORE_CODE);
          }
        } else {
          yield* authRestore(ctx, conn, data.sessionId);
        }
      } else {
        conn.sessionId = conn.id;
        let openedAt = openedAtStr ? sqlBase.DocumentAdditional.prototype.getOpenedAt(openedAtStr) : canvasService.getOpenedAt(resultRow);
        const endAuthRes = yield* endAuth(ctx, conn, false, documentCallback, openedAt);
        if (endAuthRes && cmd) {
          //todo to allow forcesave TemplateSource after convertion(move to better place)
          if (wopiParamsFull?.commonInfo?.fileInfo?.TemplateSource) {
            let newChangesLastDate = new Date();
            newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding
            cmd.setExternalChangeInfo(getExternalChangeInfo(conn.user, newChangesLastDate.getTime(), conn.lang));
          }
          yield canvasService.openDocument(ctx, conn, cmd, upsertRes, bIsRestore);
        }
      }
    }
  }

  function* endAuth(ctx, conn, bIsRestore, documentCallback, opt_openedAt) {
    const tenExpLockDoc = ctx.getCfg('services.CoAuthoring.expire.lockDoc', cfgExpLockDoc);
    const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);

    let res = true;
    const docId = conn.docId;
    const tmpUser = conn.user;
    let hasForgotten;
    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return false;
    }
    connections.push(conn);
    let firstParticipantNoView, countNoView = 0;
    yield addPresence(ctx, conn, true);
    let participantsMap = yield getParticipantMap(ctx, docId);
    const participantsTimestamp = Date.now();
    for (let i = 0; i < participantsMap.length; ++i) {
      const elem = participantsMap[i];
      if (!elem.view) {
        ++countNoView;
        if (!firstParticipantNoView && elem.id !== tmpUser.id) {
          firstParticipantNoView = elem;
        }
      }
    }
    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return false;
    }
    // Sending to an external callback only for those who edit
    if (!tmpUser.view) {
      const userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
      const userAction = new commonDefines.OutputAction(commonDefines.c_oAscUserAction.In, tmpUser.idOriginal);
      //make async request to speed up file opening
      sendStatusDocument(ctx, docId, c_oAscChangeBase.No, userAction, userIndex, documentCallback, conn.baseUrl)
        .catch(err => ctx.logger.error('endAuth sendStatusDocument error: %s', err.stack));
      if (!bIsRestore) {
        //check forgotten file
        let forgotten = yield storage.listObjects(ctx, docId, tenForgottenFiles);
        hasForgotten = forgotten.length > 0;
        ctx.logger.debug('endAuth hasForgotten %s', hasForgotten);
      }
    }

    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return false;
    }
    let lockDocument = null;
    let waitAuthUserId;
    if (!bIsRestore && 2 === countNoView && !tmpUser.view) {
      // lock a document
      const lockRes = yield editorData.lockAuth(ctx, docId, firstParticipantNoView.id, 2 * tenExpLockDoc);
      if (constants.CONN_CLOSED === conn.conn.readyState) {
        //closing could happen during async action
        return false;
      }
      if (lockRes) {
        lockDocument = firstParticipantNoView;
        waitAuthUserId = lockDocument.id;
        let lockDocumentTimer = lockDocumentsTimerId[docId];
        if (lockDocumentTimer) {
          cleanLockDocumentTimer(docId, lockDocumentTimer);
        }
        yield* setLockDocumentTimer(ctx, docId, lockDocument.id);
      }
    }
    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return false;
    }
    if (lockDocument && !tmpUser.view) {
      // waiting for the editor to switch to co-editing mode
      const sendObject = {
        type: "waitAuth",
        lockDocument: lockDocument
      };
      sendData(ctx, conn, sendObject);//Or 0 if fails
    } else {
      if (!bIsRestore && needSendChanges(conn)) {
        yield* sendAuthChanges(ctx, conn.docId, [conn]);
      }
      if (constants.CONN_CLOSED === conn.conn.readyState) {
        //closing could happen during async action
        return false;
      }
      yield* sendAuthInfo(ctx, conn, bIsRestore, participantsMap, hasForgotten, opt_openedAt);
    }
    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return false;
    }
    yield publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participantsMap, waitAuthUserId: waitAuthUserId}, docId, tmpUser.id);
    return res;
  }

  function* saveErrorChanges(ctx, docId, destDir) {
    const tenEditor = getEditorConfig(ctx);
    const tenMaxRequestChanges = ctx.getCfg('services.CoAuthoring.server.maxRequestChanges', cfgMaxRequestChanges);
    const tenErrorFiles = ctx.getCfg('FileConverter.converter.errorfiles', cfgErrorFiles);

    let index = 0;
    let indexChunk = 1;
    let changes;
    let changesPrefix = destDir + '/' + constants.CHANGES_NAME + '/' + constants.CHANGES_NAME + '.json.';
    do {
      changes = yield sqlBase.getChangesPromise(ctx, docId, index, index + tenMaxRequestChanges);
      if (changes.length > 0) {
        let buffer;
        if (tenEditor['binaryChanges']) {
          let buffers = changes.map(elem => elem.change_data);
          buffers.unshift(Buffer.from(utils.getChangesFileHeader(), 'utf-8'))
          buffer = Buffer.concat(buffers);
        } else {
          let changesJSON = indexChunk > 1 ? ',[' : '[';
          changesJSON += changes[0].change_data;
          for (let i = 1; i < changes.length; ++i) {
            changesJSON += ',';
            changesJSON += changes[i].change_data;
          }
          changesJSON += ']\r\n';
          buffer = Buffer.from(changesJSON, 'utf8');
        }
        yield storage.putObject(ctx, changesPrefix + (indexChunk++).toString().padStart(3, '0'), buffer, buffer.length, tenErrorFiles);
      }
      index += tenMaxRequestChanges;
    } while (changes && tenMaxRequestChanges === changes.length);
  }

  function sendAuthChangesByChunks(ctx, changes, connections) {
    return co(function* () {
      //websocket payload size is limited by https://github.com/faye/faye-websocket-node#initialization-options (64 MiB)
      //xhr payload size is limited by nginx param client_max_body_size (current 100MB)
      //"1.5MB" is choosen to avoid disconnect(after 25s) while downloading/uploading oversized changes with 0.5Mbps connection
      const tenEditor = getEditorConfig(ctx);

      let startIndex = 0;
      let endIndex = 0;
      while (endIndex < changes.length) {
        startIndex = endIndex;
        let curBytes = 0;
        for (; endIndex < changes.length && curBytes < tenEditor['websocketMaxPayloadSize']; ++endIndex) {
          curBytes += JSON.stringify(changes[endIndex]).length + 24;//24 - for JSON overhead
        }
        //todo simplify 'authChanges' format to reduce message size and JSON overhead
        const sendObject = {
          type: 'authChanges',
          changes: changes.slice(startIndex, endIndex)
        };
        for (let i = 0; i < connections.length; ++i) {
          let conn = connections[i];
          if (needSendChanges(conn)) {
            if (conn.supportAuthChangesAck) {
              conn.authChangesAck = true;
            }
            sendData(ctx, conn, sendObject);
          }
        }
        //todo use emit callback
        //wait ack
        let time = 0;
        let interval = 100;
        let limit = 30000;
        for (let i = 0; i < connections.length; ++i) {
          let conn = connections[i];
          while (constants.CONN_CLOSED !== conn.readyState && needSendChanges(conn) && conn.authChangesAck && time < limit) {
            yield utils.sleep(interval);
            time += interval;
          }
          delete conn.authChangesAck;
        }
      }
    });
  }
  function* sendAuthChanges(ctx, docId, connections) {
    const tenMaxRequestChanges = ctx.getCfg('services.CoAuthoring.server.maxRequestChanges', cfgMaxRequestChanges);

    let index = 0;
    let changes;
    do {
      let objChangesDocument = yield getDocumentChanges(ctx, docId, index, index + tenMaxRequestChanges);
      changes = objChangesDocument.arrChanges;
      yield sendAuthChangesByChunks(ctx, changes, connections);
      connections = connections.filter((conn) => {
        return constants.CONN_CLOSED !== conn.readyState;
      });
      index += tenMaxRequestChanges;
    } while (connections.length > 0 && changes && tenMaxRequestChanges === changes.length);
  }
  function* sendAuthInfo(ctx, conn, bIsRestore, participantsMap, opt_hasForgotten, opt_openedAt) {
    const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);
    const tenImageSize = ctx.getCfg('services.CoAuthoring.server.limits_image_size', cfgImageSize);
    const tenTypesUpload = ctx.getCfg('services.CoAuthoring.utils.limits_image_types_upload', cfgTypesUpload);

    const docId = conn.docId;
    let docLock = yield editorData.getLocks(ctx, docId);
    if (EditorTypes.document !== conn.editorType){
      let docLockList = [];
      for (let lockId in docLock) {
        docLockList.push(docLock[lockId]);
      }
      docLock = docLockList;
    }
    let allMessages = yield editorData.getMessages(ctx, docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
    let sessionToken;
    if (tenTokenEnableBrowser && !bIsRestore) {
      sessionToken = yield fillJwtByConnection(ctx, conn);
    }
    let tenEditor = getEditorConfig(ctx);
    tenEditor["limits_image_size"] = tenImageSize;
    tenEditor["limits_image_types_upload"] = tenTypesUpload;
    const sendObject = {
      type: 'auth',
      result: 1,
      sessionId: conn.sessionId,
      sessionTimeConnect: conn.sessionTimeConnect,
      participants: participantsMap,
      messages: allMessages,
      locks: docLock,
      indexUser: conn.user.indexUser,
      hasForgotten: opt_hasForgotten,
      jwt: sessionToken,
      g_cAscSpellCheckUrl: tenEditor["spellcheckerUrl"],
      buildVersion: commonDefines.buildVersion,
      buildNumber: commonDefines.buildNumber,
      licenseType: conn.licenseType,
      settings: tenEditor,
      openedAt: opt_openedAt
    };
    sendData(ctx, conn, sendObject);//Or 0 if fails
  }

  function* onMessage(ctx, conn, data) {
    if (false === conn.permissions?.chat) {
      ctx.logger.warn("insert message permissions.chat==false");
      return;
    }
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {docid: docId, message: data.message, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal, username: conn.user.username};
    yield editorData.addMessage(ctx, docId, msg);
    // insert
    ctx.logger.info("insert message: %j", msg);

    var messages = [msg];
    sendDataMessage(ctx, conn, messages);
    yield publish(ctx, {type: commonDefines.c_oPublishType.message, ctx: ctx, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* onCursor(ctx, conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {cursor: data.cursor, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal};

    ctx.logger.info("send cursor: %s", msg);

    var messages = [msg];
    yield publish(ctx, {type: commonDefines.c_oPublishType.cursor, ctx: ctx, docId: docId, userId: userId, messages: messages}, docId, userId);
  }
  // For Word block is now string "guid"
  // For Excel block is now object { sheetId, type, rangeOrObjectId, guid }
  // For presentations, this is an object { type, val } or { type, slideId, objId }
  async function getLock(ctx, conn, data, bIsRestore) {
    ctx.logger.debug("getLock");
    var fCheckLock = null;
    switch (conn.editorType) {
      case EditorTypes.document:
        // Word
        fCheckLock = _checkLockWord;
        break;
      case EditorTypes.spreadsheet:
        // Excel
        fCheckLock = _checkLockExcel;
        break;
      case EditorTypes.presentation:
        // PP
        fCheckLock = _checkLockPresentation;
        break;
      default:
        return false;
    }
    let docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    let locks = arrayBlocks.reduce(function(map, block) {
      //todo use one id
      map[block.guid || block] = {time: Date.now(), user: userId, block: block};
      return map;
    }, {});
    let addRes = await editorData.addLocksNX(ctx, docId, locks);
    let documentLocks = addRes.allLocks;
    let isAllAdded = Object.keys(addRes.lockConflict).length === 0;
    if (!isAllAdded || !fCheckLock(ctx, docId, documentLocks, locks, arrayBlocks, userId)) {
      //remove new locks
      let toRemove = {};
      for (let lockId in locks) {
        if (!addRes.lockConflict[lockId]) {
          toRemove[lockId] = locks[lockId];
          delete documentLocks[lockId];
        }
      }
      await editorData.removeLocks(ctx, docId, toRemove);
      if (bIsRestore) {
        return false;
      }
    }
    sendData(ctx, conn, {type: "getLock", locks: documentLocks});
    await publish(ctx, {type: commonDefines.c_oPublishType.getLock, ctx: ctx, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  function sendGetLock(ctx, participants, documentLocks) {
    _.each(participants, function(participant) {
      sendData(ctx, participant, {type: "getLock", locks: documentLocks});
    });
  }

  // For Excel, it is necessary to recalculate locks when adding / deleting rows / columns
  function* saveChanges(ctx, conn, data) {
    const tenEditor = getEditorConfig(ctx);
    const tenPubSubMaxChanges = ctx.getCfg('services.CoAuthoring.pubsub.maxChanges', cfgPubSubMaxChanges);
    const tenExpSaveLock = ctx.getCfg('services.CoAuthoring.expire.saveLock', cfgExpSaveLock);

    const docId = conn.docId, userId = conn.user.id;
    ctx.logger.info("Start saveChanges: reSave: %s", data.reSave);

    let lockRes = yield editorData.lockSave(ctx, docId, userId, tenExpSaveLock);
    if (!lockRes) {
      //should not be here. cfgExpSaveLock - 60sec, sockjs disconnects after 25sec
      ctx.logger.warn("saveChanges lockSave error");
      return;
    }

    let puckerIndex = yield* getChangesIndex(ctx, docId);

    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return;
    }

    let deleteIndex = -1;
    if (data.startSaveChanges && null != data.deleteIndex) {
      deleteIndex = data.deleteIndex;
      if (-1 !== deleteIndex) {
        const deleteCount = puckerIndex - deleteIndex;
        if (0 < deleteCount) {
          puckerIndex -= deleteCount;
          yield sqlBase.deleteChangesPromise(ctx, docId, deleteIndex);
        } else if (0 > deleteCount) {
          ctx.logger.error("Error saveChanges: deleteIndex: %s ; startIndex: %s ; deleteCount: %s", deleteIndex, puckerIndex, deleteCount);
        }
      }
    }

    if (constants.CONN_CLOSED === conn.conn.readyState) {
      //closing could happen during async action
      return;
    }

    // Starting index change when adding
    const startIndex = puckerIndex;

    const newChanges = tenEditor['binaryChanges'] ? data.changes : JSON.parse(data.changes);
    let newChangesLastDate = new Date();
    newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding
    let newChangesLastTime = newChangesLastDate.getTime();
    let arrNewDocumentChanges = [];
    ctx.logger.info("saveChanges: deleteIndex: %s ; startIndex: %s ; length: %s", deleteIndex, startIndex, newChanges.length);
    if (0 < newChanges.length) {
      let oElement = null;

      for (let i = 0; i < newChanges.length; ++i) {
        oElement = newChanges[i];
        let change = tenEditor['binaryChanges'] ? oElement : JSON.stringify(oElement);
        arrNewDocumentChanges.push({docid: docId, change: change, time: newChangesLastDate,
          user: userId, useridoriginal: conn.user.idOriginal});
      }

      puckerIndex += arrNewDocumentChanges.length;
      yield sqlBase.insertChangesPromise(ctx, arrNewDocumentChanges, docId, startIndex, conn.user);
    }
    const changesIndex = (-1 === deleteIndex && data.startSaveChanges) ? startIndex : -1;
    if (data.endSaveChanges) {
      // For Excel, you need to recalculate indexes for locks
      if (data.isExcel && false !== data.isCoAuthoring && data.excelAdditionalInfo) {
        const tmpAdditionalInfo = JSON.parse(data.excelAdditionalInfo);
        // This is what we got recalcIndexColumns and recalcIndexRows
        const oRecalcIndexColumns = _addRecalcIndex(tmpAdditionalInfo["indexCols"]);
        const oRecalcIndexRows = _addRecalcIndex(tmpAdditionalInfo["indexRows"]);
        // Now we need to recalculate indexes for lock elements
        if (null !== oRecalcIndexColumns || null !== oRecalcIndexRows) {
          let docLock = yield editorData.getLocks(ctx, docId);
          let docLockMod = _recalcLockArray(userId, docLock, oRecalcIndexColumns, oRecalcIndexRows);
          if (Object.keys(docLockMod).length > 0) {
            yield editorData.addLocks(ctx, docId, docLockMod);
          }
        }
      }

      let userLocks = [];
      if (data.releaseLocks) {
		  //Release locks
		  userLocks = yield removeUserLocks(ctx, docId, userId);
      }
      // For this user, we remove Lock from the document if the unlock flag has arrived
      const checkEndAuthLockRes = yield* checkEndAuthLock(ctx, data.unlock, false, docId, userId);
      if (!checkEndAuthLockRes) {
        const arrLocks = _.map(userLocks, function(e) {
          return {
            block: e.block,
            user: e.user,
            time: Date.now(),
            changes: null
          };
        });
        let changesToSend = arrNewDocumentChanges;
        if(changesToSend.length > tenPubSubMaxChanges) {
          changesToSend = null;
        } else {
          changesToSend.forEach((value) => {
            value.time = value.time.getTime();
          })
        }
        yield publish(ctx, {type: commonDefines.c_oPublishType.changes, ctx: ctx, docId: docId, userId: userId,
          changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex, syncChangesIndex: puckerIndex,
          locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo, endSaveChanges: data.endSaveChanges}, docId, userId);
      }
      // Automatically remove the lock ourselves and send the index to save
      yield* unSaveLock(ctx, conn, changesIndex, newChangesLastTime, puckerIndex);
      //last save
      let changeInfo = getExternalChangeInfo(conn.user, newChangesLastTime, conn.lang);
      yield resetForceSaveAfterChanges(ctx, docId, newChangesLastTime, puckerIndex, utils.getBaseUrlByConnection(ctx, conn), changeInfo);
    } else {
      let changesToSend = arrNewDocumentChanges;
      if(changesToSend.length > tenPubSubMaxChanges) {
        changesToSend = null;
      } else {
        changesToSend.forEach((value) => {
          value.time = value.time.getTime();
        })
      }
      let isPublished = yield publish(ctx, {type: commonDefines.c_oPublishType.changes, ctx: ctx, docId: docId, userId: userId,
        changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex, syncChangesIndex: puckerIndex,
        locks: [], excelAdditionalInfo: undefined, endSaveChanges: data.endSaveChanges}, docId, userId);
      sendData(ctx, conn, {type: 'savePartChanges', changesIndex: changesIndex, syncChangesIndex: puckerIndex});
      if (!isPublished) {
        //stub for lockDocumentsTimerId
        yield publish(ctx, {type: commonDefines.c_oPublishType.changesNotify, ctx: ctx, docId: docId});
      }
    }
  }

  // Can we save?
  function* isSaveLock(ctx, conn, data) {
    const tenExpSaveLock = ctx.getCfg('services.CoAuthoring.expire.saveLock', cfgExpSaveLock);

    if (!conn.user) {
      return;
    }
    let lockRes = true;
    //check changesIndex for compatibility or 0 in case of first save
    if (data.syncChangesIndex) {
      let forceSave = yield editorData.getForceSave(ctx, conn.docId);
      if (forceSave && forceSave.index !== data.syncChangesIndex) {
        if (!conn.unsyncTime) {
          conn.unsyncTime = new Date();
        }
        if (Date.now() - conn.unsyncTime.getTime() < tenExpSaveLock * 1000) {
          lockRes = false;
          ctx.logger.debug("isSaveLock editor unsynced since %j serverIndex:%s clientIndex:%s ", conn.unsyncTime, forceSave.index, data.syncChangesIndex);
          sendData(ctx, conn, {type: "saveLock", saveLock: !lockRes});
          return;
        } else {
          ctx.logger.warn("isSaveLock editor unsynced since %j serverIndex:%s clientIndex:%s ", conn.unsyncTime, forceSave.index, data.syncChangesIndex);
        }
      }
    }
    conn.unsyncTime = null;

    lockRes = yield editorData.lockSave(ctx, conn.docId, conn.user.id, tenExpSaveLock);
    ctx.logger.debug("isSaveLock lockRes: %s", lockRes);

    // We send only to the one who asked (you can not send to everyone)
    sendData(ctx, conn, {type: "saveLock", saveLock: !lockRes});
  }

  // Removing lock from save
  function* unSaveLock(ctx, conn, index, time, syncChangesIndex) {
    var unlockRes = yield editorData.unlockSave(ctx, conn.docId, conn.user.id);
    if (commonDefines.c_oAscUnlockRes.Locked !== unlockRes) {
      sendData(ctx, conn, {type: 'unSaveLock', index, time, syncChangesIndex});
    } else {
      ctx.logger.warn("unSaveLock failure");
    }
  }

  // Returning all messages for a document
  function* getMessages(ctx, conn) {
    let allMessages = yield editorData.getMessages(ctx, conn.docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
    sendDataMessage(ctx, conn, allMessages);
  }

  function _checkLockWord(ctx, docId, documentLocks, newLocks, arrayBlocks, userId) {
    return true;
  }
  function _checkLockExcel(ctx, docId, documentLocks, newLocks, arrayBlocks, userId) {
    // Data is array now
    var documentLock;
    var isLock = false;
    var isExistInArray = false;
    var i, blockRange;
    var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
    for (i = 0; i < lengthArray && false === isLock; ++i) {
      blockRange = arrayBlocks[i];
      for (let keyLockInArray in documentLocks) {
        if (newLocks[keyLockInArray]) {
          //skip just added
          continue;
        }
        documentLock = documentLocks[keyLockInArray];
        // Checking if an object is in an array (the current user sent a lock again)
        if (documentLock.user === userId &&
          blockRange.sheetId === documentLock.block.sheetId &&
          blockRange.type === c_oAscLockTypeElem.Object &&
          documentLock.block.type === c_oAscLockTypeElem.Object &&
          documentLock.block.rangeOrObjectId === blockRange.rangeOrObjectId) {
          isExistInArray = true;
          break;
        }

        if (c_oAscLockTypeElem.Sheet === blockRange.type &&
          c_oAscLockTypeElem.Sheet === documentLock.block.type) {
          // If the current user sent a lock of the current sheet, then we do not enter it into the array, and if a new one, then we enter it
          if (documentLock.user === userId) {
            if (blockRange.sheetId === documentLock.block.sheetId) {
              isExistInArray = true;
              break;
            } else {
              // new sheet
              continue;
            }
          } else {
            // If someone has locked a sheet, then no one else can lock sheets (otherwise you can delete all sheets)
            isLock = true;
            break;
          }
        }

        if (documentLock.user === userId || !(documentLock.block) ||
          blockRange.sheetId !== documentLock.block.sheetId) {
          continue;
        }
        isLock = compareExcelBlock(blockRange, documentLock.block);
        if (true === isLock) {
          break;
        }
      }
    }
    if (0 === lengthArray) {
      isLock = true;
    }
    return !isLock && !isExistInArray;
  }

  function _checkLockPresentation(ctx, docId, documentLocks, newLocks, arrayBlocks, userId) {
    // Data is array now
    var isLock = false;
    var i, blockRange;
    var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
    for (i = 0; i < lengthArray && false === isLock; ++i) {
      blockRange = arrayBlocks[i];
      for (let keyLockInArray in documentLocks) {
        if (newLocks[keyLockInArray]) {
          //skip just added
          continue;
        }
        let documentLock = documentLocks[keyLockInArray];
        if (documentLock.user === userId || !(documentLock.block)) {
          continue;
        }
        isLock = comparePresentationBlock(blockRange, documentLock.block);
        if (true === isLock) {
          break;
        }
      }
    }
    if (0 === lengthArray) {
      isLock = true;
    }
    return !isLock;
  }

	function _checkLicense(ctx, conn) {
		return co(function* () {
			try {
				ctx.logger.info('_checkLicense start');
        const tenEditSingleton = ctx.getCfg('services.CoAuthoring.server.edit_singleton', cfgEditSingleton);
        const tenOpenProtectedFile = ctx.getCfg('services.CoAuthoring.server.openProtectedFile', cfgOpenProtectedFile);
        const tenIsAnonymousSupport = ctx.getCfg('services.CoAuthoring.server.isAnonymousSupport', cfgIsAnonymousSupport);

				let rights = constants.RIGHTS.Edit;
				if (tenEditSingleton) {
					// ToDo docId from url ?
					let handshake = conn.handshake;
					const docIdParsed = constants.DOC_ID_SOCKET_PATTERN.exec(handshake.url);
					if (docIdParsed && 1 < docIdParsed.length) {
						const participantsMap = yield getParticipantMap(ctx, docIdParsed[1]);
						for (let i = 0; i < participantsMap.length; ++i) {
							const elem = participantsMap[i];
							if (!elem.view) {
								rights = constants.RIGHTS.View;
								break;
							}
						}
					}
				}

				let [licenseInfo] = yield tenantManager.getTenantLicense(ctx);

				sendData(ctx, conn, {
					type: 'license', license: {
						type: licenseInfo.type,
						light: false,//todo remove in sdk
						mode: licenseInfo.mode,
						rights: rights,
						buildVersion: commonDefines.buildVersion,
						buildNumber: commonDefines.buildNumber,
						protectionSupport: tenOpenProtectedFile, //todo find a better place
						isAnonymousSupport: tenIsAnonymousSupport, //todo find a better place
						liveViewerSupport: utils.isLiveViewerSupport(licenseInfo),
						branding: licenseInfo.branding,
						customization: licenseInfo.customization,
						advancedApi: licenseInfo.advancedApi
					}
				});
				ctx.logger.info('_checkLicense end');
			} catch (err) {
				ctx.logger.error('_checkLicense error: %s', err.stack);
			}
		});
	}

  function* _checkLicenseAuth(ctx, licenseInfo, userId, isLiveViewer) {
    const tenWarningLimitPercents = ctx.getCfg('license.warning_limit_percents', cfgWarningLimitPercents) / 100;
    const tenNotificationRuleLicenseLimitEdit = ctx.getCfg(`notification.rules.licenseLimitEdit.template`, cfgNotificationRuleLicenseLimitEdit);
    const tenNotificationRuleLicenseLimitLiveViewer = ctx.getCfg(`notification.rules.licenseLimitLiveViewer.template`, cfgNotificationRuleLicenseLimitLiveViewer);
    const c_LR = constants.LICENSE_RESULT;
    let licenseType = licenseInfo.type;
    if (c_LR.Success === licenseType || c_LR.SuccessLimit === licenseType) {
      let notificationLimit;
      let notificationTemplate = tenNotificationRuleLicenseLimitEdit;
      let notificationType = notificationTypes.LICENSE_LIMIT_EDIT;
      let notificationPercent = 100;
      if (licenseInfo.usersCount) {
        const nowUTC = getLicenseNowUtc();
        notificationLimit = 'users';
        if(isLiveViewer) {
          notificationTemplate = tenNotificationRuleLicenseLimitLiveViewer;
          notificationType = notificationTypes.LICENSE_LIMIT_LIVE_VIEWER;
          const arrUsers = yield editorStat.getPresenceUniqueViewUser(ctx, nowUTC);
          if (arrUsers.length >= licenseInfo.usersViewCount && (-1 === arrUsers.findIndex((element) => {return element.userid === userId}))) {
            licenseType = licenseInfo.hasLicense ? c_LR.UsersViewCount : c_LR.UsersViewCountOS;
          } else if (licenseInfo.usersViewCount * tenWarningLimitPercents <= arrUsers.length) {
            notificationPercent = tenWarningLimitPercents * 100;
          }
        } else {
          const arrUsers = yield editorStat.getPresenceUniqueUser(ctx, nowUTC);
          if (arrUsers.length >= licenseInfo.usersCount && (-1 === arrUsers.findIndex((element) => {return element.userid === userId}))) {
            licenseType = licenseInfo.hasLicense ? c_LR.UsersCount : c_LR.UsersCountOS;
          } else if(licenseInfo.usersCount * tenWarningLimitPercents <= arrUsers.length) {
            notificationPercent = tenWarningLimitPercents * 100;
          }
        }
      } else {
        notificationLimit = 'connections';
        if (isLiveViewer) {
          notificationTemplate = tenNotificationRuleLicenseLimitLiveViewer;
          notificationType = notificationTypes.LICENSE_LIMIT_LIVE_VIEWER;
          const connectionsLiveCount = licenseInfo.connectionsView;
          const liveViewerConnectionsCount = yield editorStat.getLiveViewerConnectionsCount(ctx, connections);
          if (liveViewerConnectionsCount >= connectionsLiveCount) {
            licenseType = licenseInfo.hasLicense ? c_LR.ConnectionsLive : c_LR.ConnectionsLiveOS;
          } else if(connectionsLiveCount * tenWarningLimitPercents <= liveViewerConnectionsCount){
            notificationPercent = tenWarningLimitPercents * 100;
          }
        } else {
          const connectionsCount = licenseInfo.connections;
          const editConnectionsCount = yield editorStat.getEditorConnectionsCount(ctx, connections);
          if (editConnectionsCount >= connectionsCount) {
            licenseType = licenseInfo.hasLicense ? c_LR.Connections : c_LR.ConnectionsOS;
          } else if (connectionsCount * tenWarningLimitPercents <= editConnectionsCount) {
            notificationPercent = tenWarningLimitPercents * 100;
          }
        }
      }
      if ((c_LR.Success !== licenseType && c_LR.SuccessLimit !== licenseType) || 100 !== notificationPercent) {
        const applicationName = (process.env.APPLICATION_NAME || "").toUpperCase();
        const title = util.format(notificationTemplate.title, applicationName);
        const message = util.format(notificationTemplate.body, notificationPercent, notificationLimit);
        if (100 !== notificationPercent) {
          ctx.logger.warn(message);
        } else {
          ctx.logger.error(message);
        }
        //todo with yield service could throw error
        void notificationService.notify(ctx, notificationType, title, message, notificationType + notificationPercent);
      }
    }
    return licenseType;
  }

  //publish subscribe message brocker
  pubsubOnMessage = function(msg) {
    return co(function* () {
      let ctx = new operationContext.Context();
      try {
        var data = JSON.parse(msg);
        ctx.initFromPubSub(data);
        yield ctx.initTenantCache();
        ctx.logger.debug('pubsub message start:%s', msg);
        const tenTokenEnableBrowser = ctx.getCfg('services.CoAuthoring.token.enable.browser', cfgTokenEnableBrowser);

        var participants;
        var participant;
        var objChangesDocument;
        var i;
        let lockDocumentTimer, cmd;
        switch (data.type) {
          case commonDefines.c_oPublishType.drop:
            for (i = 0; i < data.users.length; ++i) {
              dropUserFromDocument(ctx, data.docId, data.users[i], data.description);
            }
            break;
          case commonDefines.c_oPublishType.closeConnection:
            closeUsersConnection(ctx, data.docId, data.usersMap, data.isOriginalId, data.code, data.description);
            break;
          case commonDefines.c_oPublishType.releaseLock:
            participants = getParticipants(data.docId, true, data.userId, true);
            _.each(participants, function(participant) {
              sendReleaseLock(ctx, participant, data.locks);
            });
            break;
          case commonDefines.c_oPublishType.participantsState:
            participants = getParticipants(data.docId, true, data.userId);
            sendParticipantsState(ctx, participants, data);
            break;
          case commonDefines.c_oPublishType.message:
            participants = getParticipants(data.docId, true, data.userId);
            _.each(participants, function(participant) {
              sendDataMessage(ctx, participant, data.messages);
            });
            break;
          case commonDefines.c_oPublishType.getLock:
            participants = getParticipants(data.docId, true, data.userId, true);
            sendGetLock(ctx, participants, data.documentLocks);
            break;
          case commonDefines.c_oPublishType.changes:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              ctx.logger.debug("lockDocumentsTimerId update c_oPublishType.changes");
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
              yield* setLockDocumentTimer(ctx, data.docId, lockDocumentTimer.userId);
            }
            participants = getParticipants(data.docId, true, data.userId);
            if(participants.length > 0) {
              var changes = data.changes;
              if (null == changes) {
                objChangesDocument = yield* getDocumentChanges(ctx, data.docId, data.startIndex, data.changesIndex);
                changes = objChangesDocument.arrChanges;
              }
              _.each(participants, function(participant) {
                if (!needSendChanges(participant)) {
                  return;
                }
                sendData(ctx, participant, {type: 'saveChanges', changes: changes,
                  changesIndex: data.changesIndex, syncChangesIndex: data.syncChangesIndex, endSaveChanges:  data.endSaveChanges,
                  locks: data.locks, excelAdditionalInfo: data.excelAdditionalInfo});
              });
            }
            break;
          case commonDefines.c_oPublishType.changesNotify:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              ctx.logger.debug("lockDocumentsTimerId update c_oPublishType.changesNotify");
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
              yield* setLockDocumentTimer(ctx, data.docId, lockDocumentTimer.userId);
            }
            break;
          case commonDefines.c_oPublishType.auth:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              ctx.logger.debug("lockDocumentsTimerId clear");
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
            }
            participants = getParticipants(data.docId, true, data.userId, true);
            if(participants.length > 0) {
              yield* sendAuthChanges(ctx, data.docId, participants);
              for (i = 0; i < participants.length; ++i) {
                participant = participants[i];
                yield* sendAuthInfo(ctx, participant, false, data.participantsMap);
              }
            }
            break;
          case commonDefines.c_oPublishType.receiveTask:
            cmd = new commonDefines.InputCommand(data.cmd, true);
            var output = new canvasService.OutputDataWrap();
            output.fromObject(data.output);
            var outputData = output.getData();

            var docConnectionId = cmd.getDocConnectionId();
            var docId;
            if(docConnectionId){
              docId = docConnectionId;
            } else {
              docId = cmd.getDocId();
            }
            if (cmd.getUserConnectionId()) {
              participants = getParticipantUser(docId, cmd.getUserConnectionId());
            } else {
              participants = getParticipants(docId);
            }
            for (i = 0; i < participants.length; ++i) {
              participant = participants[i];
              if (data.needUrlKey) {
                if (0 === data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrls(ctx, participant.baseUrl, data.needUrlKey, data.needUrlType, data.creationDate));
                } else if (1 === data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrl(ctx, participant.baseUrl, data.needUrlKey, data.needUrlType, undefined, data.creationDate));
                } else {
                  let url;
                  if (cmd.getInline()) {
                    url = yield canvasService.getPrintFileUrl(ctx, data.needUrlKey, participant.baseUrl, cmd.getTitle());
                    outputData.setExtName('.pdf');
                  } else {
                    url = yield storage.getSignedUrl(ctx, participant.baseUrl, data.needUrlKey, data.needUrlType, cmd.getTitle(), data.creationDate);
                    outputData.setExtName(pathModule.extname(data.needUrlKey));
                  }
                  outputData.setData(url);
                }
                if (undefined !== data.openedAt) {
                  outputData.setOpenedAt(data.openedAt);
                }
                yield modifyConnectionForPassword(ctx, participant, data.needUrlIsCorrectPassword);
              }
              sendData(ctx, participant, output);
            }
            break;
          case commonDefines.c_oPublishType.warning:
            participants = getParticipants(data.docId);
            _.each(participants, function(participant) {
              sendDataWarning(ctx, participant, data.description);
            });
            break;
          case commonDefines.c_oPublishType.cursor:
            participants = getParticipants(data.docId, true, data.userId);
            _.each(participants, function(participant) {
              sendDataCursor(ctx, participant, data.messages);
            });
            break;
          case commonDefines.c_oPublishType.shutdown:
            //flag prevent new socket connections and receive data from exist connections
            shutdownFlag = data.status;
            wopiClient.setIsShutdown(shutdownFlag);
            ctx.logger.warn('start shutdown:%s', shutdownFlag);
            if (shutdownFlag) {
              ctx.logger.warn('active connections: %d', connections.length);
              //do not stop the server, because sockets and all requests will be unavailable
              //bad because you may need to convert the output file and the fact that requests for the CommandService will not be processed
              //server.close();
              //in the cycle we will remove elements so copy array
              var connectionsTmp = connections.slice();
              //destroy all open connections
              for (i = 0; i < connectionsTmp.length; ++i) {
                sendDataDisconnectReason(ctx, connectionsTmp[i], constants.SHUTDOWN_CODE, constants.SHUTDOWN_REASON);
                connectionsTmp[i].disconnect(true);
              }
            }
            ctx.logger.warn('end shutdown');
            break;
          case commonDefines.c_oPublishType.meta:
            participants = getParticipants(data.docId);
            _.each(participants, function(participant) {
              sendDataMeta(ctx, participant, data.meta);
            });
            break;
          case commonDefines.c_oPublishType.forceSave:
            participants = getParticipants(data.docId, true, data.userId, true);
            _.each(participants, function(participant) {
              sendData(ctx, participant, {type: "forceSave", messages: data.data});
            });
            break;
          case commonDefines.c_oPublishType.changeConnecitonInfo:
            let hasChanges = false;
            cmd = new commonDefines.InputCommand(data.cmd, true);
            participants = getParticipants(data.docId);
            for (i = 0; i < participants.length; ++i) {
              participant = participants[i];
              if (!participant.denyChangeName && participant.user.idOriginal === data.useridoriginal) {
                hasChanges = true;
                ctx.logger.debug('changeConnectionInfo: userId = %s', data.useridoriginal);
                participant.user.username = cmd.getUserName();
                yield addPresence(ctx, participant, false);
                if (tenTokenEnableBrowser) {
                  let sessionToken = yield fillJwtByConnection(ctx, participant);
                  sendDataRefreshToken(ctx, participant, sessionToken);
                }
              }
            }
            if (hasChanges) {
              let participants = yield getParticipantMap(ctx, data.docId);
              let participantsTimestamp = Date.now();
              yield publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: data.docId, userId: null, participantsTimestamp: participantsTimestamp, participants: participants});
            }
            break;
          case commonDefines.c_oPublishType.rpc:
            participants = getParticipantUser(data.docId, data.userId);
            _.each(participants, function(participant) {
                sendDataRpc(ctx, participant, data.responseKey, data.data);
            });
            break;
          default:
            ctx.logger.debug('pubsub unknown message type:%s', msg);
        }
      } catch (err) {
        ctx.logger.error('pubsub message error: %s', err.stack);
      }
    });
  }

  function* collectStats(ctx, countEdit, countLiveView, countView) {
    let now = Date.now();
    yield editorStat.setEditorConnections(ctx, countEdit, countLiveView, countView, now, PRECISION);
  }
  function expireDoc() {
    return co(function* () {
      let ctx = new operationContext.Context();
      try {
        let tenants = {};
        let countEditByShard = 0;
        let countLiveViewByShard = 0;
        let countViewByShard = 0;
        ctx.logger.debug('expireDoc connections.length = %d', connections.length);
        var nowMs = new Date().getTime();
        for (var i = 0; i < connections.length; ++i) {
          var conn = connections[i];
          ctx.initFromConnection(conn);
          //todo group by tenant
          yield ctx.initTenantCache();
          const tenExpSessionIdle = ms(ctx.getCfg('services.CoAuthoring.expire.sessionidle', cfgExpSessionIdle));
          const tenExpSessionAbsolute = ms(ctx.getCfg('services.CoAuthoring.expire.sessionabsolute', cfgExpSessionAbsolute));
          const tenExpSessionCloseCommand = ms(ctx.getCfg('services.CoAuthoring.expire.sessionclosecommand', cfgExpSessionCloseCommand));

          let maxMs = nowMs + Math.max(tenExpSessionCloseCommand, expDocumentsStep);
          let tenant = tenants[ctx.tenant];
          if (!tenant) {
            tenant = tenants[ctx.tenant] = {countEditByShard: 0, countLiveViewByShard: 0, countViewByShard: 0};
          }
          //wopi access_token_ttl;
          if (tenExpSessionAbsolute > 0 || conn.access_token_ttl) {
            if ((tenExpSessionAbsolute > 0 && maxMs - conn.sessionTimeConnect > tenExpSessionAbsolute ||
              (conn.access_token_ttl && maxMs > conn.access_token_ttl)) && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(ctx, conn, {
                code: constants.SESSION_ABSOLUTE_CODE,
                reason: constants.SESSION_ABSOLUTE_REASON
              });
            } else if (nowMs - conn.sessionTimeConnect > tenExpSessionAbsolute) {
              ctx.logger.debug('expireDoc close absolute session');
              sendDataDisconnectReason(ctx, conn, constants.SESSION_ABSOLUTE_CODE, constants.SESSION_ABSOLUTE_REASON);
              conn.disconnect(true);
              continue;
            }
          }
          if (tenExpSessionIdle > 0 && !(conn.user?.view || conn.isCloseCoAuthoring)) {
            if (maxMs - conn.sessionTimeLastAction > tenExpSessionIdle && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(ctx, conn, {
                code: constants.SESSION_IDLE_CODE,
                reason: constants.SESSION_IDLE_REASON,
                interval: tenExpSessionIdle
              });
            } else if (nowMs - conn.sessionTimeLastAction > tenExpSessionIdle) {
              ctx.logger.debug('expireDoc close idle session');
              sendDataDisconnectReason(ctx, conn, constants.SESSION_IDLE_CODE, constants.SESSION_IDLE_REASON);
              conn.disconnect(true);
              continue;
            }
          }
          if (constants.CONN_CLOSED === conn.conn.readyState) {
            ctx.logger.error('expireDoc connection closed');
          }
          yield updatePresence(ctx, conn);
          if (utils.isLiveViewer(conn)) {
            countLiveViewByShard++;
            tenant.countLiveViewByShard++;
          } else if(conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
            countViewByShard++;
            tenant.countViewByShard++;
          } else {
            countEditByShard++;
            tenant.countEditByShard++;
          }
        }
        for (let tenantId in tenants) {
          if(tenants.hasOwnProperty(tenantId)) {
            ctx.setTenant(tenantId);
            let tenant = tenants[tenantId];
            yield* collectStats(ctx, tenant.countEditByShard, tenant.countLiveViewByShard, tenant.countViewByShard);
            yield editorStat.setEditorConnectionsCountByShard(ctx, SHARD_ID, tenant.countEditByShard);
            yield editorStat.setLiveViewerConnectionsCountByShard(ctx, SHARD_ID, tenant.countLiveViewByShard);
            yield editorStat.setViewerConnectionsCountByShard(ctx, SHARD_ID, tenant.countViewByShard);
            if (clientStatsD) {
              //todo with multitenant
              let countEdit = yield editorStat.getEditorConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.edit', countEdit);
              let countLiveView = yield editorStat.getLiveViewerConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.liveview', countLiveView);
              let countView = yield editorStat.getViewerConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.view', countView);
            }
          }
        }
        if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
          //aggregated tenant stats
          let aggregationCtx = new operationContext.Context();
          aggregationCtx.init(tenantManager.getDefautTenant(), ctx.docId, ctx.userId);
          //yield ctx.initTenantCache();//no need
          yield* collectStats(aggregationCtx, countEditByShard, countLiveViewByShard, countViewByShard);
          yield editorStat.setEditorConnectionsCountByShard(aggregationCtx, SHARD_ID, countEditByShard);
          yield editorStat.setLiveViewerConnectionsCountByShard(aggregationCtx, SHARD_ID, countLiveViewByShard);
          yield editorStat.setViewerConnectionsCountByShard(aggregationCtx, SHARD_ID, countViewByShard);
        }
        ctx.initDefault();
      } catch (err) {
        ctx.logger.error('expireDoc error: %s', err.stack);
      } finally {
        setTimeout(expireDoc, expDocumentsStep);
      }
    });
  }
  setTimeout(expireDoc, expDocumentsStep);
  function refreshWopiLock() {
    return co(function* () {
      let ctx = new operationContext.Context();
      try {
        ctx.logger.info('refreshWopiLock start');
        let docIds = new Map();
        for (let i = 0; i < connections.length; ++i) {
          let conn = connections[i];
          ctx.initFromConnection(conn);
          //todo group by tenant
          yield ctx.initTenantCache();
          let docId = conn.docId;
          if ((conn.user && conn.user.view) || docIds.has(docId)) {
            continue;
          }
          docIds.set(docId, 1);
          if (undefined === conn.access_token_ttl) {
            continue;
          }
          let selectRes = yield taskResult.select(ctx, docId);
          if (selectRes.length > 0 && selectRes[0] && selectRes[0].callback) {
            let callback = selectRes[0].callback;
            let callbackUrl = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, callback);
            let wopiParams = wopiClient.parseWopiCallback(ctx, callbackUrl, callback);
            if (wopiParams && wopiParams.commonInfo) {
              yield wopiClient.lock(ctx, 'REFRESH_LOCK', wopiParams.commonInfo.lockId,
                                    wopiParams.commonInfo.fileInfo, wopiParams.userAuth);
            }
          }
        }
        ctx.initDefault();
        ctx.logger.info('refreshWopiLock end');
      } catch (err) {
        ctx.logger.error('refreshWopiLock error:%s', err.stack);
      } finally {
        setTimeout(refreshWopiLock, cfgRefreshLockInterval);
      }
    });
  }
  setTimeout(refreshWopiLock, cfgRefreshLockInterval);

  pubsub = new pubsubService();
  pubsub.on('message', pubsubOnMessage);
  pubsub.init(function(err) {
    if (null != err) {
      operationContext.global.logger.error('createPubSub error: %s', err.stack);
    }

    queue = new queueService();
    queue.on('dead', handleDeadLetter);
    queue.on('response', canvasService.receiveTask);
    queue.init(true, true, false, true, true, true, function(err){
      if (null != err) {
        operationContext.global.logger.error('createTaskQueue error: %s', err.stack);
      }
      gc.startGC();

      //check data base compatibility
      const tables = [
        [cfgTableResult, constants.TABLE_RESULT_SCHEMA],
        [cfgTableChanges, constants.TABLE_CHANGES_SCHEMA]
      ];
      const requestPromises = tables.map(table => isSchemaCompatible(table));

      Promise.all(requestPromises).then(
        checkResult => {
          if (checkResult.includes(false)) {
            return;
          }
          editorData
            .connect()
            .then(() => editorStat.connect())
            .then(() => callbackFunction())
            .catch(err => {
              operationContext.global.logger.error('editorData error: %s', err.stack);
            });
        },
        error => operationContext.global.logger.error('getTableColumns error: %s', error.stack)
      );
    });
  });
};
exports.setLicenseInfo = async function(globalCtx, data, original) {
  tenantManager.setDefLicense(data, original);

  await utilsDocService.notifyLicenseExpiration(globalCtx, data.endDate);

  const tenantsList = await tenantManager.getAllTenants(globalCtx);
  for (const tenant of tenantsList) {
    let ctx = new operationContext.Context();
    ctx.setTenant(tenant);
    await ctx.initTenantCache();

    const [licenseInfo] = await tenantManager.getTenantLicense(ctx);
    await utilsDocService.notifyLicenseExpiration(ctx, licenseInfo.endDate);
  }
};
exports.healthCheck = function(req, res) {
  return co(function*() {
    let output = false;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('healthCheck start');
      //database
      yield sqlBase.healthCheck(ctx);
      ctx.logger.debug('healthCheck database');
      //check redis connection
      const healthData = yield editorData.healthCheck();
      if (healthData) {
        ctx.logger.debug('healthCheck editorData');
      } else {
        throw new Error('editorData');
      }
      const healthStat = yield editorStat.healthCheck();
      if (healthStat) {
        ctx.logger.debug('healthCheck editorStat');
      } else {
        throw new Error('editorStat');
      }
      const healthPubsub = yield pubsub.healthCheck();
      if (healthPubsub) {
        ctx.logger.debug('healthCheck pubsub');
      } else {
        throw new Error('pubsub');
      }
      const healthQueue = yield queue.healthCheck();
      if (healthQueue) {
        ctx.logger.debug('healthCheck queue');
      } else {
        throw new Error('queue');
      }

      //storage
      yield storage.healthCheck(ctx);
      ctx.logger.debug('healthCheck storage');
      if (storage.isDiffrentPersistentStorage()) {
        yield storage.healthCheck(ctx, cfgForgottenFiles);
        ctx.logger.debug('healthCheck storage persistent');
      }

      output = true;
      ctx.logger.info('healthCheck end');
    } catch (err) {
      ctx.logger.error('healthCheck error %s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/plain');
      res.send(output.toString());
    }
  });
};
exports.licenseInfo = function(req, res) {
  return co(function*() {
    let isError = false;
    let serverDate = new Date();
    //security risk of high-precision time
    serverDate.setMilliseconds(0);
    let output = {
      connectionsStat: {}, licenseInfo: {}, serverInfo: {
        buildVersion: commonDefines.buildVersion, buildNumber: commonDefines.buildNumber, date: serverDate.toISOString()
      }, quota: {
        edit: {
          connectionsCount: 0,
          usersCount: {
            unique: 0,
            anonymous: 0,
          }
        },
        view: {
          connectionsCount: 0,
          usersCount: {
            unique: 0,
            anonymous: 0,
          }
        },
        byMonth: []
      }
    };

    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.debug('licenseInfo start');

      let [licenseInfo] = yield tenantManager.getTenantLicense(ctx);
      Object.assign(output.licenseInfo, licenseInfo);

      var precisionSum = {};
      for (let i = 0; i < PRECISION.length; ++i) {
        precisionSum[PRECISION[i].name] = {
          edit: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0},
          liveview: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0},
          view: {min: Number.MAX_VALUE, sum: 0, count: 0, intervalsInPresision: PRECISION[i].val / expDocumentsStep, max: 0}
        };
        output.connectionsStat[PRECISION[i].name] = {
          edit: {min: 0, avr: 0, max: 0},
          liveview: {min: 0, avr: 0, max: 0},
          view: {min: 0, avr: 0, max: 0}
        };
      }
      var redisRes = yield editorStat.getEditorConnections(ctx);
      const now = Date.now();
      if (redisRes.length > 0) {
        let expDocumentsStep95 = expDocumentsStep * 0.95;
        let prevTime = Number.MAX_VALUE;
        var precisionIndex = 0;
        for (let i = redisRes.length - 1; i >= 0; i--) {
          let elem = redisRes[i];
          let edit = elem.edit || 0;
          let view = elem.view || 0;
          let liveview = elem.liveview || 0;
          //for cluster
          while (i > 0 && elem.time - redisRes[i - 1].time < expDocumentsStep95) {
            edit += elem.edit || 0;
            view += elem.view || 0;
            liveview += elem.liveview || 0;
            i--;
          }
          for (let j = precisionIndex; j < PRECISION.length; ++j) {
            if (now - elem.time < PRECISION[j].val) {
              let precision = precisionSum[PRECISION[j].name];
              precision.edit.min = Math.min(precision.edit.min, edit);
              precision.edit.max = Math.max(precision.edit.max, edit);
              precision.edit.sum += edit
              precision.edit.count++;
              precision.view.min = Math.min(precision.view.min, view);
              precision.view.max = Math.max(precision.view.max, view);
              precision.view.sum += view;
              precision.view.count++;
              precision.liveview.min = Math.min(precision.liveview.min, liveview);
              precision.liveview.max = Math.max(precision.liveview.max, liveview);
              precision.liveview.sum += liveview;
              precision.liveview.count++;
            } else {
              precisionIndex = j + 1;
            }
          }
          prevTime = elem.time;
        }
        for (let i in precisionSum) {
          let precision = precisionSum[i];
          let precisionOut = output.connectionsStat[i];
          if (precision.edit.count > 0) {
            precisionOut.edit.avr = Math.round(precision.edit.sum / precision.edit.intervalsInPresision);
            precisionOut.edit.min = precision.edit.min;
            precisionOut.edit.max = precision.edit.max;
          }
          if (precision.liveview.count > 0) {
            precisionOut.liveview.avr = Math.round(precision.liveview.sum / precision.liveview.intervalsInPresision);
            precisionOut.liveview.min = precision.liveview.min;
            precisionOut.liveview.max = precision.liveview.max;
          }
          if (precision.view.count > 0) {
            precisionOut.view.avr = Math.round(precision.view.sum / precision.view.intervalsInPresision);
            precisionOut.view.min = precision.view.min;
            precisionOut.view.max = precision.view.max;
          }
        }
      }
      const nowUTC = getLicenseNowUtc();
      let execRes;
      execRes = yield editorStat.getPresenceUniqueUser(ctx, nowUTC);
      output.quota.edit.connectionsCount = yield editorStat.getEditorConnectionsCount(ctx, connections);
      output.quota.edit.usersCount.unique = execRes.length;
      execRes.forEach(function(elem) {
        if (elem.anonym) {
          output.quota.edit.usersCount.anonymous++;
        }
      });

      execRes = yield editorStat.getPresenceUniqueViewUser(ctx, nowUTC);
      output.quota.view.connectionsCount = yield editorStat.getLiveViewerConnectionsCount(ctx, connections);
      output.quota.view.usersCount.unique = execRes.length;
      execRes.forEach(function(elem) {
        if (elem.anonym) {
          output.quota.view.usersCount.anonymous++;
        }
      });

      let byMonth = yield editorStat.getPresenceUniqueUsersOfMonth(ctx);
      let byMonthView = yield editorStat.getPresenceUniqueViewUsersOfMonth(ctx);
      let byMonthMerged = [];
      for (let i in byMonth) {
        if (byMonth.hasOwnProperty(i)) {
          byMonthMerged[i] = {date: i, users: byMonth[i], usersView: {}};
        }
      }
      for (let i in byMonthView) {
        if (byMonthView.hasOwnProperty(i)) {
          if (byMonthMerged.hasOwnProperty(i)) {
            byMonthMerged[i].usersView = byMonthView[i];
          } else {
            byMonthMerged[i] = {date: i, users: {}, usersView: byMonthView[i]};
          }
        }
      }
      output.quota.byMonth = Object.values(byMonthMerged);
      output.quota.byMonth.sort((a, b) => {
        return a.date.localeCompare(b.date);
      });

      ctx.logger.debug('licenseInfo end');
    } catch (err) {
      isError = true;
      ctx.logger.error('licenseInfo error %s', err.stack);
    } finally {
      if (!isError) {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(output));
      } else {
        res.sendStatus(400);
      }
    }
  });
};
function validateInputParams(ctx, authRes, command) {
  const commandsWithoutKey = ['version', 'license', 'getForgottenList'];
  const isValidWithoutKey = commandsWithoutKey.includes(command.c);
  const isDocIdString = typeof command.key === 'string';

  ctx.setDocId(command.key);

  if(authRes.code === constants.VKEY_KEY_EXPIRE){
    return commonDefines.c_oAscServerCommandErrors.TokenExpire;
  } else if(authRes.code !== constants.NO_ERROR){
    return commonDefines.c_oAscServerCommandErrors.Token;
  }

  if (isValidWithoutKey || isDocIdString) {
    return commonDefines.c_oAscServerCommandErrors.NoError;
  } else {
    return commonDefines.c_oAscServerCommandErrors.DocumentIdError;
  }
}

function* getFilesKeys(ctx, opt_specialDir) {
  const directoryList = yield storage.listObjects(ctx, '', opt_specialDir);
  const keys = directoryList.map(directory => directory.split('/')[0]);

  const filteredKeys = [];
  let previousKey = null;
  // Key is a folder name. This folder could consist of several files, which leads to N same strings in "keys" array in a row.
  for (const key of keys) {
    if (previousKey !== key) {
      previousKey = key;
      filteredKeys.push(key);
    }
  }

  return filteredKeys;
}

function* findForgottenFile(ctx, docId) {
  const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);
  const tenForgottenFilesName = ctx.getCfg('services.CoAuthoring.server.forgottenfilesname', cfgForgottenFilesName);

  const forgottenList = yield storage.listObjects(ctx, docId, tenForgottenFiles);
  return forgottenList.find(forgotten => tenForgottenFilesName === pathModule.basename(forgotten, pathModule.extname(forgotten)));
}

function* commandLicense(ctx) {
  const nowUTC = getLicenseNowUtc();
  const users = yield editorStat.getPresenceUniqueUser(ctx, nowUTC);
  const users_view = yield editorStat.getPresenceUniqueViewUser(ctx, nowUTC);
  const [licenseInfo, licenseOriginal] = yield tenantManager.getTenantLicense(ctx);

  return {
    license: licenseOriginal || utils.convertLicenseInfoToFileParams(licenseInfo),
    server: utils.convertLicenseInfoToServerParams(licenseInfo),
    quota: { users, users_view }
  };
}

async function proxyCommand(ctx, req, params) {
  const tenCallbackRequestTimeout = ctx.getCfg('services.CoAuthoring.server.callbackRequestTimeout', cfgCallbackRequestTimeout);
  //todo gen shardkey as in sdkjs
  const shardkey = params.key;
  const baseUrl = utils.getBaseUrlByRequest(ctx, req);
  let url = `${baseUrl}/command?&${constants.SHARD_KEY_API_NAME}=${encodeURIComponent(shardkey)}`;
  for (let name in req.query) {
    url += `&${name}=${encodeURIComponent(req.query[name])}`;
  }
  ctx.logger.info('commandFromServer proxy request with "key" to correctly process commands in sharded cluster to url:%s', url);
  return await utils.postRequestPromise(ctx, url, req.body, null, req.body.length, tenCallbackRequestTimeout, undefined, req.headers);
}
/**
 * Server commands handler.
 * @param ctx Local context.
 * @param params Request parameters.
 * @param req Request object.
 * @param output{{ key: string, error: number, version: undefined | string, users: [string]}}} Mutable. Response body.
 * @returns undefined.
 */
function* commandHandle(ctx, params, req, output) {
  const tenForgottenFiles = ctx.getCfg('services.CoAuthoring.server.forgottenfiles', cfgForgottenFiles);

  const docId = params.key;
  const forgottenData = {};

  switch (params.c) {
    case 'info': {
      //If no files in the database means they have not been edited.
      const selectRes = yield taskResult.select(ctx, docId);
      if (selectRes.length > 0) {
        let sendData = yield* bindEvents(ctx, docId, params.callback, utils.getBaseUrlByRequest(ctx, req), undefined, params.userdata);
        if (sendData) {
          output.users = sendData.users || [];
        } else {
          output.error = commonDefines.c_oAscServerCommandErrors.ParseError;
        }
      } else {
        output.error = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
      }
      break;
    }
    case 'drop': {
      if (params.userid) {
        yield publish(ctx, {type: commonDefines.c_oPublishType.drop, ctx: ctx, docId: docId, users: [params.userid], description: params.description});
      } else if (params.users) {
        const users = (typeof params.users === 'string') ? JSON.parse(params.users) : params.users;
        yield* dropUsersFromDocument(ctx, docId, users);
      } else {
        output.error = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
      }
      break;
    }
    case 'saved': {
      // Result from document manager about file save processing status after assembly
      if ('1' !== params.status) {
        //"saved" request is done synchronously so populate a variable to check it after sendServerRequest
        yield editorData.setSaved(ctx, docId, params.status);
        ctx.logger.warn('saved corrupted id = %s status = %s conv = %s', docId, params.status, params.conv);
      } else {
        ctx.logger.info('saved id = %s status = %s conv = %s', docId, params.status, params.conv);
      }
      break;
    }
    case 'forcesave': {
      let forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Command, params.userdata, undefined, undefined, undefined, undefined, undefined, undefined, utils.getBaseUrlByRequest(ctx, req));
      output.error = forceSaveRes.code;
      break;
    }
    case 'meta': {
      if (params.meta) {
        yield publish(ctx, {type: commonDefines.c_oPublishType.meta, ctx: ctx, docId: docId, meta: params.meta});
      } else {
        output.error = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
      }
      break;
    }
    case 'getForgotten': {
      // Checking for files existence.
      const forgottenFileFullPath = yield* findForgottenFile(ctx, docId);
      if (!forgottenFileFullPath) {
        output.error = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
        break;
      }

      const forgottenFile = pathModule.basename(forgottenFileFullPath);

      // Creating URLs from files.
      const baseUrl = utils.getBaseUrlByRequest(ctx, req);
      forgottenData.url = yield storage.getSignedUrl(
        ctx, baseUrl, forgottenFileFullPath, commonDefines.c_oAscUrlTypes.Temporary, forgottenFile, undefined, tenForgottenFiles
      );
      break;
    }
    case 'deleteForgotten': {
      const forgottenFile = yield* findForgottenFile(ctx, docId);
      if (!forgottenFile) {
        output.error = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
        break;
      }

      yield storage.deletePath(ctx, docId, tenForgottenFiles);
      break;
    }
    case 'getForgottenList': {
      forgottenData.keys = yield* getFilesKeys(ctx, tenForgottenFiles);
      break;
    }
    case 'version': {
      output.version = `${commonDefines.buildVersion}.${commonDefines.buildNumber}`;
      break;
    }
    case 'license': {
      const outputLicense = yield* commandLicense(ctx);
      Object.assign(output, outputLicense);
      break;
    }
    default: {
      output.error = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
      break;
    }
  }

  Object.assign(output, forgottenData);
}

// Command from the server (specifically teamlab)
exports.commandFromServer = function (req, res) {
  return co(function* () {
    const output = { key: 'commandFromServer', error: commonDefines.c_oAscServerCommandErrors.NoError, version: undefined, users: undefined};
    const ctx = new operationContext.Context();
    let postRes = null;
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('commandFromServer start');
      const authRes = yield getRequestParams(ctx, req);
      const params = authRes.params;
      // Key is document id
      output.key = params.key;
      output.error = validateInputParams(ctx, authRes, params);
      if (output.error === commonDefines.c_oAscServerCommandErrors.NoError) {
        if (params.key && !req.query[constants.SHARD_KEY_API_NAME] && !req.query[constants.SHARD_KEY_WOPI_NAME] && process.env.DEFAULT_SHARD_KEY) {
          postRes = yield proxyCommand(ctx, req, params);
        } else {
          ctx.logger.debug('commandFromServer: c = %s', params.c);
          yield* commandHandle(ctx, params, req, output);
        }
      }
    } catch (err) {
      output.error = commonDefines.c_oAscServerCommandErrors.UnknownError;
      ctx.logger.error('Error commandFromServer: %s', err.stack);
    } finally {
      let outputBuffer;
      if (postRes) {
        outputBuffer = postRes.body;
      } else {
        outputBuffer = Buffer.from(JSON.stringify(output), 'utf8');
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', outputBuffer.length);
      res.send(outputBuffer);
      ctx.logger.info('commandFromServer end : %s', outputBuffer);
    }
  });
};

exports.shutdown = function(req, res) {
  return co(function*() {
    let output = false;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      yield ctx.initTenantCache();
      ctx.logger.info('shutdown start');
      output = yield shutdown.shutdown(ctx, editorStat, req.method === 'PUT');
    } catch (err) {
      ctx.logger.error('shutdown error %s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/plain');
      res.send(output.toString());
      ctx.logger.info('shutdown end');
    }
  });
};
exports.getEditorConnectionsCount = function (req, res) {
  let ctx = new operationContext.Context();
  let count = 0;
  try {
    ctx.initFromRequest(req);
    for (let i = 0; i < connections.length; ++i) {
      let conn = connections[i];
      if (!(conn.isCloseCoAuthoring || (conn.user && conn.user.view))) {
        count++;
      }
    }
    ctx.logger.info('getConnectionsCount count=%d', count);
  } catch (err) {
    ctx.logger.error('getConnectionsCount error %s', err.stack);
  } finally {
    res.setHeader('Content-Type', 'text/plain');
    res.send(count.toString());
  }
};
