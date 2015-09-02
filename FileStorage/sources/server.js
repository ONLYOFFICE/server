var logger = require('./../../Common/sources/logger');
var config = require('config').get('FileStorage');
var S3rver = require('s3rver');

var s3rver = new S3rver();

s3rver.setHostname(config.get('host'))
  .setPort(config.get('port'))
  .setDirectory(config.get('directory'))
  .setSilent(config.get('silent'))
  .run(function (err, host, port) {
	logger.info('s3rver listening on host %s and port %d', host, port);
  });