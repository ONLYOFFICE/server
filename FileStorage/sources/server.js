var logger = require('./../../Common/sources/logger');
var config = require('config');
var S3rver = require('s3rver');

var s3rver = new S3rver();

s3rver.setHostname(config.s3rver.host)
  .setPort(config.s3rver.port)
  .setDirectory(config.s3rver.directory)
  .setSilent(config.s3rver.silent)
  .run(function (err, host, port) {
	logger.info('s3rver listening on host %s and port %d', host, port);
  });