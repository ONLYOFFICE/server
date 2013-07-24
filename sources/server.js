var config = require('./config.json');

process.env.NODE_ENV = config['server']['mode'];

var logger = require('./logger');

// 2. Express server
var express = require('express');
var app = {};

if(config['ssl'])
{
	var fs = require("fs");
	var privateKey = fs.readFileSync(config['ssl']['key']).toString();
	var certificate = fs.readFileSync(config['ssl']['cert']).toString();
	app = express.createServer({key: privateKey, cert:certificate});
}
else
{
	app = express.createServer();
}

app.configure(function(){
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.static(__dirname + '/public'));
});

app.configure('development', function () {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
    app.use(express.errorHandler());
});

var docsCoServer  = require('./DocsCoServer');

docsCoServer.install(app, function(){
	app.listen(config['server']['port'], function(){
		logger.info("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
	});
	
	app.get('/index.html', function(req, res) {
		res.send('Server is functioning normally');
	});
});
