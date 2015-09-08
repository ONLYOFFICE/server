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
 *----------------------------------------Таблица в базе данных doc_pucker-----------------------------------------------
 * Отвечает не только за информацио о сервисе для сборки. Если есть запись в этой таблице, то значит документ
 * редактировался и были изменения. В эту таблицу пишем только на сохранении изменений
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
var sockjs = require('sockjs'),
  _ = require('underscore'),
  https = require('https'),
  http = require('http'),
  url = require('url'),
  cron = require('cron'),
  storage = require('./../../Common/sources/storage-base'),
  logger = require('./../../Common/sources/logger'),
  constants = require('./../../Common/sources/constants'),
  utils = require('./../../Common/sources/utils'),
  commonDefines = require('./../../Common/sources/commondefines'),
  config = require('config').get('services.CoAuthoring'),
  sqlBase = require('./baseConnector'),
  taskResult = require('./taskresult');
  canvasService = require('./canvasservice');
var redis = require(config.get('redis.name'));
var pubsubService = require('./' + config.get('pubsub.name'));
var queueService = require('./../../Common/sources/' + configCommon.get('queue.name'));

var cfgPubSubMaxChanges = config.get('pubsub.maxChanges');

var cfgRedisPrefix = config.get('redis.prefix');
var cfgRedisHost = config.get('redis.host');
var cfgRedisPort = config.get('redis.port');
var cfgExpCallback = config.get('expire.callback');
var cfgExpSaveLock = config.get('expire.saveLock');
var cfgExpLockDoc = config.get('expire.lockDoc');
var cfgExpDocuments = config.get('expire.documents');
var cfgExpDocumentsCron = config.get('expire.documentsCron');
var cfgExpFiles = config.get('expire.files');
var cfgExpFilesCron = config.get('expire.filesCron');
var cfgExpMessage = config.get('expire.message');

var redisKeyCallback = cfgRedisPrefix + 'callback:';
var redisKeyUserIndex = cfgRedisPrefix + 'userindex:';
var redisKeySaveLock = cfgRedisPrefix + 'savelock:';
var redisKeyEditors = cfgRedisPrefix + 'editors:';
var redisKeyLocks = cfgRedisPrefix + 'locks:';
var redisKeyChangeIndex = cfgRedisPrefix + 'changesindex:';
var redisKeyLockDoc = cfgRedisPrefix + 'lockdocument:';
var redisKeyMessage = cfgRedisPrefix + 'message:';
var redisKeyDocuments = cfgRedisPrefix + 'documents';

var PublishType = {
  drop : 0,
  releaseLock : 1,
  participantsState : 2,
  message : 3,
  getLock : 4,
  changes : 5,
  auth : 6,
  receiveTask : 7
};

var defaultHttpPort = 80, defaultHttpsPort = 443;	// Порты по умолчанию (для http и https)
var connections = [], // Активные соединения
  redisClient,
  pubsub,
  queue;

var asc_coAuthV = '3.0.8';				// Версия сервера совместного редактирования

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
  MailMerge: 5
};

var c_oAscChangeBase = {
  No: 0,
  Delete: 1,
  All: 2
};

var c_oAscServerCommandErrors = {
  NoError: 0,
  DocumentIdError: 1,
  ParseError: 2,
  CommandError: 3
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
function sendDataMessage(conn, msg) {
  sendData(conn, {type: "message", messages: msg});
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
function getParticipants(docId, excludeUserId, excludeViewer) {
  return _.filter(connections, function(el) {
    return el.connection.docId === docId && el.connection.user.id !== excludeUserId &&
      el.connection.isViewer !== excludeViewer;
  });
}
function getParticipantUser(docId, includeUserId) {
  return _.filter(connections, function(el) {
    return el.connection.docId === docId && el.connection.user.id === includeUserId;
  });
}
function* hasEditors(docId) {
  var editorsCount = yield utils.promiseRedis(redisClient, redisClient.hlen, redisKeyEditors + docId);
  return editorsCount > 0;
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
    tmpObject[elem.idOriginal] = 1;
  }
  for (var name in tmpObject) if (tmpObject.hasOwnProperty(name)) {
    result.push(name);
  }
  return result;
}

function sendServerRequest(server, postData, onReplyCallback) {
  if (!server.host || !server.path) {
    return;
  }
  var options = {
    host: server.host,
    path: server.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': postData.length
    },
    rejectUnauthorized: false
  };
  if (server.port) {
    options.port = server.port;
  }

  var requestFunction = server.https ? https.request : http.request;

  logger.info('postData: %s', postData);
  var req = requestFunction(options, function(res) {
    res.setEncoding('utf8');
    var replyData = '';
    res.on('data', function(chunk) {
      logger.info('replyData: %s', chunk);
      replyData += chunk;
    });
    res.on('end', function() {
      logger.info('end');
      if (onReplyCallback) {
        onReplyCallback(replyData);
      }
    });
  });

  req.on('error', function(e) {
    logger.warn('problem with request on server: %s', e.message);
  });

  // write data to request body
  req.write(postData);
  req.end();
}
function sendServerRequestPromise(server, postData) {
  return new Promise(function(resolve, reject) {
    sendServerRequest(server, postData, function(data) {
      resolve(data);
    });
  });
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
/**
 * Отправка статуса, чтобы знать когда документ начал редактироваться, а когда закончился
 * @param docId
 * @param {number} bChangeBase
 */
function* sendStatusDocument(docId, bChangeBase, callback, baseUrl) {
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

  var sendData = JSON.stringify({'key': docId, 'status': status, 'url': '', 'users': participants});
  var replyData = yield sendServerRequestPromise(callback, sendData);
  onReplySendStatusDocument(docId, replyData);
}
function onReplySendStatusDocument(docId, replyData) {
  if (!replyData) {
    return;
  }
  var oData, users;
  try {
    oData = JSON.parse(replyData);
  } catch (e) {
    logger.error("error reply SendStatusDocument: %s docId = %s", e.stack, docId);
    oData = null;
  }
  if (!oData) {
    return;
  }
  users = Array.isArray(oData) ? oData : oData.users;
  if (Array.isArray(users)) {
    yield* publish({type: PublishType.drop, docId: docId, users: users, description: ''});
  }
}

function dropUserFromDocument(docId, userId, description) {
  var elConnection;
  for (var i = 0, length = connections.length; i < length; ++i) {
    elConnection = connections[i].connection;
    if (elConnection.docId === docId && userId === elConnection.user.idOriginal) {
      sendData(elConnection,
        {
          type: "drop",
          description: description
        });//Or 0 if fails
    }
  }
}

// Подписка на эвенты:
function* bindEvents(docId, callback, baseUrl) {
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
      return c_oAscServerCommandErrors.ParseError;
    }
    bChangeBase = c_oAscChangeBase.All;
  }
  yield* sendStatusDocument(docId, bChangeBase, oCallbackUrl, baseUrl);
}

// Удаляем изменения из памяти (используется только с основного сервера, для очистки!)
function* removeChanges(id, isCorrupted, isConvertService) {
  logger.info('removeChanges: %s', id);
  // remove messages from memory
  yield utils.promiseRedis(redisClient, redisClient.del, redisKeyMessage + id);

  yield* deleteCallback(id);

  if (!isCorrupted) {
    // Нужно удалить изменения из базы
    sqlBase.deleteChanges(id, null);
  } else {
    // Обновим статус файла (т.к. ошибка, выставим, что не собиралось)
    sqlBase.updateStatusFile(id);
    logger.error('saved corrupted id = %s convert = %s', id, isConvertService);
  }
}

exports.version = asc_coAuthV;
exports.c_oAscServerStatus = c_oAscServerStatus;
exports.sendData = sendData;
exports.parseUrl = parseUrl;
exports.sendServerRequestPromise = sendServerRequestPromise;
exports.PublishType = PublishType;
exports.publish = publish;
exports.addTask = addTask;
exports.removeResponse = removeResponse;
exports.hasEditors = hasEditors;
exports.getCallback = getCallback;
exports.deleteCallback= deleteCallback;
exports.install = function(server, callbackFunction) {
  'use strict';
  var sockjs_opts = {sockjs_url: './../../Common/sources/sockjs-0.3.min.js'},
    sockjs_echo = sockjs.createServer(sockjs_opts),
    saveTimers = {},// Таймеры сохранения, после выхода всех пользователей
    urlParse = new RegExp("^/doc/([" + constants.DOC_ID_PATTERN + "]*)/c.+", 'i');

  sockjs_echo.on('connection', function(conn) {
    if (null == conn) {
      logger.error("null == conn");
      return;
    }
    conn.baseUrl = utils.getBaseUrlByConnection(conn);

    conn.on('data', function(message) {
      utils.spawn(function* () {
      try {
        var data = JSON.parse(message);
        logger.info('data.type = ' + data.type + ' id = ' + conn.docId);
        switch (data.type) {
          case 'auth'          :
            yield* auth(conn, data);
            break;
          case 'message'        :
            yield* onMessage(conn, data);
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
            yield* checkEndAuthLock(data.isSave, conn.docId, conn.user.id, null, conn);
            break;
          case 'ping':
            yield utils.promiseRedis(redisClient, redisClient.zadd, redisKeyDocuments, new Date().getTime(), conn.docId);
            break;
          case 'openDocument'      :
            canvasService.openDocument(conn, data);
            break;
        }
      } catch (e) {
        logger.error("error receiving response: docId = %s type = %s\r\n%s", conn ? conn.docId : 'null', (data && data.type) ? data.type : 'null', e.stack);
      }
      });
    });
    conn.on('error', function() {
      logger.error("On error");
    });
    conn.on('close', function() {
      var connection = this;
      utils.spawn(function* () {
        try {
          var userLocks, reconnected, bHasEditors, bHasChanges;
          var docId = conn.docId;
          if (null == docId) {
            return;
          }

          logger.info("Connection closed or timed out");
          //Check if it's not already reconnected

          //Notify that participant has gone
          connections = _.reject(connections, function(el) {
            return el.connection.id === connection.id;//Delete this connection
          });
          reconnected = _.any(connections, function(el) {
            return el.connection.sessionId === connection.sessionId;//This means that client is reconnected
          });
          var state = (false == reconnected) ? false : undefined;
          var tmpUser = connection.user;
          yield* publish({type: PublishType.participantsState, docId: docId, userId: tmpUser.id, state: state,
            username: tmpUser.name, indexUser: tmpUser.indexUser, view: connection.isViewer}, docId, tmpUser.id);

          if (!reconnected) {
            // Для данного пользователя снимаем лок с сохранения
            var saveLock = yield utils.promiseRedis(redisClient, redisClient.get, redisKeySaveLock + docId);
            if (connection.user.id == saveLock) {
              yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);
            }

            yield utils.promiseRedis(redisClient, redisClient.hdel, redisKeyEditors + docId, tmpUser.id);
            bHasEditors = yield* hasEditors(docId);
            var puckerIndex = yield* getChangesIndex(docId);
            bHasChanges = puckerIndex > 0;

            // Только если редактируем
            if (false === connection.isViewer) {
              // Если у нас нет пользователей, то удаляем все сообщения
              if (!bHasEditors) {
                // На всякий случай снимаем lock
                yield utils.promiseRedis(redisClient, redisClient.del, redisKeySaveLock + docId);
                //удаляем из списка документов
                yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docId);

                // Send changes to save server
                if (bHasChanges) {
                  _createSaveTimer(docId);
                } else {
                  // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
                  yield* sendStatusDocument(docId, c_oAscChangeBase.All);
                }
              } else {
                yield* sendStatusDocument(docId, c_oAscChangeBase.No);
              }

              //Давайдосвиданья!
              //Release locks
              userLocks = yield* getUserLocks(docId, connection.sessionId);
              if (0 < userLocks.length) {
                //todo на close себе ничего не шлем
                //sendReleaseLock(connection, userLocks);
                yield* publish({type: PublishType.releaseLock, docId: docId, userId: connection.user.id, locks: userLocks}, docId, connection.user.id);
              }

              // Для данного пользователя снимаем Lock с документа
              yield* checkEndAuthLock(false, docId, connection.user.id, null);
            }
          }
        } catch (err) {
          logger.error('conn close:\r\n%s', err.stack);
        }
      });
    });
  });
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
    if (toCache.length > 0) {
      //set all
      toCache.unshift(redisClient, redisClient.rpush, redisKeyLocks + docId);
      yield utils.promiseRedis.apply(this, toCache);
    }

    return userLocks;
  }

  function* getParticipantMap(docId) {
    var participantsMap = [];
    var hvalsRes = yield utils.promiseRedis(redisClient, redisClient.hvals, redisKeyEditors + docId);
    for (var i = 0; i < hvalsRes.length; ++i) {
      var elem = JSON.parse(hvalsRes[i]);
      participantsMap.push({id: elem.id, username: elem.username, indexUser: elem.indexUser, view: elem.view});
    }
    return participantsMap;
  }

  function* checkEndAuthLock(isSave, docId, userId, participants, currentConnection) {
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
      sendData(participant.connection, {
        type: "connectState",
        state: data.state,
        id: data.userId,
        username: data.username,
        indexUser: data.indexUser,
        view: data.view
      });
    });
  }

  function sendFileError(conn, errorId) {
    logger.error('error description: %s', errorId);
    sendData(conn, {type: 'error', description: errorId});
  }

  function sendChangesToServer(docId) {
    canvasService.saveFromChanges(docId);
  }

  // Пересчет только для чужих Lock при сохранении на клиенте, который добавлял/удалял строки или столбцы
  function _recalcLockArray(userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
    if (null == _locks) {
      return;
    }
    var count = _locks.length;
    var element = null, oRangeOrObjectId = null;
    var i;
    var sheetId = -1;

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
      }
      if (oRecalcIndexRows && oRecalcIndexRows.hasOwnProperty(sheetId)) {
        // Пересчет строк
        oRangeOrObjectId["r1"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r1"]);
        oRangeOrObjectId["r2"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r2"]);
      }
    }
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

  // Тип объекта
  function typeOf(obj) {
    if (obj === undefined) {
      return "undefined";
    }
    if (obj === null) {
      return "null";
    }
    return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();
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

      // Очищаем таймер сохранения
      if (false === data.isViewer && saveTimers[docId]) {
        clearTimeout(saveTimers[docId]);
      }

      var bIsRestore = null != data.sessionId;

      // Если восстанавливаем, индекс тоже восстанавливаем
      var curIndexUser;
      if (bIsRestore) {
        curIndexUser = user.indexUser;
      } else {
        curIndexUser = yield utils.promiseRedis(redisClient, redisClient.incr, redisKeyUserIndex + docId);
      }

      var curUserId = user.id + curIndexUser;

      conn.sessionState = 1;
      conn.user = {
        id: curUserId,
        idOriginal: user.id,
        name: user.name,
        indexUser: curIndexUser
      };
      conn.isViewer = data.isViewer;

      //Set the unique ID
      if (bIsRestore) {
        logger.info("restored old session id = %s", data.sessionId);

        // Останавливаем сборку (вдруг она началась)
        // Когда переподсоединение, нам нужна проверка на сборку файла
        try {
          var result = yield sqlBase.checkStatusFilePromise(docId);

          var status = result[0]['tr_status'];
          if (FileStatus.Ok === status) {
            // Все хорошо, статус обновлять не нужно
          } else if (FileStatus.SaveVersion === status) {
            // Обновим статус файла (идет сборка, нужно ее остановить)
            sqlBase.updateStatusFile(docId);
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
                return el.connection.sessionId === data.sessionId;//Delete this connection
              });

              yield* endAuth(conn, true);
            } else {
              sendFileError(conn, 'Restore error. Locks not checked.');
            }
          } else {
            sendFileError(conn, 'Restore error. Document modified.');
          }
        } catch (err) {
          sendFileError(conn, 'DataBase error');
        }
      } else {
        conn.sessionId = conn.id;
        yield* endAuth(conn, false, data.documentCallbackUrl);
      }
    }
  }

  function* endAuth(conn, bIsRestore, documentCallbackUrl) {
    var docId = conn.docId;
    connections.push({connection: conn});
    var tmpUser = conn.user;
    yield utils.promiseRedis(redisClient, redisClient.hset, redisKeyEditors + docId, tmpUser.id,
      JSON.stringify({id: tmpUser.id, idOriginal: tmpUser.idOriginal,
        username: tmpUser.name, indexUser: tmpUser.indexUser, view: conn.isViewer}));
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
    if (!conn.isViewer) {
      // Если пришла информация о ссылке для посылания информации, то добавляем
      if (documentCallbackUrl) {
        yield* bindEvents(docId, documentCallbackUrl, conn.baseUrl);
      }
      else {
        yield* sendStatusDocument(docId, c_oAscChangeBase.No);
      }
    }
    var lockDocument = null;
    if (!bIsRestore && 2 === countNoView && !conn.isViewer) {
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

    if (lockDocument && !conn.isViewer) {
      // Для view не ждем снятия lock-а
      var sendObject = {
        type: "waitAuth",
        lockDocument: lockDocument
      };
      sendData(conn, sendObject);//Or 0 if fails
    } else {
      if (bIsRestore) {
        yield* sendAuthInfo(undefined, undefined, conn, participantsMap);
      }
      else {
        var objChangesDocument = yield* getDocumentChanges(docId);
        yield* sendAuthInfo(objChangesDocument.arrChanges, objChangesDocument.getLength(), conn, participantsMap);
      }
    }
    yield* publish({type: PublishType.participantsState, docId: docId, userId: tmpUser.id, state: true,
      username: tmpUser.name, indexUser: tmpUser.indexUser, view: conn.isViewer}, docId, tmpUser.id);
  }

  function* sendAuthInfo(objChangesDocument, changesIndex, conn, participantsMap) {
    var docId = conn.docId;
    var docLock = yield* getAllLocks(docId);
    var allMessages = yield utils.promiseRedis(redisClient, redisClient.lrange, redisKeyMessage + docId, 0, -1);
    var allMessagesParsed = allMessages.map(function(val){
      return JSON.parse(val);
    });
    var sendObject = {
      type: "auth",
      result: 1,
      sessionId: conn.sessionId,
      participants: participantsMap,
      messages: allMessagesParsed,
      locks: docLock,
      changes: objChangesDocument,
      changesIndex: changesIndex,
      indexUser: conn.user.indexUser
    };
    sendData(conn, sendObject);//Or 0 if fails
  }

  function* onMessage(conn, data) {
    var docId = conn.docId;
    var userId = conn.user.id;
    var msg = {docid: docId, message: data.message, time: Date.now(), user: userId, username: conn.user.name};

    yield utils.promiseRedis(redisClient, redisClient.rpush, redisKeyMessage + docId, JSON.stringify(msg));
    yield utils.promiseRedis(redisClient, redisClient.expire, redisKeyMessage + docId, cfgExpMessage);
    // insert
    logger.info("insert message: %s", JSON.stringify(msg));

    var messages = [msg];
    sendDataMessage(conn, messages);
    yield* publish({type: PublishType.message, docId: docId, userId: userId, messages: messages}, docId, userId);
  }

  function* getLock(conn, data, bIsRestore) {
    logger.info("getLock docid: %s", conn.docId);
    var fLock = null;
    switch (data['editorType']) {
      case 0:
        // Word
        fLock = getLockWord;
        break;
      case 1:
        // Excel
        fLock = getLockExcel;
        break;
      case 2:
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
      toCache.unshift(redisClient, redisClient.rpush, redisKeyLocks + docId);
      yield utils.promiseRedis.apply(this, toCache);
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
      toCache.unshift(redisClient, redisClient.rpush, redisKeyLocks + docId);
      yield utils.promiseRedis.apply(this, toCache);
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
      toCache.unshift(redisClient, redisClient.rpush, redisKeyLocks + docId);
      yield utils.promiseRedis.apply(this, toCache);
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
      sendData(participant.connection, {type: "getLock", locks: documentLocks});
    });
  }

  function* setChangesIndex(docId, index) {
    yield utils.promiseRedis(redisClient, redisClient.set, redisKeyChangeIndex + docId, index);
  }

  // Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
  function* saveChanges(conn, data) {
    var docId = conn.docId, userId = conn.user.id;
    logger.info("saveChanges docid: %s", docId);

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
          logger.error("saveChanges docid: %s ; deleteIndex: %s ; startIndex: %s ; deleteCount: %s", docId, deleteIndex, puckerIndex, deleteCount);
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
          _recalcLockArray(userId, docLock, oRecalcIndexColumns, oRecalcIndexRows);
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
    if (conn.user.id == saveLock) {
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
        logger.info("getLock id: %s", block);
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

  function _createSaveTimer(docId) {
    var oTimeoutFunction = function() {
      if (sqlBase.isLockCriticalSection(docId)) {
        saveTimers[docId] = setTimeout(oTimeoutFunction, c_oAscLockTimeOutDelay);
      }
      else {
        delete saveTimers[docId];
        sendChangesToServer(docId);
      }
    };
    saveTimers[docId] = setTimeout(oTimeoutFunction, c_oAscSaveTimeOutDelay);
  }

  sockjs_echo.installHandlers(server, {prefix: '/doc/['+constants.DOC_ID_PATTERN+']*/c', log: function(severity, message) {
    //TODO: handle severity
    logger.info(message);
  }});

  var checkDocumentExpire = function () {
    utils.spawn(function*() {
      try {
        logger.debug('checkDocumentExpire start');
        var dateExpire = new Date();
        utils.addSeconds(dateExpire, - cfgExpDocuments);
        var expireDocs = yield utils.promiseRedis(redisClient, redisClient.zrangebyscore, redisKeyDocuments, '-inf', dateExpire.getTime());
        for(var i = 0; i < expireDocs.length; ++i) {
          var docId = expireDocs[i];
          var numDelete = yield utils.promiseRedis(redisClient, redisClient.zrem, redisKeyDocuments, docId);
          //если numDelete == 0, значит этот ключ удалил другой процесс
          if(numDelete > 0) {
            var puckerIndex = yield* getChangesIndex(docId);
            if (puckerIndex > 0) {
              logger.debug('checkDocumentExpire commit %d changes', puckerIndex);
              _createSaveTimer(docId);
            } else {
              logger.debug('checkDocumentExpire no changes');
              // Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
              yield* sendStatusDocument(docId, c_oAscChangeBase.All);
            }
          }
        }
        logger.debug('checkDocumentExpire end');
      }
      catch(e) {
        logger.error(e);
      }
    });
  };
  var checkFileExpire = function () {
    utils.spawn(function*() {
      try {
        logger.debug('checkFileExpire start');
        var expired = yield taskResult.getExpired(cfgExpFiles);
        for (var i = 0; i < expired.length; ++i) {
          var docId = expired[i].tr_key;
          //delete if no changes
          var puckerIndex = yield* getChangesIndex(docId);
          if (!(puckerIndex > 0)) {
            var removeRes = yield taskResult.remove(docId);
            //если ничего не удалилось, значит это сделал другой процесс
            if(removeRes.affectedRows > 0) {
              yield storage.deletePath(docId);
            }
          }
        }
        logger.debug('checkFileExpire end');
      }
      catch(e) {
        logger.error(e);
      }
    });
  };
  //удаление файлов от которых не приходит heartbeat
  var documentExpireJob = new cron.CronJob(cfgExpDocumentsCron, checkDocumentExpire);
  documentExpireJob.start();
  var fileExpireJob = new cron.CronJob(cfgExpFilesCron, checkFileExpire);
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
            participants = getParticipants(data.docId, data.userId);
            _.each(participants, function(participant) {
              if (!participant.connection.isViewer) {
                sendReleaseLock(participant.connection, data.locks);
              }
            });
            break;
          case PublishType.participantsState:
            participants = getParticipants(data.docId, data.userId);
            sendParticipantsState(participants, data);
            break;
          case PublishType.message:
            participants = getParticipants(data.docId, data.userId);
            _.each(participants, function(participant) {
              sendDataMessage(participant.connection, data.messages);
            });
            break;
          case PublishType.getLock:
            participants = getParticipants(data.docId, data.userId, true);
            sendGetLock(participants, data.documentLocks);
            break;
          case PublishType.changes:
            participants = getParticipants(data.docId, data.userId, true);
            if(participants.length > 0) {
              var changes = data.changes;
              if (null == changes) {
                objChangesDocument = yield* getDocumentChanges(data.docId, data.startIndex, data.changesIndex);
                changes = objChangesDocument.arrChanges;
              }
              _.each(participants, function(participant) {
                sendData(participant.connection, {type: 'saveChanges', changes: changes,
                  changesIndex: data.changesIndex, locks: data.locks, excelAdditionalInfo: data.excelAdditionalInfo});
              });
            }
            break;
          case PublishType.auth:
            participants = getParticipants(data.docId, data.userId, true);
            if(participants.length > 0) {
              objChangesDocument = yield* getDocumentChanges(data.docId);
              for (i = 0; i < participants.length; ++i) {
                participant = participants[i];
                yield* sendAuthInfo(objChangesDocument.arrChanges, objChangesDocument.getLength(), participant.connection, data.participantsMap);
              }
            }
            break;
          case PublishType.receiveTask:
            var cmd = new commonDefines.InputCommand(data.cmd);
            var output = new canvasService.OutputDataWrap();
            output.fromObject(data.output);
            var outputData = output.getData();

            if (cmd.getUserConnectionId()) {
              participants = getParticipantUser(cmd.getDocId(), cmd.getUserConnectionId());
            } else {
              participants = getParticipants(cmd.getDocId());
            }
            for (i = 0; i < participants.length; ++i) {
              participant = participants[i];
              if (data.needUrlKey) {
                if(0 == data.needUrlMethod){
                  outputData.setData(yield storage.getSignedUrls(participant.connection.baseUrl, data.needUrlKey));
                } else {
                  outputData.setData(yield storage.getSignedUrl(participant.connection.baseUrl, data.needUrlKey));
                }
              }
              sendData(participant.connection, output);
            }
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
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function(req) {
  utils.spawn(function* () {
  try {
  var query = req.query;
  // Ключ id-документа
  var docId = query.key;
  if (null == docId) {
    return c_oAscServerCommandErrors.DocumentIdError;
  }

  logger.info('commandFromServer: docId = %s c = %s', docId, query.c);
  var result = c_oAscServerCommandErrors.NoError;
  switch (query.c) {
    case 'info':
      yield* bindEvents(docId, query.callback, utils.getBaseUrlByRequest(req));
      break;
    case 'drop':
      if (query.userid) {
        yield* publish({type: PublishType.drop, docId: docId, users: [query.userid], description: query.description});
      }
      else if (query.users) {
        onReplySendStatusDocument(docId, query.users);
      }
      break;
    case 'saved':
      // Результат от менеджера документов о статусе обработки сохранения файла после сборки
      yield* removeChanges(docId, '1' !== query.status, '1' === query.conv);
      break;
    default:
      result = c_oAscServerCommandErrors.CommandError;
      break;
  }

  return result;
  } catch(err){
    logger.debug('commandFromServer error:\r\n%s', err.stack);
  }
  });
};