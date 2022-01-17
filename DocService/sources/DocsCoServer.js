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

const sockjs = require('sockjs');
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

const editorDataStorage = require('./' + configCommon.get('services.CoAuthoring.server.editorDataStorage'));
let cfgEditor = JSON.parse(JSON.stringify(config.get('editor')));
cfgEditor['reconnection']['delay'] = ms(cfgEditor['reconnection']['delay']);
cfgEditor['websocketMaxPayloadSize'] = bytes.parse(cfgEditor['websocketMaxPayloadSize']);
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
const cfgSockjs = config.get('sockjs');
const cfgTokenEnableBrowser = config.get('token.enable.browser');
const cfgTokenEnableRequestInbox = config.get('token.enable.request.inbox');
const cfgTokenSessionAlgorithm = config.get('token.session.algorithm');
const cfgTokenSessionExpires = ms(config.get('token.session.expires'));
const cfgTokenInboxHeader = config.get('token.inbox.header');
const cfgTokenInboxPrefix = config.get('token.inbox.prefix');
const cfgTokenInboxInBody = config.get('token.inbox.inBody');
const cfgTokenOutboxInBody = config.get('token.outbox.inBody');
const cfgTokenBrowserSecretFromInbox = config.get('token.browser.secretFromInbox');
const cfgTokenVerifyOptions = config.get('token.verifyOptions');
const cfgSecretBrowser = config.get('secret.browser');
const cfgSecretInbox = config.get('secret.inbox');
const cfgSecretSession = config.get('secret.session');
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
let licenseInfo = {type: constants.LICENSE_RESULT.Error, light: false, branding: false, customization: false, plugins: false};
let licenseOriginal = null;
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

function updatePresenceCounters(conn, val) {
  return co(function* () {
    if (conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
      yield editorData.incrViewerConnectionsCountByShard(SHARD_ID, val);
      if (clientStatsD) {
        let countView = yield editorData.getViewerConnectionsCount(connections);
        clientStatsD.gauge('expireDoc.connections.view', countView);
      }
    } else {
      yield editorData.incrEditorConnectionsCountByShard(SHARD_ID, val);
      if (clientStatsD) {
        let countEditors = yield editorData.getEditorConnectionsCount(connections);
        clientStatsD.gauge('expireDoc.connections.edit', countEditors);
      }
    }
  });
}
function addPresence(conn, updateCunters) {
  return co(function* () {
    yield editorData.addPresence(conn.docId, conn.user.id, utils.getConnectionInfoStr(conn));
    if (updateCunters) {
      yield updatePresenceCounters(conn, 1);
    }
  });
}
function removePresence(conn) {
  return co(function* () {
    yield editorData.removePresence(conn.docId, conn.user.id);
    yield updatePresenceCounters(conn, -1);
  });
}

let changeConnectionInfo = co.wrap(function*(conn, cmd) {
  if (!conn.denyChangeName && conn.user) {
    yield* publish({type: commonDefines.c_oPublishType.changeConnecitonInfo, docId: conn.docId, useridoriginal: conn.user.idOriginal, cmd: cmd});
    return true;
  }
  return false;
});
function signToken(payload, algorithm, expiresIn, secretElem) {
  var options = {algorithm: algorithm, expiresIn: expiresIn};
  var secret = utils.getSecretByElem(secretElem);
  return jwt.sign(payload, secret, options);
}
function fillJwtByConnection(conn) {
  var docId = conn.docId;
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
  //no standart
  edit.ds_view = conn.user.view;
  edit.ds_isCloseCoAuthoring = conn.isCloseCoAuthoring;
  edit.ds_isEnterCorrectPassword = conn.isEnterCorrectPassword;
  edit.ds_denyChangeName = conn.denyChangeName;

  return signToken(payload, cfgTokenSessionAlgorithm, cfgTokenSessionExpires / 1000, cfgSecretSession);
}

function sendData(conn, data) {
  conn.write(JSON.stringify(data));
  const type = data ? data.type : null;
  logger.debug('sendData: docId = %s;type = %s', conn.docId, type);
}
function sendDataWarning(conn, msg) {
  sendData(conn, {type: "warning", message: msg});
}
function sendDataMessage(conn, msg) {
  if (false !== conn.permissions.chat) {
    sendData(conn, {type: "message", messages: msg});
  } else {
    logger.debug("sendDataMessage permissions.chat==false: userId = %s docId = %s", conn.user && conn.user.id, conn.docId);
  }
}
function sendDataCursor(conn, msg) {
  sendData(conn, {type: "cursor", messages: msg});
}
function sendDataMeta(conn, msg) {
  sendData(conn, {type: "meta", messages: msg});
}
function sendDataSession(conn, msg) {
  sendData(conn, {type: "session", messages: msg});
}
function sendDataRefreshToken(conn) {
  sendData(conn, {type: "refreshToken", messages: fillJwtByConnection(conn)});
}
function sendDataRpc(conn, responseKey, data) {
  sendData(conn, {type: "rpc", responseKey: responseKey, data: data});
}
function sendReleaseLock(conn, userLocks) {
  sendData(conn, {type: "releaseLock", locks: _.map(userLocks, function(e) {
    return {
      block: e.block,
      user: e.user,
      time: Date.now(),
      changes: null
    };
  })});
}
function modifyConnectionForPassword(conn, isEnterCorrectPassword) {
  if (isEnterCorrectPassword) {
    conn.isEnterCorrectPassword = true;
    if (cfgTokenEnableBrowser) {
      sendDataRefreshToken(conn);
    }
  }
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


function* updateEditUsers(userId, anonym) {
  if (!licenseInfo.usersCount) {
    return;
  }
  const now = new Date();
  const expireAt = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) / 1000 +
      licenseInfo.usersExpire - 1;
  yield editorData.addPresenceUniqueUser(userId, expireAt, {anonym: anonym});
  let period = utils.getLicensePeriod(licenseInfo.startDate, now);
  yield editorData.addPresenceUniqueUsersOfMonth(userId, period, {anonym: anonym, firstOpenDate: now.toISOString()});
}
function* getEditorsCount(docId, opt_hvals) {
  var elem, editorsCount = 0;
  var hvals;
  if(opt_hvals){
    hvals = opt_hvals;
  } else {
    hvals = yield editorData.getPresence(docId, connections);
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
function* hasEditors(docId, opt_hvals) {
  let editorsCount = yield* getEditorsCount(docId, opt_hvals);
  return editorsCount > 0;
}
function* isUserReconnect(docId, userId, connectionId) {
  var elem;
  var hvals = yield editorData.getPresence(docId, connections);
  for (var i = 0; i < hvals.length; ++i) {
    elem = JSON.parse(hvals[i]);
    if (userId === elem.id && connectionId !== elem.connectionId) {
      return true;
    }
  }
  return false;
}
function* publish(data, optDocId, optUserId, opt_pubsub) {
  var needPublish = true;
  if(optDocId && optUserId) {
    needPublish = false;
    var hvals = yield editorData.getPresence(optDocId, connections);
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

function* getOriginalParticipantsId(docId) {
  var result = [], tmpObject = {};
  var hvals = yield editorData.getPresence(docId, connections);
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

function* sendServerRequest(docId, uri, dataObject, opt_checkAuthorization) {
  logger.debug('postData request: docId = %s;url = %s;data = %j', docId, uri, dataObject);
  let auth;
  if (utils.canIncludeOutboxAuthorization(uri)) {
    auth = utils.fillJwtForRequest(dataObject);
    if (cfgTokenOutboxInBody) {
      dataObject = {token: auth};
      auth = undefined;
    } else if (opt_checkAuthorization && !opt_checkAuthorization(auth, dataObject)) {
      auth = utils.fillJwtForRequest(dataObject);
      logger.warn('authorization reduced to: docId = %s; length=%d', docId, auth.length);
    }
  }
  let postRes = yield utils.postRequestPromise(uri, JSON.stringify(dataObject), undefined, cfgCallbackRequestTimeout, auth);
  logger.debug('postData response: docId = %s;data = %s', docId, postRes.body);
  return postRes.body;
}

// Парсинг ссылки
function parseUrl(callbackUrl) {
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
    logger.error("error parseUrl %s:\r\n%s", callbackUrl, e.stack);
    result = null;
  }

  return result;
}

function* getCallback(id, opt_userIndex) {
  var callbackUrl = null;
  var baseUrl = null;
  let wopiParams = null;
  var selectRes = yield taskResult.select(id);
  if (selectRes.length > 0) {
    var row = selectRes[0];
    if (row.callback) {
      callbackUrl = sqlBase.UserCallback.prototype.getCallbackByUserIndex(id, row.callback, opt_userIndex);
      wopiParams = wopiClient.parseWopiCallback(id, callbackUrl, row.callback);
    }
    if (row.baseurl) {
      baseUrl = row.baseurl;
    }
  }
  if (null != callbackUrl && null != baseUrl) {
    return {server: parseUrl(callbackUrl), baseUrl: baseUrl, wopiParams: wopiParams};
  } else {
    return null;
  }
}
function* getChangesIndex(docId) {
  var res = 0;
  var getRes = yield sqlBase.getChangesIndexPromise(docId);
  if (getRes && getRes.length > 0 && null != getRes[0]['change_id']) {
    res = getRes[0]['change_id'] + 1;
  }
  return res;
}

const hasChanges = co.wrap(function*(docId) {
  //todo check editorData.getForceSave in case of "undo all changes"
  let puckerIndex = yield* getChangesIndex(docId);
  if (0 === puckerIndex) {
    let selectRes = yield taskResult.select(docId);
    if (selectRes.length > 0 && selectRes[0].password) {
      return sqlBase.DocumentPassword.prototype.hasPasswordChanges(docId, selectRes[0].password);
    }
    return false;
  }
  return true;
});
function* setForceSave(docId, forceSave, cmd, success) {
  let forceSaveType = forceSave.getType();
  if (commonDefines.c_oAscForceSaveTypes.Form !== forceSaveType) {
    if (success) {
      yield editorData.checkAndSetForceSave(docId, forceSave.getTime(), forceSave.getIndex(), true, true);
    } else {
      yield editorData.checkAndSetForceSave(docId, forceSave.getTime(), forceSave.getIndex(), false, false);
    }
  }

  if (commonDefines.c_oAscForceSaveTypes.Command !== forceSaveType) {
    let data = {type: forceSaveType, time: forceSave.getTime(), success: success};
    if(commonDefines.c_oAscForceSaveTypes.Form === forceSaveType) {
      yield* publish({type: commonDefines.c_oPublishType.rpc, docId: docId, data: data, responseKey: cmd.getResponseKey()}, cmd.getUserConnectionId());
    } else {
      yield* publish({type: commonDefines.c_oPublishType.forceSave, docId: docId, data: data}, cmd.getUserConnectionId());
    }
  }
}
let startForceSave = co.wrap(function*(docId, type, opt_userdata, opt_userId, opt_userConnectionId, opt_userIndex, opt_responseKey, opt_baseUrl, opt_queue, opt_pubsub) {
  logger.debug('startForceSave start:docId = %s', docId);
  let res = {code: commonDefines.c_oAscServerCommandErrors.NoError, time: null};
  let startedForceSave;
  let hasEncrypted = false;
  if (!shutdownFlag) {
    let hvals = yield editorData.getPresence(docId, connections);
    hasEncrypted = hvals.some((currentValue) => {
      return !!JSON.parse(currentValue).encrypted;
    });
    if (!hasEncrypted) {
      startedForceSave = commonDefines.c_oAscForceSaveTypes.Form === type;
      if (!startedForceSave) {
        startedForceSave = yield editorData.checkAndStartForceSave(docId);
      }
    }
  }
  logger.debug('startForceSave canStart:docId = %s; hasEncrypted = %s; startedForceSave = %j', docId, hasEncrypted, startedForceSave);
  if (startedForceSave) {
    let baseUrl = opt_baseUrl || startedForceSave.baseUrl;
    let forceSave = new commonDefines.CForceSaveData(startedForceSave);
    forceSave.setType(type);
    forceSave.setAuthorUserId(opt_userId);
    forceSave.setAuthorUserIndex(opt_userIndex);

    if (commonDefines.c_oAscForceSaveTypes.Timeout === type) {
      yield* publish({
                       type: commonDefines.c_oPublishType.forceSave, docId: docId,
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
    let status = yield* converterService.convertFromChanges(docId, baseUrl, forceSave, startedForceSave.changeInfo, opt_userdata,
                                                            opt_userConnectionId, opt_responseKey, priority, expiration, opt_queue);
    if (constants.NO_ERROR === status.err) {
      res.time = forceSave.getTime();
    } else {
      res.code = commonDefines.c_oAscServerCommandErrors.UnknownError;
    }
    logger.debug('startForceSave convertFromChanges:docId = %s; status = %d', docId, status.err);
  } else {
    res.code = commonDefines.c_oAscServerCommandErrors.NotModified;
  }
  logger.debug('startForceSave end:docId = %s', docId);
  return res;
});
function getExternalChangeInfo(user, date) {
  return {user_id: user.id, user_id_original: user.idOriginal, user_name: user.username, change_date: date};
}
let resetForceSaveAfterChanges = co.wrap(function*(docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo) {
  //last save
  if (newChangesLastTime) {
    yield editorData.setForceSave(docId, newChangesLastTime, puckerIndex, baseUrl, changeInfo);
    if (cfgForceSaveEnable) {
      let expireAt = newChangesLastTime + cfgForceSaveInterval;
      yield editorData.addForceSaveTimerNX(docId, expireAt);
    }
  }
});
function* startRPC(conn, responseKey, data) {
  let docId = conn.docId;
  logger.debug('startRPC start responseKey:%s , %j:docId = %s', responseKey, data, docId);
  switch (data.type) {
    case 'sendForm':
      var forceSaveRes;
      if (conn.user) {
        forceSaveRes = yield startForceSave(docId, commonDefines.c_oAscForceSaveTypes.Form, undefined, conn.user.idOriginal, conn.user.id, conn.user.indexUser, responseKey);
      } else {
        sendDataRpc(conn, responseKey);
      }
      break;
    case 'wopi_RenameFile':
      let renameRes;
      let selectRes = yield taskResult.select(docId);
      let row = selectRes.length > 0 ? selectRes[0] : null;
      if (row) {
        if (row.callback) {
          let userIndex = utils.getIndexFromUserId(conn.user.id, conn.user.idOriginal);
          let uri = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, row.callback, userIndex);
          let wopiParams = wopiClient.parseWopiCallback(docId, uri, row.callback);
          if (wopiParams) {
            renameRes = yield wopiClient.renameFile(wopiParams, data.name);
          }
        }
      }
      sendDataRpc(conn, responseKey, renameRes);
      break;
  }
  logger.debug('startRPC end:docId = %s', docId);
}
function handleDeadLetter(data, ack) {
  return co(function*() {
    let docId = 'null';
    try {
      var isRequeued = false;
      let task = new commonDefines.TaskQueueData(JSON.parse(data));
      if (task) {
        let cmd = task.getCmd();
        docId = cmd.getDocId();
        logger.warn('handleDeadLetter start: docId = %s %s', docId, data);
        let forceSave = cmd.getForceSave();
        if (forceSave && commonDefines.c_oAscForceSaveTypes.Timeout == forceSave.getType()) {
          let actualForceSave = yield editorData.getForceSave(docId);
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
          logger.warn('handleDeadLetter addResponse delayed = %d: docId = %s', cmd.getAttempt(), docId);
          yield* addResponse(task);
        } else {
          //simulate error response
          cmd.setStatusInfo(constants.CONVERT_DEAD_LETTER);
          canvasService.receiveTask(JSON.stringify(task), function(){});
        }
      }
      logger.warn('handleDeadLetter end: docId = %s; requeue = %s', docId, isRequeued);
    } catch (err) {
      logger.error('handleDeadLetter error: docId = %s\r\n%s', docId, err.stack);
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
function* sendStatusDocument(docId, bChangeBase, opt_userAction, opt_userIndex, opt_callback, opt_baseUrl, opt_userData, opt_forceClose) {
  if (!opt_callback) {
    var getRes = yield* getCallback(docId, opt_userIndex);
    if (getRes) {
      opt_callback = getRes.server;
      if (!opt_baseUrl) {
        opt_baseUrl = getRes.baseUrl;
      }
      if (getRes.wopiParams) {
        logger.debug('sendStatusDocument wopi stub: docId = %s', docId);
        return opt_callback;
      }
    }
  }
  if (null == opt_callback) {
    return;
  }

  var status = c_oAscServerStatus.Editing;
  var participants = yield* getOriginalParticipantsId(docId);
  if (0 === participants.length) {
    let bHasChanges = yield hasChanges(docId);
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
      updateTask.key = docId;
      updateTask.callback = opt_callback.href;
      updateTask.baseurl = opt_baseUrl;
      var updateIfRes = yield taskResult.update(updateTask);
      if (updateIfRes.affectedRows > 0) {
        logger.debug('sendStatusDocument updateIf: docId = %s', docId);
      } else {
        logger.debug('sendStatusDocument updateIf no effect: docId = %s', docId);
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
    replyData = yield* sendServerRequest(docId, uri, sendData);
  } catch (err) {
    replyData = null;
    logger.error('postData error: docId = %s;url = %s;data = %j\r\n%s', docId, uri, sendData, err.stack);
  }
  yield* onReplySendStatusDocument(docId, replyData);
  return opt_callback;
}
function parseReplyData(docId, replyData) {
  var res = null;
  if (replyData) {
    try {
      res = JSON.parse(replyData);
    } catch (e) {
      logger.error("error parseReplyData: docId = %s; data = %s\r\n%s", docId, replyData, e.stack);
      res = null;
    }
  }
  return res;
}
function* onReplySendStatusDocument(docId, replyData) {
  var oData = parseReplyData(docId, replyData);
  if (!(oData && commonDefines.c_oAscServerCommandErrors.NoError == oData.error)) {
    // Ошибка подписки на callback, посылаем warning
    yield* publish({type: commonDefines.c_oPublishType.warning, docId: docId, description: 'Error on save server subscription!'});
  }
}
function* publishCloseUsersConnection(docId, users, isOriginalId, code, description) {
  if (Array.isArray(users)) {
    let usersMap = users.reduce(function(map, val) {
      map[val] = 1;
      return map;
    }, {});
    yield* publish({
                     type: commonDefines.c_oPublishType.closeConnection, docId: docId, usersMap: usersMap,
                     isOriginalId: isOriginalId, code: code, description: description
                   });
  }
}
function closeUsersConnection(docId, usersMap, isOriginalId, code, description) {
  let elConnection;
  for (let i = connections.length - 1; i >= 0; --i) {
    elConnection = connections[i];
    if (elConnection.docId === docId) {
      if (isOriginalId ? usersMap[elConnection.user.idOriginal] : usersMap[elConnection.user.id]) {
        elConnection.close(code, description);
      }
    }
  }
}
function* dropUsersFromDocument(docId, users) {
  if (Array.isArray(users)) {
    yield* publish({type: commonDefines.c_oPublishType.drop, docId: docId, users: users, description: ''});
  }
}

function dropUserFromDocument(docId, userId, description) {
  var elConnection;
  for (var i = 0, length = connections.length; i < length; ++i) {
    elConnection = connections[i];
    if (elConnection.docId === docId && userId === elConnection.user.idOriginal && !elConnection.isCloseCoAuthoring) {
      sendData(elConnection,
        {
          type: "drop",
          description: description
        });//Or 0 if fails
    }
  }
}

// Подписка на эвенты:
function* bindEvents(docId, callback, baseUrl, opt_userAction, opt_userData) {
  // Подписка на эвенты:
  // - если пользователей нет и изменений нет, то отсылаем статус "закрыто" и в базу не добавляем
  // - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
  // - если есть пользователи, то просто добавляем в базу
  var bChangeBase;
  var oCallbackUrl;
  if (!callback) {
    var getRes = yield* getCallback(docId);
    if (getRes && !getRes.wopiParams) {
      oCallbackUrl = getRes.server;
      bChangeBase = c_oAscChangeBase.Delete;
    }
  } else {
    oCallbackUrl = parseUrl(callback);
    bChangeBase = c_oAscChangeBase.All;
    if (null !== oCallbackUrl) {
      let filterStatus = yield* utils.checkHostFilter(oCallbackUrl.host);
      if (filterStatus > 0) {
        logger.warn('checkIpFilter error: docId = %s;url = %s', docId, callback);
        //todo add new error type
        oCallbackUrl = null;
      }
    }
  }
  if (null === oCallbackUrl) {
    return commonDefines.c_oAscServerCommandErrors.ParseError;
  } else {
    yield* sendStatusDocument(docId, bChangeBase, opt_userAction, undefined, oCallbackUrl, baseUrl, opt_userData);
    return commonDefines.c_oAscServerCommandErrors.NoError;
  }
}

function* cleanDocumentOnExit(docId, deleteChanges, opt_userIndex) {
  //clean redis (redisKeyPresenceSet and redisKeyPresenceHash removed with last element)
  yield editorData.cleanDocumentOnExit(docId);
  //remove changes
  if (deleteChanges) {
    yield taskResult.restoreInitialPassword(docId);
    sqlBase.deleteChanges(docId, null);
    //delete forgotten after successful send on callbackUrl
    yield storage.deletePath(cfgForgottenFiles + '/' + docId);
  }
  //unlock
  var getRes = yield* getCallback(docId, opt_userIndex);
  if (getRes && getRes.wopiParams && getRes.wopiParams.userAuth && 'view' !== getRes.wopiParams.userAuth.mode) {
      yield wopiClient.unlock(getRes.wopiParams);
      let unlockInfo = wopiClient.getWopiUnlockMarker(getRes.wopiParams);
      yield canvasService.commandOpenStartPromise(docId, undefined, true, unlockInfo);
  }
}
function* cleanDocumentOnExitNoChanges(docId, opt_userId, opt_userIndex, opt_forceClose) {
  var userAction = opt_userId ? new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, opt_userId) : null;
  // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
  yield* sendStatusDocument(docId, c_oAscChangeBase.No, userAction, opt_userIndex, undefined, undefined, undefined, opt_forceClose);
  //если пользователь зашел в документ, соединение порвалось, на сервере удалилась вся информация,
  //при восстановлении соединения userIndex сохранится и он совпадет с userIndex следующего пользователя
  yield* cleanDocumentOnExit(docId, false, opt_userIndex);
}

function* _createSaveTimer(docId, opt_userId, opt_userIndex, opt_queue, opt_noDelay) {
  var updateMask = new taskResult.TaskResultData();
  updateMask.key = docId;
  updateMask.status = taskResult.FileStatus.Ok;
  var updateTask = new taskResult.TaskResultData();
  updateTask.status = taskResult.FileStatus.SaveVersion;
  updateTask.statusInfo = utils.getMillisecondsOfHour(new Date());
  var updateIfRes = yield taskResult.updateIf(updateTask, updateMask);
  if (updateIfRes.affectedRows > 0) {
    if(!opt_noDelay){
      yield utils.sleep(cfgAscSaveTimeOutDelay);
    }
    while (true) {
      if (!sqlBase.isLockCriticalSection(docId)) {
        canvasService.saveFromChanges(docId, updateTask.statusInfo, null, opt_userId, opt_userIndex, opt_queue);
        break;
      }
      yield utils.sleep(c_oAscLockTimeOutDelay);
    }
  } else {
    //если не получилось - значит FileStatus=SaveVersion(кто-то другой начал сборку) или UpdateVersion(сборка закончена)
    //в этом случае ничего делать не надо
    logger.debug('_createSaveTimer updateIf no effect');
  }
}

function checkJwt(docId, token, type) {
  var res = {decoded: null, description: null, code: null, token: token};
  var secret;
  switch (type) {
    case commonDefines.c_oAscSecretType.Browser:
      secret = utils.getSecret(docId, cfgTokenBrowserSecretFromInbox ? cfgSecretInbox : cfgSecretBrowser, null, token);
      break;
    case commonDefines.c_oAscSecretType.Inbox:
      secret = utils.getSecret(docId, cfgSecretInbox, null, token);
      break;
    case commonDefines.c_oAscSecretType.Session:
      secret = utils.getSecretByElem(cfgSecretSession);
      break;
  }
  if (undefined == secret) {
    logger.warn('empty secret: docId = %s token = %s', docId, token);
  }
  try {
    res.decoded = jwt.verify(token, secret, cfgTokenVerifyOptions);
    logger.debug('checkJwt success: docId = %s decoded = %j', docId, res.decoded);
  } catch (err) {
    logger.warn('checkJwt error: docId = %s name = %s message = %s token = %s', docId, err.name, err.message, token);
    if ('TokenExpiredError' === err.name) {
      res.code = constants.JWT_EXPIRED_CODE;
      res.description = constants.JWT_EXPIRED_REASON + err.message;
    } else if ('JsonWebTokenError' === err.name) {
      res.code = constants.JWT_ERROR_CODE;
      res.description = constants.JWT_ERROR_REASON + err.message;
    }
  }
  return res;
}
function checkJwtHeader(docId, req, opt_header, opt_prefix, opt_secretType) {
  let header = opt_header || cfgTokenInboxHeader;
  let prefix = opt_prefix || cfgTokenInboxPrefix;
  let secretType = opt_secretType || commonDefines.c_oAscSecretType.Inbox;
  let authorization = req.get(header);
  if (authorization && authorization.startsWith(prefix)) {
    var token = authorization.substring(prefix.length);
    return checkJwt(docId, token, secretType);
  }
  return null;
}
function checkJwtPayloadHash(docId, hash, body, token) {
  var res = false;
  if (body && Buffer.isBuffer(body)) {
    var decoded = jwt.decode(token, {complete: true});
    var hmac = jwa(decoded.header.alg);
    var secret = utils.getSecret(docId, cfgSecretInbox, null, token);
    var signature = hmac.sign(body, secret);
    res = (hash === signature);
  }
  return res;
}
function getRequestParams(docId, req, opt_isNotInBody, opt_tokenAssign) {
  let res = {code: constants.NO_ERROR, params: undefined};
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0 && !opt_isNotInBody) {
    res.params = JSON.parse(req.body.toString('utf8'));
  } else {
    res.params = req.query;
  }
  if (cfgTokenEnableRequestInbox) {
    res.code = constants.VKEY;
    let checkJwtRes;
    if (cfgTokenInboxInBody && !opt_isNotInBody) {
      checkJwtRes = checkJwt(docId, res.params.token, commonDefines.c_oAscSecretType.Inbox);
    } else {
      //for compatibility
      checkJwtRes = checkJwtHeader(docId, req);
    }
    if (checkJwtRes) {
      if (checkJwtRes.decoded) {
        res.code = constants.NO_ERROR;
        if (cfgTokenInboxInBody && !opt_tokenAssign) {
          res.params = checkJwtRes.decoded;
        } else {
          //for compatibility
          if (!utils.isEmptyObject(checkJwtRes.decoded.payload)) {
            Object.assign(res.params, checkJwtRes.decoded.payload);
          } else if (checkJwtRes.decoded.payloadhash) {
            if (!checkJwtPayloadHash(docId, checkJwtRes.decoded.payloadhash, req.body, checkJwtRes.token)) {
              res.code = constants.VKEY;
            }
          } else if (!utils.isEmptyObject(checkJwtRes.decoded.query)) {
            Object.assign(res.params, checkJwtRes.decoded.query);
          }
        }
      } else {
        if (constants.JWT_EXPIRED_CODE == checkJwtRes.code) {
          res.code = constants.VKEY_KEY_EXPIRE;
        }
      }
    }
  }
  return res;
}

function getLicenseNowUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
                  now.getUTCMinutes(), now.getUTCSeconds()) / 1000;
}
let getParticipantMap = co.wrap(function*(docId, opt_hvals) {
  const participantsMap = [];
  let hvals;
  if (opt_hvals) {
    hvals = opt_hvals;
  } else {
    hvals = yield editorData.getPresence(docId, connections);
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
exports.createSaveTimerPromise = co.wrap(_createSaveTimer);
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
exports.setForceSave = setForceSave;
exports.startForceSave = startForceSave;
exports.resetForceSaveAfterChanges = resetForceSaveAfterChanges;
exports.getExternalChangeInfo = getExternalChangeInfo;
exports.checkJwt = checkJwt;
exports.getRequestParams = getRequestParams;
exports.checkJwtHeader = checkJwtHeader;
exports.checkJwtPayloadHash = checkJwtPayloadHash;
exports.install = function(server, callbackFunction) {
  var sockjs_echo = sockjs.createServer(cfgSockjs),
    urlParse = new RegExp("^/doc/([" + constants.DOC_ID_PATTERN + "]*)/c.+", 'i');

  sockjs_echo.on('connection', function(conn) {
    if (!conn) {
      logger.error("null == conn");
      return;
    }
    if (getIsShutdown()) {
      sendFileError(conn, 'Server shutdow');
      return;
    }
    conn.baseUrl = utils.getBaseUrlByConnection(conn);
    conn.sessionIsSendWarning = false;
    conn.sessionTimeConnect = conn.sessionTimeLastAction = new Date().getTime();

    conn.on('data', function(message) {
      return co(function* () {
      var docId = 'null';
      try {
        var startDate = null;
        if(clientStatsD) {
          startDate = new Date();
        }
        var data = JSON.parse(message);
        docId = conn.docId;
        logger.info('data.type = ' + data.type + ' id = ' + docId);
        if(getIsShutdown())
        {
          logger.debug('Server shutdown receive data');
          return;
        }
        if (conn.isCiriticalError && ('message' == data.type || 'getLock' == data.type || 'saveChanges' == data.type ||
            'isSaveLock' == data.type)) {
          logger.warn("conn.isCiriticalError send command: docId = %s type = %s", docId, data.type);
          conn.close(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
          return;
        }
        if ((conn.isCloseCoAuthoring || (conn.user && conn.user.view)) &&
            ('getLock' == data.type || 'saveChanges' == data.type || 'isSaveLock' == data.type)) {
          logger.warn("conn.user.view||isCloseCoAuthoring access deny: docId = %s type = %s", docId, data.type);
          conn.close(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
          return;
        }
        yield* encryptPasswordParams(data);
        switch (data.type) {
          case 'auth'          :
            yield* auth(conn, data);
            break;
          case 'message'        :
            yield* onMessage(conn, data);
            break;
          case 'cursor'        :
            yield* onCursor(conn, data);
            break;
          case 'getLock'        :
            yield* getLock(conn, data, false);
            break;
          case 'saveChanges'      :
            yield* saveChanges(conn, data);
            break;
          case 'isSaveLock'      :
            yield* isSaveLock(conn, data);
            break;
          case 'unSaveLock'      :
            yield* unSaveLock(conn, -1, -1);
            break;	// Индекс отправляем -1, т.к. это экстренное снятие без сохранения
          case 'getMessages'      :
            yield* getMessages(conn, data);
            break;
          case 'unLockDocument'    :
            yield* checkEndAuthLock(data.unlock, data.isSave, docId, conn.user.id, data.releaseLocks, data.deleteIndex, conn);
            break;
          case 'close':
            yield* closeDocument(conn, false);
            break;
          case 'versionHistory'          : {
            let cmd = new commonDefines.InputCommand(data.cmd);
            yield* versionHistory(conn, cmd);
            break;
          }
          case 'openDocument'      : {
            var cmd = new commonDefines.InputCommand(data.message);
            cmd.fillFromConnection(conn);
            yield canvasService.openDocument(conn, cmd);
            break;
          }
          case 'changesError':
            logger.error("changesError: docId = %s %s", docId, data.stack);
            if (cfgErrorFiles && docId) {
              let destDir = cfgErrorFiles + '/browser/' + docId;
              yield storage.copyPath(docId, destDir);
              yield* saveErrorChanges(docId, destDir);
            }
            break;
          case 'extendSession' :
            conn.sessionIsSendWarning = false;
            conn.sessionTimeLastAction = new Date().getTime() - data.idletime;
            break;
          case 'forceSaveStart' :
            var forceSaveRes;
            if (conn.user) {
              forceSaveRes = yield startForceSave(docId, commonDefines.c_oAscForceSaveTypes.Button, undefined, conn.user.idOriginal, conn.user.id, conn.user.indexUser);
            } else {
              forceSaveRes = {code: commonDefines.c_oAscServerCommandErrors.UnknownError, time: null};
            }
            sendData(conn, {type: "forceSaveStart", messages: forceSaveRes});
            break;
          case 'rpc' :
            yield* startRPC(conn, data.responseKey, data.data);
            break;
          default:
            logger.debug("unknown command %s", message);
            break;
        }
        if(clientStatsD) {
          if('openDocument' != data.type) {
            clientStatsD.timing('coauth.data.' + data.type, new Date() - startDate);
          }
        }
      } catch (e) {
        logger.error("error receiving response: docId = %s type = %s\r\n%s", docId, (data && data.type) ? data.type : 'null', e.stack);
      }
      });
    });
    conn.on('error', function() {
      logger.error("On error");
    });
    conn.on('close', function() {
      return co(function* () {
        var docId = 'null';
        try {
          docId = conn.docId;
          yield* closeDocument(conn, true);
        } catch (err) {
          logger.error('Error conn close: docId = %s\r\n%s', docId, err.stack);
        }
      });
    });

    _checkLicense(conn);
  });
  /**
   *
   * @param conn
   * @param isCloseConnection - закрываем ли мы окончательно соединение
   */
  function* closeDocument(conn, isCloseConnection) {
    var userLocks, reconnected = false, bHasEditors, bHasChanges;
    var docId = conn.docId;
    if (null == docId) {
      return;
    }
    var hvals;
    let participantsTimestamp;
    var tmpUser = conn.user;
    var isView = tmpUser.view;
    logger.info("Connection closed or timed out: userId = %s isCloseConnection = %s docId = %s", tmpUser.id, isCloseConnection, docId);
    var isCloseCoAuthoringTmp = conn.isCloseCoAuthoring;
    if (isCloseConnection) {
      //Notify that participant has gone
      connections = _.reject(connections, function(el) {
        return el.id === conn.id;//Delete this connection
      });
      //Check if it's not already reconnected
      reconnected = yield* isUserReconnect(docId, tmpUser.id, conn.id);
      if (reconnected) {
        logger.info("reconnected: userId = %s docId = %s", tmpUser.id, docId);
      } else {
        yield removePresence(conn);
        hvals = yield editorData.getPresence(docId, connections);
        participantsTimestamp = Date.now();
        if (hvals.length <= 0) {
          yield editorData.removePresenceDocument(docId);
        }
      }
    } else {
      if (!conn.isCloseCoAuthoring) {
        tmpUser.view = true;
        conn.isCloseCoAuthoring = true;
        yield addPresence(conn, true);
        if (cfgTokenEnableBrowser) {
          sendDataRefreshToken(conn);
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
      let participants = yield getParticipantMap(docId, hvals);
      if (!participantsTimestamp) {
        participantsTimestamp = Date.now();
      }
      yield* publish({type: commonDefines.c_oPublishType.participantsState, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participants}, docId, tmpUser.id);
      tmpUser.view = tmpView;

      // Для данного пользователя снимаем лок с сохранения
      yield editorData.unlockSave(docId, conn.user.id);

      // Только если редактируем
      if (false === isView) {
        bHasEditors = yield* hasEditors(docId, hvals);
        bHasChanges = yield hasChanges(docId);

        let needSendStatus = true;
        if (conn.encrypted) {
          let selectRes = yield taskResult.select(docId);
          if (selectRes.length > 0) {
            var row = selectRes[0];
            if (taskResult.FileStatus.UpdateVersion === row.status) {
              needSendStatus = false;
            }
          }
        }
        //Давайдосвиданья!
        //Release locks
        userLocks = yield* removeUserLocks(docId, conn.user.id);
        if (0 < userLocks.length) {
          //todo на close себе ничего не шлем
          //sendReleaseLock(conn, userLocks);
          yield* publish({type: commonDefines.c_oPublishType.releaseLock, docId: docId, userId: conn.user.id, locks: userLocks}, docId, conn.user.id);
        }

        // Для данного пользователя снимаем Lock с документа
        yield* checkEndAuthLock(true, false, docId, conn.user.id);

        let userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
        // Если у нас нет пользователей, то удаляем все сообщения
        if (!bHasEditors) {
          // На всякий случай снимаем lock
          yield editorData.unlockSave(docId, tmpUser.id);

          let needSaveChanges = bHasChanges;
          if (!needSaveChanges) {
            //start save changes if forgotten file exists.
            //more effective to send file without sfc, but this method is simpler by code
            let forgotten = yield storage.listObjects(cfgForgottenFiles + '/' + docId);
            needSaveChanges = forgotten.length > 0;
            logger.debug('closeDocument hasForgotten %s: docId = %s', needSaveChanges, docId);
          }
          if (needSaveChanges && !conn.encrypted) {
            // Send changes to save server
            yield* _createSaveTimer(docId, tmpUser.idOriginal, userIndex);
          } else if (needSendStatus) {
            yield* cleanDocumentOnExitNoChanges(docId, tmpUser.idOriginal, userIndex);
          } else {
            yield* cleanDocumentOnExit(docId, false, userIndex);
          }
        } else if (needSendStatus) {
          yield* sendStatusDocument(docId, c_oAscChangeBase.No, new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, tmpUser.idOriginal), userIndex);
        }
      }
    }
  }

  function* versionHistory(conn, cmd) {
    var docIdOld = conn.docId;
    var docIdNew = cmd.getDocId();
    //check jwt
    if (cfgTokenEnableBrowser) {
      var checkJwtRes = checkJwt(docIdNew, cmd.getTokenHistory(), commonDefines.c_oAscSecretType.Browser);
      if (checkJwtRes.decoded) {
        fillVersionHistoryFromJwt(checkJwtRes.decoded, cmd);
        docIdNew = cmd.getDocId();
        cmd.setWithAuthorization(true);
      } else {
        sendData(conn, {type: "expiredToken", code: checkJwtRes.code, description: checkJwtRes.description});
        return;
      }
    }
    if (docIdOld !== docIdNew) {
      //remove presence(other data was removed before in closeDocument)
      yield removePresence(conn);
      var hvals = yield editorData.getPresence(docIdOld, connections);
      if (hvals.length <= 0) {
        yield editorData.removePresenceDocument(docIdOld);
      }

      //apply new
      conn.docId = docIdNew;
      yield addPresence(conn, true);
      if (cfgTokenEnableBrowser) {
        sendDataRefreshToken(conn);
      }
    }
    //open
    yield canvasService.openDocument(conn, cmd, null);
  }
  // Получение изменений для документа (либо из кэша, либо обращаемся к базе, но только если были сохранения)
  function* getDocumentChanges(docId, optStartIndex, optEndIndex) {
    // Если за тот момент, пока мы ждали из базы ответа, все ушли, то отправлять ничего не нужно
    var arrayElements = yield sqlBase.getChangesPromise(docId, optStartIndex, optEndIndex);
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

  function* getAllLocks(docId) {
    var docLockRes = [];
    var docLock = yield editorData.getLocks(docId);
    for (var i = 0; i < docLock.length; ++i) {
      docLockRes.push(docLock[i]);
    }
    return docLockRes;
  }
  function* removeUserLocks(docId, userId) {
    var userLocks = [], i;
    var toCache = [];
    var docLock = yield* getAllLocks(docId);
    for (i = 0; i < docLock.length; ++i) {
      var elem = docLock[i];
      if (elem.user === userId) {
        userLocks.push(elem);
      } else {
        toCache.push(elem);
      }
    }
    //remove all
    yield editorData.removeLocks(docId);
    //set all
    yield editorData.addLocks(docId, toCache);
    return userLocks;
  }

	function* checkEndAuthLock(unlock, isSave, docId, userId, releaseLocks, deleteIndex, conn) {
		let result = false;

    if (null != deleteIndex && -1 !== deleteIndex) {
      let puckerIndex = yield* getChangesIndex(docId);
      const deleteCount = puckerIndex - deleteIndex;
      if (0 < deleteCount) {
        puckerIndex -= deleteCount;
        yield sqlBase.deleteChangesPromise(docId, deleteIndex);
      } else if (0 > deleteCount) {
        logger.error("Error checkEndAuthLock docid: %s ; deleteIndex: %s ; startIndex: %s ; deleteCount: %s", docId,
                     deleteIndex, puckerIndex, deleteCount);
      }
    }

		if (unlock) {
			var unlockRes = yield editorData.unlockAuth(docId, userId);
			if (commonDefines.c_oAscUnlockRes.Unlocked === unlockRes) {
				const participantsMap = yield getParticipantMap(docId);
				yield* publish({
					type: commonDefines.c_oPublishType.auth,
					docId: docId,
					userId: userId,
					participantsMap: participantsMap
				});

				result = true;
			}
		}

		//Release locks
		if (releaseLocks && conn) {
			const userLocks = yield* removeUserLocks(docId, userId);
			if (0 < userLocks.length) {
				sendReleaseLock(conn, userLocks);
				yield* publish({
					type: commonDefines.c_oPublishType.releaseLock,
					docId: docId,
					userId: userId,
					locks: userLocks
				}, docId, userId);
			}
		}
		if (isSave && conn) {
			// Автоматически снимаем lock сами
			yield* unSaveLock(conn, -1, -1);
		}

		return result;
	}

  function* setLockDocumentTimer(docId, userId) {
    let timerId = setTimeout(function() {
      return co(function*() {
        try {
          logger.warn("lockDocumentsTimerId timeout: docId = %s", docId);
          delete lockDocumentsTimerId[docId];
          //todo remove checkEndAuthLock(only needed for lost connections in redis)
          yield* checkEndAuthLock(true, false, docId, userId);
          yield* publishCloseUsersConnection(docId, [userId], false, constants.DROP_CODE, constants.DROP_REASON);
        } catch (e) {
          logger.error("lockDocumentsTimerId error:\r\n%s", e.stack);
        }
      });
    }, 1000 * cfgExpLockDoc);
    lockDocumentsTimerId[docId] = {timerId: timerId, userId: userId};
    logger.debug("lockDocumentsTimerId set userId = %s: docId = %s", userId, docId);
  }
  function cleanLockDocumentTimer(docId, lockDocumentTimer) {
    clearTimeout(lockDocumentTimer.timerId);
    delete lockDocumentsTimerId[docId];
  }

  function sendParticipantsState(participants, data) {
    _.each(participants, function(participant) {
      sendData(participant, {
        type: "connectState",
        participantsTimestamp: data.participantsTimestamp,
        participants: data.participants,
        waitAuth: !!data.waitAuthUserId
      });
    });
  }

  function sendFileError(conn, errorId, code) {
    logger.warn('error description: docId = %s errorId = %s', conn.docId, errorId);
    conn.isCiriticalError = true;
    sendData(conn, {type: 'error', description: errorId, code: code});
  }

  function* sendFileErrorAuth(conn, sessionId, errorId, code) {
    conn.isCloseCoAuthoring = true;
    conn.sessionId = sessionId;//restore old
    //Kill previous connections
    connections = _.reject(connections, function(el) {
      return el.sessionId === sessionId;//Delete this connection
    });
    //closing could happen during async action
    if (constants.CONN_CLOSED !== conn.readyState) {
      // Кладем в массив, т.к. нам нужно отправлять данные для открытия/сохранения документа
      connections.push(conn);
      yield addPresence(conn, true);

      sendFileError(conn, errorId, code);
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

  function* authRestore(conn, sessionId) {
    conn.sessionId = sessionId;//restore old
    //Kill previous connections
    connections = _.reject(connections, function(el) {
      return el.sessionId === sessionId;//Delete this connection
    });

    yield* endAuth(conn, true);
  }

  function fillUsername(data) {
    let name;
    let user = data.user;
    if (user.firstname && user.lastname) {
      //as in web-apps/apps/common/main/lib/util/utils.js
      let isRu = (data.lang && /^ru/.test(data.lang));
      name = isRu ? user.lastname + ' ' + user.firstname : user.firstname + ' ' + user.lastname;
    } else {
      name = user.username;
    }
    if (name.length > constants.USER_NAME_MAX_LENGTH) {
      logger.warn('fillUsername user name too long actual = %s; max = %s', name.length, constants.USER_NAME_MAX_LENGTH);
      name = name.substr(0, constants.USER_NAME_MAX_LENGTH);
    }
    return name;
  }
  function isEditMode(permissions, mode, def) {
    if (permissions && mode) {
      //as in web-apps/apps/documenteditor/main/app/controller/Main.js
      return mode !== 'view' && (permissions.edit !== false || permissions.review === true ||
        permissions.comment === true || permissions.fillForms === true);
    } else {
      return def;
    }
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
    return res;
  }
  function fillDataFromJwt(decoded, data) {
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
      if (null != edit.ds_view) {
        data.view = edit.ds_view;
      }
      if (null != edit.ds_isCloseCoAuthoring) {
        data.isCloseCoAuthoring = edit.ds_isCloseCoAuthoring;
      }
      data.isEnterCorrectPassword = edit.ds_isEnterCorrectPassword;
      data.denyChangeName = edit.ds_denyChangeName;
      if (edit.user) {
        var dataUser = data.user;
        var user = edit.user;
        if (null != user.id) {
          dataUser.id = user.id;
          if (openCmd) {
            openCmd.userid = user.id;
          }
        }
        if (null != user.index) {
          dataUser.indexUser = user.index;
        }
        if (null != user.firstname) {
          dataUser.firstname = user.firstname;
        }
        if (null != user.lastname) {
          dataUser.lastname = user.lastname;
        }
        if (user.name) {
          dataUser.username = user.name;
        }
      }
      if (edit.user && edit.user.name) {
        data.denyChangeName = true;
      }
    }

    res = res && fillDataFromWopiJwt(decoded, data);

    //todo make required fields
    if (decoded.url || decoded.payload|| (decoded.key && !decoded.fileInfo)) {
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

  function* encryptPasswordParams(data) {
    let dataWithPassword;
    if (data.type === 'openDocument' && data.message) {
      dataWithPassword = data.message;
    } else if (data.type === 'auth' && data.openCmd) {
      dataWithPassword = data.openCmd;
    }
    if (dataWithPassword && dataWithPassword.password) {
      if (dataWithPassword.password.length > constants.PASSWORD_MAX_LENGTH) {
        //todo send back error
        logger.warn('encryptPasswordParams password too long actual = %s; max = %s', dataWithPassword.password.length, constants.PASSWORD_MAX_LENGTH);
        dataWithPassword.password = null;
      } else {
        dataWithPassword.password = yield utils.encryptPassword(dataWithPassword.password);
      }
    }
  }

  function* auth(conn, data) {
    //TODO: Do authorization etc. check md5 or query db
    if (data.token && data.user) {
      let docId = data.docid;
      //check jwt
      if (cfgTokenEnableBrowser) {
        let secretType = !!data.jwtSession ? commonDefines.c_oAscSecretType.Session :
          commonDefines.c_oAscSecretType.Browser;
        const checkJwtRes = checkJwt(docId, data.jwtSession || data.jwtOpen, secretType);
        if (checkJwtRes.decoded) {
          if (!fillDataFromJwt(checkJwtRes.decoded, data)) {
            logger.warn("fillDataFromJwt return false: docId = %s", docId);
            conn.close(constants.ACCESS_DENIED_CODE, constants.ACCESS_DENIED_REASON);
            return;
          }
        } else {
          conn.close(checkJwtRes.code, checkJwtRes.description);
          return;
        }
      }

      docId = data.docid;
      const user = data.user;

      let wopiParams = null;
      if (data.documentCallbackUrl) {
        wopiParams = wopiClient.parseWopiCallback(docId, data.documentCallbackUrl);
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
          let filterStatus = yield* utils.checkHostFilter(documentCallback.hostname);
          if (0 !== filterStatus) {
            logger.warn('checkIpFilter error: docId = %s;url = %s', docId, data.documentCallbackUrl);
            conn.close(constants.DROP_CODE, constants.DROP_REASON);
            return;
          }
        }
        let format = data.openCmd && data.openCmd.format;
        upsertRes = yield canvasService.commandOpenStartPromise(docId, utils.getBaseUrlByConnection(conn), true, data.documentCallbackUrl, format);
		  curIndexUser = upsertRes.affectedRows == 1 ? 1 : upsertRes.insertId;
      }
      if (constants.CONN_CLOSED === conn.readyState) {
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
        username: fillUsername(data),
        indexUser: curIndexUser,
        view: !isEditMode(data.permissions, data.mode, !data.view)
      };
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

      const c_LR = constants.LICENSE_RESULT;
      conn.licenseType = c_LR.Success;
      if (!conn.user.view) {
        let licenceType = conn.licenseType = yield* _checkLicenseAuth(conn.user.idOriginal);
        if (c_LR.Success !== licenceType && c_LR.SuccessLimit !== licenceType) {
          conn.user.view = true;
        } else {
          //don't check IsAnonymousUser via jwt because substituting it doesn't lead to any trouble
          yield* updateEditUsers(conn.user.idOriginal,  !!data.IsAnonymousUser);
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
        if (constants.CONN_CLOSED !== conn.readyState) {
          // Кладем в массив, т.к. нам нужно отправлять данные для открытия/сохранения документа
          connections.push(conn);
          yield addPresence(conn, true);
          // Посылаем формальную авторизацию, чтобы подтвердить соединение
          yield* sendAuthInfo(conn, bIsRestore, undefined);
          if (cmd) {
            yield canvasService.openDocument(conn, cmd, upsertRes, bIsRestore);
          }
        }
        return;
      }
      let result = yield taskResult.select(docId);
      if (cmd && result && result.length > 0 && result[0].callback) {
        let userAuthStr = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, result[0].callback, curIndexUser);
        let wopiParams = wopiClient.parseWopiCallback(docId, userAuthStr, result[0].callback);
        cmd.setWopiParams(wopiParams);
        if (wopiParams) {
          documentCallback = null;
          if (!wopiParams.userAuth) {
            yield* sendFileErrorAuth(conn, data.sessionId, 'Wopi without userAuth');
            return;
          }
        }
      }
      if (conn.user.idOriginal.length > constants.USER_ID_MAX_LENGTH) {
        //todo refactor DB and remove restrictions
        logger.warn('auth user id too long actual = %s; max = %s; docId = %s', curUserIdOriginal.length, constants.USER_ID_MAX_LENGTH, docId);
        yield* sendFileErrorAuth(conn, data.sessionId, 'User id too long');
        return;
      }
      if (!conn.user.view) {
        var status = result && result.length > 0 ? result[0]['status'] : null;
        if (taskResult.FileStatus.Ok === status) {
          // Все хорошо, статус обновлять не нужно
        } else if (taskResult.FileStatus.SaveVersion === status ||
          (!bIsRestore && taskResult.FileStatus.UpdateVersion === status &&
          Date.now() - result[0]['status_info'] * 60000 > cfgExpUpdateVersionStatus)) {
          let newStatus = taskResult.FileStatus.Ok;
          if (taskResult.FileStatus.UpdateVersion === status) {
            logger.warn("UpdateVersion expired: docId = %s", docId);
            //FileStatus.None to open file again from new url
            newStatus = taskResult.FileStatus.None;
          }
          // Обновим статус файла (идет сборка, нужно ее остановить)
          var updateMask = new taskResult.TaskResultData();
          updateMask.key = docId;
          updateMask.status = status;
          updateMask.statusInfo = result[0]['status_info'];
          var updateTask = new taskResult.TaskResultData();
          updateTask.status = newStatus;
          updateTask.statusInfo = constants.NO_ERROR;
          var updateIfRes = yield taskResult.updateIf(updateTask, updateMask);
          if (!(updateIfRes.affectedRows > 0)) {
            // error version
            yield* sendFileErrorAuth(conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
            return;
          }
        } else if (bIsRestore && taskResult.FileStatus.UpdateVersion === status) {
          // error version
          yield* sendFileErrorAuth(conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
          return;
        } else if (taskResult.FileStatus.None === status && conn.encrypted) {
          //ok
        } else if (bIsRestore) {
          // Other error
          let code = null === status ? constants.NO_CACHE_CODE : undefined;
          yield* sendFileErrorAuth(conn, data.sessionId, 'Other error', code);
          return;
        }
      }
      //Set the unique ID
      if (bIsRestore) {
        logger.info("restored old session: docId = %s id = %s", docId, data.sessionId);

        if (!conn.user.view) {
          // Останавливаем сборку (вдруг она началась)
          // Когда переподсоединение, нам нужна проверка на сборку файла
          try {
            var puckerIndex = yield* getChangesIndex(docId);
            var bIsSuccessRestore = true;
            if (puckerIndex > 0) {
              let objChangesDocument = yield* getDocumentChanges(docId, puckerIndex - 1, puckerIndex);
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
              var getLockRes = yield* getLock(conn, data, true);
              if (arrayBlocks && (0 === arrayBlocks.length || getLockRes)) {
                yield* authRestore(conn, data.sessionId);
              } else {
                yield* sendFileErrorAuth(conn, data.sessionId, 'Restore error. Locks not checked.');
              }
            } else {
              yield* sendFileErrorAuth(conn, data.sessionId, 'Restore error. Document modified.');
            }
          } catch (err) {
            logger.error("DataBase error: docId = %s %s", docId, err.stack);
            yield* sendFileErrorAuth(conn, data.sessionId, 'DataBase error');
          }
        } else {
          yield* authRestore(conn, data.sessionId);
        }
      } else {
        conn.sessionId = conn.id;
        const endAuthRes = yield* endAuth(conn, false, documentCallback);
        if (endAuthRes && cmd) {
          yield canvasService.openDocument(conn, cmd, upsertRes, bIsRestore);
        }
      }
    }
  }

  function* endAuth(conn, bIsRestore, documentCallback) {
    let res = true;
    const docId = conn.docId;
    const tmpUser = conn.user;
    let hasForgotten;
    if (constants.CONN_CLOSED === conn.readyState) {
      //closing could happen during async action
      return false;
    }
    connections.push(conn);
    let firstParticipantNoView, countNoView = 0;
    yield addPresence(conn, true);
    let participantsMap = yield getParticipantMap(docId);
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
    if (constants.CONN_CLOSED === conn.readyState) {
      //closing could happen during async action
      return false;
    }
    // Отправляем на внешний callback только для тех, кто редактирует
    if (!tmpUser.view) {
      const userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal);
      const userAction = new commonDefines.OutputAction(commonDefines.c_oAscUserAction.In, tmpUser.idOriginal);
      let callback = yield* sendStatusDocument(docId, c_oAscChangeBase.No, userAction, userIndex, documentCallback, conn.baseUrl);
      if (!callback && !bIsRestore) {
        //check forgotten file
        let forgotten = yield storage.listObjects(cfgForgottenFiles + '/' + docId);
        hasForgotten = forgotten.length > 0;
        logger.debug('endAuth hasForgotten %s: docId = %s', hasForgotten, docId);
      }
    }

    if (constants.CONN_CLOSED === conn.readyState) {
      //closing could happen during async action
      return false;
    }
    let lockDocument = null;
    let waitAuthUserId;
    if (!bIsRestore && 2 === countNoView && !tmpUser.view) {
      // Ставим lock на документ
      const lockRes = yield editorData.lockAuth(docId, firstParticipantNoView.id, 2 * cfgExpLockDoc);
      if (constants.CONN_CLOSED === conn.readyState) {
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
        yield* setLockDocumentTimer(docId, lockDocument.id);
      }
    }
    if (constants.CONN_CLOSED === conn.readyState) {
      //closing could happen during async action
      return false;
    }
    if (lockDocument && !tmpUser.view) {
      // Для view не ждем снятия lock-а
      const sendObject = {
        type: "waitAuth",
        lockDocument: lockDocument
      };
      sendData(conn, sendObject);//Or 0 if fails
    } else {
      if (!bIsRestore) {
        yield* sendAuthChanges(conn.docId, [conn]);
      }
      if (constants.CONN_CLOSED === conn.readyState) {
        //closing could happen during async action
        return false;
      }
      yield* sendAuthInfo(conn, bIsRestore, participantsMap, hasForgotten);
    }
    if (constants.CONN_CLOSED === conn.readyState) {
      //closing could happen during async action
      return false;
    }
    yield* publish({type: commonDefines.c_oPublishType.participantsState, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participantsMap, waitAuthUserId: waitAuthUserId}, docId, tmpUser.id);
    return res;
  }

  function* saveErrorChanges(docId, destDir) {
    let index = 0;
    let indexChunk = 1;
    let changes;
    let changesPrefix = destDir + '/' + constants.CHANGES_NAME + '/' + constants.CHANGES_NAME + '.json.';
    do {
      changes = yield sqlBase.getChangesPromise(docId, index, index + cfgMaxRequestChanges);
      if (changes.length > 0) {
        let changesJSON = indexChunk > 1 ? ',[' : '[';
        changesJSON += changes[0].change_data;
        for (let i = 1; i < changes.length; ++i) {
          changesJSON += ',';
          changesJSON += changes[i].change_data;
        }
        changesJSON += ']\r\n';
        let buffer = Buffer.from(changesJSON, 'utf8');
        yield storage.putObject(changesPrefix + (indexChunk++).toString().padStart(3, '0'), buffer, buffer.length);
      }
      index += cfgMaxRequestChanges;
    } while (changes && cfgMaxRequestChanges === changes.length);
  }

  function sendAuthChangesByChunks(changes, connections) {
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
        sendData(connections[i], sendObject);//Or 0 if fails
      }
    }
  }
  function* sendAuthChanges(docId, connections) {
    let index = 0;
    let changes;
    do {
      let objChangesDocument = yield getDocumentChanges(docId, index, index + cfgMaxRequestChanges);
      changes = objChangesDocument.arrChanges;
      sendAuthChangesByChunks(changes, connections);
      index += cfgMaxRequestChanges;
    } while (changes && cfgMaxRequestChanges === changes.length);
  }
  function* sendAuthInfo(conn, bIsRestore, participantsMap, opt_hasForgotten) {
    const docId = conn.docId;
    let docLock;
    if(EditorTypes.document == conn.editorType){
      docLock = {};
      let elem;
      const allLocks = yield* getAllLocks(docId);
      for(let i = 0 ; i < allLocks.length; ++i) {
        elem = allLocks[i];
        docLock[elem.block] = elem;
      }
    } else {
      docLock = yield* getAllLocks(docId);
    }
    let allMessages = yield editorData.getMessages(docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
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
      jwt: (!bIsRestore && cfgTokenEnableBrowser) ? fillJwtByConnection(conn) : undefined,
      g_cAscSpellCheckUrl: cfgEditor["spellcheckerUrl"],
      buildVersion: commonDefines.buildVersion,
      buildNumber: commonDefines.buildNumber,
      licenseType: conn.licenseType,
      settings: cfgEditor
    };
    sendData(conn, sendObject);//Or 0 if fails
  }

  function* onMessage(conn, data) {
    if (false === conn.permissions.chat) {
      logger.warn("insert message permissions.chat==false: userId = %s docId = %s", conn.user && conn.user.id, conn.docId);
      return;
    }
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {docid: docId, message: data.message, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal, username: conn.user.username};
    yield editorData.addMessage(docId, msg);
    // insert
    logger.info("insert message: docId = %s %j", docId, msg);

    var messages = [msg];
    sendDataMessage(conn, messages);
    yield* publish({type: commonDefines.c_oPublishType.message, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* onCursor(conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {cursor: data.cursor, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal};

    logger.info("send cursor: docId = %s %s", docId, msg);

    var messages = [msg];
    yield* publish({type: commonDefines.c_oPublishType.cursor, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* getLock(conn, data, bIsRestore) {
    logger.info("getLock docid: %s", conn.docId);
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
    return fLock ? yield* fLock(conn, data, bIsRestore) : false;
  }

  function* getLockWord(conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLock(docId, arrayBlocks);
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
      yield editorData.addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: commonDefines.c_oPublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  // Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
  function* getLockExcel(conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLockExcel(docId, arrayBlocks, userId);
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
      yield editorData.addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: commonDefines.c_oPublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  // Для презентаций это объект { type, val } или { type, slideId, objId }
  function* getLockPresentation(conn, data, bIsRestore) {
    var docId = conn.docId, userId = conn.user.id, arrayBlocks = data.block;
    var i;
    var checkRes = yield* _checkLockPresentation(docId, arrayBlocks, userId);
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
      yield editorData.addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: commonDefines.c_oPublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  function sendGetLock(participants, documentLocks) {
    _.each(participants, function(participant) {
      sendData(participant, {type: "getLock", locks: documentLocks});
    });
  }

  // Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
  function* saveChanges(conn, data) {
    const docId = conn.docId, userId = conn.user.id;
    logger.info("Start saveChanges docid: %s; reSave: %s", docId, data.reSave);

    let lockRes = yield editorData.lockSave(docId, userId, cfgExpSaveLock);
    if (!lockRes) {
      //should not be here. cfgExpSaveLock - 60sec, sockjs disconnects after 25sec
      logger.warn("saveChanges lockSave error docid: %s", docId);
      return;
    }

    let puckerIndex = yield* getChangesIndex(docId);

    let deleteIndex = -1;
    if (data.startSaveChanges && null != data.deleteIndex) {
      deleteIndex = data.deleteIndex;
      if (-1 !== deleteIndex) {
        const deleteCount = puckerIndex - deleteIndex;
        if (0 < deleteCount) {
          puckerIndex -= deleteCount;
          yield sqlBase.deleteChangesPromise(docId, deleteIndex);
        } else if (0 > deleteCount) {
          logger.error("Error saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; deleteCount: %s", docId, deleteIndex, puckerIndex, deleteCount);
        }
      }
    }

    // Стартовый индекс изменения при добавлении
    const startIndex = puckerIndex;

    const newChanges = JSON.parse(data.changes);
    let newChangesLastDate = new Date();
    newChangesLastDate.setMilliseconds(0);//remove milliseconds avoid issues with MySQL datetime rounding
    let newChangesLastTime = newChangesLastDate.getTime();
    let arrNewDocumentChanges = [];
    logger.info("saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; length: %s", docId, deleteIndex, startIndex, newChanges.length);
    if (0 < newChanges.length) {
      let oElement = null;

      for (let i = 0; i < newChanges.length; ++i) {
        oElement = newChanges[i];
        arrNewDocumentChanges.push({docid: docId, change: JSON.stringify(oElement), time: newChangesLastDate,
          user: userId, useridoriginal: conn.user.idOriginal});
      }

      puckerIndex += arrNewDocumentChanges.length;
      yield sqlBase.insertChangesPromise(arrNewDocumentChanges, docId, startIndex, conn.user);
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
          const docLock = yield* getAllLocks(docId);
          if (_recalcLockArray(userId, docLock, oRecalcIndexColumns, oRecalcIndexRows)) {
            let toCache = [];
            for (let i = 0; i < docLock.length; ++i) {
              toCache.push(docLock[i]);
            }
            yield editorData.removeLocks(docId);
            yield editorData.addLocks(docId, toCache);
          }
        }
      }

      let userLocks = [];
      if (data.releaseLocks) {
		  //Release locks
		  userLocks = yield* removeUserLocks(docId, userId);
      }
      // Для данного пользователя снимаем Lock с документа, если пришел флаг unlock
      const checkEndAuthLockRes = yield* checkEndAuthLock(data.unlock, false, docId, userId);
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
        yield* publish({type: commonDefines.c_oPublishType.changes, docId: docId, userId: userId,
          changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
          locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo}, docId, userId);
      }
      // Автоматически снимаем lock сами и посылаем индекс для сохранения
      yield* unSaveLock(conn, changesIndex, newChangesLastTime);
      //last save
      let changeInfo = getExternalChangeInfo(conn.user, newChangesLastTime);
      yield resetForceSaveAfterChanges(docId, newChangesLastTime, puckerIndex, utils.getBaseUrlByConnection(conn), changeInfo);
    } else {
      let changesToSend = arrNewDocumentChanges;
      if(changesToSend.length > cfgPubSubMaxChanges) {
        changesToSend = null;
      } else {
        changesToSend.forEach((value) => {
          value.time = value.time.getTime();
        })
      }
      let isPublished = yield* publish({type: commonDefines.c_oPublishType.changes, docId: docId, userId: userId,
        changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
        locks: [], excelAdditionalInfo: undefined}, docId, userId);
      sendData(conn, {type: 'savePartChanges', changesIndex: changesIndex});
      if (!isPublished) {
        //stub for lockDocumentsTimerId
        yield* publish({type: commonDefines.c_oPublishType.changesNotify, docId: docId});
      }
    }
  }

  // Можем ли мы сохранять ?
  function* isSaveLock(conn) {
    let lockRes = yield editorData.lockSave(conn.docId, conn.user.id, cfgExpSaveLock);
    logger.debug("isSaveLock: docId = %s; lockRes: %s", conn.docId, lockRes);

    // Отправляем только тому, кто спрашивал (всем отправлять нельзя)
    sendData(conn, {type: "saveLock", saveLock: !lockRes});
  }

  // Снимаем лок с сохранения
  function* unSaveLock(conn, index, time) {
    var unlockRes = yield editorData.unlockSave(conn.docId, conn.user.id);
    if (commonDefines.c_oAscUnlockRes.Locked !== unlockRes) {
      sendData(conn, {type: 'unSaveLock', index: index, time: time});
    } else {
      logger.warn("unSaveLock failure: docId = %s; conn.user.id: %s", conn.docId, conn.user.id);
    }
  }

  // Возвращаем все сообщения для документа
  function* getMessages(conn) {
    let allMessages = yield editorData.getMessages(conn.docId);
    allMessages = allMessages.length > 0 ? allMessages : undefined;//todo client side
    sendDataMessage(conn, allMessages);
  }

  function* _checkLock(docId, arrayBlocks) {
    // Data is array now
    var isLock = false;
    var allLocks = yield* getAllLocks(docId);
    var documentLocks = {};
    for(var i = 0 ; i < allLocks.length; ++i) {
      var elem = allLocks[i];
      documentLocks[elem.block] =elem;
    }
    if (arrayBlocks.length > 0) {
      for (var i = 0; i < arrayBlocks.length; ++i) {
        var block = arrayBlocks[i];
        logger.info("getLock id: docId = %s %s", docId, block);
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

  function* _checkLockExcel(docId, arrayBlocks, userId) {
    // Data is array now
    var documentLock;
    var isLock = false;
    var isExistInArray = false;
    var i, blockRange;
    var documentLocks = yield* getAllLocks(docId);
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

  function* _checkLockPresentation(docId, arrayBlocks, userId) {
    // Data is array now
    var isLock = false;
    var i, documentLock, blockRange;
    var documentLocks = yield* getAllLocks(docId);
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

	function _checkLicense(conn) {
		return co(function* () {
			try {
				let rights = constants.RIGHTS.Edit;
				if (config.get('server.edit_singleton')) {
					// ToDo docId from url ?
					const docIdParsed = urlParse.exec(conn.url);
					if (docIdParsed && 1 < docIdParsed.length) {
						const participantsMap = yield getParticipantMap(docIdParsed[1]);
						for (let i = 0; i < participantsMap.length; ++i) {
							const elem = participantsMap[i];
							if (!elem.view) {
								rights = constants.RIGHTS.View;
								break;
							}
						}
					}
				}

				sendData(conn, {
					type: 'license', license: {
						type: licenseInfo.type,
						light: licenseInfo.light,
						mode: licenseInfo.mode,
						rights: rights,
						buildVersion: commonDefines.buildVersion,
						buildNumber: commonDefines.buildNumber,
						protectionSupport: cfgOpenProtectedFile, //todo find a better place
						branding: licenseInfo.branding,
						customization: licenseInfo.customization,
						plugins: licenseInfo.plugins
					}
				});
			} catch (err) {
				logger.error('_checkLicense error:\r\n%s', err.stack);
			}
		});
	}

	function* _checkLicenseAuth(userId) {
		let licenseWarningLimit = false;
		const c_LR = constants.LICENSE_RESULT;
		let licenseType = licenseInfo.type;
		if (c_LR.Success === licenseType || c_LR.SuccessLimit === licenseType) {
		if (licenseInfo.usersCount) {
				const nowUTC = getLicenseNowUtc();
				const arrUsers = yield editorData.getPresenceUniqueUser(nowUTC);
				if (arrUsers.length >= licenseInfo.usersCount && (-1 === arrUsers.findIndex((element) => {return element.userid === userId}))) {
					licenseType = c_LR.UsersCount;
				}
				licenseWarningLimit = licenseInfo.usersCount * cfgWarningLimitPercents <= arrUsers.length;
		} else {
				const connectionsCount = licenseInfo.connections;
				const editConnectionsCount = yield editorData.getEditorConnectionsCount(connections);
				if (editConnectionsCount >= connectionsCount) {
				  licenseType = c_LR.Connections;
				}
				licenseWarningLimit = connectionsCount * cfgWarningLimitPercents <= editConnectionsCount;
			  }
			  }

		if (c_LR.UsersCount === licenseType) {
		  if (!licenseInfo.hasLicense) {
		    licenseType = c_LR.UsersCountOS;
          }
		  logger.error('License: User limit exceeded!!!');
        } else if (c_LR.Connections === licenseType) {
		  if (!licenseInfo.hasLicense) {
		    licenseType = c_LR.ConnectionsOS;
          }
		  logger.error('License: Connection limit exceeded!!!');
        } else if (licenseWarningLimit) {
		  logger.warn('License: Warning limit exceeded!!!');
        }
		return licenseType;
	}

  sockjs_echo.installHandlers(server, {prefix: '/doc/['+constants.DOC_ID_PATTERN+']*/c', log: function(severity, message) {
    //TODO: handle severity
    logger.info(message);
  }});

  //publish subscribe message brocker
  function pubsubOnMessage(msg) {
    return co(function* () {
      try {
        logger.debug('pubsub message start:%s', msg);
        var data = JSON.parse(msg);
        var participants;
        var participant;
        var objChangesDocument;
        var i;
        let lockDocumentTimer, cmd;
        switch (data.type) {
          case commonDefines.c_oPublishType.drop:
            for (i = 0; i < data.users.length; ++i) {
              dropUserFromDocument(data.docId, data.users[i], data.description);
            }
            break;
          case commonDefines.c_oPublishType.closeConnection:
            closeUsersConnection(data.docId, data.usersMap, data.isOriginalId, data.code, data.description);
            break;
          case commonDefines.c_oPublishType.releaseLock:
            participants = getParticipants(data.docId, true, data.userId, true);
            _.each(participants, function(participant) {
              sendReleaseLock(participant, data.locks);
            });
            break;
          case commonDefines.c_oPublishType.participantsState:
            participants = getParticipants(data.docId, true, data.userId);
            sendParticipantsState(participants, data);
            break;
          case commonDefines.c_oPublishType.message:
            participants = getParticipants(data.docId, true, data.userId);
            _.each(participants, function(participant) {
              sendDataMessage(participant, data.messages);
            });
            break;
          case commonDefines.c_oPublishType.getLock:
            participants = getParticipants(data.docId, true, data.userId, true);
            sendGetLock(participants, data.documentLocks);
            break;
          case commonDefines.c_oPublishType.changes:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              logger.debug("lockDocumentsTimerId update c_oPublishType.changes: docId = %s", data.docId);
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
              yield* setLockDocumentTimer(data.docId, lockDocumentTimer.userId);
            }
            participants = getParticipants(data.docId, true, data.userId, true);
            if(participants.length > 0) {
              var changes = data.changes;
              if (null == changes) {
                objChangesDocument = yield* getDocumentChanges(data.docId, data.startIndex, data.changesIndex);
                changes = objChangesDocument.arrChanges;
              }
              _.each(participants, function(participant) {
                sendData(participant, {type: 'saveChanges', changes: changes,
                  changesIndex: data.changesIndex, locks: data.locks, excelAdditionalInfo: data.excelAdditionalInfo});
              });
            }
            break;
          case commonDefines.c_oPublishType.changesNotify:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              logger.debug("lockDocumentsTimerId update c_oPublishType.changesNotify: docId = %s", data.docId);
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
              yield* setLockDocumentTimer(data.docId, lockDocumentTimer.userId);
            }
            break;
          case commonDefines.c_oPublishType.auth:
            lockDocumentTimer = lockDocumentsTimerId[data.docId];
            if (lockDocumentTimer) {
              logger.debug("lockDocumentsTimerId clear: docId = %s", data.docId);
              cleanLockDocumentTimer(data.docId, lockDocumentTimer);
            }
            participants = getParticipants(data.docId, true, data.userId, true);
            if(participants.length > 0) {
              yield* sendAuthChanges(data.docId, participants);
              for (i = 0; i < participants.length; ++i) {
                participant = participants[i];
                yield* sendAuthInfo(participant, false, data.participantsMap);
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
                  outputData.setData(yield storage.getSignedUrls(participant.baseUrl, data.needUrlKey, data.needUrlType, data.creationDate));
                } else if (1 == data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey, data.needUrlType, undefined, data.creationDate));
                } else {
                  let url;
                  if (cmd.getInline()) {
                    url = canvasService.getPrintFileUrl(data.needUrlKey, participant.baseUrl, cmd.getTitle());
                    outputData.setExtName('.pdf');
                  } else {
                    url = yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey, data.needUrlType, cmd.getTitle(), data.creationDate);
                    outputData.setExtName(pathModule.extname(data.needUrlKey));
                  }
                  outputData.setData(url);
                }
                modifyConnectionForPassword(participant, data.needUrlIsCorrectPassword);
              }
              sendData(participant, output);
            }
            break;
          case commonDefines.c_oPublishType.warning:
            participants = getParticipants(data.docId);
            _.each(participants, function(participant) {
              sendDataWarning(participant, data.description);
            });
            break;
          case commonDefines.c_oPublishType.cursor:
            participants = getParticipants(data.docId, true, data.userId);
            _.each(participants, function(participant) {
              sendDataCursor(participant, data.messages);
            });
            break;
          case commonDefines.c_oPublishType.shutdown:
            //flag prevent new socket connections and receive data from exist connections
            shutdownFlag = data.status;
            logger.debug('start shutdown:%b', shutdownFlag);
            if (shutdownFlag) {
              logger.debug('active connections: %d', connections.length);
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
            logger.debug('end shutdown');
            break;
          case commonDefines.c_oPublishType.meta:
            participants = getParticipants(data.docId);
            _.each(participants, function(participant) {
              sendDataMeta(participant, data.meta);
            });
            break;
          case commonDefines.c_oPublishType.forceSave:
            participants = getParticipants(data.docId, true, data.userId, true);
            _.each(participants, function(participant) {
              sendData(participant, {type: "forceSave", messages: data.data});
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
                logger.debug('changeConnectionInfo: docId = %s, userId = %s', data.docId, data.useridoriginal);
                participant.user.username = cmd.getUserName();
                yield addPresence(participant, false);
                if (cfgTokenEnableBrowser) {
                  sendDataRefreshToken(participant);
                }
              }
            }
            if (hasChanges) {
              let participants = yield getParticipantMap(data.docId);
              let participantsTimestamp = Date.now();
              yield* publish({type: commonDefines.c_oPublishType.participantsState, docId: data.docId, userId: null, participantsTimestamp: participantsTimestamp, participants: participants});
            }
            break;
          case commonDefines.c_oPublishType.rpc:
            participants = getParticipants(data.docId, true, data.userId, true);
            _.each(participants, function(participant) {
                sendDataRpc(participant, data.responseKey, data.data);
            });
            break;
          default:
            logger.debug('pubsub unknown message type:%s', msg);
        }
      } catch (err) {
        logger.error('pubsub message error:\r\n%s', err.stack);
      }
    });
  }

  function* collectStats(countEdit, countView) {
    let now = Date.now();
    yield editorData.setEditorConnections(countEdit, countView, now, PRECISION);
  }
  function expireDoc() {
    return co(function* () {
      try {
        var countEditByShard = 0;
        var countViewByShard = 0;
        logger.debug('expireDoc connections.length = %d', connections.length);
        var nowMs = new Date().getTime();
        var maxMs = nowMs + Math.max(cfgExpSessionCloseCommand, expDocumentsStep);
        for (var i = 0; i < connections.length; ++i) {
          var conn = connections[i];
          //wopi access_token_ttl;
          if (cfgExpSessionAbsolute > 0 || conn.access_token_ttl) {
            if ((cfgExpSessionAbsolute > 0 && maxMs - conn.sessionTimeConnect > cfgExpSessionAbsolute ||
              (conn.access_token_ttl && maxMs > conn.access_token_ttl)) && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(conn, {
                code: constants.SESSION_ABSOLUTE_CODE,
                reason: constants.SESSION_ABSOLUTE_REASON
              });
            } else if (nowMs - conn.sessionTimeConnect > cfgExpSessionAbsolute) {
              conn.close(constants.SESSION_ABSOLUTE_CODE, constants.SESSION_ABSOLUTE_REASON);
              continue;
            }
          }
          if (cfgExpSessionIdle > 0) {
            if (maxMs - conn.sessionTimeLastAction > cfgExpSessionIdle && !conn.sessionIsSendWarning) {
              conn.sessionIsSendWarning = true;
              sendDataSession(conn, {
                code: constants.SESSION_IDLE_CODE,
                reason: constants.SESSION_IDLE_REASON,
                interval: cfgExpSessionIdle
              });
            } else if (nowMs - conn.sessionTimeLastAction > cfgExpSessionIdle) {
              conn.close(constants.SESSION_IDLE_CODE, constants.SESSION_IDLE_REASON);
              continue;
            }
          }
          if (constants.CONN_CLOSED === conn.readyState) {
            logger.error('expireDoc connection closed docId = %s', conn.docId);
          }
          yield addPresence(conn, false);
          if (conn.isCloseCoAuthoring || (conn.user && conn.user.view)) {
            countViewByShard++;
          } else {
            countEditByShard++;
          }
        }
        yield* collectStats(countEditByShard, countViewByShard);
        yield editorData.setEditorConnectionsCountByShard(SHARD_ID, countEditByShard);
        yield editorData.setViewerConnectionsCountByShard(SHARD_ID, countViewByShard);
        if (clientStatsD) {
          let countEdit = yield editorData.getEditorConnectionsCount(connections);
          clientStatsD.gauge('expireDoc.connections.edit', countEdit);
          let countView = yield editorData.getViewerConnectionsCount(connections);
          clientStatsD.gauge('expireDoc.connections.view', countView);
        }
      } catch (err) {
        logger.error('expireDoc error:\r\n%s', err.stack);
      } finally {
        setTimeout(expireDoc, expDocumentsStep);
      }
    });
  }
  setTimeout(expireDoc, expDocumentsStep);
  function refreshWopiLock() {
    return co(function* () {
      try {
        logger.info('refreshWopiLock start');
        let docIds = new Map();
        for (let i = 0; i < connections.length; ++i) {
          let conn = connections[i];
          let docId = conn.docId;
          if ((conn.user && conn.user.view) || docIds.has(docId)) {
            continue;
          }
          docIds.set(docId, 1);
          if (undefined === conn.access_token_ttl) {
            continue;
          }
          let selectRes = yield taskResult.select(docId);
          if (selectRes.length > 0 && selectRes[0] && selectRes[0].callback) {
            let callback = selectRes[0].callback;
            let callbackUrl = sqlBase.UserCallback.prototype.getCallbackByUserIndex(docId, callback);
            let wopiParams = wopiClient.parseWopiCallback(docId, callbackUrl, callback);
            if (wopiParams) {
              yield wopiClient.lock('REFRESH_LOCK', wopiParams.commonInfo.lockId,
                                    wopiParams.commonInfo.fileInfo, wopiParams.userAuth);
            }
          }
        }
      } catch (err) {
        logger.error('refreshWopiLock error:%s', err.stack);
      } finally {
        logger.info('refreshWopiLock end');
        setTimeout(refreshWopiLock, cfgRefreshLockInterval);
      }
    });
  }
  setTimeout(refreshWopiLock, cfgRefreshLockInterval);

  pubsub = new pubsubService();
  pubsub.on('message', pubsubOnMessage);
  pubsub.init(function(err) {
    if (null != err) {
      logger.error('createPubSub error :\r\n%s', err.stack);
    }

    queue = new queueService();
    queue.on('dead', handleDeadLetter);
    queue.on('response', canvasService.receiveTask);
    queue.init(true, true, false, true, true, true, function(err){
      if (null != err) {
        logger.error('createTaskQueue error :\r\n%s', err.stack);
      }
      gc.startGC();
      callbackFunction();
    });
  });
};
exports.setLicenseInfo = function(data, original ) {
  licenseInfo = data;
  licenseOriginal = original;
};
exports.getLicenseInfo = function() {
  return licenseInfo;
};
exports.healthCheck = function(req, res) {
  return co(function*() {
    let output = false;
    try {
      logger.debug('healthCheck start');
      let promises = [];
      //database
      promises.push(sqlBase.healthCheck());
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
      yield storage.putObject(tempName, tempBuffer, tempBuffer.length);
      try {
        //try to prevent case, when another process can remove same tempName
        yield storage.deleteObject(tempName);
      } catch (err) {
        logger.warn('healthCheck error\r\n%s', err.stack);
      }

      output = true;
      logger.debug('healthCheck end');
    } catch (err) {
      logger.error('healthCheck error\r\n%s', err.stack);
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
        editorConnectionsCount: 0,
        uniqueUserCount: 0,
        anonymousUserCount: 0,
        byMonth: null
		}
	};
    Object.assign(output.licenseInfo, licenseInfo);
    try {
      logger.debug('licenseInfo start');
      var precisionSum = {};
      for (let i = 0; i < PRECISION.length; ++i) {
        precisionSum[PRECISION[i].name] = {
          edit: {min: Number.MAX_VALUE, sum: 0, count: 0, max: 0},
          view: {min: Number.MAX_VALUE, sum: 0, count: 0, max: 0}
        };
        output.connectionsStat[PRECISION[i].name] = {
          edit: {min: 0, avr: 0, max: 0},
          view: {min: 0, avr: 0, max: 0}
        };
      }
      var redisRes = yield editorData.getEditorConnections();
      const now = Date.now();
      var precisionIndex = 0;
      for (let i = redisRes.length - 1; i >= 1; i -= 2) {
        for (let j = precisionIndex; j < PRECISION.length; ++j) {
          let elem = redisRes[i];
          if (now - elem.time < PRECISION[j].val) {
            let precision = precisionSum[PRECISION[j].name];
            precision.edit.min = Math.min(precision.edit.min, elem.edit);
            precision.edit.max = Math.max(precision.edit.max, elem.edit);
            precision.edit.sum += elem.edit;
            precision.edit.count++;
            precision.view.min = Math.min(precision.view.min, elem.view);
            precision.view.max = Math.max(precision.view.max, elem.view);
            precision.view.sum += elem.view;
            precision.view.count++;
          } else {
            precisionIndex = j + 1;
          }
        }
      }
      for (let i in precisionSum) {
        let precision = precisionSum[i];
        let precisionOut = output.connectionsStat[i];
        if (precision.edit.count > 0) {
          precisionOut.edit.avr = Math.round(precision.edit.sum / precision.edit.count);
          precisionOut.edit.min = precision.edit.min;
          precisionOut.edit.max = precision.edit.max;
        }
        if (precision.view.count > 0) {
          precisionOut.view.avr = Math.round(precision.view.sum / precision.view.count);
          precisionOut.view.min = precision.view.min;
          precisionOut.view.max = precision.view.max;
        }
      }
      const nowUTC = getLicenseNowUtc();
      let execRes = yield editorData.getPresenceUniqueUser(nowUTC);
      output.quota.uniqueUserCount = execRes.length;
      execRes.forEach(function(elem) {
        if (elem.anonym) {
          output.quota.anonymousUserCount++;
        }
      });
      output.quota.byMonth = yield editorData.getPresenceUniqueUsersOfMonth();
      output.quota.byMonth.sort((a, b) => {
        return a.date.localeCompare(b.date);
      });
      output.quota.editorConnectionsCount = yield editorData.getEditorConnectionsCount(connections);
      logger.debug('licenseInfo end');
    } catch (err) {
      isError = true;
      logger.error('licenseInfo error\r\n%s', err.stack);
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
let commandLicense = co.wrap(function*() {
  const nowUTC = getLicenseNowUtc();
  let users = yield editorData.getPresenceUniqueUser(nowUTC);
  return {
    license: licenseOriginal || utils.convertLicenseInfoToFileParams(licenseInfo),
    server: utils.convertLicenseInfoToServerParams(licenseInfo),
    quota: {users: users}
  };
});
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (req, res) {
  return co(function* () {
    let result = commonDefines.c_oAscServerCommandErrors.NoError;
    let docId = 'commandFromServer';
    let version = undefined;
    let outputLicense = undefined;
    try {
      let authRes = getRequestParams(docId, req);
      let params = authRes.params;
      if(authRes.code === constants.VKEY_KEY_EXPIRE){
        result = commonDefines.c_oAscServerCommandErrors.TokenExpire;
      } else if(authRes.code !== constants.NO_ERROR){
        result = commonDefines.c_oAscServerCommandErrors.Token;
      }
      // Ключ id-документа
      docId = params.key;
      if (commonDefines.c_oAscServerCommandErrors.NoError === result && null == docId && 'version' !== params.c && 'license' !== params.c) {
        result = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
      } else if(commonDefines.c_oAscServerCommandErrors.NoError === result) {
        logger.debug('Start commandFromServer: docId = %s c = %s', docId, params.c);
        switch (params.c) {
          case 'info':
            //If no files in the database means they have not been edited.
            const selectRes = yield taskResult.select(docId);
            if (selectRes.length > 0) {
              result = yield* bindEvents(docId, params.callback, utils.getBaseUrlByRequest(req), undefined, params.userdata);
            } else {
              result = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
            }
            break;
          case 'drop':
            if (params.userid) {
              yield* publish({type: commonDefines.c_oPublishType.drop, docId: docId, users: [params.userid], description: params.description});
            } else if (params.users) {
              const users = (typeof params.users === 'string') ? JSON.parse(params.users) : params.users;
              yield* dropUsersFromDocument(docId, users);
            } else {
              result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            }
            break;
          case 'saved':
            // Результат от менеджера документов о статусе обработки сохранения файла после сборки
            if ('1' !== params.status) {
              //запрос saved выполняется синхронно, поэтому заполняем переменную чтобы проверить ее после sendServerRequest
              yield editorData.setSaved(docId, params.status);
              logger.warn('saved corrupted id = %s status = %s conv = %s', docId, params.status, params.conv);
            } else {
              logger.info('saved id = %s status = %s conv = %s', docId, params.status, params.conv);
            }
            break;
          case 'forcesave':
            let forceSaveRes = yield startForceSave(docId, commonDefines.c_oAscForceSaveTypes.Command, params.userdata, undefined, undefined, undefined, undefined, utils.getBaseUrlByRequest(req));
            result = forceSaveRes.code;
            break;
          case 'meta':
            if (params.meta) {
              yield* publish({type: commonDefines.c_oPublishType.meta, docId: docId, meta: params.meta});
            } else {
              result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            }
            break;
          case 'version':
              version = commonDefines.buildVersion + '.' + commonDefines.buildNumber;
            break;
          case 'license':
              outputLicense = yield commandLicense();
            break;
          default:
            result = commonDefines.c_oAscServerCommandErrors.UnknownCommand;
            break;
        }
      }
    } catch (err) {
      result = commonDefines.c_oAscServerCommandErrors.UnknownError;
      logger.error('Error commandFromServer: docId = %s\r\n%s', docId, err.stack);
    } finally {
      //undefined value are excluded in JSON.stringify
      let output = {'key': docId, 'error': result, 'version': version};
      if (outputLicense) {
        Object.assign(output, outputLicense);
      }
      logger.debug('End commandFromServer: docId = %s %j', docId, output);
      const outputBuffer = Buffer.from(JSON.stringify(output), 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', outputBuffer.length);
      res.send(outputBuffer);
    }
  });
};

exports.shutdown = function(req, res) {
  return co(function*() {
    let output = false;
    try {
      output = yield shutdown.shutdown(editorData, req.method === 'PUT');
    } catch (err) {
      logger.error('shutdown error\r\n%s', err.stack);
    } finally {
      res.setHeader('Content-Type', 'text/plain');
      res.send(output.toString());
    }
  });
};
