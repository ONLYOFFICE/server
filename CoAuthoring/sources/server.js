var config = require('./config.json');
process.env.NODE_ENV = config['server']['mode'];

var logger = require('./../../Common/sources/logger'),
	express = require('express'),
	http = require('http'),
	https = require('https'),
	fs = require("fs"),
	docsCoServer = require('./DocsCoServer'),
	app = express(),
	server = null;

logger.warn('Express server starting...');

if (config['ssl']) {
	var privateKey = fs.readFileSync(config['ssl']['key']).toString(),
		certificateKey = fs.readFileSync(config['ssl']['cert']).toString(),
		trustedCertificate = fs.readFileSync(config['ssl']['ca']).toString(),
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
