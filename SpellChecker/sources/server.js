var cluster = require('cluster');
var config = require('config').get('SpellChecker');

process.env.NODE_ENV = config.get('server.mode');

var logger = require('./../../Common/sources/logger');
var spellCheck;

var idCheckInterval, c_nCheckHealth = 60000, c_sCheckWord = 'color', c_sCheckLang = 1033;
var canStartCheck = true;
var statusCheckHealth = true;
function checkHealth (worker) {
	if (!statusCheckHealth) {
		logger.error('error check health, restart!');
		worker.kill();
		return;
	}
	worker.send({type: 'spell'});
	statusCheckHealth = false;
}
function endCheckHealth (msg) {
	statusCheckHealth = true;
}

var workersCount = 1;	// ToDo Пока только 1 процесс будем задействовать. Но в будующем стоит рассмотреть несколько.
if (cluster.isMaster) {
	logger.warn('start cluster with %s workers', workersCount);
	cluster.on('listening', function(worker) {
		if (canStartCheck) {
			canStartCheck = false;
			idCheckInterval = setInterval(function(){checkHealth(worker);}, c_nCheckHealth);
			worker.on('message', function(msg){endCheckHealth(msg);});
		}
	});
	for (var nIndexWorker = 0; nIndexWorker < workersCount; ++nIndexWorker) {
		var worker = cluster.fork().process;
		logger.warn('worker %s started.', worker.pid);
	}

	cluster.on('exit', function(worker) {
		logger.warn('worker %s died. restart...', worker.process.pid);
		clearInterval(idCheckInterval);
		endCheckHealth();
		canStartCheck = true;
		cluster.fork();
	});
} else {
	var	express = require('express'),
		http = require('http'),
		https = require('https'),
		fs = require("fs"),
		app = express(),
		server = null;
	spellCheck  = require('./spellCheck');

	logger.warn('Express server starting...');

	if (config.has('ssl')) {
		var privateKey = fs.readFileSync(config.get('ssl.key')).toString();
		var certificateKey = fs.readFileSync(config.get('ssl.cert')).toString();
		var trustedCertificate = fs.readFileSync(config.get('ssl.ca')).toString();
		//See detailed options format here: http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener
		var options = {key: privateKey, cert: certificateKey, ca: [trustedCertificate]};

		server = https.createServer(options, app);
	} else {
		server = http.createServer(app);
	}

	// Если захочется использовать 'development' и 'production',
	// то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
	// Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
	spellCheck.install(server, function(){
		server.listen(config.get('server.port'), function(){
			logger.warn("Express server listening on port %d in %s mode", config.get('server.port'), app.settings.env);
		});

		app.get('/index.html', function(req, res) {
			res.send('Server is functioning normally');
		});
	});

	process.on('message', function(msg) {
		if (!spellCheck)
			return;
		spellCheck.spellSuggest(msg.type, c_sCheckWord, c_sCheckLang, function(res) {
			process.send({type: msg.type, res: res});
		});
	});

	process.on('uncaughtException', function(err) {
		logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
		logger.error(err.stack);
		logger.shutdown(function () {
			process.exit(1);
		});
	});
}
