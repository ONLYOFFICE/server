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

'use strict';

const configCommon = require('config');
const config = configCommon.get('services.CoAuthoring');
//process.env.NODE_ENV = config.get('server.mode');
const logger = require('./../../Common/sources/logger');
const co = require('co');
const license = require('./../../Common/sources/license');
const fs = require('fs');

const express = require('express');
const http = require('http');
const urlModule = require('url');
const path = require('path');
const bodyParser = require("body-parser");
const multer = require('multer');
const mime = require('mime');
const apicache = require('apicache');
const docsCoServer = require('./DocsCoServer');
const canvasService = require('./canvasservice');
const converterService = require('./converterservice');
const fileUploaderService = require('./fileuploaderservice');
const wopiClient = require('./wopiClient');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const configStorage = configCommon.get('storage');

const cfgWopiEnable = configCommon.get('wopi.enable');
const cfgHtmlTemplate = configCommon.get('wopi.htmlTemplate');

const app = express();
app.set("views", cfgHtmlTemplate);
app.set("view engine", "ejs");
const server = http.createServer(app);

let licenseInfo, licenseOriginal, updatePluginsTime, userPlugins, pluginsLoaded;

const updatePlugins = (eventType, filename) => {
	console.log('update Folder: %s ; %s', eventType, filename);
	if (updatePluginsTime && 1000 >= (new Date() - updatePluginsTime)) {
		return;
	}
	console.log('update Folder true: %s ; %s', eventType, filename);
	updatePluginsTime = new Date();
	pluginsLoaded = false;
};
const readLicense = function*() {
	[licenseInfo, licenseOriginal] = yield* license.readLicense();
};
const updateLicense = () => {
	return co(function*() {
		try {
			yield* readLicense();
			docsCoServer.setLicenseInfo(licenseInfo, licenseOriginal);
			console.log('End updateLicense');
		} catch (err) {
			logger.error('updateLicense error:\r\n%s', err.stack);
		}
	});
};

logger.warn('Express server starting...');

updateLicense();

if (config.has('server.static_content')) {
	const staticContent = config.get('server.static_content');
	for (let i in staticContent) {
		app.use(i, express.static(staticContent[i]['path'], staticContent[i]['options']));
	}
}

if (configStorage.has('fs.folderPath')) {
	const cfgBucketName = configStorage.get('bucketName');
	const cfgStorageFolderName = configStorage.get('storageFolderName');
	app.use('/' + cfgBucketName + '/' + cfgStorageFolderName, (req, res, next) => {
		const index = req.url.lastIndexOf('/');
		if ('GET' === req.method && -1 != index) {
			let sendFileOptions = {
				root: configStorage.get('fs.folderPath'), dotfiles: 'deny', headers: {
					'Content-Disposition': 'attachment'
				}
			};
			const urlParsed = urlModule.parse(req.url);
			if (urlParsed && urlParsed.pathname) {
				const filename = decodeURIComponent(path.basename(urlParsed.pathname));
				sendFileOptions.headers['Content-Type'] = mime.getType(filename);
			}
			const realUrl = req.url.substring(0, index);
			res.sendFile(realUrl, sendFileOptions, (err) => {
				if (err) {
					logger.error(err);
					res.status(400).end();
				}
			});
		} else {
			res.sendStatus(404)
		}
	});
}

try {
	fs.watch(config.get('plugins.path'), updatePlugins);
} catch (e) {
	logger.warn('Failed to subscribe to plugin folder updates. When changing the list of plugins, you must restart the server. https://nodejs.org/docs/latest/api/fs.html#fs_availability');
}
fs.watchFile(configCommon.get('license').get('license_file'), updateLicense);
setInterval(updateLicense, 86400000);

// Если захочется использовать 'development' и 'production',
// то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
// Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
docsCoServer.install(server, () => {
	console.log('Start callbackFunction');

	server.listen(config.get('server.port'), () => {
		logger.warn("Express server listening on port %d in %s mode. Version: %s. Build: %s", config.get('server.port'), app.settings.env, commonDefines.buildVersion, commonDefines.buildNumber);
	});

	app.get('/index.html', (req, res) => {
		res.send('Server is functioning normally. Version: ' + commonDefines.buildVersion + '. Build: ' +
			commonDefines.buildNumber);
	});
	const rawFileParser = bodyParser.raw(
		{inflate: true, limit: config.get('server.limits_tempfile_upload'), type: function() {return true;}});
	const urleEcodedParser = bodyParser.urlencoded({ extended: false });
	let forms = multer();

	app.get('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser, docsCoServer.commandFromServer);
	app.post('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser,
		docsCoServer.commandFromServer);

	app.get('/ConvertService.ashx', utils.checkClientIp, rawFileParser, converterService.convertXml);
	app.post('/ConvertService.ashx', utils.checkClientIp, rawFileParser, converterService.convertXml);
	app.post('/converter', utils.checkClientIp, rawFileParser, converterService.convertJson);


	app.get('/FileUploader.ashx', utils.checkClientIp, rawFileParser, fileUploaderService.uploadTempFile);
	app.post('/FileUploader.ashx', utils.checkClientIp, rawFileParser, fileUploaderService.uploadTempFile);

	app.param('docid', (req, res, next, val) => {
		if (constants.DOC_ID_REGEX.test(val)) {
			next();
		} else {
			res.sendStatus(403);
		}
	});
	app.param('index', (req, res, next, val) => {
		if (!isNaN(parseInt(val))) {
			next();
		} else {
			res.sendStatus(403);
		}
	});
	app.post('/uploadold/:docid/:userid/:index', fileUploaderService.uploadImageFileOld);
	app.post('/upload/:docid/:userid/:index', rawFileParser, fileUploaderService.uploadImageFile);

	app.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
	app.post('/savefile/:docid', rawFileParser, canvasService.saveFile);
	app.get('/printfile/:docid/:filename', canvasService.printFile);
	app.get('/downloadfile/:docid', canvasService.downloadFile);
	app.get('/healthcheck', utils.checkClientIp, docsCoServer.healthCheck);

	app.get('/baseurl', (req, res) => {
		res.send(utils.getBaseUrlByRequest(req));
	});

	app.get('/robots.txt', (req, res) => {
		res.setHeader('Content-Type', 'plain/text');
		res.send("User-agent: *\nDisallow: /");
	});

	app.post('/docbuilder', utils.checkClientIp, rawFileParser, (req, res) => {
		converterService.builder(req, res);
	});
	app.get('/info/info.json', utils.checkClientIp, docsCoServer.licenseInfo);
	app.put('/internal/cluster/inactive', utils.checkClientIp, docsCoServer.shutdown);
	app.delete('/internal/cluster/inactive', utils.checkClientIp, docsCoServer.shutdown);

	if (cfgWopiEnable) {
		app.get('/hosting/discovery', utils.checkClientIp, wopiClient.discovery);
		app.get('/hosting/capabilities', utils.checkClientIp, wopiClient.collaboraCapabilities);
		app.post('/hosting/wopi/:documentType/:mode', utils.checkClientIp, urleEcodedParser, forms.none(), utils.lowercaseQueryString, wopiClient.getEditorHtml);
	}

	app.post('/dummyCallback', utils.checkClientIp, rawFileParser, function(req, res){
		logger.debug(`dummyCallback req.body:%s`, req.body);
		utils.fillResponseSimple(res, JSON.stringify({error: 0}, "application/json"));
	});

	const sendUserPlugins = (res, data) => {
		pluginsLoaded = true;
		res.setHeader('Content-Type', 'application/json');
		res.send(JSON.stringify(data));
	};
	app.get('/plugins.json', (req, res) => {
		if (userPlugins && pluginsLoaded) {
			sendUserPlugins(res, userPlugins);
			return;
		}

		if (!config.has('server.static_content') || !config.has('plugins.uri')) {
			res.sendStatus(404);
			return;
		}

		let staticContent = config.get('server.static_content');
		let pluginsUri = config.get('plugins.uri');
		let pluginsPath = undefined;
		let pluginsAutostart = config.get('plugins.autostart');

		if (staticContent[pluginsUri]) {
			pluginsPath = staticContent[pluginsUri].path;
		}

		let baseUrl = '../../../..';
		utils.listFolders(pluginsPath, true).then((values) => {
			return co(function*() {
				const configFile = 'config.json';
				let stats = null;
				let result = [];
				for (let i = 0; i < values.length; ++i) {
					try {
						stats = yield utils.fsStat(path.join(values[i], configFile));
					} catch (err) {
						stats = null;
					}

					if (stats && stats.isFile) {
						result.push( baseUrl + pluginsUri + '/' + path.basename(values[i]) + '/' + configFile);
					}
				}

				userPlugins = {'url': '', 'pluginsData': result, 'autostart': pluginsAutostart};
				sendUserPlugins(res, userPlugins);
			});
		});
	});
	app.get('/themes.json', apicache.middleware("5 minutes"), (req, res) => {
		return co(function*() {
			let themes = [];
			try {
				logger.info('themes.json start');
				if (!config.has('server.static_content') || !config.has('themes.uri')) {
					return;
				}
				let staticContent = config.get('server.static_content');
				let themesUri = config.get('themes.uri');
				let themesList = [];

				for (let i in staticContent) {
					if (staticContent.hasOwnProperty(i) && themesUri.startsWith(i)) {
						let dir = staticContent[i].path + themesUri.substring(i.length);
						themesList = yield utils.listObjects(dir, true);
						logger.debug('themes.json dir:%s', dir);
						logger.debug('themes.json themesList:%j', themesList);
						for (let j = 0; j < themesList.length; ++j) {
							let data = yield utils.readFile(themesList[j], true);
							themes.push(JSON.parse(data.toString('utf-8')));
						}
						break;
					}
				}
			} catch (err) {
				logger.error('themes.json error:%s', err.stack);
			} finally {
				if (themes.length > 0) {
					res.setHeader('Content-Type', 'application/json');
					res.send({"themes": themes});
				} else {
					res.sendStatus(404);
				}
				logger.info('themes.json end');
			}
		});
	});
});

process.on('uncaughtException', (err) => {
	logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
	logger.error(err.stack);
	logger.shutdown(() => {
		process.exit(1);
	});
});
