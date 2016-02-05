var config = require('config');

var log4js = require('log4js');
log4js.configure(config.get('log.filePath'), config.get('log.options'));

var logger = log4js.getLogger('nodeJS');

exports.trace = function (){
	return logger.trace.apply(logger, Array.prototype.slice.call(arguments));
};
exports.debug = function (){
	return logger.debug.apply(logger, Array.prototype.slice.call(arguments));
};
exports.info = function (){
	return logger.info.apply(logger, Array.prototype.slice.call(arguments));
};
exports.warn = function (){
	return logger.warn.apply(logger, Array.prototype.slice.call(arguments));
};
exports.error = function (){
	return logger.error.apply(logger, Array.prototype.slice.call(arguments));
};
exports.fatal = function (){
	return logger.fatal.apply(logger, Array.prototype.slice.call(arguments));
};
exports.shutdown = function (callback) {
	return log4js.shutdown(callback);
};