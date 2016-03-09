const cluster = require('cluster');
const logger = require('./../../Common/sources/logger');

if (cluster.isMaster) {
  const fs = require('fs');
  const numCPUs = require('os').cpus().length;
  const configCommon = require('config');
  const config = configCommon.get('FileConverter.converter');
  const license = require('./../../Common/sources/license');

  const cfgMaxProcessCount = config.get('maxprocesscount');
  var licenseInfo, workersCount = 0;
  const readLicense = () => {
    licenseInfo = license.readLicense();
    workersCount = Math.min(licenseInfo.count, Math.ceil(numCPUs * cfgMaxProcessCount));
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
    updateWorkers();
  };

  cluster.on('exit', (worker) => {
    logger.warn('worker %s died.', worker.process.pid);
    updateWorkers();
  });

  updateLicense();

  fs.watchFile(configCommon.get('license').get('license_file'), updateLicense);
  setInterval(updateLicense, 86400000);
} else {
  const converter = require('./converter');
  converter.run();
}

process.on('uncaughtException', (err) => {
  logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  logger.error(err.stack);
  logger.shutdown(() => {
    process.exit(1);
  });
});
