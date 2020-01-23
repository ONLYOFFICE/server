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
const cron = require('cron');
const co = require('co');
const jwt = require('jsonwebtoken');
const jwa = require('jwa');
const ms = require('ms');
const deepEqual  = require('deep-equal');
const storage = require('./../../Common/sources/storage-base');
const logger = require('./../../Common/sources/logger');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const statsDClient = require('./../../Common/sources/statsdclient');
const configCommon = require('config');
const config = configCommon.get('services.CoAuthoring');
const sqlBase = require('./baseConnector');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const taskResult = require('./taskresult');
const redis = require(config.get('redis.name'));
const pubsubRedis = require('./pubsubRedis');
const pubsubService = require('./' + config.get('pubsub.name'));
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const rabbitMQCore = require('./../../Common/sources/rabbitMQCore');
const activeMQCore = require('./../../Common/sources/activeMQCore');
let cfgEditor = JSON.parse(JSON.stringify(config.get('editor')));
cfgEditor['reconnection']['delay'] = ms(cfgEditor['reconnection']['delay']);
const cfgCallbackRequestTimeout = config.get('server.callbackRequestTimeout');
//The waiting time to document assembly when all out(not 0 in case of F5 in the browser)
const cfgAscSaveTimeOutDelay = config.get('server.savetimeoutdelay');

const cfgPubSubMaxChanges = config.get('pubsub.maxChanges');

const cfgRedisPrefix = config.get('redis.prefix');
const cfgExpSaveLock = config.get('expire.saveLock');
const cfgExpPresence = config.get('expire.presence');
const cfgExpLocks = config.get('expire.locks');
const cfgExpChangeIndex = config.get('expire.changeindex');
const cfgExpLockDoc = config.get('expire.lockDoc');
const cfgExpMessage = config.get('expire.message');
const cfgExpLastSave = config.get('expire.lastsave');
const cfgExpForceSave = config.get('expire.forcesave');
const cfgExpSaved = config.get('expire.saved');
const cfgExpDocumentsCron = config.get('expire.documentsCron');
const cfgExpSessionIdle = ms(config.get('expire.sessionidle'));
const cfgExpSessionAbsolute = ms(config.get('expire.sessionabsolute'));
const cfgExpSessionCloseCommand = ms(config.get('expire.sessionclosecommand'));
const cfgExpUpdateVersionStatus = ms(config.get('expire.updateVersionStatus'));
const cfgSockjs = config.get('sockjs');
const cfgTokenEnableBrowser = config.get('token.enable.browser');
const cfgTokenEnableRequestInbox = config.get('token.enable.request.inbox');
const cfgTokenEnableRequestOutbox = config.get('token.enable.request.outbox');
const cfgTokenSessionAlgorithm = config.get('token.session.algorithm');
const cfgTokenSessionExpires = ms(config.get('token.session.expires'));
const cfgTokenInboxHeader = config.get('token.inbox.header');
const cfgTokenInboxPrefix = config.get('token.inbox.prefix');
const cfgTokenInboxInBody = config.get('token.inbox.inBody');
const cfgTokenOutboxInBody = config.get('token.outbox.inBody');
const cfgTokenBrowserSecretFromInbox = config.get('token.browser.secretFromInbox');
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

const redisKeySaveLock = cfgRedisPrefix + constants.REDIS_KEY_SAVE_LOCK;
const redisKeyPresenceHash = cfgRedisPrefix + constants.REDIS_KEY_PRESENCE_HASH;
const redisKeyPresenceSet = cfgRedisPrefix + constants.REDIS_KEY_PRESENCE_SET;
const redisKeyLocks = cfgRedisPrefix + constants.REDIS_KEY_LOCKS;
const redisKeyLockDoc = cfgRedisPrefix + constants.REDIS_KEY_LOCK_DOCUMENT;
const redisKeyMessage = cfgRedisPrefix + constants.REDIS_KEY_MESSAGE;
const redisKeyDocuments = cfgRedisPrefix + constants.REDIS_KEY_DOCUMENTS;
const redisKeyLastSave = cfgRedisPrefix + constants.REDIS_KEY_LAST_SAVE;
const redisKeyForceSave = cfgRedisPrefix + constants.REDIS_KEY_FORCE_SAVE;
const redisKeyForceSaveTimer = cfgRedisPrefix + constants.REDIS_KEY_FORCE_SAVE_TIMER;
const redisKeyForceSaveTimerLock = cfgRedisPrefix + constants.REDIS_KEY_FORCE_SAVE_TIMER_LOCK;
const redisKeySaved = cfgRedisPrefix + constants.REDIS_KEY_SAVED;
const redisKeyPresenceUniqueUsers = cfgRedisPrefix + constants.REDIS_KEY_PRESENCE_UNIQUE_USERS;
const redisKeyEditorConnections = cfgRedisPrefix + constants.REDIS_KEY_EDITOR_CONNECTIONS;

const EditorTypes = {
  document : 0,
  spreadsheet : 1,
  presentation : 2
};

const defaultHttpPort = 80, defaultHttpsPort = 443;	// Порты по умолчанию (для http и https)
const redisClient = pubsubRedis.getClientRedis();
const clientStatsD = statsDClient.getClient();
let connections = []; // Активные соединения
let lockDocumentsTimerId = {};//to drop connection that can't unlockDocument
let pubsub;
let queue;
let licenseInfo = {type: constants.LICENSE_RESULT.Error, light: false, branding: false, customization: false, plugins: false};
let shutdownFlag = false;

const MIN_SAVE_EXPIRATION = 60000;
const FORCE_SAVE_EXPIRATION = Math.min(Math.max(cfgForceSaveInterval, MIN_SAVE_EXPIRATION),
                                       cfgQueueRetentionPeriod * 1000);
const HEALTH_CHECK_KEY_MAX = 10000;

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

function sendData(conn, data) {
  conn.write(JSON.stringify(data));
  const type = data ? data.type : null;
  logger.debug('sendData: docId = %s;type = %s', conn.docId, type);
}
function sendDataWarning(conn, msg) {
  sendData(conn, {type: "warning", message: msg});
}
function sendDataMessage(conn, msg) {
  sendData(conn, {type: "message", messages: msg});
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
function sendDataRefreshToken(conn, msg) {
  sendData(conn, {type: "refreshToken", messages: msg});
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
function getConnectionInfo(conn) {
  var user = conn.user;
  var data = {
    id: user.id,
    idOriginal: user.idOriginal,
    username: user.username,
    indexUser: user.indexUser,
    view: user.view,
    connectionId: conn.id,
    isCloseCoAuthoring: conn.isCloseCoAuthoring
  };
  return JSON.stringify(data);
}
function updatePresenceCommandsToArray(outCommands, docId, userId, userInfo) {
  const expireAt = new Date().getTime() + cfgExpPresence * 1000;
  outCommands.push(
    ['zadd', redisKeyPresenceSet + docId, expireAt, userId],
    ['hset', redisKeyPresenceHash + docId, userId, userInfo],
    ['expire', redisKeyPresenceSet + docId, cfgExpPresence],
    ['expire', redisKeyPresenceHash + docId, cfgExpPresence]
  );
}
function* updatePresence(docId, userId, connInfo) {
  const multi = redisClient.multi(getUpdatePresenceCommands(docId, userId, connInfo));
  yield utils.promiseRedis(multi, multi.exec);
}
function* updateEditUsers(userId) {
  if (!licenseInfo.usersCount) {
    return;
  }
  const now = new Date();
  const expireAt = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) / 1000 +
      licenseInfo.usersExpire - 1;
  yield utils.promiseRedis(redisClient, redisClient.zadd, redisKeyPresenceUniqueUsers, expireAt, userId);
}
function getUpdatePresenceCommands(docId, userId, connInfo) {
  const commands = [];
  updatePresenceCommandsToArray(commands, docId, userId, connInfo);
  const expireAt = new Date().getTime() + cfgExpPresence * 1000;
  commands.push(['zadd', redisKeyDocuments, expireAt, docId]);
  return commands;
}
function* getAllPresence(docId, opt_userId, opt_connInfo) {
  let now = (new Date()).getTime();
  let commands;
  if(null != opt_userId && null != opt_connInfo){
    commands = getUpdatePresenceCommands(docId, opt_userId, opt_connInfo);
  } else {
    commands = [];
  }
  commands.push(['zrangebyscore', redisKeyPresenceSet + docId, 0, now], ['hvals', redisKeyPresenceHash + docId]);
  let multi = redisClient.multi(commands);
  let multiRes = yield utils.promiseRedis(multi, multi.exec);
  let expiredKeys = multiRes[multiRes.length - 2];
  let hvals = multiRes[multiRes.length - 1];
  if (expiredKeys.length > 0) {
    commands = [
      ['zremrangebyscore', redisKeyPresenceSet + docId, 0, now]
    ];
    let expiredKeysMap = {};
    for (let i = 0; i < expiredKeys.length; ++i) {
      let expiredKey = expiredKeys[i];
      expiredKeysMap[expiredKey] = 1;
      commands.push(['hdel', redisKeyPresenceHash + docId, expiredKey]);
    }
    multi = redisClient.multi(commands);
    yield utils.promiseRedis(multi, multi.exec);
    hvals = hvals.filter(function(curValue) {
      return null == expiredKeysMap[curValue];
    })
  }
  return hvals;
}
function* getEditorsCount(docId, opt_hvals) {
  var elem, editorsCount = 0;
  var hvals;
  if(opt_hvals){
    hvals = opt_hvals;
  } else {
    hvals = yield* getAllPresence(docId);
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
  var hvals = yield* getAllPresence(docId);
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
    var hvals = yield* getAllPresence(optDocId);
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
  var hvals = yield* getAllPresence(docId);
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
  if (cfgTokenEnableRequestOutbox) {
    auth = utils.fillJwtForRequest(dataObject);
    if (cfgTokenOutboxInBody) {
      dataObject = {token: auth};
      auth = undefined;
    } else if (opt_checkAuthorization && !opt_checkAuthorization(auth, dataObject)) {
      auth = utils.fillJwtForRequest(dataObject);
      logger.warn('authorization reduced to: docId = %s; length=%d', docId, auth.length);
    }
  }
  let res = yield utils.postRequestPromise(uri, JSON.stringify(dataObject), cfgCallbackRequestTimeout, auth);
  logger.debug('postData response: docId = %s;data = %s', docId, res);
  return res;
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
  var selectRes = yield taskResult.select(id);
  if (selectRes.length > 0) {
    var row = selectRes[0];
    if (row.callback) {
      callbackUrl = sqlBase.UserCallback.prototype.getCallbackByUserIndex(id, row.callback, opt_userIndex);
    }
    if (row.baseurl) {
      baseUrl = row.baseurl;
    }
  }
  if (null != callbackUrl && null != baseUrl) {
    return {server: parseUrl(callbackUrl), baseUrl: baseUrl};
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
function* getLastSave(docId) {
  var res = yield utils.promiseRedis(redisClient, redisClient.hgetall, redisKeyLastSave + docId);
  if (res) {
    if (res.time) {
      res.time = parseInt(res.time);
    }
    if (res.index) {
      res.index = parseInt(res.index);
    }
  }
  return res;
}
function getForceSaveIndex(time, index) {
  return time + '_' + index;
}
function* setForceSave(docId, forceSave, cmd, success) {
  let forceSaveIndex = getForceSaveIndex(forceSave.getTime(), forceSave.getIndex());
  if (success) {
    yield utils.promiseRedis(redisClient, redisClient.hset, redisKeyForceSave + docId, forceSaveIndex, true);
  } else {
    yield utils.promiseRedis(redisClient, redisClient.hdel, redisKeyForceSave + docId, forceSaveIndex);
  }
  let forceSaveType = forceSave.getType();
  if (commonDefines.c_oAscForceSaveTypes.Command !== forceSaveType) {
    yield* publish({
                     type: commonDefines.c_oPublishType.forceSave, docId: docId,
                     data: {type: forceSaveType, time: forceSave.getTime(), success: success}
                   }, cmd.getUserConnectionId());
  }
}
function* getLastForceSave(docId, lastSave) {
  let res = false;
  if (lastSave) {
    let forceSaveIndex = getForceSaveIndex(lastSave.time, lastSave.index);
    let forceSave = yield utils.promiseRedis(redisClient, redisClient.hget, redisKeyForceSave + docId, forceSaveIndex);
    if (forceSave) {
      res = true;
    }
  }
  return res;
}
function* startForceSave(docId, type, opt_userdata, opt_userConnectionId, opt_baseUrl, opt_queue, opt_pubsub) {
  logger.debug('startForceSave start:docId = %s', docId);
  let res = {code: commonDefines.c_oAscServerCommandErrors.NoError, time: null};
  let lastSave = null;
  if (!shutdownFlag) {
    lastSave = yield* getLastSave(docId);
    if (lastSave && undefined !== lastSave.time && undefined !== lastSave.index) {
      let forceSaveIndex = getForceSaveIndex(lastSave.time, lastSave.index);
      let multi = redisClient.multi([
                                      ['hsetnx', redisKeyForceSave + docId, forceSaveIndex, false],
                                      ['expire', redisKeyForceSave + docId, cfgExpForceSave]
                                    ]);
      let execRes = yield utils.promiseRedis(multi, multi.exec);
      //hsetnx 0 if field already exists
      if (0 == execRes[0]) {
        lastSave = null;
      }
    } else {
      lastSave = null;
    }
  }
  if (lastSave) {
    logger.debug('startForceSave lastSave:docId = %s; lastSave = %j', docId, lastSave);
    let baseUrl = opt_baseUrl || lastSave.baseUrl;
    let forceSave = new commonDefines.CForceSaveData(lastSave);
    forceSave.setType(type);

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
    let status = yield* converterService.convertFromChanges(docId, baseUrl, forceSave, opt_userdata,
                                                            opt_userConnectionId, priority, expiration, opt_queue);
    if (constants.NO_ERROR === status.err) {
      res.time = forceSave.getTime();
    } else {
      res.code = commonDefines.c_oAscServerCommandErrors.UnknownError;
    }
    logger.debug('startForceSave convertFromChanges:docId = %s; status = %d', docId, status.err);
  } else {
    res.code = commonDefines.c_oAscServerCommandErrors.NotModified;
    logger.debug('startForceSave NotModified no changes:docId = %s', docId);
  }
  logger.debug('startForceSave end:docId = %s', docId);
  return res;
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
          let lastSave = yield* getLastSave(docId);
          //check that there are no new changes
          if (lastSave && forceSave.getTime() === lastSave.time && forceSave.getIndex() === lastSave.index) {
            //requeue task
            yield* addTask(task, constants.QUEUE_PRIORITY_VERY_LOW, undefined, FORCE_SAVE_EXPIRATION);
            isRequeued = true;
          }
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
    }
  }
  if (null == opt_callback) {
    return;
  }

  var status = c_oAscServerStatus.Editing;
  var participants = yield* getOriginalParticipantsId(docId);
  if (0 === participants.length) {
    var puckerIndex = yield* getChangesIndex(docId);
    if (!(puckerIndex > 0) || opt_forceClose) {
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

  var sendData = new commonDefines.OutputSfcData();
  sendData.setKey(docId);
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
    if (getRes) {
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

function* cleanDocumentOnExit(docId, deleteChanges) {
  //clean redis (redisKeyPresenceSet and redisKeyPresenceHash removed with last element)
  var redisArgs = [redisClient, redisClient.del, redisKeyLocks + docId,
      redisKeyMessage + docId, redisKeyForceSave + docId, redisKeyLastSave + docId];
  utils.promiseRedis.apply(this, redisArgs);
  //remove changes
  if (deleteChanges) {
    sqlBase.deleteChanges(docId, null);
    //delete forgotten after successful send on callbackUrl
    yield storage.deletePath(cfgForgottenFiles + '/' + docId);
  }
}
function* cleanDocumentOnExitNoChanges(docId, opt_userId, opt_userIndex, opt_forceClose) {
  var userAction = opt_userId ? new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, opt_userId) : null;
  // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
  yield* sendStatusDocument(docId, c_oAscChangeBase.No, userAction, opt_userIndex, undefined, undefined, undefined, opt_forceClose);
  //если пользователь зашел в документ, соединение порвалось, на сервере удалилась вся информация,
  //при восстановлении соединения userIndex сохранится и он совпадет с userIndex следующего пользователя
  yield* cleanDocumentOnExit(docId, false);
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
    res.decoded = jwt.verify(token, secret);
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
function checkJwtHeader(docId, req) {
  var authorization = req.get(cfgTokenInboxHeader);
  if (authorization && authorization.startsWith(cfgTokenInboxPrefix)) {
    var token = authorization.substring(cfgTokenInboxPrefix.length);
    return checkJwt(docId, token, commonDefines.c_oAscSecretType.Inbox);
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
  if (req.body && Buffer.isBuffer(req.body) && !opt_isNotInBody) {
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

exports.c_oAscServerStatus = c_oAscServerStatus;
exports.sendData = sendData;
exports.parseUrl = parseUrl;
exports.parseReplyData = parseReplyData;
exports.sendServerRequest = sendServerRequest;
exports.createSaveTimerPromise = co.wrap(_createSaveTimer);
exports.getAllPresencePromise = co.wrap(getAllPresence);
exports.publish = publish;
exports.addTask = addTask;
exports.addDelayed = addDelayed;
exports.removeResponse = removeResponse;
exports.hasEditors = hasEditors;
exports.getEditorsCountPromise = co.wrap(getEditorsCount);
exports.getCallback = getCallback;
exports.getIsShutdown = getIsShutdown;
exports.getChangesIndexPromise = co.wrap(getChangesIndex);
exports.cleanDocumentOnExitPromise = co.wrap(cleanDocumentOnExit);
exports.cleanDocumentOnExitNoChangesPromise = co.wrap(cleanDocumentOnExitNoChanges);
exports.setForceSave = setForceSave;
exports.getLastSave = getLastSave;
exports.getLastForceSave = getLastForceSave;
exports.startForceSavePromise = co.wrap(startForceSave);
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
            cmd.fillFromConnection(conn);
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
              forceSaveRes = yield* startForceSave(docId, commonDefines.c_oAscForceSaveTypes.Button, undefined, conn.user.id);
            } else {
              forceSaveRes = {code: commonDefines.c_oAscServerCommandErrors.UnknownError, time: null};
            }
            sendData(conn, {type: "forceSaveStart", messages: forceSaveRes});
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
        var multi = redisClient.multi([['hdel', redisKeyPresenceHash + docId, tmpUser.id],
                                        ['zrem', redisKeyPresenceSet + docId, tmpUser.id]]);
        yield utils.promiseRedis(multi, multi.exec);
        hvals = yield* getAllPresence(docId);
        participantsTimestamp = Date.now();
        if (hvals.length <= 0) {
          yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docId);
        }
      }
    } else {
      if (!conn.isCloseCoAuthoring) {
        tmpUser.view = true;
        conn.isCloseCoAuthoring = true;
        yield* updatePresence(docId, tmpUser.id, getConnectionInfo(conn));
        if (cfgTokenEnableBrowser) {
          sendDataRefreshToken(conn, fillJwtByConnection(conn));
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
      let participants = yield* getParticipantMap(docId, undefined, undefined, hvals);
      if (!participantsTimestamp) {
        participantsTimestamp = Date.now();
      }
      yield* publish({type: commonDefines.c_oPublishType.participantsState, docId: docId, userId: tmpUser.id, participantsTimestamp: participantsTimestamp, participants: participants}, docId, tmpUser.id);
      tmpUser.view = tmpView;

      // Для данного пользователя снимаем лок с сохранения
      var saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + docId);
      if (conn.user.id == saveLock) {
        yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);
      }

      // Только если редактируем
      if (false === isView) {
        bHasEditors = yield* hasEditors(docId, hvals);
        var puckerIndex = yield* getChangesIndex(docId);
        bHasChanges = puckerIndex > 0;

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
        userLocks = yield* getUserLocks(docId, conn.user.id);
        if (0 < userLocks.length) {
          //todo на close себе ничего не шлем
          //sendReleaseLock(conn, userLocks);
          yield* publish({type: commonDefines.c_oPublishType.releaseLock, docId: docId, userId: conn.user.id, locks: userLocks}, docId, conn.user.id);
        }

        // Для данного пользователя снимаем Lock с документа
        yield* checkEndAuthLock(true, false, docId, conn.user.id);

        let userIndex = utils.getIndexFromUserId(tmpUser.id, tmpUser.idOriginal)
        // Если у нас нет пользователей, то удаляем все сообщения
        if (!bHasEditors) {
          // На всякий случай снимаем lock
          yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);

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
            yield* cleanDocumentOnExit(docId);
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
      var tmpUser = conn.user;
      //remove presence(other data was removed before in closeDocument)
      var multi = redisClient.multi([
                                      ['hdel', redisKeyPresenceHash + docIdOld, tmpUser.id],
                                      ['zrem', redisKeyPresenceSet + docIdOld, tmpUser.id]
                                    ]);
      yield utils.promiseRedis(multi, multi.exec);
      var hvals = yield* getAllPresence(docIdOld);
      if (hvals.length <= 0) {
        yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docIdOld);
      }

      //apply new
      conn.docId = docIdNew;
      yield* updatePresence(docIdNew, tmpUser.id, getConnectionInfo(conn));
      if (cfgTokenEnableBrowser) {
        sendDataRefreshToken(conn, fillJwtByConnection(conn));
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
    var docLock = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyLocks + docId, 0, -1);
    for (var i = 0; i < docLock.length; ++i) {
      docLockRes.push(JSON.parse(docLock[i]));
    }
    return docLockRes;
  }
  function* addLocks(docId, toCache, isReplace) {
    if (toCache && toCache.length > 0) {
      toCache.unshift('rpush', redisKeyLocks + docId);
      var multiArgs = [toCache, ['expire', redisKeyLocks + docId, cfgExpLocks]];
      if (isReplace) {
        multiArgs.unshift(['del', redisKeyLocks + docId]);
      }
      var multi = redisClient.multi(multiArgs);
      yield utils.promiseRedis(multi, multi.exec);
    }
  }
  function* getUserLocks(docId, userId) {
    var userLocks = [], i;
    var toCache = [];
    var docLock = yield* getAllLocks(docId);
    for (i = 0; i < docLock.length; ++i) {
      var elem = docLock[i];
      if (elem.user === userId) {
        userLocks.push(elem);
      } else {
        toCache.push(JSON.stringify(elem));
      }
    }
    //remove all
    yield utils.promiseRedis(redisClient, redisClient.del, redisKeyLocks + docId);
    //set all
    yield* addLocks(docId, toCache);
    return userLocks;
  }

  function* getParticipantMap(docId, opt_userId, opt_connInfo, opt_hvals) {
    const participantsMap = [];
    let hvals;
    if (opt_hvals) {
      hvals = opt_hvals;
    } else {
      hvals = yield* getAllPresence(docId, opt_userId, opt_connInfo);
    }
    for (let i = 0; i < hvals.length; ++i) {
      const elem = JSON.parse(hvals[i]);
      if (!elem.isCloseCoAuthoring) {
        participantsMap.push(elem);
      }
    }
    return participantsMap;
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
			const lockDocument = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyLockDoc + docId);
			if (lockDocument && userId === JSON.parse(lockDocument).id) {
				yield utils.promiseRedis(redisClient, redisClient.del, redisKeyLockDoc + docId);

				const participantsMap = yield* getParticipantMap(docId);
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
			const userLocks = yield* getUserLocks(docId, userId);
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
    yield utils.promiseRedis(redisClient, redisClient.expire, redisKeyLockDoc + docId, 2 * cfgExpLockDoc);
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
      yield* updatePresence(conn.docId, conn.user.id, getConnectionInfo(conn));

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
    let user = data.user;
    if (user.firstname && user.lastname) {
      //as in web-apps/apps/common/main/lib/util/utils.js
      let isRu = (data.lang && /^ru/.test(data.lang));
      return isRu ? user.lastname + ' ' + user.firstname : user.firstname + ' ' + user.lastname;
    } else {
      return user.username;
    }
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
        if (null != user.name) {
          dataUser.username = user.name;
        }
      }
    }

    //issuer for secret
    if (decoded.iss) {
      data.iss = decoded.iss;
    }
    return res;
  }
  function fillVersionHistoryFromJwt(decoded, cmd) {
    if (decoded.changesUrl && decoded.previous && (cmd.getServerVersion() === commonDefines.buildVersion)) {
      if (decoded.previous.url) {
        cmd.setUrl(decoded.previous.url);
      }
      if (decoded.previous.key) {
        cmd.setDocId(decoded.previous.key);
      }
    } else {
      if (decoded.url) {
        cmd.setUrl(decoded.url);
      }
      if (decoded.key) {
        cmd.setDocId(decoded.key);
      }
    }
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

    var options = {algorithm: cfgTokenSessionAlgorithm, expiresIn: cfgTokenSessionExpires / 1000};
    var secret = utils.getSecretByElem(cfgSecretSession);
    return jwt.sign(payload, secret, options);
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

      //get user index
      const bIsRestore = null != data.sessionId;
      let upsertRes = null;
      let curIndexUser, documentCallback;
      if (bIsRestore) {
        // Если восстанавливаем, индекс тоже восстанавливаем
        curIndexUser = user.indexUser;
      } else {
        if (data.documentCallbackUrl) {
          documentCallback = url.parse(data.documentCallbackUrl);
          let filterStatus = yield* utils.checkHostFilter(documentCallback.hostname);
          if (0 !== filterStatus) {
            logger.warn('checkIpFilter error: docId = %s;url = %s', docId, data.documentCallbackUrl);
            conn.close(constants.DROP_CODE, constants.DROP_REASON);
            return;
          }
        }
        upsertRes = yield canvasService.commandOpenStartPromise(docId, true, data.documentCallbackUrl, utils.getBaseUrlByConnection(conn));
		  curIndexUser = upsertRes.affectedRows == 1 ? 1 : upsertRes.insertId;
      }
      if (constants.CONN_CLOSED === conn.readyState) {
        //closing could happen during async action
        return;
      }

      const curUserId = user.id + curIndexUser;
      conn.docId = data.docid;
      conn.permissions = data.permissions;
      conn.user = {
        id: curUserId,
        idOriginal: user.id,
        username: fillUsername(data),
        indexUser: curIndexUser,
        view: !isEditMode(data.permissions, data.mode, !data.view)
      };
      conn.isCloseCoAuthoring = data.isCloseCoAuthoring;
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
          yield* updateEditUsers(conn.user.idOriginal);
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
          yield* updatePresence(docId, conn.user.id, getConnectionInfo(conn));
          // Посылаем формальную авторизацию, чтобы подтвердить соединение
          yield* sendAuthInfo(conn, bIsRestore, undefined);
          if (cmd) {
            yield canvasService.openDocument(conn, cmd, upsertRes, bIsRestore);
          }
        }
        return;
      }

      if (!conn.user.view) {
        var result = yield sqlBase.checkStatusFilePromise(docId);

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
        } else if (taskResult.FileStatus.UpdateVersion === status) {
          // error version
          yield* sendFileErrorAuth(conn, data.sessionId, 'Update Version error', constants.UPDATE_VERSION_CODE);
          return;
        } else if (taskResult.FileStatus.None === status && conn.encrypted) {
          //ok
        } else if (bIsRestore) {
          // Other error
          yield* sendFileErrorAuth(conn, data.sessionId, 'Other error');
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
    let participantsMap = yield* getParticipantMap(docId, tmpUser.id, getConnectionInfo(conn));
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
      const isLock = yield utils.promiseRedis(redisClient, redisClient.setnx,
                                            redisKeyLockDoc + docId, JSON.stringify(firstParticipantNoView));
      if (constants.CONN_CLOSED === conn.readyState) {
        //closing could happen during async action
        return false;
      }
      if (isLock) {
        lockDocument = firstParticipantNoView;
        waitAuthUserId = lockDocument.id;
        yield* setLockDocumentTimer(docId, lockDocument.id);
      }
    }
    if (!lockDocument) {
      const getRes = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyLockDoc + docId);
      if (getRes) {
        const getResParsed = JSON.parse(getRes);
        //prevent self locking
        if (tmpUser.id !== getResParsed.id) {
          lockDocument = getResParsed;
        }
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

  function* sendAuthChanges(docId, connections) {
    let index = 0;
    let changes;
    do {
      let objChangesDocument = yield getDocumentChanges(docId, index, index + cfgMaxRequestChanges);
      changes = objChangesDocument.arrChanges;
      const sendObject = {
        type: 'authChanges',
        changes: changes
      };
      for (let i = 0; i < connections.length; ++i) {
        sendData(connections[i], sendObject);//Or 0 if fails
      }
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
    const allMessages = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyMessage + docId, 0, -1);
    let allMessagesParsed = undefined;
    if(allMessages && allMessages.length > 0) {
      allMessagesParsed = allMessages.map(function (val) {
        return JSON.parse(val);
      });
    }
    const sendObject = {
      type: 'auth',
      result: 1,
      sessionId: conn.sessionId,
      sessionTimeConnect: conn.sessionTimeConnect,
      participants: participantsMap,
      messages: allMessagesParsed,
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
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {docid: docId, message: data.message, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal, username: conn.user.username};
    var msgStr = JSON.stringify(msg);
    var multi = redisClient.multi([
      ['rpush', redisKeyMessage + docId, msgStr],
      ['expire', redisKeyMessage + docId, cfgExpMessage]
    ]);
    yield utils.promiseRedis(multi, multi.exec);
    // insert
    logger.info("insert message: docId = %s %s", docId, msgStr);

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
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
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
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
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
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
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
    let newChangesLastTime = null;
    let arrNewDocumentChanges = [];
    logger.info("saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; length: %s", docId, deleteIndex, startIndex, newChanges.length);
    if (0 < newChanges.length) {
      let oElement = null;

      for (let i = 0; i < newChanges.length; ++i) {
        oElement = newChanges[i];
        newChangesLastTime = Date.now();
        arrNewDocumentChanges.push({docid: docId, change: JSON.stringify(oElement), time: newChangesLastTime,
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
              toCache.push(JSON.stringify(docLock[i]));
            }
            yield* addLocks(docId, toCache, true);
          }
        }
      }

      let userLocks = [];
      if (data.releaseLocks) {
		  //Release locks
		  userLocks = yield* getUserLocks(docId, userId);
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
        }
        yield* publish({type: commonDefines.c_oPublishType.changes, docId: docId, userId: userId,
          changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
          locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo}, docId, userId);
      }
      // Автоматически снимаем lock сами и посылаем индекс для сохранения
      yield* unSaveLock(conn, changesIndex, newChangesLastTime);
      //last save
      if (newChangesLastTime) {
        let commands = [
          ['del', redisKeyForceSave + docId],
          ['hmset', redisKeyLastSave + docId, 'time', newChangesLastTime, 'index', puckerIndex,
            'baseUrl', utils.getBaseUrlByConnection(conn)],
          ['expire', redisKeyLastSave + docId, cfgExpLastSave]
        ];
        if (cfgForceSaveEnable) {
          let ttl = Math.ceil((cfgForceSaveInterval + cfgForceSaveStep) / 1000);
          let multi = redisClient.multi([
                                          ['setnx', redisKeyForceSaveTimerLock + docId, 1],
                                          ['expire', redisKeyForceSaveTimerLock + docId, ttl]
                                        ]);
          let multiRes = yield utils.promiseRedis(multi, multi.exec);
          if (multiRes[0]) {
            let expireAt = newChangesLastTime + cfgForceSaveInterval;
            commands.push(['zadd', redisKeyForceSaveTimer, expireAt, docId]);
          }
        }
        let multi = redisClient.multi(commands);
        yield utils.promiseRedis(multi, multi.exec);
      }
    } else {
      let changesToSend = arrNewDocumentChanges;
      if(changesToSend.length > cfgPubSubMaxChanges) {
        changesToSend = null;
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
    let isSaveLock = true;
    const exist = yield utils.promiseRedis(redisClient, redisClient.setnx, redisKeySaveLock + conn.docId, conn.user.id);
    if (exist) {
      isSaveLock = false;
      const saveLock = yield utils.promiseRedis(redisClient, redisClient.expire, redisKeySaveLock + conn.docId, cfgExpSaveLock);
    }
    logger.debug("isSaveLock: docId = %s; isSaveLock: %s", conn.docId, isSaveLock);

    // Отправляем только тому, кто спрашивал (всем отправлять нельзя)
    sendData(conn, {type: "saveLock", saveLock: isSaveLock});
  }

  // Снимаем лок с сохранения
  function* unSaveLock(conn, index, time) {
    const saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + conn.docId);
    // ToDo проверка null === saveLock это заглушка на подключение второго пользователя в документ (не делается saveLock в этот момент, но идет сохранение и снять его нужно)
    if (null === saveLock || conn.user.id == saveLock) {
      yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + conn.docId);
      sendData(conn, {type: 'unSaveLock', index: index, time: time});
    } else {
      logger.warn("unSaveLock failure: docId = %s; conn.user.id: %s; saveLock: %s", conn.docId, conn.user.id, saveLock);
    }
  }

  // Возвращаем все сообщения для документа
  function* getMessages(conn) {
    const allMessages = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyMessage + conn.docId, 0, -1);
    let allMessagesParsed = undefined;
    if(allMessages && allMessages.length > 0) {
      allMessagesParsed = allMessages.map(function (val) {
        return JSON.parse(val);
      });
    }
    sendData(conn, {type: "message", messages: allMessagesParsed});
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
				const c_LR = constants.LICENSE_RESULT;
				let licenseType = licenseInfo.type;
				if (constants.PACKAGE_TYPE_OS === licenseInfo.packageType && c_LR.Error === licenseType) {
					licenseType = c_LR.Success;
				}
				let rights = constants.RIGHTS.Edit;
				if (config.get('server.edit_singleton')) {
					// ToDo docId from url ?
					const docIdParsed = urlParse.exec(conn.url);
					if (docIdParsed && 1 < docIdParsed.length) {
						const participantsMap = yield* getParticipantMap(docIdParsed[1]);
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
						type: licenseType,
						light: licenseInfo.light,
						mode: licenseInfo.mode,
						rights: rights,
						buildVersion: commonDefines.buildVersion,
						buildNumber: commonDefines.buildNumber,
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
		if (licenseInfo.usersCount) {
			if (c_LR.Success === licenseType) {
				const now = new Date();
				const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
					now.getUTCMinutes(), now.getUTCSeconds()) / 1000;
				const multi = redisClient.multi([
					['zrangebyscore', redisKeyPresenceUniqueUsers, nowUTC, '+inf'],
					['zremrangebyscore', redisKeyPresenceUniqueUsers, '-inf', nowUTC]
				]);
				const execRes = yield utils.promiseRedis(multi, multi.exec);
				if (licenseInfo.usersCount > execRes[0].length) {
					licenseType = c_LR.Success;
				} else {
					licenseType = -1 === execRes[0].indexOf(userId) ? c_LR.UsersCount : c_LR.Success;
				}
				licenseWarningLimit = licenseInfo.usersCount * cfgWarningLimitPercents <= execRes[0].length;
			}
		} else {
			// Warning. Cluster version or if workers > 1 will work with increasing numbers.
			let connectionsCount = 0;
			if (constants.PACKAGE_TYPE_OS === licenseInfo.packageType && c_LR.Error === licenseType) {
				connectionsCount = constants.LICENSE_CONNECTIONS;
				licenseType = c_LR.SuccessLimit;
			} else if (c_LR.Success === licenseType) {
				connectionsCount = licenseInfo.connections;
			}
			if (connectionsCount) {
				const editConnectionsCount = (_.filter(connections, function (el) {
					return true !== el.isCloseCoAuthoring && el.user.view !== true;
				})).length;
				licenseType = (connectionsCount > editConnectionsCount) ? licenseType : c_LR.Connections;
				licenseWarningLimit = connectionsCount * cfgWarningLimitPercents <= editConnectionsCount;
			}
			/*if (constants.PACKAGE_TYPE_OS === licenseInfo.packageType && c_LR.Error === licenseType) {
			licenseType = c_LR.SuccessLimit;

			const count = constants.LICENSE_CONNECTIONS;
			let cursor = '0', sum = 0, scanRes, tmp, length, i, users;
			while (true) {
			  scanRes = yield utils.promiseRedis(redisClient, redisClient.scan, cursor, 'MATCH', redisKeyPresenceHash + '*');
			  tmp = scanRes[1];
			  sum += (length = tmp.length);

			  for (i = 0; i < length; ++i) {
				if (sum >= count) {
				  licenseType = c_LR.Connections;
				  break;
				}

				users = yield utils.promiseRedis(redisClient, redisClient.hlen, tmp[i]);
				sum += users - (0 !== users ? 1 : 0);
			  }

			  if (sum >= count) {
				licenseType = c_LR.Connections;
				break;
			  }

			  cursor = scanRes[0];
			  if ('0' === cursor) {
				break;
			  }
			}
		  }*/
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
        let lockDocumentTimer;
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
            var cmd = new commonDefines.InputCommand(data.cmd, true);
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
                  outputData.setData(yield storage.getSignedUrls(participant.baseUrl, data.needUrlKey, data.needUrlType));
                } else if (1 == data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey, data.needUrlType));
                } else {
                  var contentDisposition = cmd.getInline() ? constants.CONTENT_DISPOSITION_INLINE : constants.CONTENT_DISPOSITION_ATTACHMENT;
                  outputData.setData(yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey, data.needUrlType, cmd.getTitle(), contentDisposition));
                }
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
            logger.debug('start shutdown');
            //flag prevent new socket connections and receive data from exist connections
            shutdownFlag = true;
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
    var multi = redisClient.multi(
      [
        ['lpop', redisKeyEditorConnections],
        ['rpush', redisKeyEditorConnections, JSON.stringify({time: now, edit: countEdit, view: countView})]
      ]);
    let multiRes = yield utils.promiseRedis(multi, multi.exec);
    if (multiRes.length > 1 && multiRes[0] && JSON.parse(multiRes[0]).time > now - PRECISION[PRECISION.length - 1].val) {
      yield utils.promiseRedis(redisClient, redisClient.lpush, redisKeyEditorConnections, multiRes[0]);
    }
  }
  function expireDoc() {
    var cronJob = this;
    return co(function* () {
      try {
        var countEdit = 0;
        var countView = 0;
        logger.debug('expireDoc connections.length = %d', connections.length);
        var commands = [];
        var idSet = new Set();
        var nowMs = new Date().getTime();
        var nextMs = cronJob.nextDate();
        var maxMs = Math.max(nowMs + cfgExpSessionCloseCommand, nextMs);
        for (var i = 0; i < connections.length; ++i) {
          var conn = connections[i];
          if (cfgExpSessionAbsolute > 0) {
            if (maxMs - conn.sessionTimeConnect > cfgExpSessionAbsolute && !conn.sessionIsSendWarning) {
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
          idSet.add(conn.docId);
          updatePresenceCommandsToArray(commands, conn.docId, conn.user.id, getConnectionInfo(conn));
          if (conn.user && conn.user.view) {
            countView++;
          } else {
            countEdit++;
          }
        }
        var expireAt = new Date().getTime() + cfgExpPresence * 1000;
        idSet.forEach(function(value1, value2, set) {
          commands.push(['zadd', redisKeyDocuments, expireAt, value1]);
        });
        yield* collectStats(countEdit, countView);
        if (commands.length > 0) {
          var multi = redisClient.multi(commands);
          yield utils.promiseRedis(multi, multi.exec);
        }
        if (clientStatsD) {
          clientStatsD.gauge('expireDoc.connections.edit', countEdit);
          clientStatsD.gauge('expireDoc.connections.view', countView);
        }
      } catch (err) {
        logger.error('expireDoc error:\r\n%s', err.stack);
      }
    });
  }
  var innerPingJob = function(opt_isStart) {
    if (!opt_isStart) {
      logger.warn('expireDoc restart');
    }
    new cron.CronJob(cfgExpDocumentsCron, expireDoc, innerPingJob, true);
  };
  innerPingJob(true);

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

      callbackFunction();
    });
  });
};
exports.setLicenseInfo = function(data) {
  licenseInfo = data;
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
      if (redisClient.connected) {
        promises.push(utils.promiseRedis(redisClient, redisClient.ping));
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
		}
	};
    Object.assign(output.licenseInfo, licenseInfo);
    try {
      logger.debug('licenseInfo start');
      var precisionSum = {};
      for (let i = 0; i < PRECISION.length; ++i) {
        precisionSum[PRECISION[i].name] = {
          edit: {min: Number.MAX_VALUE, sum: 0, count: 0, max: 0, time: null, period: PRECISION[i].val},
          view: {min: Number.MAX_VALUE, sum: 0, count: 0, max: 0}
        };
        output.connectionsStat[PRECISION[i].name] = {
          edit: {min: 0, avr: 0, max: 0},
          view: {min: 0, avr: 0, max: 0}
        };
      }
      var redisRes = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyEditorConnections, 0, -1);
      const now = Date.now();
      var precisionIndex = 0;
      for (let i = redisRes.length - 1; i >= 1; i -= 2) {
        for (let j = precisionIndex; j < PRECISION.length; ++j) {
          let elem = JSON.parse(redisRes[i]);
          if (now - elem.time < PRECISION[j].val) {
            let precision = precisionSum[PRECISION[j].name];
            precision.edit.min = Math.min(precision.edit.min, elem.edit);
            precision.edit.max = Math.max(precision.edit.max, elem.edit);
            precision.edit.sum += elem.edit;
            precision.edit.count++;
			precision.edit.time = elem.time;
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
		//scale compensates for the lack of points at server start
		let scale = (now - precision.edit.time) / precision.edit.period;
        if (precision.edit.count > 0) {
          precisionOut.edit.avr = Math.round((precision.edit.sum / precision.edit.count) * scale);
          precisionOut.edit.min = precision.edit.min;
          precisionOut.edit.max = precision.edit.max;
        }
        if (precision.view.count > 0) {
          precisionOut.view.avr = Math.round((precision.view.sum / precision.view.count) * scale);
          precisionOut.view.min = precision.view.min;
          precisionOut.view.max = precision.view.max;
        }
      }
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
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (req, res) {
  return co(function* () {
    let result = commonDefines.c_oAscServerCommandErrors.NoError;
    let docId = 'commandFromServer';
    let version = undefined;
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
      if (commonDefines.c_oAscServerCommandErrors.NoError === result && null == docId && 'version' != params.c) {
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
              yield utils.promiseRedis(redisClient, redisClient.setex, redisKeySaved + docId, cfgExpSaved, params.status);
              logger.warn('saved corrupted id = %s status = %s conv = %s', docId, params.status, params.conv);
            } else {
              logger.info('saved id = %s status = %s conv = %s', docId, params.status, params.conv);
            }
            break;
          case 'forcesave':
            let forceSaveRes = yield* startForceSave(docId, commonDefines.c_oAscForceSaveTypes.Command, params.userdata, utils.getBaseUrlByRequest(req));
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
      const output = JSON.stringify({'key': docId, 'error': result, 'version': version});
      logger.debug('End commandFromServer: docId = %s %s', docId, output);
      const outputBuffer = Buffer.from(output, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', outputBuffer.length);
      res.send(outputBuffer);
    }
  });
};
