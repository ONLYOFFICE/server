const cluster = require('cluster');
const logger = require('./../../Common/sources/logger');

if (cluster.isMaster) {
  const numCPUs = require('os').cpus().length;
  const config = require('config').get('FileConverter.converter');
  const license = require('./../../Common/sources/license');

  const cfgMaxProcessCount = config.get('maxprocesscount');
  const workersCount = Math.min(license.readLicense(), Math.ceil(numCPUs * cfgMaxProcessCount));

  logger.warn('start cluster with %s workers', workersCount);
  for (var nIndexWorker = 0; nIndexWorker < workersCount; ++nIndexWorker) {
    const worker = cluster.fork().process;
    logger.warn('worker %s started.', worker.pid);
  }

  cluster.on('exit', function(worker) {
    logger.warn('worker %s died. restart...', worker.process.pid);
    cluster.fork();
  });
} else {
  const converter = require('./converter');
  converter.run();
}

process.on('uncaughtException', function(err) {
  logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  logger.shutdown(function() {
    process.exit(1);
  });
});
