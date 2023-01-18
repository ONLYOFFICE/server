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

/*
 ----------------------------------------------------view-режим---------------------------------------------------------
 * 1) Для view-режима обновляем страницу (без быстрого перехода), чтобы пользователь не считался за редактируемого и не
 * 	держал документ для сборки (если не ждать, то непонятен быстрый переход из view в edit, когда документ уже собрался)
 * 2) Если пользователь во view-режиме, то он не участвует в редактировании (только в chat-е). При открытии он получает
 * 	все актуальные изменения в документе на момент открытия. Для view-режима не принимаем изменения и не отправляем их
 * 	view-пользователям (т.к. непонятно что делать в ситуации, когда 1-пользователь наделал изменений,
 * 	сохранил и сделал undo).
 *-----------------------------------------------------------------------------------------------------------------------
 *------------------------------------------------Схема сохранения-------------------------------------------------------
 * а) Один пользователь - первый раз приходят изменения без индекса, затем изменения приходят с индексом, можно делать
 * 	undo-redo (история не трется). Если автосохранение включено, то оно на любое действие (не чаще 5-ти секунд).
 * b) Как только заходит второй пользователь, начинается совместное редактирование. На документ ставится lock, чтобы
 * 	первый пользователь успел сохранить документ (либо прислать unlock)
 * c) Когда пользователей 2 или больше, каждое сохранение трет историю и присылается целиком (без индекса). Если
 * 	автосохранение включено, то сохраняется не чаще раз в 10-минут.
 * d) Когда пользователь остается один, после принятия чужих изменений начинается пункт 'а'
 *-----------------------------------------------------------------------------------------------------------------------
 *--------------------------------------------Схема работы с сервером----------------------------------------------------
 * а) Когда все уходят, спустя время cfgAscSaveTimeOutDelay на сервер документов шлется команда на сборку.
 * b) Если приходит статус '1' на CommandService.ashx, то удалось сохранить и поднять версию. Очищаем callback-и и
 * 	изменения из базы и из памяти.
 * с) Если приходит статус, отличный от '1'(сюда можно отнести как генерацию файла, так и работа внешнего подписчика
 * 	с готовым результатом), то трем callback-и, а изменения оставляем. Т.к. можно будет зайти в старую
 * 	версию и получить несобранные изменения. Также сбрасываем статус у файла на несобранный, чтобы его можно было
 * 	открывать без сообщения об ошибке версии.
 *-----------------------------------------------------------------------------------------------------------------------
 *------------------------------------------------Старт сервера----------------------------------------------------------
 * 1) Загружаем информацию о сборщике
 * 2) Загружаем информацию о callback-ах
 * 3) Собираем только те файлы, у которых есть callback и информация для сборки
 *-----------------------------------------------------------------------------------------------------------------------
 *------------------------------------------Переподключение при разрыве соединения---------------------------------------
 * 1) Проверяем файл на сборку. Если она началась, то останавливаем.
 * 2) Если сборка уже завершилась, то отправляем пользователю уведомление о невозможности редактировать дальше
 * 3) Далее проверяем время последнего сохранения и lock-и пользователя. Если кто-то уже успел сохранить или
 * 		заблокировать объекты, то мы не можем дальше редактировать.
 *-----------------------------------------------------------------------------------------------------------------------
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
const jwa = require('jwa');
const ms = require('ms');
const deepEqual  = require('deep-equal');
const bytes = require('bytes');
const storage = require('./../../Common/sources/storage-base');
const logger = require('./../../Common/sources/logger');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const statsDClient = require('./../../Common/sources/statsdclient');
const license = require('./../../Common/sources/license');
const configCommon = require('config');
const config = configCommon.get('services.CoAuthoring');
const sqlBase = require('./baseConnector');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const taskResult = require('./taskresult');
const gc = require('./gc');
const shutdown = require('./shutdown');
const pubsubService = require('./pubsubRabbitMQ');
const wopiClient = require('./wopiClient');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const rabbitMQCore = require('./../../Common/sources/rabbitMQCore');
const activeMQCore = require('./../../Common/sources/activeMQCore');
const operationContext = require('./../../Common/sources/operationContext');
const tenantManager = require('./../../Common/sources/tenantManager');

const editorDataStorage = require('./' + configCommon.get('services.CoAuthoring.server.editorDataStorage'));
let cfgEditor = JSON.parse(JSON.stringify(config.get('editor')));
cfgEditor['reconnection']['delay'] = ms(cfgEditor['reconnection']['delay']);
cfgEditor['websocketMaxPayloadSize'] = bytes.parse(cfgEditor['websocketMaxPayloadSize']);
cfgEditor['maxChangesSize'] = bytes.parse(cfgEditor['maxChangesSize']);
//websocket payload size is limited by https://github.com/faye/faye-websocket-node#initialization-options (64 MiB)
//xhr payload size is limited by nginx param client_max_body_size (current 100MB)
//"1.5MB" is choosen to avoid disconnect(after 25s) while downloading/uploading oversized changes with 0.5Mbps connection
const cfgWebsocketMaxPayloadSize = cfgEditor['websocketMaxPayloadSize'];
const cfgCallbackRequestTimeout = config.get('server.callbackRequestTimeout');
//The waiting time to document assembly when all out(not 0 in case of F5 in the browser)
const cfgAscSaveTimeOutDelay = config.get('server.savetimeoutdelay');

const cfgPubSubMaxChanges = config.get('pubsub.maxChanges');

const cfgExpSaveLock = config.get('expire.saveLock');
const cfgExpLockDoc = config.get('expire.lockDoc');
const cfgExpDocumentsCron = config.get('expire.documentsCron');
const cfgExpSessionIdle = ms(config.get('expire.sessionidle'));
const cfgExpSessionAbsolute = ms(config.get('expire.sessionabsolute'));
const cfgExpSessionCloseCommand = ms(config.get('expire.sessionclosecommand'));
const cfgExpUpdateVersionStatus = ms(config.get('expire.updateVersionStatus'));
const cfgTokenEnableBrowser = config.get('token.enable.browser');
const cfgTokenEnableRequestInbox = config.get('token.enable.request.inbox');
const cfgTokenSessionAlgorithm = config.get('token.session.algorithm');
const cfgTokenSessionExpires = ms(config.get('token.session.expires'));
const cfgTokenInboxHeader = config.get('token.inbox.header');
const cfgTokenInboxPrefix = config.get('token.inbox.prefix');
const cfgTokenVerifyOptions = config.get('token.verifyOptions');
const cfgForceSaveEnable = config.get('autoAssembly.enable');
const cfgForceSaveInterval = ms(config.get('autoAssembly.interval'));
const cfgForceSaveStep = ms(config.get('autoAssembly.step'));
const cfgQueueType = configCommon.get('queue.type');
const cfgQueueRetentionPeriod = configCommon.get('queue.retentionPeriod');
const cfgForgottenFiles = config.get('server.forgottenfiles');
const cfgMaxRequestChanges = config.get('server.maxRequestChanges');
const cfgWarningLimitPercents = configCommon.get('license.warning_limit_percents') / 100;
const cfgErrorFiles = configCommon.get('FileConverter.converter.errorfiles');
const cfgOpenProtectedFile = config.get('server.openProtectedFile');
const cfgRefreshLockInterval = ms(configCommon.get('wopi.refreshLockInterval'));
const cfgTokenRequiredParams = config.get('server.tokenRequiredParams');
const cfgSocketIoConnection = configCommon.get('services.CoAuthoring.socketio.connection');
const cfgTableResult = configCommon.get('services.CoAuthoring.sql.tableResult');

const EditorTypes = {
  document : 0,
  spreadsheet : 1,
  presentation : 2
};

const defaultHttpPort = 80, defaultHttpsPort = 443;	// Порты по умолчанию (для http и https)
const editorData = new editorDataStorage();
const clientStatsD = statsDClient.getClient();
let connections = []; // Активные соединения
let lockDocumentsTimerId = {};//to drop connection that can't unlockDocument
let pubsub;
let queue;
let f = {type: constants.LICENSE_RESULT.Error, light: false, branding: false, customization: false, plugins: false};
let shutdownFlag = false;
let expDocumentsStep = gc.getCronStep(cfgExpDocumentsCron);

const MIN_SAVE_EXPIRATION = 60000;
const FORCE_SAVE_EXPIRATION = Math.min(Math.max(cfgForceSaveInterval, MIN_SAVE_EXPIRATION),
                                       cfgQueueRetentionPeriod * 1000);
const HEALTH_CHECK_KEY_MAX = 10000;
const SHARD_ID = crypto.randomBytes(16).toString('base64');//16 as guid

const PRECISION = [{name: 'hour', val: ms('1h')}, {name: 'day', val: ms('1d')}, {name: 'week', val: ms('7d')},
  {name: 'month', val: ms('31d')},
];

function getIsShutdown() {
  return shutdownFlag;
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

const c_oAscLockTimeOutDelay = 500;	// Время ожидания для сохранения, когда зажата база данных

const c_oAscRecalcIndexTypes = {
  RecalcIndexAdd: 1,
  RecalcIndexRemove: 2
};

/**
 * lock types
 * @const
 */
const c_oAscLockTypes = {
  kLockTypeNone: 1, // никто не залочил данный объект
  kLockTypeMine: 2, // данный объект залочен текущим пользователем
  kLockTypeOther: 3, // данный объект залочен другим(не текущим) пользователем
  kLockTypeOther2: 4, // данный объект залочен другим(не текущим) пользователем (обновления уже пришли)
  kLockTypeOther3: 5  // данный объект был залочен (обновления пришли) и снова стал залочен
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

  this._recalcType = recalcType;		// Тип изменений (удаление или добавление)
  this._position = position;			// Позиция, в которой произошли изменения
  this._count = 1;				// Считаем все изменения за простейшие
  this.m_bIsSaveIndex = !!bIsSaveIndex;	// Это индексы из изменений других пользователей (которые мы еще не применили)

  return this;
}

CRecalcIndexElement.prototype = {
  constructor: CRecalcIndexElement,

  // Пересчет для других
  getLockOther: function(position, type) {
    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
    if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      true === this.m_bIsSaveIndex) {
      // Мы еще не применили чужие изменения (поэтому для insert не нужно отрисовывать)
      // RecalcIndexRemove (потому что перевертываем для правильной отработки, от другого пользователя
      // пришло RecalcIndexAdd
      return null;
    } else if (position === this._position &&
      c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
      // Для пользователя, который удалил столбец, рисовать залоченные ранее в данном столбце ячейки
      // не нужно
      return null;
    } else if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // Пересчет для других (только для сохранения)
  getLockSaveOther: function(position, type) {
    if (this.m_bIsSaveIndex) {
      return position;
    }

    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
    if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      true === this.m_bIsSaveIndex) {
      // Мы еще не применили чужие изменения (поэтому для insert не нужно отрисовывать)
      // RecalcIndexRemove (потому что перевертываем для правильной отработки, от другого пользователя
      // пришло RecalcIndexAdd
      return null;
    } else if (position === this._position &&
      c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
      c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
      // Для пользователя, который удалил столбец, рисовать залоченные ранее в данном столбце ячейки
      // не нужно
      return null;
    } else if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // Пересчет для себя
  getLockMe: function(position) {
    var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
    if (position < this._position) {
      return position;
    }
    else {
      return (position + inc);
    }
  },
  // Только когда от других пользователей изменения (для пересчета)
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

  this._arrElements = [];		// Массив CRecalcIndexElement

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

  // Пересчет для других
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
  // Пересчет для других (только для сохранения)
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
  // Пересчет для себя
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
  // Только когда от других пользователей изменения (для пересчета)
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
    if (utils.isLiveViewer(conn)) {
      yield editorData.incrLiveViewerConnectionsCountByShard(ctx, SHARD_ID, val);
      if (clientStatsD) {
        let countLiveView = yield editorData.getLiveViewerConnectionsCount(ctx, connections);
        clientStatsD.gauge('expireDoc.connections.liveview', countLiveView);
      }
    } else if (conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
      yield editorData.incrViewerConnectionsCountByShard(ctx, SHARD_ID, val);
      if (clientStatsD) {
        let countView = yield editorData.getViewerConnectionsCount(ctx, connections);
        clientStatsD.gauge('expireDoc.connections.view', countView);
      }
    } else {
      yield editorData.incrEditorConnectionsCountByShard(ctx, SHARD_ID, val);
      if (clientStatsD) {
        let countEditors = yield editorData.getEditorConnectionsCount(ctx, connections);
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
function removePresence(ctx, conn) {
  return co(function* () {
    yield editorData.removePresence(ctx, conn.docId, conn.user.id);
    yield updatePresenceCounters(ctx, conn, -1);
  });
}

let changeConnectionInfo = co.wrap(function*(ctx, conn, cmd) {
  if (!conn.denyChangeName && conn.user) {
    yield* publish(ctx, {type: commonDefines.c_oPublishType.changeConnecitonInfo, ctx: ctx, docId: conn.docId, useridoriginal: conn.user.idOriginal, cmd: cmd});
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
    edit.ds_view = conn.user.view;
    edit.ds_isCloseCoAuthoring = conn.isCloseCoAuthoring;
    edit.ds_isEnterCorrectPassword = conn.isEnterCorrectPassword;
    // presenter viewer opens with same session jwt. do not put sessionId to jwt
    // edit.ds_sessionId = conn.sessionId;
    edit.ds_sessionTimeConnect = conn.sessionTimeConnect;

    return yield signToken(ctx, payload, cfgTokenSessionAlgorithm, cfgTokenSessionExpires / 1000, commonDefines.c_oAscSecretType.Session);
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
    if (isEnterCorrectPassword) {
      conn.isEnterCorrectPassword = true;
      if (cfgTokenEnableBrowser) {
        let sessionToken = yield fillJwtByConnection(ctx, conn);
        sendDataRefreshToken(ctx, conn, sessionToken);
      }
    }
  });
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
    yield editorData.addPresenceUniqueViewUser(ctx, userId, expireAt, {anonym: anonym});
    yield editorData.addPresenceUniqueViewUsersOfMonth(ctx, userId, period, {anonym: anonym, firstOpenDate: now.toISOString()});
  } else {
    yield editorData.addPresenceUniqueUser(ctx, userId, expireAt, {anonym: anonym});
    yield editorData.addPresenceUniqueUsersOfMonth(ctx, userId, period, {anonym: anonym, firstOpenDate: now.toISOString()});
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
function* publish(ctx, data, optDocId, optUserId, opt_pubsub) {
  var needPublish = true;
  if(optDocId && optUserId) {
    needPublish = false;
    var hvals = yield editorData.getPresence(ctx, optDocId, connections);
    for (var i = 0; i < hvals.length; ++i) {
      var elem = JSON.parse(hvals[i]);
      if(optUserId != elem.id) {
        needPublish = true;
        break;
      }
    }
  }
  if(needPublish) {
    var msg = JSON.stringify(data);
    var realPubsub = opt_pubsub ? opt_pubsub : pubsub;
    if (realPubsub) {
      realPubsub.publish(msg);
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

function* getOriginalParticipantsId(ctx, docId) {
  var result = [], tmpObject = {};
  var hvals = yield editorData.getPresence(ctx, docId, connections);
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

function* sendServerRequest(ctx, uri, dataObject, opt_checkAndFixAuthorizationLength) {
  ctx.logger.debug('postData request: url = %s;data = %j', uri, dataObject);
  let auth;
  if (utils.canIncludeOutboxAuthorization(ctx, uri)) {
    let secret = yield tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Outbox);
    let bodyToken = utils.fillJwtForRequest(dataObject, secret, true);
    auth = utils.fillJwtForRequest(dataObject, secret, false);
    let authLen = auth.length;
    if (opt_checkAndFixAuthorizationLength && !opt_checkAndFixAuthorizationLength(auth, dataObject)) {
      auth = utils.fillJwtForRequest(dataObject, secret, false);
      ctx.logger.warn('authorization too large. Use body token instead. size reduced from %d to %d', authLen, auth.length);
    }
    dataObject.setToken(bodyToken);
  }
  let postRes = yield utils.postRequestPromise(uri, JSON.stringify(dataObject), undefined, undefined, cfgCallbackRequestTimeout, auth);
  ctx.logger.debug('postData response: data = %s', postRes.body);
  return postRes.body;
}

// Парсинг ссылки
function parseUrl(ctx, callbackUrl) {
  var result = null;
  try {
    //делать decodeURIComponent не нужно http://expressjs.com/en/4x/api.html#app.settings.table
    //по умолчанию express использует 'query parser' = 'extended', но даже в 'simple' версии делается decode
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

function* getCallback(ctx, id, opt_userIndex) {
  var callbackUrl = null;
  var baseUrl = null;
  let wopiParams = null;
  var selectRes = yield taskResult.select(ctx, id);
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
function* setForceSave(ctx, docId, forceSave, cmd, success) {
  let forceSaveType = forceSave.getType();
  if (commonDefines.c_oAscForceSaveTypes.Form !== forceSaveType) {
    if (success) {
      yield editorData.checkAndSetForceSave(ctx, docId, forceSave.getTime(), forceSave.getIndex(), true, true);
    } else {
      yield editorData.checkAndSetForceSave(ctx, docId, forceSave.getTime(), forceSave.getIndex(), false, false);
    }
  }

  if (commonDefines.c_oAscForceSaveTypes.Command !== forceSaveType) {
    let data = {type: forceSaveType, time: forceSave.getTime(), success: success};
    if(commonDefines.c_oAscForceSaveTypes.Form === forceSaveType) {
      yield* publish(ctx, {type: commonDefines.c_oPublishType.rpc, ctx: ctx, docId: docId, data: data, responseKey: cmd.getResponseKey()}, cmd.getUserConnectionId());
    } else {
      yield* publish(ctx, {type: commonDefines.c_oPublishType.forceSave, ctx: ctx, docId: docId, data: data}, cmd.getUserConnectionId());
    }
  }
}
let startForceSave = co.wrap(function*(ctx, docId, type, opt_userdata, opt_userId, opt_userConnectionId, opt_userIndex, opt_responseKey, opt_baseUrl, opt_queue, opt_pubsub) {
  ctx.logger.debug('startForceSave start');
  let res = {code: commonDefines.c_oAscServerCommandErrors.NoError, time: null};
  let startedForceSave;
  let hasEncrypted = false;
  if (!shutdownFlag) {
    let hvals = yield editorData.getPresence(ctx, docId, connections);
    hasEncrypted = hvals.some((currentValue) => {
      return !!JSON.parse(currentValue).encrypted;
    });
    if (!hasEncrypted) {
      if (commonDefines.c_oAscForceSaveTypes.Form === type) {
        startedForceSave = yield editorData.getForceSave(ctx, docId);
      } else {
        startedForceSave = yield editorData.checkAndStartForceSave(ctx, docId);
      }
    }
  }
  ctx.logger.debug('startForceSave canStart: hasEncrypted = %s; startedForceSave = %j', hasEncrypted, startedForceSave);
  if (startedForceSave) {
    let baseUrl = opt_baseUrl || startedForceSave.baseUrl;
    let forceSave = new commonDefines.CForceSaveData(startedForceSave);
    forceSave.setType(type);
    forceSave.setAuthorUserId(opt_userId);
    forceSave.setAuthorUserIndex(opt_userIndex);

    if (commonDefines.c_oAscForceSaveTypes.Timeout === type) {
      yield* publish(ctx, {
                       type: commonDefines.c_oPublishType.forceSave, ctx: ctx, docId: docId,
                       data: {type: type, time: forceSave.getTime(), start: true}
                     }, undefined, undefined, opt_pubsub);
    }

    let priority;
    let expiration;
    if (commonDefines.c_oAscForceSaveTypes.Timeout === type) {
      priority = constants.QUEUE_PRIORITY_VERY_LOW;
      expiration = FORCE_SAVE_EXPIRATION;
    } else {
      priority = constants.QUEUE_PRIORITY_LOW;
    }
    //start new convert
    let status = yield converterService.convertFromChanges(ctx, docId, baseUrl, forceSave, startedForceSave.changeInfo, opt_userdata,
                                                            opt_userConnectionId, opt_responseKey, priority, expiration, opt_queue);
    if (constants.NO_ERROR === status.err) {
      res.time = forceSave.getTime();
    } else {
      res.code = commonDefines.c_oAscServerCommandErrors.UnknownError;
    }
    ctx.logger.debug('startForceSave convertFromChanges: status = %d', status.err);
  } else {
    res.code = commonDefines.c_oAscServerCommandErrors.NotModified;
  }
  ctx.logger.debug('startForceSave end');
  return res;
});
function getExternalChangeInfo(user, date) {
  return {user_id: user.id, user_id_original: user.idOriginal, user_name: user.username, change_date: date};
}
let resetForceSaveAfterChanges = co.wrap(function*(ctx, docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo) {
  //last save
  if (newChangesLastTime) {
    yield editorData.setForceSave(ctx, docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo);
    if (cfgForceSaveEnable) {
      let expireAt = newChangesLastTime + cfgForceSaveInterval;
      yield editorData.addForceSaveTimerNX(ctx, docId, expireAt);
    }
  }
});
function* startRPC(ctx, conn, responseKey, data) {
  let docId = conn.docId;
  ctx.logger.debug('startRPC start responseKey:%s , %j', responseKey, data);
  switch (data.type) {
    case 'sendForm':
      var forceSaveRes;
      if (conn.user) {
        forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Form, undefined, conn.user.idOriginal, conn.user.id, conn.user.indexUser, responseKey);
      } else {
        sendDataRpc(ctx, conn, responseKey);
      }
      break;
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
        let cmd = task.getCmd();
        ctx.logger.warn('handleDeadLetter start: %s', data);
        let forceSave = cmd.getForceSave();
        if (forceSave && commonDefines.c_oAscForceSaveTypes.Timeout == forceSave.getType()) {
          let actualForceSave = yield editorData.getForceSave(ctx, cmd.getDocId());
          //check that there are no new changes
          if (actualForceSave && forceSave.getTime() === actualForceSave.time && forceSave.getIndex() === actualForceSave.index) {
            //requeue task
            yield* addTask(task, constants.QUEUE_PRIORITY_VERY_LOW, undefined, FORCE_SAVE_EXPIRATION);
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
 * Отправка статуса, чтобы знать когда документ начал редактироваться, а когда закончился
 * @param docId
 * @param {number} bChangeBase
 * @param callback
 * @param baseUrl
 */
function* sendStatusDocument(ctx, docId, bChangeBase, opt_userAction, opt_userIndex, opt_callback, opt_baseUrl, opt_userData, opt_forceClose) {
  if (!opt_callback) {
    var getRes = yield* getCallback(ctx, docId, opt_userIndex);
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
  var participants = yield* getOriginalParticipantsId(ctx, docId);
  if (0 === participants.length) {
    let bHasChanges = yield hasChanges(ctx, docId);
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
      var updateIfRes = yield taskResult.update(ctx, updateTask);
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
    replyData = yield* sendServerRequest(ctx, uri, sendData);
  } catch (err) {
    replyData = null;
    ctx.logger.error('postData error: url = %s;data = %j %s', uri, sendData, err.stack);
  }
  yield* onReplySendStatusDocument(ctx, docId, replyData);
  return opt_callback;
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
function* onReplySendStatusDocument(ctx, docId, replyData) {
  var oData = parseReplyData(ctx, replyData);
  if (!(oData && commonDefines.c_oAscServerCommandErrors.NoError == oData.error)) {
    // Ошибка подписки на callback, посылаем warning
    yield* publish(ctx, {type: commonDefines.c_oPublishType.warning, ctx: ctx, docId: docId, description: 'Error on save server subscription!'});
  }
}
function* publishCloseUsersConnection(ctx, docId, users, isOriginalId, code, description) {
  if (Array.isArray(users)) {
    let usersMap = users.reduce(function(map, val) {
      map[val] = 1;
      return map;
    }, {});
    yield* publish(ctx, {
                     type: commonDefines.c_oPublishType.closeConnection, ctx: ctx, docId: docId, usersMap: usersMap,
                     isOriginalId: isOriginalId, code: code, description: description
                   });
  }
}
function closeUsersConnection(docId, usersMap, isOriginalId, code, description) {
  //close
  let conn;
  for (let i = connections.length - 1; i >= 0; --i) {
    conn = connections[i];
    if (conn.docId === docId) {
      if (isOriginalId ? usersMap[conn.user.idOriginal] : usersMap[conn.user.id]) {
        conn.disconnect(code, description);
      }
    }
  }
}
function* dropUsersFromDocument(ctx, docId, users) {
  if (Array.isArray(users)) {
    yield* publish(ctx, {type: commonDefines.c_oPublishType.drop, ctx: ctx, docId: docId, users: users, description: ''});
  }
}

function dropUserFromDocument(ctx, docId, userId, description) {
  var elConnection;
  for (var i = 0, length = connections.length; i < length; ++i) {
    elConnection = connections[i];
    if (elConnection.docId === docId && userId === elConnection.user.idOriginal && !elConnection.isCloseCoAuthoring) {
      sendData(ctx, elConnection,
        {
          type: "drop",
          description: description
        });//Or 0 if fails
    }
  }
}

// Подписка на эвенты:
function* bindEvents(ctx, docId, callback, baseUrl, opt_userAction, opt_userData) {
  // Подписка на эвенты:
  // - если пользователей нет и изменений нет, то отсылаем статус "закрыто" и в базу не добавляем
  // - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
  // - если есть пользователи, то просто добавляем в базу
  var bChangeBase;
  var oCallbackUrl;
  if (!callback) {
    var getRes = yield* getCallback(ctx, docId);
    if (getRes && !getRes.wopiParams) {
      oCallbackUrl = getRes.server;
      bChangeBase = c_oAscChangeBase.Delete;
    }
  } else {
    oCallbackUrl = parseUrl(ctx, callback);
    bChangeBase = c_oAscChangeBase.All;
    if (null !== oCallbackUrl) {
      let filterStatus = yield* utils.checkHostFilter(ctx, oCallbackUrl.host);
      if (filterStatus > 0) {
        ctx.logger.warn('checkIpFilter error: url = %s', callback);
        //todo add new error type
        oCallbackUrl = null;
      }
    }
  }
  if (null === oCallbackUrl) {
    return commonDefines.c_oAscServerCommandErrors.ParseError;
  } else {
    yield* sendStatusDocument(ctx, docId, bChangeBase, opt_userAction, undefined, oCallbackUrl, baseUrl, opt_userData);
    return commonDefines.c_oAscServerCommandErrors.NoError;
  }
}
let unlockWopiDoc = co.wrap(function*(ctx, docId, opt_userIndex) {
  //wopi unlock
  var getRes = yield* getCallback(ctx, docId, opt_userIndex);
  if (getRes && getRes.wopiParams && getRes.wopiParams.userAuth && 'view' !== getRes.wopiParams.userAuth.mode) {
    yield wopiClient.unlock(ctx, getRes.wopiParams);
    let unlockInfo = wopiClient.getWopiUnlockMarker(getRes.wopiParams);
    if (unlockInfo) {
      yield canvasService.commandOpenStartPromise(ctx, docId, undefined, true, unlockInfo);
    }
  }
});
function* cleanDocumentOnExit(ctx, docId, deleteChanges, opt_userIndex) {
  //clean redis (redisKeyPresenceSet and redisKeyPresenceHash removed with last element)
  yield editorData.cleanDocumentOnExit(ctx, docId);
  //remove changes
  if (deleteChanges) {
    yield taskResult.restoreInitialPassword(ctx, docId);
    sqlBase.deleteChanges(ctx, docId, null);
    //delete forgotten after successful send on callbackUrl
    yield storage.deletePath(ctx, docId, cfgForgottenFiles);
  }
  yield unlockWopiDoc(ctx, docId, opt_userIndex);
}
function* cleanDocumentOnExitNoChanges(ctx, docId, opt_userId, opt_userIndex, opt_forceClose) {
  var userAction = opt_userId ? new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, opt_userId) : null;
  // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
  yield* sendStatusDocument(ctx, docId, c_oAscChangeBase.No, userAction, opt_userIndex, undefined, undefined, undefined, opt_forceClose);
  //если пользователь зашел в документ, соединение порвалось, на сервере удалилась вся информация,
  //при восстановлении соединения userIndex сохранится и он совпадет с userIndex следующего пользователя
  yield* cleanDocumentOnExit(ctx, docId, false, opt_userIndex);
}

function createSaveTimer(ctx, docId, opt_userId, opt_userIndex, opt_queue, opt_noDelay) {
  return co(function*(){
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
        yield utils.sleep(cfgAscSaveTimeOutDelay);
      }
      while (true) {
        if (!sqlBase.isLockCriticalSection(docId)) {
          canvasService.saveFromChanges(ctx, docId, updateTask.statusInfo, null, opt_userId, opt_userIndex, opt_queue);
          break;
        }
        yield utils.sleep(c_oAscLockTimeOutDelay);
      }
    } else {
      //если не получилось - значит FileStatus=SaveVersion(кто-то другой начал сборку) или UpdateVersion(сборка закончена)
      //в этом случае ничего делать не надо
      ctx.logger.debug('createSaveTimer updateIf no effect');
    }
  });
}

function checkJwt(ctx, token, type) {
  return co(function*() {
    var res = {decoded: null, description: null, code: null, token: token};
    let secret = yield tenantManager.getTenantSecret(ctx, type);
    if (undefined == secret) {
      ctx.logger.warn('empty secret: token = %s', token);
    }
    try {
      res.decoded = jwt.verify(token, secret, cfgTokenVerifyOptions);
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
    let header = opt_header || cfgTokenInboxHeader;
    let prefix = opt_prefix || cfgTokenInboxPrefix;
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
    let res = {code: constants.NO_ERROR, params: undefined};
    if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0 && !opt_isNotInBody) {
      res.params = JSON.parse(req.body.toString('utf8'));
    } else {
      res.params = req.query;
    }
    if (cfgTokenEnableRequestInbox) {
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
          if (cfgTokenRequiredParams) {
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

exports.c_oAscServerStatus = c_oAscServerStatus;
exports.editorData = editorData;
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
function encryptPasswordParams(ctx, data) {
  return co(function*(){
    let dataWithPassword;
    if (data.type === 'openDocument' && data.message) {
      dataWithPassword = data.message;
    } else if (data.type === 'auth' && data.openCmd) {
      dataWithPassword = data.openCmd;
    } else if (data.c === 'savefromorigin') {
      dataWithPassword = data;
    }
    if (dataWithPassword && dataWithPassword.password) {
      if (dataWithPassword.password.length > constants.PASSWORD_MAX_LENGTH) {
        //todo send back error
        ctx.logger.warn('encryptPasswordParams password too long actual = %s; max = %s', dataWithPassword.password.length, constants.PASSWORD_MAX_LENGTH);
        dataWithPassword.password = null;
      } else {
        dataWithPassword.password = yield utils.encryptPassword(dataWithPassword.password);
      }
    }
    if (dataWithPassword && dataWithPassword.savepassword) {
      if (dataWithPassword.savepassword.length > constants.PASSWORD_MAX_LENGTH) {
        //todo send back error
        ctx.logger.warn('encryptPasswordParams password too long actual = %s; max = %s', dataWithPassword.savepassword.length, constants.PASSWORD_MAX_LENGTH);
        dataWithPassword.savepassword = null;
      } else {
        dataWithPassword.savepassword = yield utils.encryptPassword(dataWithPassword.savepassword);
      }
    }
  });
}
exports.encryptPasswordParams = encryptPasswordParams;
exports.install = function(server, callbackFunction) {
  const io = new Server(server, cfgSocketIoConnection);

  io.use((socket, next) => {
    co(function*(){
      let ctx = new operationContext.Context();
      let res;
      let checkJwtRes;
      try {
        ctx.initFromConnection(socket);
        ctx.logger.info('io.use start');
        let handshake = socket.handshake;
        if (cfgTokenEnableBrowser) {
          checkJwtRes = yield checkJwt(ctx, handshake?.auth?.token, commonDefines.c_oAscSecretType.Browser);
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

  io.on('connection', function(conn) {
    if (!conn) {
      operationContext.global.logger.error("null == conn");
      return;
    }
    let ctx = new operationContext.Context();
    ctx.initFromConnection(conn);
    if (getIsShutdown()) {
      sendFileError(ctx, conn, 'Server shutdow');
      return;
    }
    conn.baseUrl = utils.getBaseUrlByConnection(conn);
    conn.sessionIsSendWarning = false;
    conn.sessionTimeConnect = conn.sessionTimeLastAction = new Date().getTime();

    conn.on('message', function(data) {
      return co(function* () {
      var docId = 'null';
      let ctx = new operationContext.Context();
      try {
        ctx.initFromConnection(conn);
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
          conn.disconnect(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
          return;
        }
        if ((conn.isCloseCoAuthoring || (conn.user && conn.user.view)) &&
            ('getLock' == data.type || 'saveChanges' == data.type || 'isSaveLock' == data.type)) {
          ctx.logger.warn("conn.user.view||isCloseCoAuthoring access deny: type = %s", data.type);
          conn.disconnect(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
          return;
        }
        yield encryptPasswordParams(ctx, data);
        switch (data.type) {
          case 'auth'          :
            try {
              yield* auth(ctx, conn, data);
            } catch(err){
              ctx.logger.error('auth error: %s', err.stack);
              conn.disconnect(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
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
            yield* getLock(ctx, conn, data, false);
            break;
          case 'saveChanges'      :
            yield* saveChanges(ctx, conn, data);
            break;
          case 'isSaveLock'      :
            yield* isSaveLock(ctx, conn, data);
            break;
          case 'unSaveLock'      :
            yield* unSaveLock(ctx, conn, -1, -1);
            break;	// Индекс отправляем -1, т.к. это экстренное снятие без сохранения
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
            if ("error" === level && cfgErrorFiles && docId) {
              let destDir = 'browser/' + docId;
              yield storage.copyPath(ctx, docId, destDir, undefined, cfgErrorFiles);
              yield* saveErrorChanges(ctx, docId, destDir);
            }
            break;
          case 'extendSession' :
            conn.sessionIsSendWarning = false;
            conn.sessionTimeLastAction = new Date().getTime() - data.idletime;
            break;
          case 'forceSaveStart' :
            var forceSaveRes;
            if (conn.user) {
              forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Button, undefined, conn.user.idOriginal, conn.user.id, conn.user.indexUser);
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
        if(clientStatsD) {
          if('openDocument' != data.type) {
            clientStatsD.timing('coauth.data.' + data.type, new Date() - startDate);
          }
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
          yield* closeDocument(ctx, conn, reason);
        } catch (err) {
          ctx.logger.error('Error conn close: %s', err.stack);
        }
      });
    });

    _checkLicense(ctx, conn);
  });
  io.engine.on("connection_error", (err) => {
    operationContext.global.logger.warn(err.req);      // the request object
    operationContext.global.logger.warn(err.code);     // the error code, for example 1
    operationContext.global.logger.warn(err.message);  // the error message, for example "Session ID unknown"
    operationContext.global.logger.warn(err.context);  // some additional error context
  });
  /**
   *
   * @param ctx
   * @param conn
   * @param reason - the reason of the disconnection (either client or server-side)
   */
  function* closeDocument(ctx, conn, reason) {
    var userLocks, reconnected = false, bHasEditors, bHasChanges;
    var docId = conn.docId;
    if (null == docId) {
      return;
    }
    var hvals;
    let participantsTimestamp;
    var tmpUser = conn.user;
    var isView = tmpUser.view;
    ctx.logger.info("Connection closed or timed out: reason = %s", reason);
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
        tmpUser.view = true;
        conn.isCloseCoAuthoring = true;
        yield addPresence(ctx, conn, true);
        if (cfgTokenEnableBrowser) {
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
      yield* publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participants}, docId, tmpUser.id);
      tmpUser.view = tmpView;

      // Для данного пользователя снимаем лок с сохранения
      yield editorData.unlockSave(ctx, docId, conn.user.id);

      // Только если редактируем
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
        //Давайдосвиданья!
        //Release locks
        userLocks = yield* removeUserLocks(ctx, docId, conn.user.id);
        if (0 < userLocks.length) {
          //todo на close себе ничего не шлем
          //sendReleaseLock(conn, userLocks);
          yield* publish(ctx, {type: commonDefines.c_oPublishType.releaseLock, ctx: ctx, docId: docId, userId: conn.user.id, locks: userLocks}, docId, conn.user.id);
        }

        // Для данного пользователя снимаем Lock с документа
        yield* checkEndAuthLock(ctx, true, false, docId, conn.user.id);

        let userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
        // Если у нас нет пользователей, то удаляем все сообщения
        if (!bHasEditors) {
          // На всякий случай снимаем lock
          yield editorData.unlockSave(ctx, docId, tmpUser.id);

          let needSaveChanges = bHasChanges;
          if (!needSaveChanges) {
            //start save changes if forgotten file exists.
            //more effective to send file without sfc, but this method is simpler by code
            let forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
            needSaveChanges = forgotten.length > 0;
            ctx.logger.debug('closeDocument hasForgotten %s', needSaveChanges);
          }
          if (needSaveChanges && !conn.encrypted) {
            // Send changes to save server
            yield createSaveTimer(ctx, docId, tmpUser.idOriginal, userIndex);
          } else if (needSendStatus) {
            yield* cleanDocumentOnExitNoChanges(ctx, docId, tmpUser.idOriginal, userIndex);
          } else {
            yield* cleanDocumentOnExit(ctx, docId, false, userIndex);
          }
        } else if (needSendStatus) {
          yield* sendStatusDocument(ctx, docId, c_oAscChangeBase.No, new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, tmpUser.idOriginal), userIndex);
        }
      }
    }
  }

  function* versionHistory(ctx, conn, cmd) {
    var docIdOld = conn.docId;
    var docIdNew = cmd.getDocId();
    //check jwt
    if (cfgTokenEnableBrowser) {
      var checkJwtRes = yield checkJwt(ctx, cmd.getTokenHistory(), commonDefines.c_oAscSecretType.Browser);
      if (checkJwtRes.decoded) {
        fillVersionHistoryFromJwt(checkJwtRes.decoded, cmd);
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
      if (cfgTokenEnableBrowser) {
        let sessionToken = yield fillJwtByConnection(ctx, conn);
        sendDataRefreshToken(ctx, conn, sessionToken);
      }
    }
    //open
    yield canvasService.openDocument(ctx, conn, cmd, null);
  }
  // Получение изменений для документа (либо из кэша, либо обращаемся к базе, но только если были сохранения)
  function* getDocumentChanges(ctx, docId, optStartIndex, optEndIndex) {
    // Если за тот момент, пока мы ждали из базы ответа, все ушли, то отправлять ничего не нужно
    var arrayElements = yield sqlBase.getChangesPromise(ctx, docId, optStartIndex, optEndIndex);
    var j, element;
    var objChangesDocument = new DocumentChanges(docId);
    for (j = 0; j < arrayElements.length; ++j) {
      element = arrayElements[j];

      // Добавляем GMT, т.к. в базу данных мы пишем UTC, но сохраняется туда строка без UTC и при зачитывании будет неправильное время
      objChangesDocument.push({docid: docId, change: element['change_data'],
        time: element['change_date'].getTime(), user: element['user_id'],
        useridoriginal: element['user_id_original']});
    }
    return objChangesDocument;
  }

  function* getAllLocks(ctx, docId) {
    var docLockRes = [];
    var docLock = yield editorData.getLocks(ctx, docId);
    for (var i = 0; i < docLock.length; ++i) {
      docLockRes.push(docLock[i]);
    }
    return docLockRes;
  }
  function* removeUserLocks(ctx, docId, userId) {
    var userLocks = [], i;
    var toCache = [];
    var docLock = yield* getAllLocks(ctx, docId);
    for (i = 0; i < docLock.length; ++i) {
      var elem = docLock[i];
      if (elem.user === userId) {
        userLocks.push(elem);
      } else {
        toCache.push(elem);
      }
    }
    //remove all
    yield editorData.removeLocks(ctx, docId);
    //set all
    yield editorData.addLocks(ctx, docId, toCache);
    return userLocks;
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
				yield* publish(ctx, {
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
			const userLocks = yield* removeUserLocks(ctx, docId, userId);
			if (0 < userLocks.length) {
				sendReleaseLock(ctx, conn, userLocks);
				yield* publish(ctx, {
					type: commonDefines.c_oPublishType.releaseLock,
                    ctx: ctx,
					docId: docId,
					userId: userId,
					locks: userLocks
				}, docId, userId);
			}
		}
		if (isSave && conn) {
			// Автоматически снимаем lock сами
			yield* unSaveLock(ctx, conn, -1, -1);
		}

		return result;
	}

  function* setLockDocumentTimer(ctx, docId, userId) {
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
    }, 1000 * cfgExpLockDoc);
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
    conn.isCloseCoAuthoring = true;
    conn.sessionId = sessionId;//restore old
    //Kill previous connections
    connections = _.reject(connections, function(el) {
      return el.sessionId === sessionId;//Delete this connection
    });
    //closing could happen during async action
    if (constants.CONN_CLOSED !== conn.conn.readyState) {
      // Кладем в массив, т.к. нам нужно отправлять данные для открытия/сохранения документа
      connections.push(conn);
      yield addPresence(ctx, conn, true);

      sendFileError(ctx, conn, errorId, code);
    }
  }

  // Пересчет только для чужих Lock при сохранении на клиенте, который добавлял/удалял строки или столбцы
  function _recalcLockArray(userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
    if (null == _locks) {
      return false;
    }
    var count = _locks.length;
    var element = null, oRangeOrObjectId = null;
    var i;
    var sheetId = -1;
    var isModify = false;
    for (i = 0; i < count; ++i) {
      // Для самого себя не пересчитываем
      if (userId === _locks[i].user) {
        continue;
      }
      element = _locks[i].block;
      if (c_oAscLockTypeElem.Range !== element["type"] ||
        c_oAscLockTypeElemSubType.InsertColumns === element["subType"] ||
        c_oAscLockTypeElemSubType.InsertRows === element["subType"]) {
        continue;
      }
      sheetId = element["sheetId"];

      oRangeOrObjectId = element["rangeOrObjectId"];

      if (oRecalcIndexColumns && oRecalcIndexColumns.hasOwnProperty(sheetId)) {
        // Пересчет колонок
        oRangeOrObjectId["c1"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c1"]);
        oRangeOrObjectId["c2"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c2"]);
        isModify = true;
      }
      if (oRecalcIndexRows && oRecalcIndexRows.hasOwnProperty(sheetId)) {
        // Пересчет строк
        oRangeOrObjectId["r1"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r1"]);
        oRangeOrObjectId["r2"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r2"]);
        isModify = true;
      }
    }
    return isModify;
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
          // Дублируем для возврата результата (нам нужно пересчитать только по последнему индексу
          oRecalcIndexResult[sheetId].add(nRecalcType, oRecalcIndexElement._position,
            oRecalcIndexElement._count, /*bIsSaveIndex*/true);
        }
      }
    }

    return oRecalcIndexResult;
  }

  function compareExcelBlock(newBlock, oldBlock) {
    // Это lock для удаления или добавления строк/столбцов
    if (null !== newBlock.subType && null !== oldBlock.subType) {
      return true;
    }

    // Не учитываем lock от ChangeProperties (только если это не lock листа)
    if ((c_oAscLockTypeElemSubType.ChangeProperties === oldBlock.subType &&
      c_oAscLockTypeElem.Sheet !== newBlock.type) ||
      (c_oAscLockTypeElemSubType.ChangeProperties === newBlock.subType &&
        c_oAscLockTypeElem.Sheet !== oldBlock.type)) {
      return false;
    }

    var resultLock = false;
    if (newBlock.type === c_oAscLockTypeElem.Range) {
      if (oldBlock.type === c_oAscLockTypeElem.Range) {
        // Не учитываем lock от Insert
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

  // Сравнение для презентаций
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
      //as in web-apps/apps/documenteditor/main/app/controller/Main.js
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
      data.lang = queryParams.lang || queryParams.ui || "en-US";
    }
    if (decoded.fileInfo) {
      let fileInfo = decoded.fileInfo;
      if (openCmd) {
        let fileType = fileInfo.BaseFileName ? fileInfo.BaseFileName.substr(fileInfo.BaseFileName.lastIndexOf('.') + 1) : "";
        openCmd.format = fileInfo.FileExtension ? fileInfo.FileExtension.substr(1) : fileType;
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
      let permissions = {
        edit: !fileInfo.ReadOnly && fileInfo.UserCanWrite,
        review: (fileInfo.SupportsReviewing === false) ? false : (fileInfo.UserCanReview === false ? false : fileInfo.UserCanReview),
        copy: fileInfo.CopyPasteRestrictions !== "CurrentDocumentOnly" && fileInfo.CopyPasteRestrictions !== "BlockAll",
        print: !fileInfo.DisablePrint && !fileInfo.HidePrintOption
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
    } else if (data.mode && !decoded?.editorConfig?.mode) {
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
      if (null != edit.mode) {
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
      if (null != edit.ds_view) {
        data.view = edit.ds_view;
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
    if (decoded.url || decoded.payload|| (decoded.key && !decoded.fileInfo)) {
      ctx.logger.warn('fillDataFromJwt token has invalid format');
      res = false;
    }

    //issuer for secret
    if (decoded.iss) {
      data.iss = decoded.iss;
    }
    return res;
  }
  function fillVersionHistoryFromJwt(decoded, cmd) {
    if (decoded.changesUrl && decoded.previous && (cmd.getServerVersion() === commonDefines.buildVersion)) {
      cmd.setUrl(decoded.previous.url);
      cmd.setDocId(decoded.previous.key);
    } else {
      cmd.setUrl(decoded.url);
      cmd.setDocId(decoded.key);
    }
  }

  function* auth(ctx, conn, data) {
    //TODO: Do authorization etc. check md5 or query db
    ctx.logger.debug('auth time: %d', data.time);
    if (data.token && data.user) {
      ctx.setUserId(data.user.id);
      let licenseInfo = yield tenantManager.getTenantLicense(ctx);
      //check jwt
      if (cfgTokenEnableBrowser) {
        let secretType = !!data.jwtSession ? commonDefines.c_oAscSecretType.Session : commonDefines.c_oAscSecretType.Browser;
        const checkJwtRes = yield checkJwt(ctx, data.jwtSession || data.jwtOpen, secretType);
        if (checkJwtRes.decoded) {
          let decoded = checkJwtRes.decoded;
          let fillDataFromJwtRes = false;
          if (decoded.fileInfo) {
            //wopi
            fillDataFromJwtRes = fillDataFromWopiJwt(decoded, data);
          } else if (decoded.editorConfig && undefined !== decoded.editorConfig.ds_view) {
            //reconnection
            fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
          } else {
            //opening
            let validationErr = validateAuthToken(data, decoded);
            if (!validationErr) {
              fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
            } else if (cfgTokenRequiredParams) {
              ctx.logger.error("auth missing required parameter %s (since 7.1 version)", validationErr);
              conn.disconnect(constants.JWT_ERROR_CODE, constants.JWT_ERROR_REASON);
              return;
            } else {
              ctx.logger.warn("auth missing required parameter %s (since 7.1 version)", validationErr);
              fillDataFromJwtRes = fillDataFromJwt(ctx, decoded, data);
            }
          }
          if(!fillDataFromJwtRes) {
            ctx.logger.warn("fillDataFromJwt return false");
            conn.disconnect(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
            return;
          }
        } else {
          conn.disconnect(checkJwtRes.code, checkJwtRes.description);
          return;
        }
      }
      ctx.setUserId(data.user.id);

      let docId = data.docid;
      const user = data.user;

      let wopiParams = null;
      if (data.documentCallbackUrl) {
        wopiParams = wopiClient.parseWopiCallback(ctx, data.documentCallbackUrl);
        if (wopiParams && wopiParams.userAuth) {
          conn.access_token_ttl = wopiParams.userAuth.access_token_ttl;
        }
      }
      //get user index
      const bIsRestore = null != data.sessionId;
      let upsertRes = null;
      let curIndexUser, documentCallback;
      if (bIsRestore) {
        // Если восстанавливаем, индекс тоже восстанавливаем
        curIndexUser = user.indexUser;
      } else {
        if (data.documentCallbackUrl && !wopiParams) {
          documentCallback = url.parse(data.documentCallbackUrl);
          let filterStatus = yield* utils.checkHostFilter(ctx, documentCallback.hostname);
          if (0 !== filterStatus) {
            ctx.logger.warn('checkIpFilter error: url = %s', data.documentCallbackUrl);
            conn.disconnect(constants.DROP_CODE, constants.DROP_REASON);
            return;
          }
        }
        let format = data.openCmd && data.openCmd.format;
        upsertRes = yield canvasService.commandOpenStartPromise(ctx, docId, utils.getBaseUrlByConnection(conn), true, data.documentCallbackUrl, format);
        let isInserted = upsertRes.affectedRows == 1;
        curIndexUser = isInserted ? 1 : upsertRes.insertId;
        if (isInserted && undefined !== data.timezoneOffset) {
          //todo insert in commandOpenStartPromise. insert here for database compatibility
          if (false === canvasService.hasAdditionalCol) {
            let selectRes = yield taskResult.select(ctx, docId);
            canvasService.hasAdditionalCol = selectRes.length > 0 && undefined !== selectRes[0].additional;
          }
          if (canvasService.hasAdditionalCol) {
            let task = new taskResult.TaskResultData();
            task.tenant = ctx.tenant;
            task.key = docId;
            //todo duplicate created_at because CURRENT_TIMESTAMP uses server timezone
            task.additional = sqlBase.DocumentAdditional.prototype.setOpenedAt(Date.now(), data.timezoneOffset);
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
      conn.encrypted = data.encrypted;
      conn.supportAuthChangesAck = data.supportAuthChangesAck;

      const c_LR = constants.LICENSE_RESULT;
      conn.licenseType = c_LR.Success;
      let isLiveViewer = utils.isLiveViewer(conn);
      if (!conn.user.view || isLiveViewer) {
        //todo
        let licenseType = conn.licenseType = yield* _checkLicenseAuth(ctx, licenseInfo, conn.user.idOriginal, isLiveViewer);
        if (c_LR.Success !== licenseType && c_LR.SuccessLimit !== licenseType) {
          conn.user.view = true;
          delete conn.coEditingMode;
        } else {
          //don't check IsAnonymousUser via jwt because substituting it doesn't lead to any trouble
          yield* updateEditUsers(ctx, licenseInfo, conn.user.idOriginal, !!data.IsAnonymousUser, isLiveViewer);
        }
      }

      let cmd = null;
      if (data.openCmd) {
        cmd = new commonDefines.InputCommand(data.openCmd);
        cmd.fillFromConnection(conn);
        cmd.setWithAuthorization(true);
      }

      // Ситуация, когда пользователь уже отключен от совместного редактирования
      if (bIsRestore && data.isCloseCoAuthoring) {
        conn.sessionId = data.sessionId;//restore old
        // Удаляем предыдущие соединения
        connections = _.reject(connections, function(el) {
          return el.sessionId === data.sessionId;//Delete this connection
        });
        //closing could happen during async action
        if (constants.CONN_CLOSED !== conn.conn.readyState) {
          // Кладем в массив, т.к. нам нужно отправлять данные для открытия/сохранения документа
          connections.push(conn);
          yield addPresence(ctx, conn, true);
          // Посылаем формальную авторизацию, чтобы подтвердить соединение
          yield* sendAuthInfo(ctx, conn, bIsRestore, undefined);
          if (cmd) {
            yield canvasService.openDocument(ctx, conn, cmd, upsertRes, bIsRestore);
          }
        }
        return;
      }
      let result = yield taskResult.select(ctx, docId);
      let resultRow = result.length > 0 ? result[0] : null;
      if (cmd && resultRow && resultRow.callback) {
        let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(ctx, resultRow.callback, curIndexUser);
        let wopiParams = wopiClient.parseWopiCallback(ctx, userAuthStr, resultRow.callback);
        cmd.setWopiParams(wopiParams);
        if (wopiParams) {
          documentCallback = null;
          if (!wopiParams.userAuth || !wopiParams.commonInfo) {
            yield* sendFileErrorAuth(ctx, conn, data.sessionId, `invalid wopi callback (maybe postgres<9.5) ${JSON.stringify(wopiParams)}`);
            return;
          }
        }
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
          // Все хорошо, статус обновлять не нужно
        } else if (commonDefines.FileStatus.SaveVersion === status ||
          (!bIsRestore && commonDefines.FileStatus.UpdateVersion === status &&
          Date.now() - result[0]['status_info'] * 60000 > cfgExpUpdateVersionStatus)) {
          let newStatus = commonDefines.FileStatus.Ok;
          if (commonDefines.FileStatus.UpdateVersion === status) {
            ctx.logger.warn("UpdateVersion expired");
            //FileStatus.None to open file again from new url
            newStatus = commonDefines.FileStatus.None;
          }
          // Обновим статус файла (идет сборка, нужно ее остановить)
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
        } else if (bIsRestore && commonDefines.FileStatus.UpdateVersion === status) {
          // error version
          yield* sendFileErrorAuth(ctx, conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
          return;
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
          // Останавливаем сборку (вдруг она началась)
          // Когда переподсоединение, нам нужна проверка на сборку файла
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
              // Проверяем lock-и
              var arrayBlocks = data['block'];
              var getLockRes = yield* getLock(ctx, conn, data, true);
              if (arrayBlocks && (0 === arrayBlocks.length || getLockRes)) {
                yield* authRestore(ctx, conn, data.sessionId);
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
        const endAuthRes = yield* endAuth(ctx, conn, false, documentCallback, canvasService.getOpenedAt(resultRow));
        if (endAuthRes && cmd) {
          yield canvasService.openDocument(ctx, conn, cmd, upsertRes, bIsRestore);
        }
      }
    }
  }

  function* endAuth(ctx, conn, bIsRestore, documentCallback, opt_openedAt) {
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
    // Отправляем на внешний callback только для тех, кто редактирует
    if (!tmpUser.view) {
      const userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
      const userAction = new commonDefines.OutputAction(commonDefines.c_oAscUserAction.In, tmpUser.idOriginal);
      let callback = yield* sendStatusDocument(ctx, docId, c_oAscChangeBase.No, userAction, userIndex, documentCallback, conn.baseUrl);
      if (!callback && !bIsRestore) {
        //check forgotten file
        let forgotten = yield storage.listObjects(ctx, docId, cfgForgottenFiles);
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
      // Ставим lock на документ
      const lockRes = yield editorData.lockAuth(ctx, docId, firstParticipantNoView.id, 2 * cfgExpLockDoc);
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
      // Для view не ждем снятия lock-а
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
    yield* publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participantsMap, waitAuthUserId: waitAuthUserId}, docId, tmpUser.id);
    return res;
  }

  function* saveErrorChanges(ctx, docId, destDir) {
    let index = 0;
    let indexChunk = 1;
    let changes;
    let changesPrefix = destDir + '/' + constants.CHANGES_NAME + '/' + constants.CHANGES_NAME + '.json.';
    do {
      changes = yield sqlBase.getChangesPromise(ctx, docId, index, index + cfgMaxRequestChanges);
      if (changes.length > 0) {
        let buffer;
        if (cfgEditor['binaryChanges']) {
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
        yield storage.putObject(ctx, changesPrefix + (indexChunk++).toString().padStart(3, '0'), buffer, buffer.length, cfgErrorFiles);
      }
      index += cfgMaxRequestChanges;
    } while (changes && cfgMaxRequestChanges === changes.length);
  }

  function sendAuthChangesByChunks(ctx, changes, connections) {
    return co(function* () {
      let startIndex = 0;
      let endIndex = 0;
      while (endIndex < changes.length) {
        startIndex = endIndex;
        let curBytes = 0;
        for (; endIndex < changes.length && curBytes < cfgWebsocketMaxPayloadSize; ++endIndex) {
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
    let index = 0;
    let changes;
    do {
      let objChangesDocument = yield getDocumentChanges(ctx, docId, index, index + cfgMaxRequestChanges);
      changes = objChangesDocument.arrChanges;
      yield sendAuthChangesByChunks(ctx, changes, connections);
      connections = connections.filter((conn) => {
        return constants.CONN_CLOSED !== conn.readyState;
      });
      index += cfgMaxRequestChanges;
    } while (connections.length > 0 && changes && cfgMaxRequestChanges === changes.length);
  }
  function* sendAuthInfo(ctx, conn, bIsRestore, participantsMap, opt_hasForgotten, opt_openedAt) {
    const docId = conn.docId;
    let docLock;
    if(EditorTypes.document == conn.editorType){
      docLock = {};
      let elem;
      const allLocks = yield* getAllLocks(ctx, docId);
      for(let i = 0 ; i < allLocks.length; ++i) {
        elem = allLocks[i];
        docLock[elem.block] = elem;
      }
    } else {
      docLock = yield* getAllLocks(ctx, docId);
    }
    let allMessages = yield editorData.getMessages(ctx, docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
    let sessionToken;
    if (cfgTokenEnableBrowser && !bIsRestore) {
      sessionToken = yield fillJwtByConnection(ctx, conn);
    }
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
      g_cAscSpellCheckUrl: cfgEditor["spellcheckerUrl"],
      buildVersion: commonDefines.buildVersion,
      buildNumber: commonDefines.buildNumber,
      licenseType: conn.licenseType,
      settings: cfgEditor,
      openedAt: opt_openedAt
    };
    sendData(ctx, conn, sendObject);//Or 0 if fails
  }

  function* onMessage(ctx, conn, data) {
    if (false === conn.permissions.chat) {
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
    yield* publish(ctx, {type: commonDefines.c_oPublishType.message, ctx: ctx, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* onCursor(ctx, conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {cursor: data.cursor, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal};

    ctx.logger.info("send cursor: %s", msg);

    var messages = [msg];
    yield* publish(ctx, {type: commonDefines.c_oPublishType.cursor, ctx: ctx, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* getLock(ctx, conn, data, bIsRestore) {
    ctx.logger.info("getLock");
    var fLock = null;
    switch (conn.editorType) {
      case EditorTypes.document:
        // Word
        fLock = getLockWord;
        break;
      case EditorTypes.spreadsheet:
        // Excel
        fLock = getLockExcel;
        break;
      case EditorTypes.presentation:
        // PP
        fLock = getLockPresentation;
        break;
    }
    return fLock ? yield* fLock(ctx, conn, data, bIsRestore) : false;
  }

  function* getLockWord(ctx, conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLock(ctx, docId, arrayBlocks);
    var documentLocks = checkRes.documentLocks;
    if (checkRes.res) {
      //Ok. take lock
      var toCache = [];
      for (i = 0; i < arrayBlocks.length; ++i) {
        var block = arrayBlocks[i];
        var elem = {time: Date.now(), user: userId, block: block};
        documentLocks[block] = elem;
        toCache.push(elem);
      }
      yield editorData.addLocks(ctx, docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(ctx, conn, {type: "getLock", locks: documentLocks});
    yield* publish(ctx, {type: commonDefines.c_oPublishType.getLock, ctx: ctx, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  // Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
  function* getLockExcel(ctx, conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLockExcel(ctx, docId, arrayBlocks, userId);
    var documentLocks = checkRes.documentLocks;
    if (checkRes.res) {
      //Ok. take lock
      var toCache = [];
      for (i = 0; i < arrayBlocks.length; ++i) {
        var block = arrayBlocks[i];
        var elem = {time: Date.now(), user: userId, block: block};
        documentLocks.push(elem);
        toCache.push(elem);
      }
      yield editorData.addLocks(ctx, docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(ctx, conn, {type: "getLock", locks: documentLocks});
    yield* publish(ctx, {type: commonDefines.c_oPublishType.getLock, ctx: ctx, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  // Для презентаций это объект { type, val } или { type, slideId, objId }
  function* getLockPresentation(ctx, conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLockPresentation(ctx, docId, arrayBlocks, userId);
    var documentLocks = checkRes.documentLocks;
    if (checkRes.res) {
      //Ok. take lock
      var toCache = [];
      for (i = 0; i < arrayBlocks.length; ++i) {
        var block = arrayBlocks[i];
        var elem = {time: Date.now(), user: userId, block: block};
        documentLocks.push(elem);
        toCache.push(elem);
      }
      yield editorData.addLocks(ctx, docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(ctx, conn, {type: "getLock", locks: documentLocks});
    yield* publish(ctx, {type: commonDefines.c_oPublishType.getLock, ctx: ctx, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  function sendGetLock(ctx, participants, documentLocks) {
    _.each(participants, function(participant) {
      sendData(ctx, participant, {type: "getLock", locks: documentLocks});
    });
  }

  // Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
  function* saveChanges(ctx, conn, data) {
    const docId = conn.docId, userId = conn.user.id;
    ctx.logger.info("Start saveChanges: reSave: %s", data.reSave);

    let lockRes = yield editorData.lockSave(ctx, docId, userId, cfgExpSaveLock);
    if (!lockRes) {
      //should not be here. cfgExpSaveLock - 60sec, sockjs disconnects after 25sec
      ctx.logger.warn("saveChanges lockSave error");
      return;
    }

    let puckerIndex = yield* getChangesIndex(ctx, docId);

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

    // Стартовый индекс изменения при добавлении
    const startIndex = puckerIndex;

    const newChanges = cfgEditor['binaryChanges'] ? data.changes : JSON.parse(data.changes);
    let newChangesLastDate = new Date();
    newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding
    let newChangesLastTime = newChangesLastDate.getTime();
    let arrNewDocumentChanges = [];
    ctx.logger.info("saveChanges: deleteIndex: %s ; startIndex: %s ; length: %s", deleteIndex, startIndex, newChanges.length);
    if (0 < newChanges.length) {
      let oElement = null;

      for (let i = 0; i < newChanges.length; ++i) {
        oElement = newChanges[i];
        let change = cfgEditor['binaryChanges'] ? oElement : JSON.stringify(oElement);
        arrNewDocumentChanges.push({docid: docId, change: change, time: newChangesLastDate,
          user: userId, useridoriginal: conn.user.idOriginal});
      }

      puckerIndex += arrNewDocumentChanges.length;
      yield sqlBase.insertChangesPromise(ctx, arrNewDocumentChanges, docId, startIndex, conn.user);
    }
    const changesIndex = (-1 === deleteIndex && data.startSaveChanges) ? startIndex : -1;
    if (data.endSaveChanges) {
      // Для Excel нужно пересчитать индексы для lock-ов
      if (data.isExcel && false !== data.isCoAuthoring && data.excelAdditionalInfo) {
        const tmpAdditionalInfo = JSON.parse(data.excelAdditionalInfo);
        // Это мы получили recalcIndexColumns и recalcIndexRows
        const oRecalcIndexColumns = _addRecalcIndex(tmpAdditionalInfo["indexCols"]);
        const oRecalcIndexRows = _addRecalcIndex(tmpAdditionalInfo["indexRows"]);
        // Теперь нужно пересчитать индексы для lock-элементов
        if (null !== oRecalcIndexColumns || null !== oRecalcIndexRows) {
          const docLock = yield* getAllLocks(ctx, docId);
          if (_recalcLockArray(userId, docLock, oRecalcIndexColumns, oRecalcIndexRows)) {
            let toCache = [];
            for (let i = 0; i < docLock.length; ++i) {
              toCache.push(docLock[i]);
            }
            yield editorData.removeLocks(ctx, docId);
            yield editorData.addLocks(ctx, docId, toCache);
          }
        }
      }

      let userLocks = [];
      if (data.releaseLocks) {
		  //Release locks
		  userLocks = yield* removeUserLocks(ctx, docId, userId);
      }
      // Для данного пользователя снимаем Lock с документа, если пришел флаг unlock
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
        if(changesToSend.length > cfgPubSubMaxChanges) {
          changesToSend = null;
        } else {
          changesToSend.forEach((value) => {
            value.time = value.time.getTime();
          })
        }
        yield* publish(ctx, {type: commonDefines.c_oPublishType.changes, ctx: ctx, docId: docId, userId: userId,
          changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
          locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo, endSaveChanges: data.endSaveChanges}, docId, userId);
      }
      // Автоматически снимаем lock сами и посылаем индекс для сохранения
      yield* unSaveLock(ctx, conn, changesIndex, newChangesLastTime);
      //last save
      let changeInfo = getExternalChangeInfo(conn.user, newChangesLastTime);
      yield resetForceSaveAfterChanges(ctx, docId, newChangesLastTime, puckerIndex, utils.getBaseUrlByConnection(conn), changeInfo);
    } else {
      let changesToSend = arrNewDocumentChanges;
      if(changesToSend.length > cfgPubSubMaxChanges) {
        changesToSend = null;
      } else {
        changesToSend.forEach((value) => {
          value.time = value.time.getTime();
        })
      }
      let isPublished = yield* publish(ctx, {type: commonDefines.c_oPublishType.changes, ctx: ctx, docId: docId, userId: userId,
        changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
        locks: [], excelAdditionalInfo: undefined, endSaveChanges: data.endSaveChanges}, docId, userId);
      sendData(ctx, conn, {type: 'savePartChanges', changesIndex: changesIndex});
      if (!isPublished) {
        //stub for lockDocumentsTimerId
        yield* publish(ctx, {type: commonDefines.c_oPublishType.changesNotify, ctx: ctx, docId: docId});
      }
    }
  }

  // Можем ли мы сохранять ?
  function* isSaveLock(ctx, conn) {
    let lockRes = yield editorData.lockSave(ctx, conn.docId, conn.user.id, cfgExpSaveLock);
    ctx.logger.debug("isSaveLock lockRes: %s", lockRes);

    // Отправляем только тому, кто спрашивал (всем отправлять нельзя)
    sendData(ctx, conn, {type: "saveLock", saveLock: !lockRes});
  }

  // Снимаем лок с сохранения
  function* unSaveLock(ctx, conn, index, time) {
    var unlockRes = yield editorData.unlockSave(ctx, conn.docId, conn.user.id);
    if (commonDefines.c_oAscUnlockRes.Locked !== unlockRes) {
      sendData(ctx, conn, {type: 'unSaveLock', index: index, time: time});
    } else {
      ctx.logger.warn("unSaveLock failure");
    }
  }

  // Возвращаем все сообщения для документа
  function* getMessages(ctx, conn) {
    let allMessages = yield editorData.getMessages(ctx, conn.docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
    sendDataMessage(ctx, conn, allMessages);
  }

  function* _checkLock(ctx, docId, arrayBlocks) {
    // Data is array now
    var isLock = false;
    var allLocks = yield* getAllLocks(ctx, docId);
    var documentLocks = {};
    for(var i = 0 ; i < allLocks.length; ++i) {
      var elem = allLocks[i];
      documentLocks[elem.block] =elem;
    }
    if (arrayBlocks.length > 0) {
      for (var i = 0; i < arrayBlocks.length; ++i) {
        var block = arrayBlocks[i];
        ctx.logger.info("getLock id: %s", block);
        if (documentLocks.hasOwnProperty(block) && documentLocks[block] !== null) {
          isLock = true;
          break;
        }
      }
    } else {
      isLock = true;
    }
    return {res: !isLock, documentLocks: documentLocks};
  }

  function* _checkLockExcel(ctx, docId, arrayBlocks, userId) {
    // Data is array now
    var documentLock;
    var isLock = false;
    var isExistInArray = false;
    var i, blockRange;
    var documentLocks = yield* getAllLocks(ctx, docId);
    var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
    for (i = 0; i < lengthArray && false === isLock; ++i) {
      blockRange = arrayBlocks[i];
      for (var keyLockInArray in documentLocks) {
        if (true === isLock) {
          break;
        }
        if (!documentLocks.hasOwnProperty(keyLockInArray)) {
          continue;
        }
        documentLock = documentLocks[keyLockInArray];
        // Проверка вхождения объекта в массив (текущий пользователь еще раз прислал lock)
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
          // Если текущий пользователь прислал lock текущего листа, то не заносим в массив, а если нового, то заносим
          if (documentLock.user === userId) {
            if (blockRange.sheetId === documentLock.block.sheetId) {
              // уже есть в массиве
              isExistInArray = true;
              break;
            } else {
              // новый лист
              continue;
            }
          } else {
            // Если кто-то залочил sheet, то больше никто не может лочить sheet-ы (иначе можно удалить все листы)
            isLock = true;
            break;
          }
        }

        if (documentLock.user === userId || !(documentLock.block) ||
          blockRange.sheetId !== documentLock.block.sheetId) {
          continue;
        }
        isLock = compareExcelBlock(blockRange, documentLock.block);
      }
    }
    if (0 === lengthArray) {
      isLock = true;
    }
    return {res: !isLock && !isExistInArray, documentLocks: documentLocks};
  }

  function* _checkLockPresentation(ctx, docId, arrayBlocks, userId) {
    // Data is array now
    var isLock = false;
    var i, documentLock, blockRange;
    var documentLocks = yield* getAllLocks(ctx, docId);
    var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
    for (i = 0; i < lengthArray && false === isLock; ++i) {
      blockRange = arrayBlocks[i];
      for (var keyLockInArray in documentLocks) {
        if (true === isLock) {
          break;
        }
        if (!documentLocks.hasOwnProperty(keyLockInArray)) {
          continue;
        }
        documentLock = documentLocks[keyLockInArray];

        if (documentLock.user === userId || !(documentLock.block)) {
          continue;
        }
        isLock = comparePresentationBlock(blockRange, documentLock.block);
      }
    }
    if (0 === lengthArray) {
      isLock = true;
    }
    return {res: !isLock, documentLocks: documentLocks};
  }

	function _checkLicense(ctx, conn) {
		return co(function* () {
			try {
				ctx.logger.info('_checkLicense start');
				let rights = constants.RIGHTS.Edit;
				if (config.get('server.edit_singleton')) {
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

				let licenseInfo = yield tenantManager.getTenantLicense(ctx);

				sendData(ctx, conn, {
					type: 'license', license: {
						type: licenseInfo.type,
						light: licenseInfo.light,
						mode: licenseInfo.mode,
						rights: rights,
						buildVersion: commonDefines.buildVersion,
						buildNumber: commonDefines.buildNumber,
						protectionSupport: cfgOpenProtectedFile, //todo find a better place
						liveViewerSupport: utils.isLiveViewerSupport(licenseInfo),
						branding: licenseInfo.branding,
						customization: licenseInfo.customization,
						advancedApi: licenseInfo.advancedApi,
						plugins: licenseInfo.plugins
					}
				});
				ctx.logger.info('_checkLicense end');
			} catch (err) {
				ctx.logger.error('_checkLicense error: %s', err.stack);
			}
		});
	}

  function* _checkLicenseAuth(ctx, licenseInfo, userId, isLiveViewer) {
    let licenseWarningLimitUsers = false;
    let licenseWarningLimitUsersView = false;
    let licenseWarningLimitConnections = false;
    let licenseWarningLimitConnectionsLive = false;
    const c_LR = constants.LICENSE_RESULT;
    let licenseType = licenseInfo.type;
    if (c_LR.Success === licenseType || c_LR.SuccessLimit === licenseType) {
      if (licenseInfo.usersCount) {
        const nowUTC = getLicenseNowUtc();
        if(isLiveViewer) {
          const arrUsers = yield editorData.getPresenceUniqueViewUser(ctx, nowUTC);
          if (arrUsers.length >= licenseInfo.usersViewCount && (-1 === arrUsers.findIndex((element) => {return element.userid === userId}))) {
            licenseType = c_LR.UsersViewCount;
          }
          licenseWarningLimitUsersView = licenseInfo.usersViewCount * cfgWarningLimitPercents <= arrUsers.length;
        } else {
          const arrUsers = yield editorData.getPresenceUniqueUser(ctx, nowUTC);
          if (arrUsers.length >= licenseInfo.usersCount && (-1 === arrUsers.findIndex((element) => {return element.userid === userId}))) {
            licenseType = c_LR.UsersCount;
          }
          licenseWarningLimitUsers = licenseInfo.usersCount * cfgWarningLimitPercents <= arrUsers.length;
        }
      } else if(isLiveViewer) {
        const connectionsLiveCount = licenseInfo.connectionsView;
        const liveViewerConnectionsCount = yield editorData.getLiveViewerConnectionsCount(ctx, connections);
        if (liveViewerConnectionsCount >= connectionsLiveCount) {
          licenseType = c_LR.ConnectionsLive;
        }
        licenseWarningLimitConnectionsLive = connectionsLiveCount * cfgWarningLimitPercents <= liveViewerConnectionsCount;
      } else {
        const connectionsCount = licenseInfo.connections;
        const editConnectionsCount = yield editorData.getEditorConnectionsCount(ctx, connections);
        if (editConnectionsCount >= connectionsCount) {
          licenseType = c_LR.Connections;
        }
        licenseWarningLimitConnections = connectionsCount * cfgWarningLimitPercents <= editConnectionsCount;
      }
    }

    if (c_LR.UsersCount === licenseType) {
      if (!licenseInfo.hasLicense) {
        licenseType = c_LR.UsersCountOS;
      }
      ctx.logger.error('License: User limit exceeded!!!');
    } else if (c_LR.UsersViewCount === licenseType) {
        if (!licenseInfo.hasLicense) {
          licenseType = c_LR.UsersViewCountOS;
        }
        ctx.logger.error('License: User Live Viewer limit exceeded!!!');
    } else if (c_LR.Connections === licenseType) {
      if (!licenseInfo.hasLicense) {
        licenseType = c_LR.ConnectionsOS;
      }
      ctx.logger.error('License: Connection limit exceeded!!!');
    } else if (c_LR.ConnectionsLive === licenseType) {
      if (!licenseInfo.hasLicense) {
        licenseType = c_LR.ConnectionsLiveOS;
      }
      ctx.logger.error('License: Connection Live Viewer limit exceeded!!!');
    } else {
      if (licenseWarningLimitUsers) {
        ctx.logger.warn('License: Warning User limit exceeded!!!');
      }
      if (licenseWarningLimitUsersView) {
        ctx.logger.warn('License: Warning User Live Viewer limit exceeded!!!');
      }
      if (licenseWarningLimitConnections) {
        ctx.logger.warn('License: Warning Connection limit exceeded!!!');
      }
      if (licenseWarningLimitConnectionsLive) {
        ctx.logger.warn('License: Warning Connection Live Viewer limit exceeded!!!');
      }
    }
    return licenseType;
  }

  //publish subscribe message brocker
  function pubsubOnMessage(msg) {
    return co(function* () {
      let ctx = new operationContext.Context();
      try {
        var data = JSON.parse(msg);
        ctx.initFromPubSub(data);
        ctx.logger.debug('pubsub message start:%s', msg);
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
            closeUsersConnection(data.docId, data.usersMap, data.isOriginalId, data.code, data.description);
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
                  changesIndex: data.changesIndex, endSaveChanges:  data.endSaveChanges,
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
                if (0 == data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrls(ctx, participant.baseUrl, data.needUrlKey, data.needUrlType, data.creationDate));
                } else if (1 == data.needUrlMethod) {
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
            ctx.logger.warn('start shutdown:%b', shutdownFlag);
            if (shutdownFlag) {
              ctx.logger.warn('active connections: %d', connections.length);
              //не останавливаем сервер, т.к. будут недоступны сокеты и все запросы
              //плохо тем, что может понадобится конвертация выходного файла и то что не будут обработаны запросы на CommandService
              //server.close();
              //in the cycle we will remove elements so copy array
              var connectionsTmp = connections.slice();
              //destroy all open connections
              for (i = 0; i < connectionsTmp.length; ++i) {
                connectionsTmp[i].close(constants.SHUTDOWN_CODE, constants.SHUTDOWN_REASON);
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
                if (cfgTokenEnableBrowser) {
                  let sessionToken = yield fillJwtByConnection(ctx, participant);
                  sendDataRefreshToken(ctx, participant, sessionToken);
                }
              }
            }
            if (hasChanges) {
              let participants = yield getParticipantMap(ctx, data.docId);
              let participantsTimestamp = Date.now();
              yield* publish(ctx, {type: commonDefines.c_oPublishType.participantsState, ctx: ctx, docId: data.docId, userId: null, participantsTimestamp: participantsTimestamp, participants: participants});
            }
            break;
          case commonDefines.c_oPublishType.rpc:
            participants = getParticipants(data.docId, true, data.userId, true);
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
    yield editorData.setEditorConnections(ctx, countEdit, countLiveView, countView, now, PRECISION);
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
        var maxMs = nowMs + Math.max(cfgExpSessionCloseCommand, expDocumentsStep);
        for (var i = 0; i < connections.length; ++i) {
          var conn = connections[i];
          ctx.initFromConnection(conn);
          let tenant = tenants[ctx.tenant];
          if (!tenant) {
            tenant = tenants[ctx.tenant] = {countEditByShard: 0, countLiveViewByShard: 0, countViewByShard: 0};
          }
          //wopi access_token_ttl;
          if (cfgExpSessionAbsolute > 0 || conn.access_token_ttl) {
            if ((cfgExpSessionAbsolute > 0 && maxMs - conn.sessionTimeConnect > cfgExpSessionAbsolute ||
              (conn.access_token_ttl && maxMs > conn.access_token_ttl)) && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(ctx, conn, {
                code: constants.SESSION_ABSOLUTE_CODE,
                reason: constants.SESSION_ABSOLUTE_REASON
              });
            } else if (nowMs - conn.sessionTimeConnect > cfgExpSessionAbsolute) {
              ctx.logger.debug('expireDoc close absolute session');
              conn.disconnect(constants.SESSION_ABSOLUTE_CODE, constants.SESSION_ABSOLUTE_REASON);              continue;
            }
          }
          if (cfgExpSessionIdle > 0 && !(conn.user?.view || conn.isCloseCoAuthoring)) {
            if (maxMs - conn.sessionTimeLastAction > cfgExpSessionIdle && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(ctx, conn, {
                code: constants.SESSION_IDLE_CODE,
                reason: constants.SESSION_IDLE_REASON,
                interval: cfgExpSessionIdle
              });
            } else if (nowMs - conn.sessionTimeLastAction > cfgExpSessionIdle) {
              ctx.logger.debug('expireDoc close idle session');
              conn.disconnect(constants.SESSION_IDLE_CODE, constants.SESSION_IDLE_REASON);              continue;
            }
          }
          if (constants.CONN_CLOSED === conn.conn.readyState) {
            ctx.logger.error('expireDoc connection closed');
          }
          yield addPresence(ctx, conn, false);
          if (utils.isLiveViewer(conn)) {
            tenant.countLiveViewByShard++;
          } else if(conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
            tenant.countViewByShard++;
          } else {
            tenant.countEditByShard++;
          }
        }
        for (let tenantId in tenants) {
          if(tenants.hasOwnProperty(tenantId)) {
            ctx.setTenant(tenantId);
            let tenant = tenants[tenantId];
            yield* collectStats(ctx, tenant.countEditByShard, tenant.countLiveViewByShard, tenant.countViewByShard);
            yield editorData.setEditorConnectionsCountByShard(ctx, SHARD_ID, tenant.countEditByShard);
            yield editorData.setLiveViewerConnectionsCountByShard(ctx, SHARD_ID, tenant.countLiveViewByShard);
            yield editorData.setViewerConnectionsCountByShard(ctx, SHARD_ID, tenant.countViewByShard);
            if (clientStatsD) {
              //todo with multitenant
              let countEdit = yield editorData.getEditorConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.edit', countEdit);
              let countLiveView = yield editorData.getLiveViewerConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.liveview', countLiveView);
              let countView = yield editorData.getViewerConnectionsCount(ctx, connections);
              clientStatsD.gauge('expireDoc.connections.view', countView);
            }
          }
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

      let tableName = cfgTableResult;
      const tableRequiredColumn = 'tenant';
      //check data base compatibility
      sqlBase.getTableColumns(operationContext.global, tableName).then(function(res) {
        let index = res.findIndex((currentValue) => {
          for (let key in currentValue) {
            if (currentValue.hasOwnProperty(key) && 'column_name' === key.toLowerCase()) {
              return tableRequiredColumn === currentValue[key];
            }
          }
        });
        if (-1 !== index || 0 === res.length) {
          callbackFunction();
        } else {
          operationContext.global.logger.error('DB table "%s" does not contain %s column, columns info: %j', tableName, tableRequiredColumn, res);
        }
      }).catch(err => {
        operationContext.global.logger.error('getTableColumns error: %s', err.stack);
      });

    });
  });
};
exports.setLicenseInfo = function(data, original ) {
  tenantManager.setDefLicense(data, original);
};
exports.healthCheck = function(req, res) {
  return co(function*() {
    let output = false;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      ctx.logger.debug('healthCheck start');
      let promises = [];
      //database
      promises.push(sqlBase.healthCheck(ctx));
      //redis
      if (editorData.isConnected()) {
        promises.push(editorData.ping());
        yield Promise.all(promises);
      } else {
        throw new Error('redis disconnected');
      }
      //rabbitMQ
      if (commonDefines.c_oAscQueueType.rabbitmq === cfgQueueType) {
        let conn = yield rabbitMQCore.connetPromise(false, function() {});
        yield rabbitMQCore.closePromise(conn);
      } else {
        let conn = yield activeMQCore.connetPromise(false, function() {});
        yield activeMQCore.closePromise(conn);
      }
      //storage
      const clusterId = cluster.isWorker ? cluster.worker.id : '';
      const tempName = 'hc_' + os.hostname() + '_' + clusterId + '_' + Math.round(Math.random() * HEALTH_CHECK_KEY_MAX);
      const tempBuffer = Buffer.from([1, 2, 3, 4, 5]);
      //It's proper to putObject one tempName
      yield storage.putObject(ctx, tempName, tempBuffer, tempBuffer.length);
      try {
        //try to prevent case, when another process can remove same tempName
        yield storage.deleteObject(ctx, tempName);
      } catch (err) {
        ctx.logger.warn('healthCheck error %s', err.stack);
      }

      output = true;
      ctx.logger.debug('healthCheck end');
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
    let output = {
      connectionsStat: {}, licenseInfo: {}, serverInfo: {
        buildVersion: commonDefines.buildVersion, buildNumber: commonDefines.buildNumber,
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
      ctx.logger.debug('licenseInfo start');

      let licenseInfo = yield tenantManager.getTenantLicense(ctx);
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
      var redisRes = yield editorData.getEditorConnections(ctx);
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
      execRes = yield editorData.getPresenceUniqueUser(ctx, nowUTC);
      output.quota.edit.connectionsCount = yield editorData.getEditorConnectionsCount(ctx, connections);
      output.quota.edit.usersCount.unique = execRes.length;
      execRes.forEach(function(elem) {
        if (elem.anonym) {
          output.quota.edit.usersCount.anonymous++;
        }
      });

      execRes = yield editorData.getPresenceUniqueViewUser(ctx, nowUTC);
      output.quota.view.connectionsCount = yield editorData.getLiveViewerConnectionsCount(ctx, connections);
      output.quota.view.usersCount.unique = execRes.length;
      execRes.forEach(function(elem) {
        if (elem.anonym) {
          output.quota.view.usersCount.anonymous++;
        }
      });

      let byMonth = yield editorData.getPresenceUniqueUsersOfMonth(ctx);
      let byMonthView = yield editorData.getPresenceUniqueViewUsersOfMonth(ctx);
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
let commandLicense = co.wrap(function*(ctx) {
  const nowUTC = getLicenseNowUtc();
  let users = yield editorData.getPresenceUniqueUser(ctx, nowUTC);
  let users_view = yield editorData.getPresenceUniqueViewUser(ctx, nowUTC);
  let licenseInfo = yield tenantManager.getTenantLicense(ctx);
  return {
    license: utils.convertLicenseInfoToFileParams(licenseInfo),
    server: utils.convertLicenseInfoToServerParams(licenseInfo),
    quota: {users: users, users_view: users_view}
  };
});
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (req, res) {
  return co(function* () {
    let result = commonDefines.c_oAscServerCommandErrors.NoError;
    let docId = 'commandFromServer';
    let version = undefined;
    let outputLicense = undefined;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      ctx.logger.info('commandFromServer start');
      let authRes = yield getRequestParams(ctx, req);
      let params = authRes.params;
      if(authRes.code === constants.VKEY_KEY_EXPIRE){
        result = commonDefines.c_oAscServerCommandErrors.TokenExpire;
      } else if(authRes.code !== constants.NO_ERROR){
        result = commonDefines.c_oAscServerCommandErrors.Token;
      }
      // Ключ id-документа
      docId = params.key;
      ctx.setDocId(docId);
      if (commonDefines.c_oAscServerCommandErrors.NoError === result && null == docId && 'version' !== params.c && 'license' !== params.c) {
        result = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
      } else if(commonDefines.c_oAscServerCommandErrors.NoError === result) {
        ctx.logger.debug('commandFromServer: c = %s', params.c);
        switch (params.c) {
          case 'info':
            //If no files in the database means they have not been edited.
            const selectRes = yield taskResult.select(ctx, docId);
            if (selectRes.length > 0) {
              result = yield* bindEvents(ctx, docId, params.callback, utils.getBaseUrlByRequest(req), undefined, params.userdata);
            } else {
              result = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
            }
            break;
          case 'drop':
            if (params.userid) {
              yield* publish(ctx, {type: commonDefines.c_oPublishType.drop, ctx: ctx, docId: docId, users: [params.userid], description: params.description});
            } else if (params.users) {
              const users = (typeof params.users === 'string') ? JSON.parse(params.users) : params.users;
              yield* dropUsersFromDocument(ctx, docId, users);
            } else {
              result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            }
            break;
          case 'saved':
            // Результат от менеджера документов о статусе обработки сохранения файла после сборки
            if ('1' !== params.status) {
              //запрос saved выполняется синхронно, поэтому заполняем переменную чтобы проверить ее после sendServerRequest
              yield editorData.setSaved(ctx, docId, params.status);
              ctx.logger.warn('saved corrupted id = %s status = %s conv = %s', docId, params.status, params.conv);
            } else {
              ctx.logger.info('saved id = %s status = %s conv = %s', docId, params.status, params.conv);
            }
            break;
          case 'forcesave':
            let forceSaveRes = yield startForceSave(ctx, docId, commonDefines.c_oAscForceSaveTypes.Command, params.userdata, undefined, undefined, undefined, undefined, utils.getBaseUrlByRequest(req));
            result = forceSaveRes.code;
            break;
          case 'meta':
            if (params.meta) {
              yield* publish(ctx, {type: commonDefines.c_oPublishType.meta, ctx: ctx, docId: docId, meta: params.meta});
            } else {
              result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            }
            break;
          case 'version':
              version = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
            break;
          case 'license':
              outputLicense = yield commandLicense(ctx);
            break;
          default:
            result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            break;
        }
      }
    } catch (err) {
      result = commonDefines.c_oAscServerCommandErrors.UnknownError;
      ctx.logger.error('Error commandFromServer: %s', err.stack);
    } finally {
      //undefined value are excluded in JSON.stringify
      let output = {'key': docId, 'error': result, 'version': version};
      if (outputLicense) {
        Object.assign(output, outputLicense);
      }
      const outputBuffer = Buffer.from(JSON.stringify(output), 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', outputBuffer.length);
      res.send(outputBuffer);
      ctx.logger.info('commandFromServer end : %j', output);
    }
  });
};

exports.shutdown = function(req, res) {
  return co(function*() {
    let output = false;
    let ctx = new operationContext.Context();
    try {
      ctx.initFromRequest(req);
      ctx.logger.info('shutdown start');
      output = yield shutdown.shutdown(ctx, editorData, req.method === 'PUT');
    } catch (err) {
      ctx.logger.error('shutdown error %s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/plain');
      res.send(output.toString());
      ctx.logger.info('shutdown end');
    }
  });
};
