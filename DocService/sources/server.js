/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
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

const config = require('config');
//process.env.NODE_ENV = config.get('services.CoAuthoring.server.mode');
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
const operationContext = require('./../../Common/sources/operationContext');
const tenantManager = require('./../../Common/sources/tenantManager');
const staticRouter = require('./routes/static');
const ms = require('ms');

const cfgWopiEnable = config.get('wopi.enable');
const cfgWopiDummyEnable = config.get('wopi.dummy.enable');
const cfgHtmlTemplate = config.get('wopi.htmlTemplate');
const cfgTokenEnableBrowser = config.get('services.CoAuthoring.token.enable.browser');
const cfgTokenEnableRequestInbox = config.get('services.CoAuthoring.token.enable.request.inbox');
const cfgTokenEnableRequestOutbox = config.get('services.CoAuthoring.token.enable.request.outbox');
const cfgLicenseFile = config.get('license.license_file');
const cfgDownloadMaxBytes = config.get('FileConverter.converter.maxDownloadBytes');

if (false) {
	var cluster = require('cluster');
	cluster.schedulingPolicy = cluster.SCHED_RR
	if (cluster.isMaster) {
		let workersCount = 2;
		logger.warn('start cluster with %s workers %s', workersCount, cluster.schedulingPolicy);
		for (let nIndexWorker = 0; nIndexWorker < workersCount; ++nIndexWorker) {
			var worker = cluster.fork().process;
			logger.warn('worker %s started.', worker.pid);
		}

		cluster.on('exit', function (worker) {
			logger.warn('worker %s died. restart...', worker.process.pid);
			cluster.fork();
		});
		return;
	}
}

const app = express();
app.disable('x-powered-by');
//path.resolve uses __dirname by default(unexpected path in pkg)
app.set("views", path.resolve(process.cwd(), cfgHtmlTemplate));
app.set("view engine", "ejs");
const server = http.createServer(app);

let licenseInfo, licenseOriginal, updatePluginsTime, userPlugins;
const updatePluginsCacheExpire = ms("5m");

const updatePlugins = (eventType, filename) => {
	operationContext.global.logger.info('update Folder true: %s ; %s', eventType, filename);
	userPlugins = undefined;
};
const readLicense = async function () {
	[licenseInfo, licenseOriginal] = await license.readLicense(cfgLicenseFile);
};
const updateLicense = async () => {
	try {
		await readLicense();
		await docsCoServer.setLicenseInfo(operationContext.global, licenseInfo, licenseOriginal);
		operationContext.global.logger.info('End updateLicense');
	} catch (err) {
		operationContext.global.logger.error('updateLicense error: %s', err.stack);
	}
};

operationContext.global.logger.warn('Express server starting...');

if (!(cfgTokenEnableBrowser && cfgTokenEnableRequestInbox && cfgTokenEnableRequestOutbox)) {
	operationContext.global.logger.warn('Set services.CoAuthoring.token.enable.browser, services.CoAuthoring.token.enable.request.inbox, ' +
				'services.CoAuthoring.token.enable.request.outbox in the Document Server config ' +
				'to prevent an unauthorized access to your documents and the substitution of important parameters in Document Server requests.');
}

updateLicense();
fs.watchFile(cfgLicenseFile, updateLicense);
setInterval(updateLicense, 86400000);

try {
	let staticContent = config.get('services.CoAuthoring.server.static_content');
	let pluginsUri = config.get('services.CoAuthoring.plugins.uri');
	let pluginsPath = undefined;
	if (staticContent[pluginsUri]) {
		pluginsPath = staticContent[pluginsUri].path;
	}
	fs.watch(pluginsPath, updatePlugins);
} catch (e) {
	operationContext.global.logger.warn('Failed to subscribe to plugin folder updates. When changing the list of plugins, you must restart the server. https://nodejs.org/docs/latest/api/fs.html#fs_availability. %s', e.stack);
}

// If you want to use 'development' and 'production',
// then with app.settings.env (https://github.com/strongloop/express/issues/936)
// If error handling is needed, now it's like this https://github.com/expressjs/errorhandler
docsCoServer.install(server, () => {
	operationContext.global.logger.info('Start callbackFunction');

	server.listen(config.get('services.CoAuthoring.server.port'), () => {
		operationContext.global.logger.warn("Express server listening on port %d in %s mode. Version: %s. Build: %s", config.get('services.CoAuthoring.server.port'), app.settings.env, commonDefines.buildVersion, commonDefines.buildNumber);
	});

	app.get('/index.html', (req, res) => {
		return co(function*() {
			let ctx = new operationContext.Context();
			try {
				ctx.initFromRequest(req);
				yield ctx.initTenantCache();
				let [licenseInfo] = yield tenantManager.getTenantLicense(ctx);
				let buildVersion = commonDefines.buildVersion;
				let buildNumber = commonDefines.buildNumber;
				let buildDate, packageType, customerId = "", alias = "";
				if (licenseInfo) {
					buildDate = licenseInfo.buildDate.toISOString();
					packageType = licenseInfo.packageType;
					customerId = licenseInfo.customerId;
					alias = licenseInfo.alias;
				}
				let output = `Server is functioning normally. Version: ${buildVersion}. Build: ${buildNumber}`;
				output += `. Release date: ${buildDate}. Package type: ${packageType}. Customer Id: ${customerId}. Alias: ${alias}`;
				res.send(output);
			} catch (err) {
				ctx.logger.error('index.html error: %s', err.stack);
				res.sendStatus(400);
			}
		});
	});

	app.use('/', staticRouter);

	const rawFileParser = bodyParser.raw(
		{inflate: true, limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'), type: function() {return true;}});
	const urleEcodedParser = bodyParser.urlencoded({ extended: false });
	let forms = multer();

	app.get('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser, docsCoServer.commandFromServer);
	app.post('/coauthoring/CommandService.ashx', utils.checkClientIp, rawFileParser, docsCoServer.commandFromServer);
	app.post('/command', utils.checkClientIp, rawFileParser, docsCoServer.commandFromServer);

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
	//'*' for backward compatible
	app.post('/uploadold/:docid*', fileUploaderService.uploadImageFileOld);
	app.post('/upload/:docid*', rawFileParser, fileUploaderService.uploadImageFile);

	app.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
	app.post('/savefile/:docid', rawFileParser, canvasService.saveFile);
	app.get('/printfile/:docid/:filename', canvasService.printFile);
	app.get('/downloadfile/:docid', canvasService.downloadFile);
	app.post('/downloadfile/:docid', rawFileParser, canvasService.downloadFile);
	app.get('/healthcheck', utils.checkClientIp, docsCoServer.healthCheck);

	app.get('/baseurl', (req, res) => {
		let ctx = new operationContext.Context();
		try {
			ctx.initFromRequest(req);
			//todo
			// yield ctx.initTenantCache();
			res.send(utils.getBaseUrlByRequest(ctx, req));
		} catch (err) {
			ctx.logger.error('baseurl error: %s', err.stack);
		}
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
	app.get('/internal/connections/edit', docsCoServer.getEditorConnectionsCount);

	function checkWopiEnable(req, res, next) {
		//todo may be move code into wopiClient or wopiClient.discovery...
		let ctx = new operationContext.Context();
		ctx.initFromRequest(req);
		ctx.initTenantCache()
			.then(() => {
				const tenWopiEnable = ctx.getCfg('wopi.enable', cfgWopiEnable);
				if (tenWopiEnable) {
					next();
				} else {
					res.sendStatus(404);
				}
			}).catch((err) => {
				ctx.logger.error('checkWopiEnable error: %s', err.stack);
				res.sendStatus(404);
			});
	}
	function checkWopiDummyEnable(req, res, next) {
		//todo may be move code into wopiClient or wopiClient.discovery...
		let ctx = new operationContext.Context();
		ctx.initFromRequest(req);
		ctx.initTenantCache()
			.then(() => {
				const tenWopiEnable = ctx.getCfg('wopi.enable', cfgWopiEnable);
				const tenWopiDummyEnable = ctx.getCfg('wopi.dummy.enable', cfgWopiDummyEnable);
				if (tenWopiEnable && tenWopiDummyEnable) {
					next();
				} else {
					res.sendStatus(404);
				}
			}).catch((err) => {
				ctx.logger.error('checkWopiDummyEnable error: %s', err.stack);
				res.sendStatus(404);
			});
	}
	//todo dest
	let fileForms = multer({limits: {fieldSize: cfgDownloadMaxBytes}});
	app.get('/hosting/discovery', checkWopiEnable, utils.checkClientIp, wopiClient.discovery);
	app.get('/hosting/capabilities', checkWopiEnable, utils.checkClientIp, wopiClient.collaboraCapabilities);
	app.post('/lool/convert-to/:format?', checkWopiEnable, utils.checkClientIp, urleEcodedParser, fileForms.any(), converterService.convertTo);
	app.post('/cool/convert-to/:format?', checkWopiEnable, utils.checkClientIp, urleEcodedParser, fileForms.any(), converterService.convertTo);
	app.post('/hosting/wopi/:documentType/:mode', checkWopiEnable, urleEcodedParser, forms.none(), utils.lowercaseQueryString, wopiClient.getEditorHtml);
	app.post('/hosting/wopi/convert-and-edit/:ext/:targetext', checkWopiEnable, urleEcodedParser, forms.none(), utils.lowercaseQueryString, wopiClient.getConverterHtml);
	app.get('/hosting/wopi/convert-and-edit-handler', checkWopiEnable, utils.lowercaseQueryString, converterService.getConverterHtmlHandler);
	app.get('/wopi/files/:docid', apicache.middleware("5 minutes"), checkWopiDummyEnable, utils.lowercaseQueryString, wopiClient.dummyCheckFileInfo);
	app.post('/wopi/files/:docid', checkWopiDummyEnable, wopiClient.dummyOk);
	app.get('/wopi/files/:docid/contents', apicache.middleware("5 minutes"), checkWopiDummyEnable, wopiClient.dummyGetFile);
	app.post('/wopi/files/:docid/contents', checkWopiDummyEnable, wopiClient.dummyOk);

	app.post('/dummyCallback', utils.checkClientIp, apicache.middleware("5 minutes"), rawFileParser, function(req, res){
		let ctx = new operationContext.Context();
		ctx.initFromRequest(req);
		//yield ctx.initTenantCache();//no need
		ctx.logger.debug(`dummyCallback req.body:%s`, req.body);
		utils.fillResponseSimple(res, JSON.stringify({error: 0}, "application/json"));
	});

	const sendUserPlugins = (res, data) => {
		res.setHeader('Content-Type', 'application/json');
		res.send(JSON.stringify(data));
	};
	app.get('/plugins.json', (req, res) => {
		//fs.watch is not reliable. Set cache expiry time
		if (userPlugins && (new Date() - updatePluginsTime) < updatePluginsCacheExpire) {
			sendUserPlugins(res, userPlugins);
			return;
		}

		if (!config.has('services.CoAuthoring.server.static_content') || !config.has('services.CoAuthoring.plugins.uri')) {
			res.sendStatus(404);
			return;
		}

		let staticContent = config.get('services.CoAuthoring.server.static_content');
		let pluginsUri = config.get('services.CoAuthoring.plugins.uri');
		let pluginsPath = undefined;
		let pluginsAutostart = config.get('services.CoAuthoring.plugins.autostart');

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

				updatePluginsTime = new Date();
				userPlugins = {'url': '', 'pluginsData': result, 'autostart': pluginsAutostart};
				sendUserPlugins(res, userPlugins);
			});
		});
	});
	app.get('/themes.json', apicache.middleware("5 minutes"), (req, res) => {
		return co(function*() {
			let themes = [];
			let ctx = new operationContext.Context();
			try {
				ctx.initFromRequest(req);
				yield ctx.initTenantCache();
				ctx.logger.info('themes.json start');
				if (!config.has('services.CoAuthoring.server.static_content') || !config.has('services.CoAuthoring.themes.uri')) {
					return;
				}
				let staticContent = config.get('services.CoAuthoring.server.static_content');
				let themesUri = config.get('services.CoAuthoring.themes.uri');
				let themesList = [];

				for (let i in staticContent) {
					if (staticContent.hasOwnProperty(i) && themesUri.startsWith(i)) {
						let dir = staticContent[i].path + themesUri.substring(i.length);
						themesList = yield utils.listObjects(dir, true);
						ctx.logger.debug('themes.json dir:%s', dir);
						ctx.logger.debug('themes.json themesList:%j', themesList);
						for (let j = 0; j < themesList.length; ++j) {
							if (themesList[j].endsWith('.json')) {
								try {
									let data = yield utils.readFile(themesList[j], true);
									let text = new TextDecoder('utf-8', {ignoreBOM: false}).decode(data);
									themes.push(JSON.parse(text));
								} catch (err) {
									ctx.logger.error('themes.json file:%s error:%s', themesList[j], err.stack);
								}
							}
						}
						break;
					}
				}
			} catch (err) {
				ctx.logger.error('themes.json error:%s', err.stack);
			} finally {
				if (themes.length > 0) {
					res.setHeader('Content-Type', 'application/json');
					res.send({"themes": themes});
				} else {
					res.sendStatus(404);
				}
				ctx.logger.info('themes.json end');
			}
		});
	});
	app.use((err, req, res, next) => {
		let ctx = new operationContext.Context();
		ctx.initFromRequest(req);
		ctx.logger.error('default error handler:%s', err.stack);
		res.sendStatus(500);
	});
});

process.on('uncaughtException', (err) => {
	operationContext.global.logger.error('uncaughtException:%s', err.stack);
	logger.shutdown(() => {
		process.exit(1);
	});
});
