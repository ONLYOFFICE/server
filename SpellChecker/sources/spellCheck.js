/*
 * (c) Copyright Ascensio System SIA 2010-2018
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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

const sockjs = require('sockjs');
const nodehun = require('nodehun');
const logger = require('./../../Common/sources/logger');
const utils = require('./../../Common/sources/utils');
const fs = require('fs');
const co = require('co');
const cfgSockjs = require('config').get('services.CoAuthoring.sockjs');
const languages = require('./languages');
const allLanguages = languages.allLanguages;
const path = require('path');
const arrExistDictionaries = {};
const pathDictionaries = path.join(__dirname, '../dictionaries');
const arrDictionaries = {};

function spell(type, word, id) {
	return new Promise(function(resolve, reject) {
		let dict = null;
		if (arrDictionaries[id]) {
			dict = arrDictionaries[id];
		} else {
			if (arrExistDictionaries[id]) {
				let pathTmp = path.join(pathDictionaries, allLanguages[id], allLanguages[id] + '.');
				dict = arrDictionaries[id] = new nodehun(pathTmp + 'aff', pathTmp + 'dic');
			}
		}

		if (dict) {
			if ("spell" === type) {
				// use setImmediate because https://github.com/nodejs/node/issues/5691
				dict.isCorrect(word, function (err, correct, origWord) {
					return setImmediate(resolve, !err && correct);
				});
			} else if ("suggest" === type) {
				dict.spellSuggestions(word, function (err, correct, suggestions, origWord) {
					return setImmediate(resolve, suggestions);
				});
			}
		} else {
			return setImmediate(resolve, true);
		}
	});
}
 
exports.install = function (server, callbackFunction) {
	'use strict';

	utils.listFolders(pathDictionaries, true).then((values) => {
		return co(function*() {
			let lang;
			for (let i = 0; i < values.length; ++i) {
				lang = languages.sToId(path.basename(values[i]));
				if (-1 !== lang) {
					arrExistDictionaries[lang] = 1;
				}
			}
			yield spell('spell', 'color', 0x0409);
			callbackFunction();
		});
	});

	const sockjs_echo = sockjs.createServer(cfgSockjs);

	sockjs_echo.on('connection', function (conn) {
		if (!conn) {
			logger.error ("null == conn");
			return;
		}
		conn.on('data', function (message) {
			try {
				let data = JSON.parse(message);
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

		sendData(conn, {type: 'init', languages: Object.keys(arrExistDictionaries)});
	});

	function sendData(conn, data) {
		conn.write(JSON.stringify(data));
	}

	function spellCheck(conn, data) {
		return co(function*() {
			data = JSON.parse(data.spellCheckData);

			let promises = [];
			for (let i = 0, length = data.usrWords.length; i < length; ++i) {
				promises.push(spell(data.type, data.usrWords[i], data.usrLang[i]));
			}
			yield Promise.all(promises).then(values => {
				data[('spell' === data.type ? 'usrCorrect' : 'usrSuggest')] = values;
			});
			sendData(conn, {type: 'spellCheck', spellCheckData: data});
		});
	}

	sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
	}});
};
exports.spellSuggest = function (type, word, lang, callbackFunction) {
	return co(function*() {
		callbackFunction(yield spell(type, word, lang));
	});
};
