var cluster = require('cluster');
var config = require('./config.json');
process.env.NODE_ENV = config['server']['mode'];

var logger = require('./../../Common/sources/logger');

var workersCount = 1;	// ToDo Пока только 1 процесс будем задействовать. Но в будующем стоит рассмотреть несколько.
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
		docsCoServer = require('./DocsCoServer'),
		app = express(),
		server = null;

	logger.warn('Express server starting...');

	var configSSL = config['ssl'];
	if (configSSL) {
		var privateKey = fs.readFileSync(configSSL['key']).toString(),
			certificateKey = fs.readFileSync(configSSL['cert']).toString(),
			trustedCertificate = fs.readFileSync(configSSL['ca']).toString(),
			//See detailed options format here: http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener
			options = {key: privateKey, cert: certificateKey, ca: [trustedCertificate]};

		server = https.createServer(options, app);
	} else {
		server = http.createServer(app);
	}

	// Если захочется использовать 'development' и 'production',
	// то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
	// Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
	docsCoServer.install(server, function() {
		server.listen(config['server']['port'], function() {
			logger.warn("Express server listening on port %d in %s mode", config['server']['port'], app.settings.env);
		});

		app.get('/index.html', function(req, res) {
			res.send('Server is functioning normally. Version: ' + docsCoServer.version);
		});

		app.get('/CommandService.ashx', onServiceCall);
		app.post('/CommandService.ashx', onServiceCall);

		function onServiceCall (req, res) {
			var result = docsCoServer.commandFromServer(req.query);
			result = JSON.stringify({'key': req.query.key, 'error': result});

			res.setHeader('Content-Type', 'application/json');
			res.setHeader('Content-Length', result.length);
			res.send(result);
		}
	});
}

process.on('uncaughtException', function (err) {
	logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
	logger.error(err.stack);
	logger.shutdown(function () {
		process.exit(1);
	});
});