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
 * а) Когда все уходят, спустя время c_oAscSaveTimeOutDelay на сервер документов шлется команда на сборку.
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

var configCommon = require('config');
var sockjs = require('sockjs');
var _ = require('underscore');
var https = require('https');
var http = require('http');
var url = require('url');
var cron = require('cron');
var storage = require('./../../Common/sources/storage-base');
var logger = require('./../../Common/sources/logger');
const constants = require('./../../Common/sources/constants');
var utils = require('./../../Common/sources/utils');
var commonDefines = require('./../../Common/sources/commondefines');
var statsDClient = require('./../../Common/sources/statsdclient');
var config = require('config').get('services.CoAuthoring');
var sqlBase = require('./baseConnector');
var canvasService = require('./canvasservice');
var converterService = require('./converterservice');
var checkExpire = require('./checkexpire');
var taskResult = require('./taskresult');
var redis = require(config.get('redis.name'));
var pubsubService = require('./' + config.get('pubsub.name'));
var queueService = require('./../../Common/sources/taskqueueRabbitMQ');
var cfgSpellcheckerUrl = config.get('server.editor_settings_spellchecker_url');
var cfgCallbackRequestTimeout = config.get('server.callbackRequestTimeout');

var cfgPubSubMaxChanges = config.get('pubsub.maxChanges');

var cfgRedisPrefix = config.get('redis.prefix');
var cfgRedisHost = config.get('redis.host');
var cfgRedisPort = config.get('redis.port');
var cfgExpCallback = config.get('expire.callback');
var cfgExpUserIndex = config.get('expire.userindex');
var cfgExpSaveLock = config.get('expire.saveLock');
var cfgExpEditors = config.get('expire.editors');
var cfgExpLocks = config.get('expire.locks');
var cfgExpChangeIndex = config.get('expire.changeindex');
var cfgExpLockDoc = config.get('expire.lockDoc');
var cfgExpMessage = config.get('expire.message');
var cfgExpLastSave = config.get('expire.lastsave');
var cfgExpForceSave = config.get('expire.forcesave');
var cfgExpSaved = config.get('expire.saved');
var cfgExpDocuments = config.get('expire.documents');
var cfgExpDocumentsCron = config.get('expire.documentsCron');
var cfgExpFiles = config.get('expire.files');
var cfgExpFilesCron = config.get('expire.filesCron');
var cfgSockjsUrl = config.get('server.sockjsUrl');

var redisKeyCallback = cfgRedisPrefix + 'callback:';
var redisKeyUserIndex = cfgRedisPrefix + 'userindex:';
var redisKeySaveLock = cfgRedisPrefix + 'savelock:';
var redisKeyEditors = cfgRedisPrefix + 'editors:';
var redisKeyLocks = cfgRedisPrefix + 'locks:';
var redisKeyChangeIndex = cfgRedisPrefix + 'changesindex:';
var redisKeyLockDoc = cfgRedisPrefix + 'lockdocument:';
var redisKeyMessage = cfgRedisPrefix + 'message:';
var redisKeyDocuments = cfgRedisPrefix + 'documents:';
var redisKeyLastSave = cfgRedisPrefix + 'lastsave:';
var redisKeyForceSave = cfgRedisPrefix + 'forcesave:';
var redisKeySaved = cfgRedisPrefix + 'saved:';

var PublishType = {
  drop : 0,
  releaseLock : 1,
  participantsState : 2,
  message : 3,
  getLock : 4,
  changes : 5,
  auth : 6,
  receiveTask : 7,
  warning: 8,
  cursor: 9
};

var EditorTypes = {
  document : 0,
  spreadsheet : 1,
  presentation : 2
};

var defaultHttpPort = 80, defaultHttpsPort = 443;	// Порты по умолчанию (для http и https)
var connections = []; // Активные соединения
var redisClient;
var pubsub;
var queue;
var clientStatsD = statsDClient.getClient();
var licenseInfo = constants.LICENSE_RESULT.Error;

var asc_coAuthV = '3.0.9';				// Версия сервера совместного редактирования

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

var c_oAscServerStatus = {
  NotFound: 0,
  Editing: 1,
  MustSave: 2,
  Corrupted: 3,
  Closed: 4,
  MailMerge: 5,
  MustSaveForce: 6,
  CorruptedForce: 7
};

var c_oAscChangeBase = {
  No: 0,
  Delete: 1,
  All: 2
};

var c_oAscSaveTimeOutDelay = 5000;	// Время ожидания для сохранения на сервере (для отработки F5 в браузере)
var c_oAscLockTimeOutDelay = 500;	// Время ожидания для сохранения, когда зажата база данных

var c_oAscRecalcIndexTypes = {
  RecalcIndexAdd: 1,
  RecalcIndexRemove: 2
};

var FileStatus = {
  None: 0,
  Ok: 1,
  WaitQueue: 2,
  NeedParams: 3,
  Convert: 4,
  Err: 5,
  ErrToReload: 6,
  SaveVersion: 7,
  UpdateVersion: 8
};

/**
 * lock types
 * @const
 */
var c_oAscLockTypes = {
  kLockTypeNone: 1, // никто не залочил данный объект
  kLockTypeMine: 2, // данный объект залочен текущим пользователем
  kLockTypeOther: 3, // данный объект залочен другим(не текущим) пользователем
  kLockTypeOther2: 4, // данный объект залочен другим(не текущим) пользователем (обновления уже пришли)
  kLockTypeOther3: 5  // данный объект был залочен (обновления пришли) и снова стал залочен
};

var c_oAscLockTypeElem = {
  Range: 1,
  Object: 2,
  Sheet: 3
};
var c_oAscLockTypeElemSubType = {
  DeleteColumns: 1,
  InsertColumns: 2,
  DeleteRows: 3,
  InsertRows: 4,
  ChangeProperties: 5
};

var c_oAscLockTypeElemPresentation = {
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
function getParticipants(excludeClosed, docId, excludeUserId, excludeViewer) {
  return _.filter(connections, function(el) {
    return el.isCloseCoAuthoring !== excludeClosed && el.docId === docId &&
      el.user.id !== excludeUserId && el.user.view !== excludeViewer;
  });
}
function getParticipantUser(docId, includeUserId) {
  return _.filter(connections, function(el) {
    return el.docId === docId && el.user.id === includeUserId;
  });
}
function* hasEditors(docId, optEditors) {
  var elem, hasEditors = false;
  if (!optEditors) {
    optEditors = yield utils.promiseRedis(redisClient, redisClient.hvals, redisKeyEditors + docId);
  }
  for (var i = 0; i < optEditors.length; ++i) {
    elem = JSON.parse(optEditors[i]);
    if(!elem.view) {
      hasEditors = true;
      break;
    }
  }

  return hasEditors;
}
function* publish(data, optDocId, optUserId) {
  var needPublish = true;
  if(optDocId && optUserId) {
    needPublish = false;
    var hvalsRes = yield utils.promiseRedis(redisClient, redisClient.hvals, redisKeyEditors + optDocId);
    for (var i = 0; i < hvalsRes.length; ++i) {
      var elem = JSON.parse(hvalsRes[i]);
      if(optUserId != elem.id) {
        needPublish = true;
        break;
      }
    }
  }
  if(needPublish) {
    var msg = JSON.stringify(data);
    pubsub.publish(msg);
  }
}
function* addTask(data, priority) {
  yield queue.addTask(data, priority);
}
function* removeResponse(data) {
  yield queue.removeResponse(data);
}

function* getOriginalParticipantsId(docId) {
  var result = [], tmpObject = {};
  var hvalsRes = yield utils.promiseRedis(redisClient, redisClient.hvals, redisKeyEditors + docId);
  for (var i = 0; i < hvalsRes.length; ++i) {
    var elem = JSON.parse(hvalsRes[i]);
    if (!elem.view) {
      tmpObject[elem.idOriginal] = 1;
    }
  }
  for (var name in tmpObject) if (tmpObject.hasOwnProperty(name)) {
    result.push(name);
  }
  return result;
}

function* sendServerRequest(docId, uri, postData) {
  logger.debug('postData request: docId = %s;url = %s;data = %s', docId, uri, postData);
  var res = yield utils.postRequestPromise(uri, postData, cfgCallbackRequestTimeout * 1000);
  logger.debug('postData response: docId = %s;data = %s', docId, res);
  return res;
}

// Парсинг ссылки
function parseUrl(callbackUrl) {
  var result = null;
  try {
    var parseObject = url.parse(decodeURIComponent(callbackUrl));
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

function* deleteCallback(id) {
  // Нужно удалить из базы callback-ов
  yield utils.promiseRedis(redisClient, redisClient.del, redisKeyCallback + id);
  yield sqlBase.deleteCallbackPromise(id);
}
function* getCallback(id) {
  var callbackUrl = null;
  var baseUrl = null;
  var data = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyCallback + id);
  if (data) {
    var dataParsed = JSON.parse(data);
    callbackUrl = dataParsed.callbackUrl;
    baseUrl = dataParsed.baseUrl;
  }
  else {
    var selectRes = yield sqlBase.getCallbackPromise(id);
    if (selectRes.length > 0) {
      var row = selectRes[0];
      if (row.dc_callback) {
        callbackUrl = row.dc_callback;
      }
      if (row.dc_baseurl) {
        baseUrl = row.dc_baseurl;
      }
    }
  }
  if (null != callbackUrl && null != baseUrl) {
    return {server: parseUrl(callbackUrl), baseUrl: baseUrl};
  } else {
    return null;
  }
}
function* addCallback(id, href, baseUrl) {
  yield sqlBase.insertInTablePromise(sqlBase.tableId.callbacks, null, id, href, baseUrl);
  yield utils.promiseRedis(redisClient, redisClient.setex, redisKeyCallback + id, cfgExpCallback,
    JSON.stringify({callbackUrl: href, baseUrl: baseUrl}));
}
function* getChangesIndex(docId) {
  var res = 0;
  var redisRes = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyChangeIndex + docId);
  if (null != redisRes) {
    res = parseInt(redisRes);
  } else {
    var getRes = yield sqlBase.getChangesIndexPromise(docId);
    if (getRes && getRes.length > 0 && null != getRes[0]['dc_change_id']) {
      res = getRes[0]['dc_change_id'] + 1;
    }
  }
  return res;
}
function* setForceSave(docId, lastSave, savePathDoc) {
  yield utils.promiseRedis(redisClient, redisClient.hset, redisKeyForceSave + docId, lastSave, savePathDoc);
}
/**
 * Отправка статуса, чтобы знать когда документ начал редактироваться, а когда закончился
 * @param docId
 * @param {number} bChangeBase
 * @param callback
 * @param baseUrl
 */
function* sendStatusDocument(docId, bChangeBase, userAction, callback, baseUrl) {
  if (!callback) {
    var getRes = yield* getCallback(docId);
    if(getRes) {
      callback = getRes.server;
    }
  }
  if (null == callback) {
    return;
  }

  var status = c_oAscServerStatus.Editing;
  var participants = yield* getOriginalParticipantsId(docId);
  if (0 === participants.length) {
    var puckerIndex = yield* getChangesIndex(docId);
    if (!(puckerIndex > 0)) {
      status = c_oAscServerStatus.Closed;
    }
  }

  if (c_oAscChangeBase.No !== bChangeBase) {
    if (c_oAscServerStatus.Editing === status && c_oAscChangeBase.All === bChangeBase) {
      // Добавить в базу
      yield* addCallback(docId, callback.href, baseUrl);
    } else if (c_oAscServerStatus.Closed === status) {
      // Удалить из базы
      yield* deleteCallback(docId);
    }
  }

  var sendData = new commonDefines.OutputSfcData();
  sendData.setKey(docId);
  sendData.setStatus(status);
  if(c_oAscServerStatus.Closed !== status){
    sendData.setUsers(participants);
  } else {
    sendData.setUsers(undefined);
  }
  if (userAction) {
    var actions = [];
    if (commonDefines.c_oAscUserAction.AllIn === userAction.type) {
      for (var i = 0; i < participants.length; ++i) {
        actions.push(new commonDefines.OutputAction(commonDefines.c_oAscUserAction.In, participants[i]));
      }
    } else {
      actions.push(userAction);
    }
    sendData.setActions(actions);
  }
  var uri = callback.href;
  var replyData = null;
  var postData = JSON.stringify(sendData);
  try {
    replyData = yield* sendServerRequest(docId, uri, postData);
  } catch (err) {
    replyData = null;
    logger.error('postData error: docId = %s;url = %s;data = %s\r\n%s', docId, uri, postData, err.stack);
  }
  yield* onReplySendStatusDocument(docId, replyData);
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
    yield* publish({type: PublishType.warning, docId: docId, description: 'Error on save server subscription!'});
  }
}
function* dropUsersFromDocument(docId, replyData) {
  var oData = parseReplyData(docId, replyData);
  if (oData) {
    users = Array.isArray(oData) ? oData : oData.users;
    if (Array.isArray(users)) {
      yield* publish({type: PublishType.drop, docId: docId, users: users, description: ''});
    }
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
function* bindEvents(docId, callback, baseUrl, opt_userAction) {
  // Подписка на эвенты:
  // - если пользователей нет и изменений нет, то отсылаем статус "закрыто" и в базу не добавляем
  // - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
  // - если есть пользователи, то просто добавляем в базу
  var bChangeBase = c_oAscChangeBase.Delete;
  var getRes = yield* getCallback(docId);
  var oCallbackUrl;
  if (getRes) {
    oCallbackUrl = getRes.server;
  } else {
    oCallbackUrl = parseUrl(callback);
    if (null === oCallbackUrl) {
      return commonDefines.c_oAscServerCommandErrors.ParseError;
    }
    bChangeBase = c_oAscChangeBase.All;
  }
  var userAction = opt_userAction ? opt_userAction : new commonDefines.OutputAction(commonDefines.c_oAscUserAction.AllIn, null);
  yield* sendStatusDocument(docId, bChangeBase, userAction, oCallbackUrl, baseUrl);
}

function* cleanDocumentOnExit(docId, deleteChanges, deleteUserIndex) {
  //clean redis
  var redisArgs = [redisClient, redisClient.del, redisKeyLocks + docId, redisKeyEditors + docId,
      redisKeyMessage + docId, redisKeyChangeIndex + docId, redisKeyForceSave + docId, redisKeyLastSave + docId];
  if (deleteUserIndex) {
    redisArgs.push(redisKeyUserIndex + docId);
  }
  utils.promiseRedis.apply(this, redisArgs);
  //remove callback
  yield* deleteCallback(docId);
  //remove changes
  if (deleteChanges) {
    sqlBase.deleteChanges(docId, null);
  }
}
function* cleanDocumentOnExitNoChanges(docId, opt_userId) {
  var userAction = opt_userId ? new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, opt_userId) : null;
  // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
  yield* sendStatusDocument(docId, c_oAscChangeBase.All, userAction);
  //если пользователь зашел в документ, соединение порвалось, на сервере удалилась вся информация,
  //при восстановлении соединения userIndex сохранится и он совпадет с userIndex следующего пользователя
  yield* cleanDocumentOnExit(docId, false, false);
}

exports.version = asc_coAuthV;
exports.c_oAscServerStatus = c_oAscServerStatus;
exports.sendData = sendData;
exports.parseUrl = parseUrl;
exports.parseReplyData = parseReplyData;
exports.sendServerRequest = sendServerRequest;
exports.PublishType = PublishType;
exports.publish = publish;
exports.addTask = addTask;
exports.removeResponse = removeResponse;
exports.hasEditors = hasEditors;
exports.getCallback = getCallback;
exports.cleanDocumentOnExit = cleanDocumentOnExit;
exports.setForceSave= setForceSave;
exports.install = function(server, callbackFunction) {
  'use strict';
  var sockjs_opts = {sockjs_url: cfgSockjsUrl},
    sockjs_echo = sockjs.createServer(sockjs_opts),
    urlParse = new RegExp("^/doc/([" + constants.DOC_ID_PATTERN + "]*)/c.+", 'i');

  sockjs_echo.on('connection', function(conn) {
    if (null == conn) {
      logger.error("null == conn");
      return;
    }
    conn.baseUrl = utils.getBaseUrlByConnection(conn);

    conn.on('data', function(message) {
      utils.spawn(function* () {
      var docId = 'null';
      try {
        var startDate = null;
        if(clientStatsD) {
          startDate = new Date();
        }
        var data = JSON.parse(message);
        docId = conn.docId;
        logger.info('data.type = ' + data.type + ' id = ' + docId);
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
            yield* unSaveLock(conn, -1);
            break;	// Индекс отправляем -1, т.к. это экстренное снятие без сохранения
          case 'getMessages'      :
            yield* getMessages(conn, data);
            break;
          case 'unLockDocument'    :
            yield* checkEndAuthLock(data.isSave, docId, conn.user.id, conn);
            break;
          case 'ping':
            yield utils.promiseRedis(redisClient, redisClient.zadd, redisKeyDocuments, new Date().getTime(), docId);
            break;
          case 'close':
            yield* closeDocument(conn, false);
            break;
          case 'openDocument'      :
            canvasService.openDocument(conn, data);
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
      utils.spawn(function* () {
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

    logger.info("Connection closed or timed out: docId = %s", docId);
    var isCloseCoAuthoringTmp = conn.isCloseCoAuthoring;
    if (isCloseConnection) {
      //Notify that participant has gone
      connections = _.reject(connections, function(el) {
        return el.id === conn.id;//Delete this connection
      });
      //Check if it's not already reconnected
      reconnected = _.any(connections, function(el) {
        return (el.sessionId === conn.sessionId);//This means that client is reconnected
      });
    } else {
      conn.isCloseCoAuthoring = true;
    }

    if (isCloseCoAuthoringTmp) {
      // Мы уже закрывали совместное редактирование
      return;
    }

    var state = (false == reconnected) ? false : undefined;
    var tmpUser = conn.user;
    yield* publish({type: PublishType.participantsState, docId: docId, user: tmpUser, state: state}, docId, tmpUser.id);

    if (!reconnected) {
      // Для данного пользователя снимаем лок с сохранения
      var saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + docId);
      if (conn.user.id == saveLock) {
        yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);
      }

      // Только если редактируем
      if (false === tmpUser.view) {
        var multi = redisClient.multi([
          ['hdel', redisKeyEditors + docId, tmpUser.id],
          ['hvals', redisKeyEditors + docId]
        ]);
        var execRes = yield utils.promiseRedis(multi, multi.exec);
        bHasEditors = yield* hasEditors(docId, execRes[1]);
        var puckerIndex = yield* getChangesIndex(docId);
        bHasChanges = puckerIndex > 0;

        // Если у нас нет пользователей, то удаляем все сообщения
        if (!bHasEditors) {
          // На всякий случай снимаем lock
          yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);
          //удаляем из списка документов
          yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docId);

          // Send changes to save server
          if (bHasChanges) {
            yield* _createSaveTimer(docId, tmpUser.idOriginal);
          } else {
            yield* cleanDocumentOnExitNoChanges(docId, tmpUser.idOriginal);
          }
        } else {
          yield* sendStatusDocument(docId, c_oAscChangeBase.No, new commonDefines.OutputAction(commonDefines.c_oAscUserAction.Out, tmpUser.idOriginal));
        }

        //Давайдосвиданья!
        //Release locks
        userLocks = yield* getUserLocks(docId, conn.sessionId);
        if (0 < userLocks.length) {
          //todo на close себе ничего не шлем
          //sendReleaseLock(conn, userLocks);
          yield* publish({type: PublishType.releaseLock, docId: docId, userId: conn.user.id, locks: userLocks}, docId, conn.user.id);
        }

        // Для данного пользователя снимаем Lock с документа
        yield* checkEndAuthLock(false, docId, conn.user.id);
      } else {
        yield utils.promiseRedis(redisClient, redisClient.hdel, redisKeyEditors + docId, tmpUser.id);
      }
    }
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
      objChangesDocument.push({docid: docId, change: element['dc_data'],
        time: element['dc_date'].getTime(), user: element['dc_user_id'],
        useridoriginal: element['dc_user_id_original']});
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
  function* getUserLocks(docId, sessionId) {
    var userLocks = [], i;
    var toCache = [];
    var docLock = yield* getAllLocks(docId);
    for (i = 0; i < docLock.length; ++i) {
      var elem = docLock[i];
      if (elem.sessionId === sessionId) {
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

  function* getParticipantMap(docId) {
    var participantsMap = [];
    var hvalsRes = yield utils.promiseRedis(redisClient, redisClient.hvals, redisKeyEditors + docId);
    for (var i = 0; i < hvalsRes.length; ++i) {
      participantsMap.push(JSON.parse(hvalsRes[i]));
    }
    return participantsMap;
  }

  function* checkEndAuthLock(isSave, docId, userId, currentConnection) {
    var result = false;
    var lockDocument = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyLockDoc + docId);
    if (lockDocument && userId === JSON.parse(lockDocument).id) {
      yield utils.promiseRedis(redisClient, redisClient.del, redisKeyLockDoc + docId);

      var participantsMap = yield* getParticipantMap(docId);
      yield* publish({type: PublishType.auth, docId: docId, userId: userId, participantsMap: participantsMap}, docId, userId);

      result = true;
    } else if (isSave) {
      //Release locks
      var userLocks = yield* getUserLocks(docId, currentConnection.sessionId);
      if (0 < userLocks.length) {
        sendReleaseLock(currentConnection, userLocks);
        yield* publish({type: PublishType.releaseLock, docId: docId, userId: userId, locks: userLocks}, docId, userId);
      }

      // Автоматически снимаем lock сами
      yield* unSaveLock(currentConnection, -1);
    }
    return result;
  }

  function sendParticipantsState(participants, data) {
    _.each(participants, function(participant) {
      sendData(participant, {
        type: "connectState",
        state: data.state,
        user: data.user
      });
    });
  }

  function sendFileError(conn, errorId) {
    logger.error('error description: docId = %s errorId = %s', conn.docId, errorId);
    sendData(conn, {type: 'error', description: errorId});
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

  function* auth(conn, data) {
    // Проверка версий
    if (data.version !== asc_coAuthV) {
      sendFileError(conn, 'Old Version Sdk');
      return;
    }

    //TODO: Do authorization etc. check md5 or query db
    if (data.token && data.user) {
      var docId;
      var user = data.user;
      //Parse docId
      var parsed = urlParse.exec(conn.url);
      if (parsed.length > 1) {
        docId = conn.docId = parsed[1];
      } else {
        //TODO: Send some shit back
      }

      var bIsRestore = null != data.sessionId;

      // Если восстанавливаем, индекс тоже восстанавливаем
      var curIndexUser;
      if (bIsRestore) {
        curIndexUser = user.indexUser;
      } else {
        curIndexUser = 1;
        var multi = redisClient.multi([
          ['incr', redisKeyUserIndex + docId],
          ['expire', redisKeyUserIndex + docId, cfgExpUserIndex]
        ]);
        var replies = yield utils.promiseRedis(multi, multi.exec);
        if(replies){
          curIndexUser = replies[0];
        }
      }

      var curUserId = user.id + curIndexUser;

      conn.sessionState = 1;
      conn.user = {
        id: curUserId,
        idOriginal: user.id,
        username: user.username,
        indexUser: curIndexUser,
        view: data.view
      };
      conn.editorType = data['editorType'];

      // Ситуация, когда пользователь уже отключен от совместного редактирования
      if (bIsRestore && data.isCloseCoAuthoring) {
        // Удаляем предыдущие соединения
        connections = _.reject(connections, function(el) {
          return el.sessionId === data.sessionId;//Delete this connection
        });
        // Кладем в массив, т.к. нам нужно отправлять данные для открытия/сохранения документа
        connections.push(conn);
        // Посылаем формальную авторизацию, чтобы подтвердить соединение
        yield* sendAuthInfo(undefined, undefined, conn, undefined);
        return;
      }

      //Set the unique ID
      if (bIsRestore) {
        logger.info("restored old session: docId = %s id = %s", docId, data.sessionId);

        // Останавливаем сборку (вдруг она началась)
        // Когда переподсоединение, нам нужна проверка на сборку файла
        try {
          var result = yield sqlBase.checkStatusFilePromise(docId);

          var status = result[0]['tr_status'];
          if (FileStatus.Ok === status) {
            // Все хорошо, статус обновлять не нужно
          } else if (FileStatus.SaveVersion === status) {
            // Обновим статус файла (идет сборка, нужно ее остановить)
            var updateMask = new taskResult.TaskResultData();
            updateMask.key = docId;
            updateMask.status = status;
            updateMask.statusInfo = result[0]['tr_status_info'];
            var updateTask = new taskResult.TaskResultData();
            updateTask.status = taskResult.FileStatus.Ok;
            updateTask.statusInfo = constants.NO_ERROR;
            var updateIfRes = yield taskResult.updateIf(updateTask, updateMask);
            if (!(updateIfRes.affectedRows > 0)) {
              // error version
              sendFileError(conn, 'Update Version error');
              return;
            }
          } else if (FileStatus.UpdateVersion === status) {
            // error version
            sendFileError(conn, 'Update Version error');
            return;
          } else {
            // Other error
            sendFileError(conn, 'Other error');
            return;
          }

          var objChangesDocument = yield* getDocumentChanges(docId);
          var bIsSuccessRestore = true;
          if (objChangesDocument && 0 < objChangesDocument.arrChanges.length) {
            var change = objChangesDocument.arrChanges[objChangesDocument.getLength() - 1];
            if (change['change']) {
              if (change['user'] !== curUserId) {
                bIsSuccessRestore = 0 === (((data['lastOtherSaveTime'] - change['time']) / 1000) >> 0);
              }
            }
          }

          if (bIsSuccessRestore) {
            conn.sessionId = data.sessionId;//restore old

            // Проверяем lock-и
            var arrayBlocks = data['block'];
            var getLockRes = yield* getLock(conn, data, true);
            if (arrayBlocks && (0 === arrayBlocks.length || getLockRes)) {
              //Kill previous connections
              connections = _.reject(connections, function(el) {
                return el.sessionId === data.sessionId;//Delete this connection
              });

              yield* endAuth(conn, true);
            } else {
              sendFileError(conn, 'Restore error. Locks not checked.');
            }
          } else {
            sendFileError(conn, 'Restore error. Document modified.');
          }
        } catch (err) {
          sendFileError(conn, 'DataBase error\r\n' + err.stack);
        }
      } else {
        conn.sessionId = conn.id;
        yield* endAuth(conn, false, data.documentCallbackUrl);
      }
    }
  }

  function* endAuth(conn, bIsRestore, documentCallbackUrl) {
    var docId = conn.docId;
    connections.push(conn);
    var tmpUser = conn.user;
    var multi = redisClient.multi([
      ['hset', redisKeyEditors + docId, tmpUser.id, JSON.stringify(tmpUser)],
      ['expire', redisKeyEditors + docId, cfgExpEditors]
    ]);
    yield utils.promiseRedis(multi, multi.exec);
    yield utils.promiseRedis(redisClient, redisClient.zadd, redisKeyDocuments, new Date().getTime(), docId);
    var firstParticipantNoView, countNoView = 0;
    var participantsMap = yield* getParticipantMap(docId);
    for (var i = 0; i < participantsMap.length; ++i) {
      var elem = participantsMap[i];
      if (!elem.view) {
        ++countNoView;
        if (!firstParticipantNoView && elem.id != tmpUser.id) {
          firstParticipantNoView = elem;
        }
      }
    }

    // Отправляем на внешний callback только для тех, кто редактирует
    if (!tmpUser.view) {
      var userAction = new commonDefines.OutputAction(commonDefines.c_oAscUserAction.In, tmpUser.idOriginal);
      // Если пришла информация о ссылке для посылания информации, то добавляем
      if (documentCallbackUrl) {
        yield* bindEvents(docId, documentCallbackUrl, conn.baseUrl, userAction);
      } else {
        yield* sendStatusDocument(docId, c_oAscChangeBase.No, userAction);
      }
    }
    var lockDocument = null;
    if (!bIsRestore && 2 === countNoView && !tmpUser.view) {
      // Ставим lock на документ
      var isLock = yield utils.promiseRedis(redisClient, redisClient.setnx,
          redisKeyLockDoc + docId, JSON.stringify(firstParticipantNoView));
      if(isLock) {
        lockDocument = firstParticipantNoView;
        yield utils.promiseRedis(redisClient, redisClient.expire, redisKeyLockDoc + docId, cfgExpLockDoc);
      }
    }
    if (!lockDocument) {
      var getRes = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyLockDoc + docId);
      if (getRes) {
        lockDocument = JSON.parse(getRes);
      }
    }

    if (lockDocument && !tmpUser.view) {
      // Для view не ждем снятия lock-а
      var sendObject = {
        type: "waitAuth",
        lockDocument: lockDocument
      };
      sendData(conn, sendObject);//Or 0 if fails
    } else {
      if (bIsRestore) {
        yield* sendAuthInfo(undefined, undefined, conn, participantsMap);
      } else {
        var objChangesDocument = yield* getDocumentChanges(docId);
        yield* sendAuthInfo(objChangesDocument.arrChanges, objChangesDocument.getLength(), conn, participantsMap);
      }
    }
    yield* publish({type: PublishType.participantsState, docId: docId, user: tmpUser, state: true}, docId, tmpUser.id);
  }

  function* sendAuthInfo(objChangesDocument, changesIndex, conn, participantsMap) {
    var docId = conn.docId;
    var docLock;
    if(EditorTypes.document == conn.editorType){
      docLock = {};
      var allLocks = yield* getAllLocks(docId);
      for(var i = 0 ; i < allLocks.length; ++i) {
        var elem = allLocks[i];
        docLock[elem.block] =elem;
      }
    } else {
      docLock = yield* getAllLocks(docId);
    }
    var allMessages = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyMessage + docId, 0, -1);
    var allMessagesParsed = undefined;
    if(allMessages && allMessages.length > 0) {
      allMessagesParsed = allMessages.map(function (val) {
        return JSON.parse(val);
      });
    }
    var sendObject = {
      type: 'auth',
      result: 1,
      sessionId: conn.sessionId,
      participants: participantsMap,
      messages: allMessagesParsed,
      locks: docLock,
      changes: objChangesDocument,
      changesIndex: changesIndex,
      indexUser: conn.user.indexUser,
      g_cAscSpellCheckUrl: cfgSpellcheckerUrl
    };
    sendData(conn, sendObject);//Or 0 if fails
  }

  function* onMessage(conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {docid: docId, message: data.message, time: Date.now(), user: userId, username: conn.user.username};
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
    yield* publish({type: PublishType.message, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* onCursor(conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {cursor: data.cursor, time: Date.now(), user: userId, useridoriginal: conn.user.idOriginal};

    logger.info("send cursor: docId = %s %s", docId, msg);

    var messages = [msg];
    yield* publish({type: PublishType.cursor, docId: docId, userId: userId, messages: messages}, docId, userId);
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
        var elem = {time: Date.now(), user: userId, block: block, sessionId: conn.sessionId};
        documentLocks[block] = elem;
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: PublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
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
        var elem = {time: Date.now(), user: userId, block: block, sessionId: conn.sessionId};
        documentLocks.push(elem);
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: PublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
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
        var elem = {time: Date.now(), user: userId, block: block, sessionId: conn.sessionId};
        documentLocks.push(elem);
        toCache.push(JSON.stringify(elem));
      }
      yield* addLocks(docId, toCache);
    } else if (bIsRestore) {
      return false;
    }
    //тому кто зделал запрос возвращаем максимально быстро
    sendData(conn, {type: "getLock", locks: documentLocks});
    yield* publish({type: PublishType.getLock, docId: docId, userId: userId, documentLocks: documentLocks}, docId, userId);
    return true;
  }

  function sendGetLock(participants, documentLocks) {
    _.each(participants, function(participant) {
      sendData(participant, {type: "getLock", locks: documentLocks});
    });
  }

  function* setChangesIndex(docId, index) {
    yield utils.promiseRedis(redisClient, redisClient.setex, redisKeyChangeIndex + docId, cfgExpChangeIndex, index);
  }

  // Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
  function* saveChanges(conn, data) {
    var docId = conn.docId, userId = conn.user.id;
    logger.info("Start saveChanges docid: %s", docId);

    var puckerIndex = yield* getChangesIndex(docId);

    var deleteIndex = -1;
    if (data.startSaveChanges && null != data.deleteIndex) {
      deleteIndex = data.deleteIndex;
      if (-1 !== deleteIndex) {
        var deleteCount = puckerIndex - deleteIndex;
        if (0 < deleteCount) {
          puckerIndex -= deleteCount;
          yield sqlBase.deleteChangesPromise(docId, deleteIndex);
        } else if (0 > deleteCount) {
          logger.error("Error saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; deleteCount: %s", docId, deleteIndex, puckerIndex, deleteCount);
        }
      }
    }

    // Стартовый индекс изменения при добавлении
    var startIndex = puckerIndex;

    var newChanges = JSON.parse(data.changes);
    var arrNewDocumentChanges = [];
    logger.info("saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; length: %s", docId, deleteIndex, startIndex, newChanges.length);
    if (0 < newChanges.length) {
      var oElement = null;

      for (var i = 0; i < newChanges.length; ++i) {
        oElement = newChanges[i];
        arrNewDocumentChanges.push({docid: docId, change: JSON.stringify(oElement), time: Date.now(),
          user: userId, useridoriginal: conn.user.idOriginal});
      }

      puckerIndex += arrNewDocumentChanges.length;
      yield sqlBase.insertChangesPromise(arrNewDocumentChanges, docId, startIndex, conn.user);
    }
    yield* setChangesIndex(docId, puckerIndex);
    var changesIndex = (-1 === deleteIndex && data.startSaveChanges) ? startIndex : -1;
    if (data.endSaveChanges) {
      // Для Excel нужно пересчитать индексы для lock-ов
      if (data.isExcel && false !== data.isCoAuthoring && data.excelAdditionalInfo) {
        var tmpAdditionalInfo = JSON.parse(data.excelAdditionalInfo);
        // Это мы получили recalcIndexColumns и recalcIndexRows
        var oRecalcIndexColumns = _addRecalcIndex(tmpAdditionalInfo["indexCols"]);
        var oRecalcIndexRows = _addRecalcIndex(tmpAdditionalInfo["indexRows"]);
        // Теперь нужно пересчитать индексы для lock-элементов
        if (null !== oRecalcIndexColumns || null !== oRecalcIndexRows) {
          var docLock = yield* getAllLocks(docId);
          if (_recalcLockArray(userId, docLock, oRecalcIndexColumns, oRecalcIndexRows)) {
            var toCache = [];
            for (i = 0; i < docLock.length; ++i) {
              toCache.push(JSON.stringify(docLock[i]));
            }
            yield* addLocks(docId, toCache, true);
          }
        }
      }

      //Release locks
      var userLocks = yield* getUserLocks(docId, conn.sessionId);
      // Для данного пользователя снимаем Lock с документа
      var checkEndAuthLockRes = yield* checkEndAuthLock(false, docId, userId);
      if (!checkEndAuthLockRes) {
        var arrLocks = _.map(userLocks, function(e) {
          return {
            block: e.block,
            user: e.user,
            time: Date.now(),
            changes: null
          };
        });
        var changesToSend = arrNewDocumentChanges;
        if(changesToSend.length > cfgPubSubMaxChanges) {
          changesToSend = null;
        }
        yield* publish({type: PublishType.changes, docId: docId, userId: userId,
          changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
          locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo}, docId, userId);
      }
      // Автоматически снимаем lock сами и посылаем индекс для сохранения
      yield* unSaveLock(conn, changesIndex);
      yield utils.promiseRedis(redisClient, redisClient.setex, redisKeyLastSave + docId, cfgExpLastSave, (new Date()).toISOString() + '_' + puckerIndex);

    } else {
      var changesToSend = arrNewDocumentChanges;
      if(changesToSend.length > cfgPubSubMaxChanges) {
        changesToSend = null;
      }
      yield* publish({type: PublishType.changes, docId: docId, userId: userId,
        changes: changesToSend, startIndex: startIndex, changesIndex: puckerIndex,
        locks: [], excelAdditionalInfo: undefined}, docId, userId);
      sendData(conn, {type: 'savePartChanges', changesIndex: changesIndex});
    }
  }

  // Можем ли мы сохранять ?
  function* isSaveLock(conn) {
    var isSaveLock = true;
    var exist = yield utils.promiseRedis(redisClient, redisClient.setnx, redisKeySaveLock + conn.docId, conn.user.id);
    if (exist) {
      isSaveLock = false;
      var saveLock = yield utils.promiseRedis(redisClient, redisClient.expire, redisKeySaveLock + conn.docId, cfgExpSaveLock);
    }

    // Отправляем только тому, кто спрашивал (всем отправлять нельзя)
    sendData(conn, {type: "saveLock", saveLock: isSaveLock});
  }

  // Снимаем лок с сохранения
  function* unSaveLock(conn, index) {
    var saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + conn.docId);
    // ToDo проверка null === saveLock это заглушка на подключение второго пользователя в документ (не делается saveLock в этот момент, но идет сохранение и снять его нужно)
    if (null === saveLock || conn.user.id == saveLock) {
      yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + conn.docId);
      sendData(conn, {type: 'unSaveLock', index: index});
    }
  }

  // Возвращаем все сообщения для документа
  function* getMessages(conn) {
    var allMessages = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyMessage + conn.docId, 0, -1);
    var allMessagesParsed = undefined;
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

  function* _createSaveTimer(docId, opt_userId) {
    var updateMask = new taskResult.TaskResultData();
    updateMask.key = docId;
    updateMask.status = taskResult.FileStatus.Ok;
    var updateTask = new taskResult.TaskResultData();
    updateTask.status = taskResult.FileStatus.SaveVersion;
    updateTask.statusInfo = utils.getMillisecondsOfHour(new Date());
    var updateIfRes = yield taskResult.updateIf(updateTask, updateMask);
    if (updateIfRes.affectedRows > 0) {
      yield utils.sleep(c_oAscSaveTimeOutDelay);
      while (true) {
        if (!sqlBase.isLockCriticalSection(docId)) {
          canvasService.saveFromChanges(docId, updateTask.statusInfo, null, opt_userId);
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

  function _checkLicense(conn) {
    sendData(conn, {type: 'license', license: licenseInfo});
  }

  sockjs_echo.installHandlers(server, {prefix: '/doc/['+constants.DOC_ID_PATTERN+']*/c', log: function(severity, message) {
    //TODO: handle severity
    logger.info(message);
  }});

  var checkDocumentExpire = function() {
    utils.spawn(function*() {
      try {
        logger.debug('checkDocumentExpire start');
        var removedCount = 0;
        var dateExpire = new Date();
        utils.addSeconds(dateExpire, -cfgExpDocuments);
        var expireDocs = yield utils.promiseRedis(redisClient, redisClient.zrangebyscore, redisKeyDocuments, '-inf', dateExpire.getTime());
        for (var i = 0; i < expireDocs.length; ++i) {
          var docId = expireDocs[i];
          var numDelete = yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docId);
          //если numDelete == 0, значит этот ключ удалил другой процесс
          if (numDelete > 0) {
            removedCount++;
            var puckerIndex = yield* getChangesIndex(docId);
            if (puckerIndex > 0) {
              logger.debug('checkDocumentExpire commit %d changes: docId = %s', puckerIndex, docId);
              yield* _createSaveTimer(docId);
            } else {
              logger.debug('checkDocumentExpire no changes: docId = %s', docId);
              yield* cleanDocumentOnExitNoChanges(docId);
            }
          }
        }
        logger.debug('checkDocumentExpire end: removedCount = %d', removedCount);
      } catch (e) {
        logger.error('checkDocumentExpire error:\r\n%s', e.stack);
      }
    });
  };
  //удаление файлов от которых не приходит heartbeat
  var documentExpireJob = new cron.CronJob(cfgExpDocumentsCron, checkDocumentExpire);
  documentExpireJob.start();
  var fileExpireJob = new cron.CronJob(cfgExpFilesCron, checkExpire.checkFileExpire);
  fileExpireJob.start();

  //cache
  redisClient = redis.createClient(cfgRedisPort, cfgRedisHost, {});
  redisClient.on('error', function(err) {
    logger.error('redisClient error:\r\n%s', err.stack);
  });
//  redisClient.on("connect", function () {
//    logger.debug('redisClient connect');
//  });

  //publish subscribe message brocker
  function pubsubOnMessage(msg) {
    utils.spawn(function*() {
      try {
        logger.debug('pubsub message start:%s', msg);
        var data = JSON.parse(msg);
        var participants;
        var participant;
        var objChangesDocument;
        var i;
        switch (data.type) {
          case PublishType.drop:
            for (i = 0; i < data.users.length; ++i) {
              dropUserFromDocument(data.docId, data.users[i], data.description);
            }
            break;
          case PublishType.releaseLock:
            participants = getParticipants(true, data.docId, data.userId, true);
            _.each(participants, function(participant) {
              sendReleaseLock(participant, data.locks);
            });
            break;
          case PublishType.participantsState:
            participants = getParticipants(true, data.docId, data.user.id);
            sendParticipantsState(participants, data);
            break;
          case PublishType.message:
            participants = getParticipants(true, data.docId, data.userId);
            _.each(participants, function(participant) {
              sendDataMessage(participant, data.messages);
            });
            break;
          case PublishType.getLock:
            participants = getParticipants(true, data.docId, data.userId, true);
            sendGetLock(participants, data.documentLocks);
            break;
          case PublishType.changes:
            participants = getParticipants(true, data.docId, data.userId, true);
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
          case PublishType.auth:
            participants = getParticipants(true, data.docId, data.userId, true);
            if(participants.length > 0) {
              objChangesDocument = yield* getDocumentChanges(data.docId);
              for (i = 0; i < participants.length; ++i) {
                participant = participants[i];
                yield* sendAuthInfo(objChangesDocument.arrChanges, objChangesDocument.getLength(), participant, data.participantsMap);
              }
            }
            break;
          case PublishType.receiveTask:
            var cmd = new commonDefines.InputCommand(data.cmd);
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
              participants = getParticipants(false, docId);
            }
            for (i = 0; i < participants.length; ++i) {
              participant = participants[i];
              if (data.needUrlKey) {
                if (0 == data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrls(participant.baseUrl, data.needUrlKey));
                } else if (1 == data.needUrlMethod) {
                  outputData.setData(yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey));
                } else {
                  outputData.setData(yield storage.getSignedUrl(participant.baseUrl, data.needUrlKey, null, cmd.getTitle()));
                }
              }
              sendData(participant, output);
            }
            break;
          case PublishType.warning:
            participants = getParticipants(false, data.docId);
            _.each(participants, function(participant) {
              sendDataWarning(participant, data.description);
            });
            break;
          case PublishType.cursor:
            participants = getParticipants(true, data.docId, data.userId);
            _.each(participants, function(participant) {
              sendDataCursor(participant, data.messages);
            });
            break;
        }
      } catch (err) {
        logger.debug('pubsub message error:\r\n%s', err.stack);
      }
    });
  }

  pubsub = new pubsubService();
  pubsub.on('message', pubsubOnMessage);
  pubsub.init(function(err) {
    if (null != err) {
      logger.error('createPubSub error :\r\n%s', err.stack);
    }

    queue = new queueService();
    queue.on('response', canvasService.receiveTask);
    queue.init(true, false, false, true, function(err){
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
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (req, res) {
  utils.spawn(function* () {
    var result = commonDefines.c_oAscServerCommandErrors.NoError;
    var docId = 'null';
    try {
      var query = req.query;
      // Ключ id-документа
      docId = query.key;
      if (null == docId) {
        result = commonDefines.c_oAscServerCommandErrors.DocumentIdError;
      } else {
        logger.debug('Start commandFromServer: docId = %s c = %s', docId, query.c);
        switch (query.c) {
          case 'info':
            yield* bindEvents(docId, query.callback, utils.getBaseUrlByRequest(req));
            break;
          case 'drop':
            if (query.userid) {
              yield* publish({type: PublishType.drop, docId: docId, users: [query.userid], description: query.description});
            }
            else if (query.users) {
              yield* dropUsersFromDocument(docId, query.users);
            }
            break;
          case 'saved':
            // Результат от менеджера документов о статусе обработки сохранения файла после сборки
            if ('1' !== query.status) {
              //запрос saved выполняется синхронно, поэтому заполняем переменную чтобы проверить ее после sendServerRequest
              yield utils.promiseRedis(redisClient, redisClient.setex, redisKeySaved + docId, cfgExpSaved, query.status);
              logger.error('saved corrupted id = %s status = %s conv = %s', docId, query.status, query.conv);
            } else {
              logger.info('saved id = %s status = %s conv = %s', docId, query.status, query.conv);
            }
            break;
          case 'forcesave':
            //проверяем хеш состоящий из времени и индекса последнего изменения, если мы его не собирали, то запускаем сборку
            var lastSave = yield utils.promiseRedis(redisClient, redisClient.get, redisKeyLastSave + docId);
            if (lastSave) {
              var baseUrl = utils.getBaseUrlByRequest(req);
              var multi = redisClient.multi([
                ['hsetnx', redisKeyForceSave + docId, lastSave, ""],
                ['expire', redisKeyForceSave + docId, cfgExpForceSave]
              ]);
              var execRes = yield utils.promiseRedis(multi, multi.exec);
              //hsetnx 0 if field already exists
              if (0 == execRes[0]) {
                result = commonDefines.c_oAscServerCommandErrors.NotModify;
              } else {
                //start new convert
                var status = yield* converterService.convertFromChanges(docId, baseUrl, lastSave, query.userdata);
                if (constants.NO_ERROR !== status.err) {
                  result = commonDefines.c_oAscServerCommandErrors.CommandError;
                }
              }
            } else {
              result = commonDefines.c_oAscServerCommandErrors.NotModify;
            }
            break;
          default:
            result = commonDefines.c_oAscServerCommandErrors.CommandError;
            break;
        }
      }
    } catch (err) {
      result = commonDefines.c_oAscServerCommandErrors.CommandError;
      logger.error('Error commandFromServer: docId = %s\r\n%s', docId, err.stack);
    } finally {
      var output = JSON.stringify({'key': req.query.key, 'error': result});
      logger.debug('End commandFromServer: docId = %s %s', docId, output);
      var outputBuffer = new Buffer(output, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', outputBuffer.length);
      res.send(outputBuffer);
    }
  });
};