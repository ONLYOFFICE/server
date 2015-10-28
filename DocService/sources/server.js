var cluster = require('cluster');
var configCommon = require('config');
var config = configCommon.get('services.CoAuthoring');
var numCPUs = require('os').cpus().length;
//process.env.NODE_ENV = config.get('server.mode');

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
  var express = require('express');
  var http = require('http');
  var https = require('https');
  var fs = require("fs");
  var urlModule = require('url');
  var path = require('path');
  var bodyParser = require("body-parser");
  var docsCoServer = require('./DocsCoServer');
  var canvasService = require('./canvasservice');
  var converterService = require('./converterservice');
  var fontService = require('./fontservice');
  var fileUploaderService = require('./fileuploaderservice');
  var constants = require('./../../Common/sources/constants');
  var utils = require('./../../Common/sources/utils');
  var configStorage = configCommon.get('storage');
  var app = express();
  var server = null;

  logger.warn('Express server starting...');

  if (config.has('ssl')) {
    var configSSL = config.get('ssl');
    var privateKey = fs.readFileSync(configSSL.get('key')).toString(), certificateKey = fs.readFileSync(configSSL.get('cert')).toString(), trustedCertificate = fs.readFileSync(configSSL.get('ca')).toString(), //See detailed options format here: http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener
      options = {key: privateKey, cert: certificateKey, ca: [trustedCertificate]};

    server = https.createServer(options, app);
  } else {
    server = http.createServer(app);
  }

  if (config.has('server.static_content')) {
    var staticContent = config.get('server.static_content');
    for (var i = 0; i < staticContent.length; ++i) {
      var staticContentElem = staticContent[i];
      app.use(staticContentElem['name'], express.static(staticContentElem['path']));
    }
  }

  if (configStorage.has('fs.folderPath')) {
    var cfgBucketName = configStorage.get('bucketName');
    var cfgStorageFolderName = configStorage.get('storageFolderName');
    app.use('/' + cfgBucketName + '/' + cfgStorageFolderName, function(req, res, next) {
      var index = req.url.lastIndexOf('/');
      var contentDisposition = 'attachment;';
      if (-1 != index) {
        var urlParsed = urlModule.parse(req.url);
        if (urlParsed && urlParsed.pathname) {
          var filename = decodeURIComponent(path.basename(urlParsed.pathname));
          contentDisposition = utils.getContentDisposition(filename, req.headers['user-agent']);
        }
        req.url = req.url.substring(0, index);
      }
      res.setHeader("Content-Disposition", contentDisposition);
      next();
    }, express.static(configStorage.get('fs.folderPath')));
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

    app.get('/coauthoring/CommandService.ashx', docsCoServer.commandFromServer);
    app.post('/coauthoring/CommandService.ashx', docsCoServer.commandFromServer);

    if (config.has('server.fonts_route')) {
      var fontsRoute = config.get('server.fonts_route');
      app.get('/' + fontsRoute + 'native/:fontname', fontService.getFont);
      app.get('/' + fontsRoute + 'js/:fontname', fontService.getFont);
      app.get('/' + fontsRoute + 'odttf/:fontname', fontService.getFont);
    }

    app.get('/license', docsCoServer.getDefaultLicense);

    app.get('/ConvertService.ashx', converterService.convert);
    app.post('/ConvertService.ashx', converterService.convert);

    var rawFileParser = bodyParser.raw({ inflate: true, limit: config.get('server.limits_tempfile_upload'), type: '*/*' });
    app.get('/FileUploader.ashx', rawFileParser, fileUploaderService.uploadTempFile);
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
    app.post('/uploadold/:docid/:userid/:index/:vkey?', fileUploaderService.uploadImageFileOld);
    app.post('/upload/:docid/:userid/:index/:vkey?', rawFileParser, fileUploaderService.uploadImageFile);

    app.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
  });
}

process.on('uncaughtException', function(err) {
  logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  logger.shutdown(function() {
    process.exit(1);
  });
});