var sockjs = require('sockjs'),
    _ = require('underscore'),
	dataBase  = null,
	http = require('http'),
	config = require('./config.json');
if (config["mongodb"])
	dataBase = require('./database');
	
var logger = require('./logger');

var c_oAscRecalcIndexTypes = {
	RecalcIndexAdd:		1,
	RecalcIndexRemove:	2
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

exports.install = function (server, callbackFunction) {
    'use strict';
    var sockjs_opts = {sockjs_url:"http://cdn.sockjs.org/sockjs-0.3.min.js"},
        sockjs_echo = sockjs.createServer(sockjs_opts),
        connections = [],
        messages = {},
		objchanges = {},
		indexuser = {},
        locks = {},
		arrsavelock = [],
        dataHandler,
        urlParse = new RegExp("^/doc/([0-9-.a-zA-Z_=]*)/c.+", 'i'),
		serverPort = 80;

    sockjs_echo.on('connection', function (conn) {
		if (null == conn) {
			logger.error ("null == conn");
			return;
        }
        conn.on('data', function (message) {
            try {
                var data = JSON.parse(message);
                dataHandler[data.type](conn, data);
            } catch (e) {
                logger.error("error receiving response:" + e);
            }

        });
        conn.on('error', function () {
            logger.error("On error");
        });
        conn.on('close', function () {
            var connection = this, docLock, userLocks, i, participants, reconected;

            logger.info("Connection closed or timed out");
            //Check if it's not already reconnected

            //Notify that participant has gone
            connections = _.reject(connections, function (el) {
                return el.connection.id === connection.id;//Delete this connection
            });
            reconected = _.any(connections, function (el) {
                return el.connection.sessionId === connection.sessionId;//This means that client is reconected
            });

			var state = (false == reconected) ? false : undefined;
			participants = getParticipants(conn.docId);
            sendParticipantsState(participants, state, connection.userId, connection.userName);

            if (!reconected) {
				// Для данного пользователя снимаем лок с сохранения
				if (undefined != arrsavelock[conn.docId] && connection.userId == arrsavelock[conn.docId].user) {
					arrsavelock[conn.docId] = undefined;
				}
				
				participants = getParticipants(conn.docId);
				// Если у нас нет пользователей, то удаляем все сообщения
				if (0 >= participants.length) {
					// remove messages from dataBase
					if (dataBase)
						dataBase.remove ("messages", {docid:conn.docId});
					// remove messages from memory
					delete messages[conn.docId];
					
					// ToDo Send changes to save server
					if (objchanges[conn.docId] && 0 < objchanges[conn.docId].length)
						sendChangesToServer(conn.serverHost, conn.serverPath, conn.docId);
					
					// remove changes from dataBase
					if (dataBase)
						dataBase.remove ("changes", {docid:conn.docId});
					// remove changes from memory
					delete objchanges[conn.docId];
					
					// На всякий случай снимаем lock
					arrsavelock[conn.docId] = undefined;
				}
				
                //Давайдосвиданья!
                //Release locks
                docLock = locks[connection.docId];
                if (docLock) {
					userLocks = [];
					
					if ("array" === typeOf (docLock)) {
						for (var nIndex = 0; nIndex < docLock.length; ++nIndex) {
							if (docLock[nIndex].sessionId === connection.sessionId) {
								userLocks.push(docLock[nIndex]);
								docLock.splice(nIndex, 1);
								--nIndex;
							}
						}
					} else {
						for (var keyLockElem in docLock) {
							if (docLock[keyLockElem].sessionId === connection.sessionId) {
								userLocks.push(docLock[keyLockElem]);
								delete docLock[keyLockElem];
							}
						}
					}
					
                    _.each(participants, function (participant) {
                        sendData(participant.connection, {type:"releaselock", locks:_.map(userLocks, function (e) {
                            return {
                                block:e.block,
                                user:e.user,
                                time:Date.now(),
                                changes:null
                            };
                        })});
                    });
                }
            }
        });
    });

    function sendData(conn, data) {
        conn.write(JSON.stringify(data));
    }

    function sendParticipantsState(participants, stateConnect, _userId, _userName) {
        _.each(participants, function (participant) {
            sendData(participant.connection, {type:"participants",
                participants:_.chain(connections).filter(
                    function (el) {
                        return el.connection.docId === participant.connection.docId && el.connection.userId !== participant.connection.userId;
                    }).map(
                    function (conn) {
                        return {id: conn.connection.userId, username: conn.connection.userName,
							isviewermode: conn.connection.isViewerMode};
                    }).value()
            });
			
			sendData(participant.connection, {type:"connectstate",
				state: stateConnect,
				id: _userId,
				username: _userName
			});
        });
    }
	
	function sendParticipantsIsViewerMode(participants, isViewerMode, _userId, _userName) {
        _.each(participants, function (participant) {
            sendData(participant.connection, {type:"participants",
                participants:_.chain(connections).filter(
                    function (el) {
                        return el.connection.docId === participant.connection.docId && el.connection.userId !== participant.connection.userId;
                    }).map(
                    function (conn) {
                        return {id: conn.connection.userId, username: conn.connection.userName,
							isviewermode: conn.connection.isViewerMode};
                    }).value()
            });
			
			sendData(participant.connection, {type:"isviewermode",
				isviewermode: isViewerMode,
				id: _userId,
				username: _userName
			});
        });
    }

    function getParticipants(docId, exludeuserId) {
        return _.filter(connections, function (el) {
            return el.connection.docId === docId && el.connection.userId !== exludeuserId;
        });
    }
	
	function sendChangesToServer(serverHost, serverPath, docId) {
		if (!serverHost || !serverPath)
			return;
		// Пошлем пока только информацию о том, что нужно сбросить кеш
		var options = {
		  host: serverHost,
		  port: serverPort,
		  path: serverPath,
		  method: 'POST'
		};
		
		var req = http.request(options, function(res) {
			res.setEncoding('utf8');
		});

		req.on('error', function(e) {
			logger.warn('problem with request on server: ' + e.message);
		});
		
		var sendData = JSON.stringify({"id": docId, "c": "cc", "t": "", "v": ""});

		// write data to request body
		req.write(sendData);
		req.end();
	}

	// Пересчет только для чужих Lock при сохранении на клиенте, который добавлял/удалял строки или столбцы
	function _recalcLockArray (userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
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

			if (oRecalcIndexColumns.hasOwnProperty(sheetId)) {
				// Пересчет колонок
				oRangeOrObjectId["c1"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c1"]);
				oRangeOrObjectId["c2"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c2"]);
			}
			if (oRecalcIndexRows.hasOwnProperty(sheetId)) {
				// Пересчет строк
				oRangeOrObjectId["r1"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r1"]);
				oRangeOrObjectId["r2"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r2"]);
			}
		}
	}

	function _addRecalcIndex (oRecalcIndex) {
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
		if (c_oAscLockTypeElemSubType.ChangeProperties === oldBlock.subType
			&& c_oAscLockTypeElem.Sheet !== newBlock.type)
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


    dataHandler = (function () {
        function auth(conn, data) {
            //TODO: Do authorization etc. check md5 or query db
            if (data.token && data.user) {

                //Parse docId
                var parsed = urlParse.exec(conn.url);
                if (parsed.length > 1) {
                    conn.docId = parsed[1];
                } else {
                    //TODO: Send some shit back
                }

                conn.sessionState = 1;
                conn.userId = data.user;
				conn.userName = data.username;
				conn.isViewerMode = data.isviewermode;
				conn.serverHost = data.serverHost;
				conn.serverPath = data.serverPath;
                //Set the unique ID
                if (data.sessionId !== null && _.isString(data.sessionId) && data.sessionId !== "") {
                    logger.info("restored old session id=" + data.sessionId);

                    //Kill previous connections
                    connections = _.reject(connections, function (el) {
                        return el.connection.sessionId === data.sessionId;//Delete this connection
                    });
                    conn.sessionId = data.sessionId;//restore old

                } else {
                    conn.sessionId = conn.id;
                }
                connections.push({connection:conn});
                var participants = getParticipants(data.docid, data.user);
				
				// Увеличиваем индекс обращения к документу
				if (!indexuser.hasOwnProperty(conn.docId)) {
					indexuser[conn.docId] = 1;
				} else {
					indexuser[conn.docId] += 1;
				}
				
                sendData(conn,
                    {
                        type:"auth",
                        result:1,
                        sessionId:conn.sessionId,
                        participants:_.map(participants, function (conn) {
                            return {id: conn.connection.userId, username: conn.connection.userName,
								isviewermode: conn.connection.isViewerMode};
                        }),
                        messages:messages[data.docid],
                        locks:locks[conn.docId],
                        changes:objchanges[conn.docId],
						indexuser:indexuser[conn.docId]
                    });//Or 0 if fails
                sendParticipantsState(participants, true, data.user, data.username);
            }
        }

        function message(conn, data) {
            var participants = getParticipants(conn.docId),
                msg = {docid:conn.docId, message:data.message, time:Date.now(), user:conn.userId, username:conn.userName};

            if (!messages.hasOwnProperty(conn.docId)) {
                messages[conn.docId] = [msg];
            } else {
                messages[conn.docId].push(msg);
            }
			
			// insert in dataBase
			logger.info("database insert message: " + JSON.stringify(msg));
			if (dataBase)
				dataBase.insert ("messages", msg);

            _.each(participants, function (participant) {
                sendData(participant.connection, {type:"message", messages:[msg]});
            });
        }

        function getlock(conn, data) {
            var participants = getParticipants(conn.docId), documentLocks, currentLock;
            if (!locks.hasOwnProperty(conn.docId)) {
                locks[conn.docId] = {};
            }
            documentLocks = locks[conn.docId];
			
			// Data is array now
			var arrayBlocks = data.block;
			var isLock = false;
			var i = 0;
			var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
			for (; i < lengthArray; ++i) {
				logger.info("getLock id: " + arrayBlocks[i]);
				if (documentLocks.hasOwnProperty(arrayBlocks[i]) && documentLocks[arrayBlocks[i]] !== null) {
					isLock = true;
					break;
				}
			}
			if (0 === lengthArray)
				isLock = true;
			
			if (!isLock) {
				//Ok. take lock
				for (i = 0; i < lengthArray; ++i) {
					documentLocks[arrayBlocks[i]] = {time:Date.now(), user:conn.userId, block:arrayBlocks[i], sessionId:conn.sessionId};
				}
			}

            _.each(participants, function (participant) {
                sendData(participant.connection, {type:"getlock", locks:locks[conn.docId]});
            });
        }
		
		// Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
		function getlockrange(conn, data) {
			var participants = getParticipants(conn.docId), documentLocks, currentLock;
            if (!locks.hasOwnProperty(conn.docId)) {
                locks[conn.docId] = [];
            }
            documentLocks = locks[conn.docId];
			
			// Data is array now
			var arrayBlocks = data.block;
			var isLock = false;
			var isExistInArray = false;
			var i = 0, blockRange = null;
			var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
			for (; i < lengthArray && false === isLock; ++i) {
				blockRange = arrayBlocks[i];
				for (var keyLockInArray in documentLocks) {
					if (true === isLock)
						break;
					// Проверка вхождения объекта в массив (текущий пользователь еще раз прислал lock)
					if (documentLocks[keyLockInArray].user === conn.userId &&
						blockRange.sheetId === documentLocks[keyLockInArray].block.sheetId &&
						blockRange.type === c_oAscLockTypeElem.Object &&
						documentLocks[keyLockInArray].block.type === c_oAscLockTypeElem.Object &&
						documentLocks[keyLockInArray].block.rangeOrObjectId === blockRange.rangeOrObjectId) {
						isExistInArray = true;
						break;
					}
					
					if (c_oAscLockTypeElem.Sheet === blockRange.type &&
						c_oAscLockTypeElem.Sheet === documentLocks[keyLockInArray].block.type) {
						// Если текущий пользователь прислал lock текущего листа, то не заносим в массив, а если нового, то заносим
						if (documentLocks[keyLockInArray].user === conn.userId) {
							if (blockRange.sheetId === documentLocks[keyLockInArray].block.sheetId) {
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
					
					if (documentLocks[keyLockInArray].user === conn.userId || !(documentLocks[keyLockInArray].block) ||
						blockRange.sheetId !== documentLocks[keyLockInArray].block.sheetId)
						continue;
					isLock = compareExcelBlock(blockRange, documentLocks[keyLockInArray].block);
				}
			}
			if (0 === lengthArray)
				isLock = true;
			
			if (!isLock && !isExistInArray) {
				//Ok. take lock
				for (i = 0; i < lengthArray; ++i) {
					blockRange = arrayBlocks[i];
					documentLocks.push({time:Date.now(), user:conn.userId, block:blockRange, sessionId:conn.sessionId});
				}
			}

            _.each(participants, function (participant) {
                sendData(participant.connection, {type:"getlock", locks:locks[conn.docId]});
            });
		}

		// Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
		function savechanges(conn, data) {
			var docLock, userLocks, participants;
			//Release locks
			if (data.endSaveChanges) {
				docLock = locks[conn.docId];
				if (docLock) {
					if ("array" === typeOf (docLock)) {
						userLocks = [];
						for (var nIndex = 0; nIndex < docLock.length; ++nIndex) {
							if (null !== docLock[nIndex] && docLock[nIndex].sessionId === conn.sessionId) {
								userLocks.push(docLock[nIndex]);
								docLock.splice(nIndex, 1);
								--nIndex;
							}
						}
					} else {
						userLocks = _.filter(docLock, function (el) {
							return el !== null && el.sessionId === conn.sessionId;
						});
						for (var i = 0; i < userLocks.length; i++) {
							delete docLock[userLocks[i].block];
						}
					}
				}
			} else {
				userLocks = [];
			}
			
			var objchange = {docid:conn.docId, changes:data.changes, time:Date.now(), user:conn.userId};
			if (!objchanges.hasOwnProperty(conn.docId)) {
                objchanges[conn.docId] = [objchange];
            } else {
                objchanges[conn.docId].push(objchange);
            }
			// insert in dataBase
			logger.info("database insert changes: " + JSON.stringify(objchange));
			if (dataBase)
				dataBase.insert ("changes", objchange);
			
			if (!data.endSaveChanges) {
				sendData(conn, {type:"savePartChanges"});
			} else {
				if (data.isExcel) {
					var oElement = null;
					var oRecalcIndexColumns = null, oRecalcIndexRows = null;
					var oChanges = JSON.parse(data.changes);
					var nCount = oChanges.length;
					var nIndexChanges = 0;
					for (; nIndexChanges < nCount; ++nIndexChanges) {
						oElement = oChanges[nIndexChanges];
						if ("object" === typeof oElement) {
							if ("0" === oElement["type"]) {
								// Это мы получили recalcIndexColumns
								oRecalcIndexColumns = _addRecalcIndex(oElement["index"]);
							} else if ("1" === oElement["type"]) {
								// Это мы получили recalcIndexRows
								oRecalcIndexRows = _addRecalcIndex(oElement["index"]);
							}
						}

						// Теперь нужно пересчитать индексы для lock-элементов
						if (null !== oRecalcIndexColumns && null !== oRecalcIndexRows) {
							_recalcLockArray(conn.userId, locks[conn.docId], oRecalcIndexColumns, oRecalcIndexRows);

							oRecalcIndexColumns = null;
							oRecalcIndexRows = null;
							break;
						}
					}
				}
			}
			
			participants = getParticipants(conn.docId, conn.userId);
            _.each(participants, function (participant) {
                sendData(participant.connection, {type:"savechanges", changes:data.changes, locks:_.map(userLocks, function (e) {
                    return {
                        block:e.block,
                        user:e.user,
                        time:Date.now(),
                        changes:null
                    };
                })});
            });
		}
		
		// Можем ли мы сохранять ?
		function issavelock(conn, data) {
			var _docId = conn.docId;
			var _userId = conn.userId;
			var _time = Date.now();
			var isSaveLock = (undefined === arrsavelock[conn.docId]) ? false : arrsavelock[conn.docId].savelock;
			if (false === isSaveLock) {
				arrsavelock[conn.docId] = {docid:conn.docId, savelock:true, time:Date.now(), user:conn.userId};
				var _tmpsavelock = arrsavelock;
				// Вдруг не придет unlock,  пустим timeout на lock 60 секунд
				setTimeout(function () {
					if (_tmpsavelock[_docId] && _userId == _tmpsavelock[_docId].user && _time == _tmpsavelock[_docId].time) {
						_tmpsavelock[_docId] = undefined;
			
						var participants = getParticipants(_docId);
						_.each(participants, function (participant) {
							sendData(participant.connection, {type:"unsavelock"});
						});
					}
				}, 60000);
			}
			
			var participants = getParticipants(conn.docId);
			_.each(participants, function (participant) {
                sendData(participant.connection, {type:"savelock", savelock:isSaveLock});
            });
		}
		// Снимаем лок с сохранения
		function unsavelock(conn, data) {
			if (undefined != arrsavelock[conn.docId] && conn.userId != arrsavelock[conn.docId].user) {
				// Не можем удалять не свой лок
				return;
			}
			arrsavelock[conn.docId] = undefined;
			
			var participants = getParticipants(conn.docId);
			_.each(participants, function (participant) {
                sendData(participant.connection, {type:"unsavelock"});
            });
		}
		// Выставляем режим редактирования или просмотра
		function setisviewermode(conn, data) {
			if (data && conn.isViewerMode != data.isviewermode) {
				conn.isViewerMode = data.isviewermode;
				var participants = getParticipants(conn.docId);
				sendParticipantsIsViewerMode (participants, conn.isViewerMode, conn.userId, conn.userName);
			}
		}
		// Возвращаем все сообщения для документа
		function getmessages(conn, data) {
			sendData(conn, {type:"message", messages:messages[conn.docId]});
		}
		// Возвращаем всех пользователей для документа
		function getusers(conn, data) {
			var participants = getParticipants(conn.docId, conn.userId);

			sendData(conn,
				{
					type:"getusers",
					participants:_.map(participants, function (conn) {
						return {id: conn.connection.userId, username: conn.connection.userName,
							isviewermode: conn.connection.isViewerMode};
					})
				});
		}

        return {
            auth:auth,
            message:message,
            getlock:getlock,
			getlockrange:getlockrange,
			savechanges:savechanges,
			issavelock:issavelock,
			unsavelock:unsavelock,
			setisviewermode:setisviewermode,
			getmessages:getmessages,
			getusers:getusers
        };
    }());


    sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
    }});
	
	var callbackLoadMessages = (function (arrayElements){
		if (null != arrayElements)
		{
			messages = arrayElements;
			
			// remove all messages from dataBase
			if (dataBase)
				dataBase.remove ("messages", {});
		}
		if (dataBase)
			dataBase.load ("changes", callbackLoadChanges);
		else
			callbackLoadChanges(null);
	});
	
	var callbackLoadChanges = (function (arrayElements){
		if (null != arrayElements)
		{
			// ToDo Send changes to save server
			
			// remove all changes from dataBase
			if (dataBase)
				dataBase.remove ("changes", {});
		}
		callbackFunction ();
	});
	
	if (dataBase)
		dataBase.load ("messages", callbackLoadMessages);
	else
		callbackLoadMessages(null);
};