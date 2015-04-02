var config = require('./config.json');

process.env.NODE_ENV = config['server']['mode'];

var logger = require('./../../Common/sources/logger'),
	express = require('express'),
	http = require('http'),
	https = require('https'),
	fs = require("fs"),
	spellCheck  = require('./spellCheck'),
	app = express(),
	server = {};

logger.warn('Express server starting...');

if (config['ssl']) {
	var privateKey = fs.readFileSync(config['ssl']['key']).toString();
	var certificateKey = fs.readFileSync(config['ssl']['cert']).toString();
	var trustedCertificate = fs.readFileSync(config['ssl']['ca']).toString();
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
	server.listen(config['server']['port'], function(){
		logger.warn("Express server listening on port %d in %s mode", config['server']['port'], app.settings.env);
	});
	
	app.get('/index.html', function(req, res) {
		res.send('Server is functioning normally');
	});
});
