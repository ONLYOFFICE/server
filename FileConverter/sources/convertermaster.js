var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var logger = require('./../../Common/sources/logger');
var config = require('./config.json');

var cfgMaxProcessCount = config['converter']['maxprocesscount'];

var workersCount = Math.ceil(numCPUs * cfgMaxProcessCount);

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
  var converter = require('./converter');
  converter.run();
}

process.on('uncaughtException', function(err) {
  logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  logger.shutdown(function() {
    process.exit(1);
  });
});
