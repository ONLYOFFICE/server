/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU 
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html). 
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that 
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display 
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains 
 * relevant author attributions when distributing the software. If the display of the logo in its graphic 
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE" 
 * in every copy of the program you distribute. 
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
*/
const fs = require('fs');
const cluster = require('cluster');
const configCommon = require('config');
const config = configCommon.get('services.CoAuthoring');
//process.env.NODE_ENV = config.get('server.mode');

const logger = require('./../../Common/sources/logger');

if (cluster.isMaster) {
  const numCPUs = require('os').cpus().length;
  const license = require('./../../Common/sources/license');

  const cfgWorkerPerCpu = config.get('server.workerpercpu');
  var licenseInfo, workersCount = 0;
  const readLicense = () => {
    licenseInfo = license.readLicense();
    workersCount = Math.min(licenseInfo.count, Math.ceil(numCPUs * cfgWorkerPerCpu));
  };
  const updateLicenseWorker = (worker) => {
    worker.send({data: licenseInfo.type});
  };
  const updateWorkers = () => {
    var i;
    const arrKeyWorkers = Object.keys(cluster.workers);
    if (arrKeyWorkers.length < workersCount) {
      for (i = arrKeyWorkers.length; i < workersCount; ++i) {
        const newWorker = cluster.fork();
        logger.warn('worker %s started.', newWorker.process.pid);
      }
    } else {
      for (i = workersCount; i < arrKeyWorkers.length; ++i) {
        const killWorker = cluster.workers[arrKeyWorkers[i]];
        if (killWorker) {
          killWorker.kill();
        }
      }
    }
  };
  const updateLicense = () => {
    readLicense();
    logger.warn('update cluster with %s workers', workersCount);
    for (var i in cluster.workers) {
      updateLicenseWorker(cluster.workers[i]);
    }
    updateWorkers();
  };

  cluster.on('fork', (worker) => {
    updateLicenseWorker(worker);
  });
  cluster.on('exit', (worker) => {
    logger.warn('worker %s died.', worker.process.pid);
    updateWorkers();
  });

  updateLicense();

  fs.watchFile(configCommon.get('license').get('license_file'), updateLicense);
  setInterval(updateLicense, 86400000);
} else {
  const express = require('express');
  const http = require('http');
  const https = require('https');
  const urlModule = require('url');
  const path = require('path');
  const bodyParser = require("body-parser");
  const mime = require('mime');
  const docsCoServer = require('./DocsCoServer');
  const canvasService = require('./canvasservice');
  const converterService = require('./converterservice');
  const fontService = require('./fontservice');
  const fileUploaderService = require('./fileuploaderservice');
  const constants = require('./../../Common/sources/constants');
  const utils = require('./../../Common/sources/utils');
  const configStorage = configCommon.get('storage');
  const app = express();
  var server = null;

  logger.warn('Express server starting...');

  if (config.has('ssl')) {
    const configSSL = config.get('ssl');
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
    app.use('/' + cfgBucketName + '/' + cfgStorageFolderName, (req, res, next) => {
      var index = req.url.lastIndexOf('/');
      if (-1 != index) {
        var contentDisposition = req.query['response-content-disposition'] || 'attachment';
        var sendFileOptions = {
          root: configStorage.get('fs.folderPath'),
          dotfiles: 'deny',
          headers: {
            'Content-Disposition': contentDisposition
          }
        };
        var urlParsed = urlModule.parse(req.url);
        if (urlParsed && urlParsed.pathname) {
          var filename = decodeURIComponent(path.basename(urlParsed.pathname));
          sendFileOptions.headers['Content-Type'] = mime.lookup(filename);
        }
        var realUrl = req.url.substring(0, index);
        res.sendFile(realUrl, sendFileOptions, (err) => {
          if (err) {
            logger.error(err);
            res.status(err.status).end();
          }
        });
      } else {
        req.sendStatus(404)
      }
    });
  }

  // Если захочется использовать 'development' и 'production',
  // то с помощью app.settings.env (https://github.com/strongloop/express/issues/936)
  // Если нужна обработка ошибок, то теперь она такая https://github.com/expressjs/errorhandler
  docsCoServer.install(server, () => {
    server.listen(config.get('server.port'), () => {
      logger.warn("Express server listening on port %d in %s mode", config.get('server.port'), app.settings.env);
    });

    app.get('/index.html', (req, res) => {
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

    app.get('/ConvertService.ashx', converterService.convert);
    app.post('/ConvertService.ashx', converterService.convert);

    var rawFileParser = bodyParser.raw({ inflate: true, limit: config.get('server.limits_tempfile_upload'), type: '*/*' });
    app.get('/FileUploader.ashx', rawFileParser, fileUploaderService.uploadTempFile);
    app.post('/FileUploader.ashx', rawFileParser, fileUploaderService.uploadTempFile);

    var docIdRegExp = new RegExp("^[" + constants.DOC_ID_PATTERN + "]*$", 'i');
    app.param('docid', (req, res, next, val) => {
      if (docIdRegExp.test(val)) {
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
    app.post('/uploadold/:docid/:userid/:index/:vkey?', fileUploaderService.uploadImageFileOld);
    app.post('/upload/:docid/:userid/:index/:vkey?', rawFileParser, fileUploaderService.uploadImageFile);

    app.post('/downloadas/:docid', rawFileParser, canvasService.downloadAs);
    app.get('/healthcheck', converterService.convertHealthCheck);
  });

  process.on('message', (msg) => {
    if (!docsCoServer) {
      return;
    }
    docsCoServer.setLicenseInfo(msg.data);
  });
}

process.on('uncaughtException', (err) => {
  logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  logger.shutdown(() => {
    process.exit(1);
  });
});