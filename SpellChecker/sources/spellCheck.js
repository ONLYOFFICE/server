var sockjs = require('sockjs'),
	nodehun = require('nodehun'),
	config = require('./config.json'),
	logger = require('./../../Common/sources/logger'),
	fs = require('fs');
var arrDictionaries = {};

(function() {
	// Read dictionaries
	var arrDictionariesConfig = config['dictionaries'];
	var oDictTmp = null, pathTmp = '', oDictName = null;
	for (var indexDict = 0, lengthDict = arrDictionariesConfig.length; indexDict < lengthDict; ++indexDict) {
		oDictTmp = arrDictionariesConfig[indexDict];
		oDictName = oDictTmp.name;
		pathTmp = __dirname + '/../Dictionaries/' + oDictName + '/' + oDictName + '.';
		arrDictionaries[oDictTmp.id] = new nodehun(fs.readFileSync(pathTmp + 'aff'), fs.readFileSync(pathTmp + 'dic'));
	}
})();

/*function CheckDictionary (dict, correct, unCorrect) {
	if (dict) {
		dict.isCorrect(correct, function (err, correct, origWord) {
			console.log(err, correct, origWord);
			if (err || !correct) logger.error('Error: spelling correct word %s failed!', correct);
		});

		dict.spellSuggestions(unCorrect, function (err, correct, suggestions, origWord) {
			console.log(err, correct, suggestions, origWord);
			if (err || correct) logger.error('Error: spelling unCorrect word %s failed!', unCorrect);
		});
	} else {
		logger.error('Error: no dictionary');
	}
}
CheckDictionary(arrDictionaries[0x0409], 'color', 'calor');*/
 
exports.install = function (server, callbackFunction) {
	'use strict';
	var sockjs_opts = {sockjs_url: './../../Common/sources/sockjs-0.3.min.js'},
		sockjs_echo = sockjs.createServer(sockjs_opts);

	sockjs_echo.on('connection', function (conn) {
		if (null == conn) {
			logger.error ("null == conn");
			return;
		}
		conn.on('data', function (message) {
			try {
				var data = JSON.parse(message);
				switch (data.type) {
					case 'spellCheck':	spellCheck(conn, data);break;
				}
			} catch (e) {
				logger.error("error receiving response: %s", e);
			}
		});
		conn.on('error', function () {
			logger.error("On error");
		});
		conn.on('close', function () {
			logger.info("Connection closed or timed out");
		});
	});

	function sendData(conn, data) {
		conn.write(JSON.stringify(data));
	}

	function spellCheck(conn, data) {
		var oSpellInfo;
		function checkEnd() {
			if (0 === oSpellInfo.usrWordsLength) {
				sendData(conn, { type:"spellCheck", spellCheckData:JSON.stringify(data) });
			}
		}
		function spellSuggest(index, word, lang) {
			oSpellInfo.arrTimes[index] = new Date();
			logger.info('start %s word = %s, lang = %s', data.type, word, lang);
			var oDictionary = arrDictionaries[lang];
			if (undefined === oDictionary) {
				data.usrCorrect[index] = false;
				--data.usrWordsLength;
				checkEnd();
			} else if ("spell" === data.type) {
				oDictionary.isCorrect(word, function (err, correct, origWord) {
					data.usrCorrect[index] = (!err && correct);
					logger.info('spell word = %s, lang = %s, time = %s', word, lang, new Date() - oSpellInfo.arrTimes[index]);
					--oSpellInfo.usrWordsLength;
					checkEnd();
				});
			} else if ("suggest" === data.type) {
				oDictionary.spellSuggestions(word, function (err, correct, suggestions, origWord) {
					data.usrSuggest[index] = suggestions;
					logger.info('suggest word = %s, lang = %s, time = %s', word, lang, new Date() - oSpellInfo.arrTimes[index]);
					--oSpellInfo.usrWordsLength;
					checkEnd();
				});
			}
		}

		data = JSON.parse(data.spellCheckData);
		// Ответ
		data.usrCorrect = [];
		data.usrSuggest = [];

		oSpellInfo = {usrWordsLength: data.usrWords.length, arrTimes: []};

		//data.start = new Date();
		for (var i = 0, length = data.usrWords.length; i < length; ++i) {
			spellSuggest(i, data.usrWords[i], data.usrLang[i]);
		}
	}

	sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
	}});

	callbackFunction();
};
exports.spellSuggest = function (type, word, lang, callbackFunction) {
	var oDictionary = arrDictionaries[lang];
	if (undefined === oDictionary) {
		callbackFunction(false);
	} else if ('spell' === type) {
		oDictionary.isCorrect(word, function (err, correct, origWord) {
			callbackFunction(!err && correct);
		});
	} else if ('suggest' === type) {
		oDictionary.spellSuggestions(word, function (err, correct, suggestions, origWord) {
			callbackFunction(suggestions);
		});
	}
};