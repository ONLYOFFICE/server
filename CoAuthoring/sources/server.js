var cluster = require('cluster');
var config = require('config').get('services.CoAuthoring');
var numCPUs = require('os').cpus().length;
process.env.NODE_ENV = config.get('server.mode');

var logger = require('./../../Common/sources/logger');

var cfgWorkerPerCpu = config.get('server.workerpercpu');
var workersCount = Math.ceil(numCPUs * cfgWorkerPerCpu);

if (cluster.isMaster) {
	logger.warn('start cluster with %s workers', workersCount);
	for (var nIndexWorker = 0; nIndexWorker < workersCount; ++nIndexWorker) {
		var worker = cluster.fork().process;
		logger.warn('worker %s started.', worker.pid);
	}

	cluster.on('exit', function(worker) {
		logger.warn('worker %s died. restart...', worker.process.pid);
		cluster.fork();
	});
} else {
	var express = require('express'),
		http = require('http'),
		https = require('https'),
		fs = require("fs"),
		bodyParser = require("body-parser");
		docsCoServer = require('./DocsCoServer'),
		canvasService = require('./canvasservice'),
		converterService = require('./converterservice'),
		fontService = require('./fontservice'),
		fileUploaderService = require('./fileuploaderservice'),
		constants = require('./../../Common/sources/constants'),
		configCommon = require('./../../Common/sources/config.json'),
		app = express(),
		server = null;

	logger.warn('Express server starting...');

	var configSSL = config.get('ssl');
	if (configSSL) {
		var privateKey = fs.readFileSync(configSSL.get('key')).toString(),
			certificateKey = fs.readFileSync(configSSL.get('cert')).toString(),
			trustedCertificate = fs.readFileSync(configSSL.get('ca')).toString(),
			//See detailed options format here: http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener
			options = {key: privateKey, cert: certificateKey, ca: [trustedCertificate]};

		server = https.createServer(options, app);
	} else {
		server = http.createServer(app);
	}

	if (config.get('server') && config.get('server.static.content')) {
		var staticContent = config.get('server.static.content');
		for(var i = 0; i < staticContent.length; ++i) {
			var staticContentElem = staticContent[i];
			app.use(staticContentElem['name'], express.static(staticContentElem['path']));
		}
	}

	if (configCommon && configCommon['storage') && configCommon['storage.fs') &&
		configCommon['storage.fs.folderPath')) {
		var cfgBucketName = configCommon['storage.bucketName');
		var cfgStorageFolderName = configCommon['storage.storageFolderName');
		app.use('/' + cfgBucketName + '/' + cfgStorageFolderName, function(req, res, next) {
			res.setHeader("Content-Disposition", 'attachment');
			next();
		}, express.static(configCommon['storage.fs.folderPath')));
	}

	// Если захочется использовать 'development' и 'production',
	// то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
	// Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
	docsCoServer.install(server, function() {
		server.listen(config.get('server.port'), function() {
			logger.warn("Express server listening on port %d in %s mode", config.get('server.port'), app.settings.env);
		});

		app.get('/index.html', function(req, res) {
			res.send('Server is functioning normally. Version: ' + docsCoServer.version);
		});

		app.get('/coauthoring/CommandService.ashx', onServiceCall);
		app.post('/coauthoring/CommandService.ashx', onServiceCall);

		function onServiceCall (req, res) {
			var result = docsCoServer.commandFromServer(req);
			result = JSON.stringify({'key': req.query.key, 'error': result});

			res.setHeader('Content-Type', 'application/json');
			res.setHeader('Content-Length', result.length);
			res.send(result);
		}

		app.get('/' + config.get('server.fonts.route') + 'native/:fontname', fontService.getFont);
		app.get('/' + config.get('server.fonts.route') + 'js/:fontname', fontService.getFont);
		app.get('/' + config.get('server.fonts.route') + 'odttf/:fontname', fontService.getFont);

		app.get('/ConvertService.ashx', converterService.convert);
		app.post('/ConvertService.ashx', converterService.convert);

		var rawFileParser = bodyParser.raw({ inflate: true, limit: config.get('server.limits.tempfile.upload'), type: '*/*' });
		app.post('/FileUploader.ashx', rawFileParser, fileUploaderService.uploadTempFile);

		var docIdRegExp = new RegExp("^[" + constants.DOC_ID_PATTERN + "]*$", 'i');
		app.param('docid', function(req, res, next, val) {
			if (docIdRegExp.test(val)) {
				next();
			} else {
				res.sendStatus(403);
			}
		});
		app.param('index', function(req, res, next, val) {
			if (!isNaN(parseInt(val))) {
				next();
			} else {
				res.sendStatus(403);
			}
		});
		app.post('/upload/:docid/:userid/:index/:vkey?', fileUploaderService.uploadImageFile);

		app.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
	});
}

process.on('uncaughtException', function (err) {
	logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
	logger.error(err.stack);
	logger.shutdown(function () {
		process.exit(1);
	});
});