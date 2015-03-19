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

var sockjs = require('sockjs'),
    _ = require('underscore'),
	https = require('https'),
	http = require('http'),
	url = require('url'),
	logger = require('./../../Common/sources/logger'),
	config = require('./config.json'),
	sqlBase = require('./baseConnector');

var defaultHttpPort = 80, defaultHttpsPort = 443;	// Порты по умолчанию (для http и https)
var messages					= {}, // Сообщения из чата для документов
	connections					= [], // Активные соединения
	objServiceInfo				= {}, // Информация о подписчиках (callback-ах)
	objServicePucker			= {}, // Информация о сборщике + о сохранении файла
	arrCacheDocumentsChanges	= [], // Кэш для хранения изменений активных документов
	nCacheSize					= 100;// Размер кэша

var asc_coAuthV	= '3.0.8';				// Версия сервера совместного редактирования

function DocumentChanges (docId) {
	this.docId = docId;
	this.arrChanges = [];

	return this;
}
DocumentChanges.prototype.getLength = function () {
	return this.arrChanges.length;
};
DocumentChanges.prototype.push = function (change) {
	this.arrChanges.push(change);
};
DocumentChanges.prototype.splice = function (start, deleteCount) {
	this.arrChanges.splice(start, deleteCount);
};
DocumentChanges.prototype.concat = function (item) {
	this.arrChanges = this.arrChanges.concat(item);
};

var c_oAscServerStatus = {
	NotFound	: 0,
	Editing		: 1,
	MustSave	: 2,
	Corrupted	: 3,
	Closed		: 4
};

var c_oAscChangeBase = {
	No		: 0,
	Delete	: 1,
	All		: 2
};

var c_oAscServerCommandErrors = {
	NoError			: 0,
	DocumentIdError	: 1,
	ParseError		: 2,
	CommandError	: 3
};

var c_oAscSaveTimeOutDelay = 5000;	// Время ожидания для сохранения на сервере (для отработки F5 в браузере)

var c_oAscRecalcIndexTypes = {
	RecalcIndexAdd:		1,
	RecalcIndexRemove:	2
};

var FileStatus  = {
	None			: 0,
	Ok				: 1,
	WaitQueue		: 2,
	NeedParams		: 3,
	Convert			: 4,
	Err				: 5,
	ErrToReload		: 6,
	SaveVersion		: 7,
	UpdateVersion	: 8
};

/**
 * lock types
 * @const
 */
var c_oAscLockTypes = {
	kLockTypeNone	: 1, // никто не залочил данный объект
	kLockTypeMine	: 2, // данный объект залочен текущим пользователем
	kLockTypeOther	: 3, // данный объект залочен другим(не текущим) пользователем
	kLockTypeOther2	: 4, // данный объект залочен другим(не текущим) пользователем (обновления уже пришли)
	kLockTypeOther3	: 5  // данный объект был залочен (обновления пришли) и снова стал залочен
};

var c_oAscLockTypeElem = {
	Range:	1,
	Object:	2,
	Sheet:	3
};
var c_oAscLockTypeElemSubType = {
	DeleteColumns:		1,
	InsertColumns:		2,
	DeleteRows:			3,
	InsertRows:			4,
	ChangeProperties:	5
};

var c_oAscLockTypeElemPresentation = {
	Object		: 1,
	Slide		: 2,
	Presentation: 3
};

function CRecalcIndexElement(recalcType, position, bIsSaveIndex) {
	if ( !(this instanceof CRecalcIndexElement) ) {
		return new CRecalcIndexElement (recalcType, position, bIsSaveIndex);
	}

	this._recalcType	= recalcType;		// Тип изменений (удаление или добавление)
	this._position		= position;			// Позиция, в которой произошли изменения
	this._count			= 1;				// Считаем все изменения за простейшие
	this.m_bIsSaveIndex	= !!bIsSaveIndex;	// Это индексы из изменений других пользователей (которые мы еще не применили)

	return this;
}

CRecalcIndexElement.prototype = {
	constructor: CRecalcIndexElement,

	// Пересчет для других
	getLockOther: function (position, type) {
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
		} else if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Пересчет для других (только для сохранения)
	getLockSaveOther: function (position, type) {
		if (this.m_bIsSaveIndex)
			return position;

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
		} else if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Пересчет для себя
	getLockMe: function (position) {
		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
		if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Только когда от других пользователей изменения (для пересчета)
	getLockMe2: function (position) {
		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
		if (true !== this.m_bIsSaveIndex || position < this._position)
			return position;
		else
			return (position + inc);
	}
};

function CRecalcIndex() {
	if ( !(this instanceof CRecalcIndex) ) {
		return new CRecalcIndex ();
	}

	this._arrElements = [];		// Массив CRecalcIndexElement

	return this;
}

CRecalcIndex.prototype = {
	constructor: CRecalcIndex,
	add: function (recalcType, position, count, bIsSaveIndex) {
		for (var i = 0; i < count; ++i)
			this._arrElements.push(new CRecalcIndexElement(recalcType, position, bIsSaveIndex));
	},
	clear: function () {
		this._arrElements.length = 0;
	},

	// Пересчет для других
	getLockOther: function (position, type) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = 0; i < count; ++i) {
			newPosition = this._arrElements[i].getLockOther(newPosition, type);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Пересчет для других (только для сохранения)
	getLockSaveOther: function (position, type) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = 0; i < count; ++i) {
			newPosition = this._arrElements[i].getLockSaveOther(newPosition, type);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Пересчет для себя
	getLockMe: function (position) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = count - 1; i >= 0; --i) {
			newPosition = this._arrElements[i].getLockMe(newPosition);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Только когда от других пользователей изменения (для пересчета)
	getLockMe2: function (position) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = count - 1; i >= 0; --i) {
			newPosition = this._arrElements[i].getLockMe2(newPosition);
			if (null === newPosition)
				break;
		}

		return newPosition;
	}
};

function sendData(conn, data) {
	conn.write(JSON.stringify(data));
}

function getOriginalParticipantsId(docId) {
	var result = [], tmpObject = {}, elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && false === elConnection.isViewer)
			tmpObject[elConnection.user.idOriginal] = 1;
	}
	for(var name in tmpObject) if (tmpObject.hasOwnProperty(name))
		result.push(name);
	return result;
}

function sendServerRequest (server, postData, onReplyCallback) {
	if (!server.host || !server.path)
		return;
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
	if (server.port)
		options.port = server.port;

	var requestFunction = server.https ? https.request : http.request;

	logger.info('postData: %s', postData);
	var req = requestFunction(options, function(res) {
		res.setEncoding('utf8');
		res.on('data', function(replyData) {
			logger.info('replyData: %s', replyData);
			if (onReplyCallback)
				onReplyCallback(replyData);
		});
		res.on('end', function() {
			logger.info('end');
		});
	});

	req.on('error', function(e) {
		logger.warn('problem with request on server: %s', e.message);
	});

	// write data to request body
	req.write(postData);
	req.end();
}

// Парсинг ссылки
function parseUrl (callbackUrl) {
	var result = null;
	try {
		var parseObject = url.parse(decodeURIComponent(callbackUrl));
		var isHttps = 'https:' === parseObject.protocol;
		var port = parseObject.port;
		if (!port)
			port = isHttps ? defaultHttpsPort : defaultHttpPort;
		result = {
			'https'		: isHttps,
			'host'		: parseObject.hostname,
			'port'		: port,
			'path'		: parseObject.path,
			'href'		: parseObject.href
		};
	} catch (e) {result = null;}

	return result;
}

function deleteCallback (id) {
	// Нужно удалить из базы callback-ов
	sqlBase.deleteCallback(id);
	delete objServiceInfo[id];
}

/**
 * Отправка статуса, чтобы знать когда документ начал редактироваться, а когда закончился
 * @param docId
 * @param {number} bChangeBase
 */
function sendStatusDocument (docId, bChangeBase) {
	var callback = objServiceInfo[docId];
	if (null == callback)
		return;

	var status = c_oAscServerStatus.Editing;
	var participants = getOriginalParticipantsId(docId);
	var oPucker = objServicePucker[docId];
	// Проверка на наличие изменений
	if (0 === participants.length && !(oPucker && oPucker.inDataBase && 0 !== oPucker.index))
		status = c_oAscServerStatus.Closed;

	if (c_oAscChangeBase.No !== bChangeBase) {
		if (c_oAscServerStatus.Editing === status && c_oAscChangeBase.All === bChangeBase) {
			// Добавить в базу
			sqlBase.insertInTable(sqlBase.tableId.callbacks, docId, callback.href);
		} else if (c_oAscServerStatus.Closed === status) {
			// Удалить из базы
			deleteCallback(docId);
		}
	}

	var sendData = JSON.stringify({'key': docId, 'status': status, 'url': '', 'users': participants});
	sendServerRequest(callback, sendData, function (replyData) {onReplySendStatusDocument(docId, replyData);});
}
function onReplySendStatusDocument (docId, replyData) {
	if (!replyData)
		return;
	var i, oData, users;
	try {
		oData = JSON.parse(replyData);
	} catch (e) {
		logger.error("error reply SendStatusDocument: %s docId = %s", e, docId);
		oData = null;
	}
	if (!oData)
		return;
	users = Array.isArray(oData) ? oData : oData.users;
	if (Array.isArray(users)) {
		for (i = 0; i < users.length; ++i)
			dropUserFromDocument(docId, users[i], '');
	}
}

function dropUserFromDocument (docId, userId, description) {
	var elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && userId === elConnection.user.idOriginal) {
			sendData(elConnection,
				{
					type			: "drop",
					description		: description
				});//Or 0 if fails
		}
	}
}

function removeDocumentChanges (docId) {
	// Посмотрим в закэшированных данных
	for (var i = 0, length = arrCacheDocumentsChanges.length; i < length; ++i) {
		if (docId === arrCacheDocumentsChanges[i].docId) {
			arrCacheDocumentsChanges.splice(i, 1);
			return;
		}
	}
}

// Подписка на эвенты:
function bindEvents(docId, callback) {
	// Подписка на эвенты:
	// - если пользователей нет и изменений нет, то отсылаем статус "закрыто" и в базу не добавляем
	// - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
	// - если есть пользователи, то просто добавляем в базу
	var bChangeBase = c_oAscChangeBase.Delete;
	if (!objServiceInfo[docId]) {
		var oCallbackUrl = parseUrl(callback);
		if (null === oCallbackUrl)
			return c_oAscServerCommandErrors.ParseError;
		objServiceInfo[docId] = oCallbackUrl;
		bChangeBase = c_oAscChangeBase.All;
	}
	sendStatusDocument(docId, bChangeBase);
}

// Удаляем изменения из памяти (используется только с основного сервера, для очистки!)
function removeChanges (id, isCorrupted) {
	logger.info('removeChanges: %s', id);
	// remove messages from memory
	delete messages[id];

	deleteCallback(id);
	// remove changes from memory (удаляем из памяти всегда)
	removeDocumentChanges(id);

	if (!isCorrupted) {
		// Удаляем информацию о сборщике
		deletePucker(id);
		// Нужно удалить изменения из базы
		sqlBase.deleteChanges(id, null);
	} else {
		// Обновим статус файла (т.к. ошибка, выставим, что не собиралось)
		sqlBase.updateStatusFile(id);
		logger.error('saved corrupted id = %s', id);
	}
}
function deletePucker (docId) {
	// Нужно удалить из базы сборщика
	sqlBase.deletePucker(docId);
	delete objServicePucker[docId];
}
function updatePucker (docId, url, documentFormatSave, inDataBase) {
	if (!objServicePucker.hasOwnProperty(docId)) {
		var serverUrl = parseUrl(url);
		if (null === serverUrl) {
			logger.error('Error server url = %s', url);
			return;
		}

		objServicePucker[docId] = {
			url					: url,					// Оригинальная ссылка
			server				: serverUrl,			// Распарсили ссылку
			documentFormatSave	: documentFormatSave,	// Формат документа
			inDataBase			: inDataBase,			// Записали ли мы в базу (в базу добавляем только на сохранении)
			index				: 0						// Текущий индекс изменения
		};
	}
}
// Добавление в базу информации для сборки (только на сохранении)
function insertPucker (docId) {
	var pucker = objServicePucker[docId];
	// Добавляем в базу если мы еще не добавляли
	if (pucker && !pucker.inDataBase) {
		sqlBase.insertInTable(sqlBase.tableId.pucker, docId, pucker.url, pucker.documentFormatSave);
		pucker.inDataBase = true;
	}
	return pucker;
}

exports.version = asc_coAuthV;

exports.install = function (server, callbackFunction) {
    'use strict';
    var sockjs_opts = {sockjs_url: './../../Common/sources/sockjs-0.3.min.js'},
        sockjs_echo = sockjs.createServer(sockjs_opts),
		indexUser = {},
        locks = {},
		lockDocuments = {},
		arrSaveLock = {},
		saveTimers = {},// Таймеры сохранения, после выхода всех пользователей
        urlParse = new RegExp("^/doc/([0-9-.a-zA-Z_=]*)/c.+", 'i');

    sockjs_echo.on('connection', function (conn) {
		if (null == conn) {
			logger.error("null == conn");
			return;
        }
        conn.on('data', function (message) {
            try {
                var data = JSON.parse(message);
				//logger.info('data.type = ' + data.type + ' id = ' + conn.docId);
				switch (data.type) {
					case 'auth'					: auth(conn, data); break;
					case 'message'				: onMessage(conn, data); break;
					case 'getLock'				: getLock(conn, data, false); break;
					case 'saveChanges'			: saveChanges(conn, data); break;
					case 'isSaveLock'			: isSaveLock(conn, data); break;
					case 'getMessages'			: getMessages(conn, data); break;
					case 'unLockDocument'		: checkEndAuthLock(data.isSave, conn.docId, conn.user.id, null, conn); break;
				}
            } catch (e) {
                logger.error("error receiving response: %s docId = %s", e, conn ? conn.docId : 'null');
            }

        });
        conn.on('error', function () {
            logger.error("On error");
        });
        conn.on('close', function () {
            var connection = this, userLocks, participants, reconnected, oPucker;
			var docId = conn.docId;
			if (null == docId)
				return;

            logger.info("Connection closed or timed out");
            //Check if it's not already reconnected

            //Notify that participant has gone
            connections = _.reject(connections, function (el) {
                return el.connection.id === connection.id;//Delete this connection
            });
			reconnected = _.any(connections, function (el) {
                return el.connection.sessionId === connection.sessionId;//This means that client is reconnected
            });

			var state = (false == reconnected) ? false : undefined;
			participants = getParticipants(docId);
            sendParticipantsState(participants, state, connection);

            if (!reconnected) {
				// Для данного пользователя снимаем лок с сохранения
				if (undefined != arrSaveLock[docId] && connection.user.id == arrSaveLock[docId].user) {
					// Очищаем предыдущий таймер
					if (null != arrSaveLock[docId].saveLockTimeOutId)
						clearTimeout(arrSaveLock[docId].saveLockTimeOutId);
					arrSaveLock[docId] = undefined;
				}

				// Только если редактируем
				if (false === connection.isViewer) {
					// Если у нас нет пользователей, то удаляем все сообщения
					if (!hasEditors(docId)) {
						// Очищаем предыдущий таймер
						if (null != arrSaveLock[docId] && null != arrSaveLock[docId].saveLockTimeOutId)
							clearTimeout(arrSaveLock[docId].saveLockTimeOutId);
						// На всякий случай снимаем lock
						arrSaveLock[docId] = undefined;

						// Send changes to save server
						oPucker = objServicePucker[docId];
						if (oPucker && oPucker.inDataBase && 0 !== oPucker.index) {
							saveTimers[docId] = setTimeout(function () {
								sendChangesToServer(docId);
							}, c_oAscSaveTimeOutDelay);
						} else {
							// Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
							deletePucker(docId);
							sendStatusDocument(docId, c_oAscChangeBase.All);
						}
					} else
						sendStatusDocument(docId, c_oAscChangeBase.No);

					//Давайдосвиданья!
					//Release locks
					userLocks = getUserLocks(docId, connection.sessionId);
					if (0 < userLocks.length) {
						_.each(participants, function (participant) {
							if (!participant.connection.isViewer) {
								sendData(participant.connection, {type: "releaseLock", locks: _.map(userLocks, function (e) {
									return {
										block: e.block,
										user: e.user,
										time: Date.now(),
										changes: null
									};
								})});
							}
						});
					}

					// Для данного пользователя снимаем Lock с документа
					checkEndAuthLock(false, docId, connection.user.id, participants);
				}
            }
        });
    });
	// Получение только кэшированных изменений для документа (чтобы их модифицировать)
	function getDocumentChangesCache (docId) {
		var oPucker = objServicePucker[docId];
		if (oPucker && oPucker.inDataBase) {
			var i, length;
			// Посмотрим в закэшированных данных
			for (i = 0, length = arrCacheDocumentsChanges.length; i < length; ++i) {
				if (docId === arrCacheDocumentsChanges[i].docId)
					return arrCacheDocumentsChanges[i];
			}
		}
		return null;
	}
	// Получение изменений для документа (либо из кэша, либо обращаемся к базе, но только если были сохранения)
	function getDocumentChanges (docId, callback) {
		var oPucker = objServicePucker[docId];
		if (oPucker && oPucker.inDataBase) {
			var i, length;
			// Посмотрим в закэшированных данных
			for (i = 0, length = arrCacheDocumentsChanges.length; i < length; ++i) {
				if (docId === arrCacheDocumentsChanges[i].docId) {
					callback(arrCacheDocumentsChanges[i].arrChanges, oPucker.index);
					return;
				}
			}

			var callbackGetChanges = function (error, arrayElements) {
				// Если за тот момент, пока мы ждали из базы ответа, все ушли, то отправлять ничего не нужно
				if (!oPucker || error)
					return;

				var j, element;
				var objChangesDocument = new DocumentChanges(docId);
				for (j = 0; j < arrayElements.length; ++j) {
					element = arrayElements[j];

					objChangesDocument.push({docid: docId, change: element['dc_data'], time: Date.now(),
						user: element['dc_user_id'], useridoriginal: element['dc_user_id_original']});
				}

				oPucker.index = objChangesDocument.getLength();

				// Стоит удалять из начала, если не убрались по размеру
				arrCacheDocumentsChanges.push(objChangesDocument);
				callback(objChangesDocument.arrChanges, oPucker.index);
			};
			// Берем из базы данных
			sqlBase.getChanges(docId, callbackGetChanges);
			return;
		}
		callback(undefined, 0);
	}

	function getUserLocks (docId, sessionId) {
		var userLocks = [], i;
		var docLock = locks[docId];
		if (docLock) {
			if ("array" === typeOf (docLock)) {
				for (i = 0; i < docLock.length; ++i) {
					if (docLock[i].sessionId === sessionId) {
						userLocks.push(docLock[i]);
						docLock.splice(i, 1);
						--i;
					}
				}
			} else {
				for (i in docLock) {
					if (docLock[i].sessionId === sessionId) {
						userLocks.push(docLock[i]);
						delete docLock[i];
					}
				}
			}
		}
		return userLocks;
	}

	function checkEndAuthLock (isSave, docId, userId, participants, currentConnection) {
		var result = false;
		if (lockDocuments.hasOwnProperty(docId) && userId === lockDocuments[docId].id) {
			delete lockDocuments[docId];

			if (!participants)
				participants = getParticipants(docId);

			var participantsMap = _.map(participants, function (conn) {
				var tmpUser = conn.connection.user;
				return {
					id			: tmpUser.id,
					username	: tmpUser.name,
					indexUser	: tmpUser.indexUser,
					view		: conn.connection.isViewer
				};
			});

			getDocumentChanges(docId, function (objChangesDocument, changesIndex) {
				var connection;
				for (var i = 0, l = participants.length; i < l; ++i) {
					connection = participants[i].connection;
					if (userId !== connection.user.id && !connection.isViewer)
						sendAuthInfo(objChangesDocument, changesIndex, connection, participantsMap);
				}
			});

			result = true;
		} else if (isSave) {
			//Release locks
			var userLocks = getUserLocks(docId, currentConnection.sessionId);
			//Release locks
			if (0 < userLocks.length) {
				if (!participants)
					participants = getParticipants(docId);

				for (var i = 0, l = participants.length; i < l; ++i) {
					var connection = participants[i].connection;
					if (userId !== connection.user.id && !connection.isViewer) {
						sendData(connection, {type: "releaseLock", locks: _.map(userLocks, function (e) {
							return {
								block: e.block,
								user: e.user,
								time: Date.now(),
								changes: null
							};
						})});
					}
				}
			}

			// Автоматически снимаем lock сами
			unSaveLock(currentConnection, -1);
		}
		return result;
	}

    function sendParticipantsState(participants, stateConnect, oConnection) {
		var tmpUser = oConnection.user;
        _.each(participants, function (participant) {
			if (participant.connection.user.id !== tmpUser.id) {
				sendData(participant.connection, {
					type		: "connectState",
					state		: stateConnect,
					id			: tmpUser.id,
					username	: tmpUser.name,
					indexUser	: tmpUser.indexUser,
					view		: oConnection.isViewer
				});
			}
        });
    }

	function sendFileError(conn, errorId) {
		sendData(conn, {type : 'error', description: errorId});
	}

	function getParticipants(docId, excludeUserId, excludeViewer) {
		return _.filter(connections, function (el) {
			return el.connection.docId === docId && el.connection.user.id !== excludeUserId &&
				el.connection.isViewer !== excludeViewer;
		});
	}
	function hasEditors(docId) {
		var result = false, elConnection;
		for (var i = 0, length = connections.length; i < length; ++i) {
			elConnection = connections[i].connection;
			if (elConnection.docId === docId && false === elConnection.isViewer) {
				result = true;
				break;
			}
		}
		return result;
	}
	
	function sendChangesToServer(docId) {
		var sendData = JSON.stringify({
			'id': docId,
			'c': 'sfc',
			'url': '/CommandService.ashx?c=saved&key=' + docId + '&status=',
			'outputformat': objServicePucker[docId].documentFormatSave,
			'data': c_oAscSaveTimeOutDelay
		});
		sendServerRequest(objServicePucker[docId].server, sendData);
	}

	// Пересчет только для чужих Lock при сохранении на клиенте, который добавлял/удалял строки или столбцы
	function _recalcLockArray (userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
		if (null == _locks)
			return;
		var count = _locks.length;
		var element = null, oRangeOrObjectId = null;
		var i;
		var sheetId = -1;

		for (i = 0; i < count; ++i) {
			// Для самого себя не пересчитываем
			if (userId === _locks[i].user)
				continue;
			element = _locks[i].block;
			if (c_oAscLockTypeElem.Range !== element["type"] ||
				c_oAscLockTypeElemSubType.InsertColumns === element["subType"] ||
				c_oAscLockTypeElemSubType.InsertRows === element["subType"])
				continue;
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
	function _addRecalcIndex (oRecalcIndex) {
		if (null == oRecalcIndex)
			return null;
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
					if (true === oRecalcIndexElement.m_bIsSaveIndex)
						continue;
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
		if (null !== newBlock.subType && null !== oldBlock.subType)
			return true;
		
		// Не учитываем lock от ChangeProperties (только если это не lock листа)
		if ((c_oAscLockTypeElemSubType.ChangeProperties === oldBlock.subType &&
				c_oAscLockTypeElem.Sheet !== newBlock.type) ||
			(c_oAscLockTypeElemSubType.ChangeProperties === newBlock.subType &&
				c_oAscLockTypeElem.Sheet !== oldBlock.type))
			return false;
			
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
		if (range2.c1 > range1.c2 || range2.c2 < range1.c1 || range2.r1 > range1.r2 || range2.r2 < range1.r1)
			return false;
		return true;
	}
	
	// Тип объекта
	function typeOf(obj) {
		if (obj === undefined) {return "undefined";}
		if (obj === null) {return "null";}
		return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();
	}
	// Сравнение для презентаций
	function comparePresentationBlock(newBlock, oldBlock) {
		var resultLock = false;

		switch (newBlock.type) {
			case c_oAscLockTypeElemPresentation.Presentation:
				if (c_oAscLockTypeElemPresentation.Presentation === oldBlock.type)
					resultLock = newBlock.val === oldBlock.val;
				break;
			case c_oAscLockTypeElemPresentation.Slide:
				if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type)
					resultLock = newBlock.val === oldBlock.val;
				else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type)
					resultLock = newBlock.val === oldBlock.slideId;
				break;
			case c_oAscLockTypeElemPresentation.Object:
				if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type)
					resultLock = newBlock.slideId === oldBlock.val;
				else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type)
					resultLock = newBlock.objId === oldBlock.objId;
				break;
		}
		return resultLock;
	}

	function auth(conn, data) {
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
			if (false === data.isViewer && saveTimers[docId])
				clearTimeout(saveTimers[docId]);

			var bIsRestore = null != data.sessionId;

			// Увеличиваем индекс обращения к документу (если восстанавливаем, индекс тоже восстанавливаем)
			var curIndexUser = bIsRestore ? user.indexUser : (!indexUser.hasOwnProperty(docId) ? (indexUser[docId] = 0) : indexUser[docId] += 1);
			var curUserId = user.id + curIndexUser;

			conn.sessionState = 1;
			conn.user = {
				id			: curUserId,
				idOriginal	: user.id,
				name		: user.name,
				indexUser	: curIndexUser
			};
			conn.isViewer = data.isViewer;

			// Сохраняем информацию для сборки
			updatePucker(docId, data.server, data.documentFormatSave, false);

			//Set the unique ID
			if (bIsRestore) {
				logger.info("restored old session id = %s", data.sessionId);

				// Останавливаем сборку (вдруг она началась)
				// Когда переподсоединение, нам нужна проверка на сборку файла
				sqlBase.checkStatusFile(docId, function (error, result) {
					if (null !== error || 0 === result.length) {
						// error database
						sendFileError(conn, 'DataBase error');
						return;
					}

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

					getDocumentChanges(docId, function (objChangesDocument, changesIndex) {
						var bIsSuccessRestore = true;
						if (objChangesDocument && 0 < objChangesDocument.length) {
							var change = objChangesDocument[objChangesDocument.length - 1];
							if (change['change'])
								if (change['user'] !== curUserId)
									bIsSuccessRestore = data['lastOtherSaveTime'] === change['time'];
						}

						if (bIsSuccessRestore) {
							conn.sessionId = data.sessionId;//restore old

							// Проверяем lock-и
							var arrayBlocks = data['block'];
							if (arrayBlocks && (0 === arrayBlocks.length || getLock(conn, data, true))) {
								//Kill previous connections
								connections = _.reject(connections, function (el) {
									return el.connection.sessionId === data.sessionId;//Delete this connection
								});

								endAuth(conn, true);
							} else
								sendFileError(conn, 'Restore error. Locks not checked.');
						} else
							sendFileError(conn, 'Restore error. Document modified.');
					});
				});

			} else {
				conn.sessionId = conn.id;
				endAuth(conn, false, data.documentCallbackUrl);
			}
		}
	}
	function endAuth(conn, bIsRestore, documentCallbackUrl) {
		var docId = conn.docId;
		connections.push({connection:conn});
		var participants = getParticipants(docId);
		var tmpConnection, tmpUser, firstParticipantNoView, participantsMap = [], countNoView = 0;
		for (var i = 0; i < participants.length; ++i) {
			tmpConnection = participants[i].connection;
			tmpUser = tmpConnection.user;
			participantsMap.push({
				id			: tmpUser.id,
				username	: tmpUser.name,
				indexUser	: tmpUser.indexUser,
				view		: tmpConnection.isViewer
			});
			if (!tmpConnection.isViewer) {
				++countNoView;
				if (!firstParticipantNoView)
					firstParticipantNoView = participantsMap[participantsMap.length - 1];
			}
		}

		// Отправляем на внешний callback только для тех, кто редактирует
		if (!conn.isViewer) {
			// Если пришла информация о ссылке для посылания информации, то добавляем
			if (documentCallbackUrl)
				bindEvents(docId, documentCallbackUrl);
			else
				sendStatusDocument(docId, c_oAscChangeBase.No);
		}

		if (!bIsRestore && 2 === countNoView && !conn.isViewer) {
			// Ставим lock на документ
			lockDocuments[docId] = firstParticipantNoView;
		}

		if (lockDocuments[docId] && !conn.isViewer) {
			// Для view не ждем снятия lock-а
			var sendObject = {
				type			: "waitAuth",
				lockDocument	: lockDocuments[docId]
			};
			sendData(conn, sendObject);//Or 0 if fails
		} else {
			if (bIsRestore)
				sendAuthInfo(undefined, undefined, conn, participantsMap);
			else
				getDocumentChanges(docId, function (objChangesDocument, changesIndex) {
					sendAuthInfo(objChangesDocument, changesIndex, conn, participantsMap);
				});
		}

		sendParticipantsState(participants, true, conn);
	}
	function sendAuthInfo (objChangesDocument, changesIndex, conn, participantsMap) {
		var docId = conn.docId;
		var sendObject = {
			type			: "auth",
			result			: 1,
			sessionId		: conn.sessionId,
			participants	: participantsMap,
			messages		: messages[docId],
			locks			: locks[docId],
			changes			: objChangesDocument,
			changesIndex	: changesIndex,
			indexUser		: indexUser[docId]
		};
		sendData(conn, sendObject);//Or 0 if fails
	}
	function onMessage(conn, data) {
		var participants = getParticipants(conn.docId),
			msg = {docid:conn.docId, message:data.message, time:Date.now(), user:conn.user.id, username:conn.user.name};

		if (!messages.hasOwnProperty(conn.docId)) {
			messages[conn.docId] = [msg];
		} else {
			messages[conn.docId].push(msg);
		}

		// insert
		logger.info("insert message: %s", JSON.stringify(msg));

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"message", messages:[msg]});
		});
	}
	function getLock(conn, data, bIsRestore) {
		var fLock = null;
		switch(data['editorType']) {
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
		return fLock ? fLock(conn, data, bIsRestore) : false;
	}
	function getLockWord(conn, data, bIsRestore) {
		var docId = conn.docId, participants = getParticipants(docId, undefined, true), arrayBlocks = data.block;
		if (!locks.hasOwnProperty(docId))
			locks[docId] = {};

		var i, documentLocks = locks[docId];
		if (_checkLock(documentLocks, arrayBlocks)) {
			//Ok. take lock
			for (i = 0; i < arrayBlocks.length; ++i) {
				documentLocks[arrayBlocks[i]] = {time:Date.now(), user:conn.user.id,
					block:arrayBlocks[i], sessionId:conn.sessionId};
			}
		} else if (bIsRestore)
			return false;

		sendGetLock(participants, documentLocks);
		return true;
	}
	// Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
	function getLockExcel(conn, data, bIsRestore) {
		var docId = conn.docId, userId = conn.user.id, participants = getParticipants(docId, undefined, true), arrayBlocks = data.block;
		if (!locks.hasOwnProperty(docId))
			locks[docId] = [];

		var i, documentLocks = locks[docId];
		if (_checkLockExcel(documentLocks, arrayBlocks, userId)) {
			//Ok. take lock
			for (i = 0; i < arrayBlocks.length; ++i) {
				documentLocks.push({time:Date.now(), user:userId, block:arrayBlocks[i], sessionId:conn.sessionId});
			}
		} else if (bIsRestore)
			return false;

		sendGetLock(participants, documentLocks);
		return true;
	}
	// Для презентаций это объект { type, val } или { type, slideId, objId }
	function getLockPresentation(conn, data, bIsRestore) {
		var docId = conn.docId, userId = conn.user.id, participants = getParticipants(docId, undefined, true), arrayBlocks = data.block;
		if (!locks.hasOwnProperty(docId))
			locks[docId] = [];

		var i, documentLocks = locks[docId];
		if (_checkLockPresentation(documentLocks, arrayBlocks, userId)) {
			//Ok. take lock
			for (i = 0; i < arrayBlocks.length; ++i) {
				documentLocks.push({time:Date.now(), user:userId, block:arrayBlocks[i], sessionId:conn.sessionId});
			}
		} else if (bIsRestore)
			return false;

		sendGetLock(participants, documentLocks);
		return true;
	}
	function sendGetLock(participants, documentLocks) {
		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getLock", locks:documentLocks});
		});
	}
	// Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
	function saveChanges(conn, data) {
		var docId = conn.docId, userId = conn.user.id;
		var participants = getParticipants(docId, userId, true);

		// Пишем в базу информацию о сборщике и получаем текущий индекс
		var pucker = insertPucker(docId);
		// Закэшированный объект с изменениями
		var objChangesDocument = getDocumentChangesCache(docId);

		var deleteIndex = -1;
		if (data.startSaveChanges && null != data.deleteIndex) {
			deleteIndex = data.deleteIndex;
			if (-1 !== deleteIndex) {
				var deleteCount = pucker.index - deleteIndex;
				if (objChangesDocument)
					objChangesDocument.splice(deleteIndex, deleteCount);
				pucker.index -= deleteCount;
				sqlBase.deleteChanges(docId, deleteIndex);
			}
		}

		// Стартовый индекс изменения при добавлении
		var startIndex = pucker.index;

		var newChanges = JSON.parse(data.changes);
		var arrNewDocumentChanges = [];
		if (0 < newChanges.length) {
			var oElement = null;

			for (var i = 0; i < newChanges.length; ++i) {
				oElement = newChanges[i];
				arrNewDocumentChanges.push({docid: docId, change: JSON.stringify(oElement), time: Date.now(),
					user: userId, useridoriginal: conn.user.idOriginal});
			}

			if (objChangesDocument)
				objChangesDocument.concat(arrNewDocumentChanges);
			pucker.index += arrNewDocumentChanges.length;
			sqlBase.insertChanges(arrNewDocumentChanges, docId, startIndex, conn.user);
		}

		var changesIndex = (-1 === deleteIndex && data.startSaveChanges) ? startIndex : -1;
		if (data.endSaveChanges) {
			// Для Excel нужно пересчитать индексы для lock-ов
			if (data.isExcel && false !== data.isCoAuthoring && data.excelAdditionalInfo) {
				var tmpAdditionalInfo = JSON.parse(data.excelAdditionalInfo);
				// Это мы получили recalcIndexColumns и recalcIndexRows
				var oRecalcIndexColumns = _addRecalcIndex(tmpAdditionalInfo["indexCols"]);
				var oRecalcIndexRows = _addRecalcIndex(tmpAdditionalInfo["indexRows"]);
				// Теперь нужно пересчитать индексы для lock-элементов
				if (null !== oRecalcIndexColumns || null !== oRecalcIndexRows)
					_recalcLockArray(userId, locks[docId], oRecalcIndexColumns, oRecalcIndexRows);
			}

			//Release locks
			var userLocks = getUserLocks(docId, conn.sessionId);
			// Для данного пользователя снимаем Lock с документа
			if (!checkEndAuthLock(false, docId, userId)) {
				var arrLocks = _.map(userLocks, function (e) {
					return {
						block:e.block,
						user:e.user,
						time:Date.now(),
						changes:null
					};
				});
				_.each(participants, function (participant) {
					sendData(participant.connection, {type: 'saveChanges', changes: arrNewDocumentChanges,
						changesIndex: pucker.index, locks: arrLocks, excelAdditionalInfo: data.excelAdditionalInfo});
				});
			}
			// Автоматически снимаем lock сами и посылаем индекс для сохранения
			unSaveLock(conn, changesIndex);
		} else {
			_.each(participants, function (participant) {
				sendData(participant.connection, {type: 'saveChanges', changes: arrNewDocumentChanges,
					changesIndex: pucker.index, locks: []});
			});
			sendData(conn, {type: 'savePartChanges', changesIndex: changesIndex});
		}
	}
	// Можем ли мы сохранять ?
	function isSaveLock(conn) {
		var _docId = conn.docId;
		var _userId = conn.user.id;
		var _time = Date.now();
		var isSaveLock = (undefined === arrSaveLock[_docId]) ? false : arrSaveLock[_docId].savelock;
		if (false === isSaveLock) {
			arrSaveLock[conn.docId] = {docid:_docId, savelock:true, time:Date.now(), user:conn.user.id};
			var _tmpSaveLock = arrSaveLock[_docId];
			// Вдруг не придет unlock,  пустим timeout на lock 60 секунд
			arrSaveLock[conn.docId].saveLockTimeOutId = setTimeout(function () {
				if (_tmpSaveLock && _userId == _tmpSaveLock.user && _time == _tmpSaveLock.time) {
					// Снимаем лок с сохранения
					arrSaveLock[_docId] = undefined;
				}
			}, 60000);
		}

		// Отправляем только тому, кто спрашивал (всем отправлять нельзя)
		sendData(conn, {type:"saveLock", saveLock:isSaveLock});
	}
	// Снимаем лок с сохранения
	function unSaveLock(conn, index) {
		if (undefined != arrSaveLock[conn.docId] && conn.user.id != arrSaveLock[conn.docId].user) {
			// Не можем удалять не свой лок
			return;
		}
		// Очищаем предыдущий таймер
		if (arrSaveLock[conn.docId] && null != arrSaveLock[conn.docId].saveLockTimeOutId)
			clearTimeout(arrSaveLock[conn.docId].saveLockTimeOutId);

		arrSaveLock[conn.docId] = undefined;

		// Отправляем только тому, кто спрашивал (всем отправлять нельзя)
		sendData(conn, {type:'unSaveLock', index: index});
	}
	// Возвращаем все сообщения для документа
	function getMessages(conn) {
		sendData(conn, {type:"message", messages:messages[conn.docId]});
	}

	function _checkLock(documentLocks, arrayBlocks) {
		// Data is array now
		var isLock = false;
		var i, lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (i = 0; i < lengthArray; ++i) {
			logger.info("getLock id: %s", arrayBlocks[i]);
			if (documentLocks.hasOwnProperty(arrayBlocks[i]) && documentLocks[arrayBlocks[i]] !== null) {
				isLock = true;
				break;
			}
		}
		if (0 === lengthArray)
			isLock = true;
		return !isLock;
	}

	function _checkLockExcel(documentLocks, arrayBlocks, userId) {
		// Data is array now
		var documentLock;
		var isLock = false;
		var isExistInArray = false;
		var i, blockRange;
		var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (i = 0; i < lengthArray && false === isLock; ++i) {
			blockRange = arrayBlocks[i];
			for (var keyLockInArray in documentLocks) {
				if (true === isLock)
					break;
				if (!documentLocks.hasOwnProperty(keyLockInArray))
					continue;
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
					blockRange.sheetId !== documentLock.block.sheetId)
					continue;
				isLock = compareExcelBlock(blockRange, documentLock.block);
			}
		}
		if (0 === lengthArray)
			isLock = true;
		return !isLock && !isExistInArray;
	}

	function _checkLockPresentation(documentLocks, arrayBlocks, userId) {
		// Data is array now
		var isLock = false;
		var i, documentLock, blockRange;
		var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (i = 0; i < lengthArray && false === isLock; ++i) {
			blockRange = arrayBlocks[i];
			for (var keyLockInArray in documentLocks) {
				if (true === isLock)
					break;
				if (!documentLocks.hasOwnProperty(keyLockInArray))
					continue;
				documentLock = documentLocks[keyLockInArray];

				if (documentLock.user === userId || !(documentLock.block))
					continue;
				isLock = comparePresentationBlock(blockRange, documentLock.block);
			}
		}
		if (0 === lengthArray)
			isLock = true;
		return !isLock;
	}

    sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
    }});

	var callbackLoadPuckerMySql = function (error, arrayElements) {
		if (null != arrayElements) {
			var i, element;
			for (i = 0; i < arrayElements.length; ++i) {
				element = arrayElements[i];
		 		updatePucker(element['dp_key'], element['dp_callback'], element['dp_documentFormatSave'], true);
			}
		}

		sqlBase.loadTable(sqlBase.tableId.callbacks, callbackLoadCallbacksMySql);
	};

	var callbackLoadCallbacksMySql = function (error, arrayElements) {
		var createTimer = function (id) {
			return setTimeout(function () { sendChangesToServer(id); }, c_oAscSaveTimeOutDelay);
		};
		if (null != arrayElements) {
			var i, element, callbackUrl;
			for (i = 0; i < arrayElements.length; ++i) {
				element = arrayElements[i];
				callbackUrl = parseUrl(element['dc_callback']);
				if (null === callbackUrl)
					logger.error('error parse callback = %s', element['dc_callback']);
				objServiceInfo[element['dc_key']] = callbackUrl;
			}

			var docId;
			// Проходимся по всем подписчикам
			for (docId in objServiceInfo) {
				// Если есть информация для сборки, то запускаем. Иначе - удаляем подписчика? : ToDo
				if (objServicePucker[docId])
					saveTimers[docId] = createTimer(docId);
				else
					deleteCallback(docId);
			}
		}

		callbackFunction();
	};

	sqlBase.loadTable(sqlBase.tableId.pucker, callbackLoadPuckerMySql);
};
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (query) {
	// Ключ id-документа
	var docId = query.key;
	if (null == docId)
		return c_oAscServerCommandErrors.DocumentIdError;

	logger.info('commandFromServer: docId = %s c = %s', docId, query.c);
	var result = c_oAscServerCommandErrors.NoError;
	switch(query.c) {
		case 'info':
			bindEvents(docId, query.callback);
			break;
		case 'drop':
			if (query.userid)
				dropUserFromDocument(docId, query.userid, query.description);
			else if (query.users)
				onReplySendStatusDocument(docId, query.users);
			break;
		case 'saved':
			// Результат от менеджера документов о статусе обработки сохранения файла после сборки
			removeChanges(docId, '1' !== query.status);
			break;
		default:
			result = c_oAscServerCommandErrors.CommandError;
			break;
	}

	return result;
};