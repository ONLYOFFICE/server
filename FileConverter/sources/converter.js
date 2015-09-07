'use strict'
var os = require('os');
var path = require('path');
var fs = require('fs');
var http = require('http');
var https = require('https');
var url = require('url');
var childProcess = require('child_process');
var config = require('config');
var configConverter = config.get('FileConverter.converter');

var commonDefines = require('./../../Common/sources/commondefines');
var storage = require('./../../Common/sources/storage-base');
var formatChecker = require('./../../Common/sources/formatchecker');
var utils = require('./../../Common/sources/utils');
var logger = require('./../../Common/sources/logger');
var constants = require('./../../Common/sources/constants');
var nodeZip = require('./../../Common/node_modules/node-zip');
var baseConnector = require('./../../CoAuthoring/sources/baseConnector');
var queueService = require('./../../Common/sources/' + config.get('queue.name'));

var cfgMaxDownloadBytes = configConverter.has('maxDownloadBytes') ? configConverter.get('maxDownloadBytes') : 100000000;
var cfgDownloadTimeout = configConverter.has('downloadTimeout') ? configConverter.get('downloadTimeout') : 60;
var cfgFontDir = configConverter.get('fontDir');
var cfgPresentationThemesDir = configConverter.get('presentationThemesDir');
var cfgFilePath = configConverter.get('filePath');
var cfgArgs = configConverter.get('args');
var cfgErrorFiles = configConverter.get('errorfiles');

var TEMP_PREFIX = 'ASC_CONVERT';
var queue = null;

function TaskQueueDataConvert(task) {
  var cmd = task.getCmd();
  this.key = cmd.savekey ? cmd.savekey : cmd.id;
  this.fileFrom = null;
  this.fileTo = null;
  this.formatFrom = constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  this.formatTo = cmd.outputformat;
  this.csvTxtEncoding = cmd.codepage;
  this.csvDelimiter = cmd.delimiter;
  this.paid = task.getPaid();
  this.embeddedFonts = cmd.embeddedfonts;
  this.fromChanges = task.getFromChanges();
  //todo
  this.fontDir = path.resolve(cfgFontDir);
  this.themeDir = path.resolve(cfgPresentationThemesDir);
  this.mailMergeSend = cmd.mailmergesend;
  this.timestamp = new Date();
}
TaskQueueDataConvert.prototype = {
  serialize: function(fsPath) {
    var xml = '\ufeff<?xml version="1.0" encoding="utf-8"?>';
    xml += '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
    xml += ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">';
    xml += this.serializeXmlProp('m_sKey', this.key);
    xml += this.serializeXmlProp('m_sFileFrom', this.fileFrom);
    xml += this.serializeXmlProp('m_sFileTo', this.fileTo);
    xml += this.serializeXmlProp('m_nFormatFrom', this.formatFrom);
    xml += this.serializeXmlProp('m_nFormatTo', this.formatTo);
    xml += this.serializeXmlProp('m_nCsvTxtEncoding', this.csvTxtEncoding);
    xml += this.serializeXmlProp('m_nCsvDelimiter', this.csvDelimiter);
    xml += this.serializeXmlProp('m_bPaid', this.paid);
    xml += this.serializeXmlProp('m_bEmbeddedFonts', this.embeddedFonts);
    xml += this.serializeXmlProp('m_bFromChanges', this.fromChanges);
    xml += this.serializeXmlProp('m_sFontDir', this.fontDir);
    xml += this.serializeXmlProp('m_sThemeDir', this.themeDir);
    if (this.mailMergeSend) {
      xml += this.serializeMailMerge(this.mailMergeSend);
    }
    xml += this.serializeXmlProp('m_oTimestamp', this.timestamp.toISOString());
    xml += '</TaskQueueDataConvert>';
    fs.writeFileSync(fsPath, xml, {encoding: 'utf8'});
  },
  serializeMailMerge: function(data) {
    var xml = '<m_oMailMergeSend>';
    xml += this.serializeXmlProp('from', data.getFrom());
    xml += this.serializeXmlProp('to', data.getTo());
    xml += this.serializeXmlProp('subject', data.getSubject());
    xml += this.serializeXmlProp('mailFormat', data.getMailFormat());
    xml += this.serializeXmlProp('fileName', data.getFileName());
    xml += this.serializeXmlProp('message', data.getMessage());
    xml += this.serializeXmlProp('recordFrom', data.getRecordFrom());
    xml += this.serializeXmlProp('recordTo', data.getRecordTo());
    xml += this.serializeXmlProp('recordCount', data.getRecordCount());
    xml += this.serializeXmlProp('userid', data.getUserId());
    xml += this.serializeXmlProp('url', data.getUrl());
    xml += '</m_oMailMergeSend>';
    return xml;
  },
  serializeXmlProp: function(name, value) {
    var xml = '';
    if (null != value) {
      xml += '<' + name + '>';
      xml += utils.encodeXml(value.toString());
      xml += '</' + name + '>';
    } else {
      xml += '<' + name + ' xsi:nil="true" />';
    }
    return xml;
  }
};

function getTempDir() {
  var tempDir = os.tmpdir();
  var now = new Date();
  var newTemp;
  while (!newTemp || fs.existsSync(newTemp)) {
    var newName = [TEMP_PREFIX, now.getYear(), now.getMonth(), now.getDate(),
      '-', (Math.random() * 0x100000000 + 1).toString(36)
    ].join('');
    newTemp = path.join(tempDir, newName);
  }
  fs.mkdirSync(newTemp);
  var sourceDir = path.join(newTemp, 'source');
  fs.mkdirSync(sourceDir);
  var resultDir = path.join(newTemp, 'result');
  fs.mkdirSync(resultDir);
  return {temp: newTemp, source: sourceDir, result: resultDir};
}
function promiseHttpsGet(uri) {
  return new Promise(function(resolve, reject) {
    //todo может стоит делать url.parse, а потом с каждой частью отдельно работать
    if (!utils.containsAllAsciiNP(uri)) {
      uri = encodeURI(uri);
    }
    var urlParsed = url.parse(uri);
    var proto;
	if (urlParsed.protocol === 'https:') {
		proto = https;
		//TODO: Check how to correct handle a ssl link
		urlParsed.rejectUnauthorized = false;
	}
	else {
		proto = http;
	}
    var request = proto.get(urlParsed, function(res) {
      resolve({request: request, response: res});
    });
    request.on('error', function(e) {
      reject(e);
    });
    request.setTimeout(cfgDownloadTimeout * 1000, function() {
      request.abort();
    });
  });
}
function promiseReadResponse(request, response, file) {
  return new Promise(function(resolve, reject) {
    var realByteSize = 0;
    response.on('data', function(chunk) {
      realByteSize += chunk.length;
      if (realByteSize <= cfgMaxDownloadBytes) {
        file.write(chunk);
      } else {
        request.abort();
      }
    });
    response.on('end', function() {
      file.end(function() {
        if (request.aborted) {
          reject(new Error('Error statusCode or contentLength'));
        } else {
          resolve(realByteSize);
        }
      });
    });
  });
}
function* downloadFile(uri, fileFrom) {
  var getRes = yield promiseHttpsGet(uri);
  var contentLength = 0;
  if (getRes.response.headers['content-length']) {
    contentLength = getRes.response.headers['content-length'] - 0;
  }
  if (200 === getRes.response.statusCode && contentLength <= cfgMaxDownloadBytes) {
    var file = yield utils.promiseCreateWriteStream(fileFrom);
    yield promiseReadResponse(getRes.request, getRes.response, file);
  } else {
    throw new Error('Error statusCode:' + getRes.response.statusCode + ' or contentLength:' + contentLength);
  }
}
function promiseGetChanges(key) {
  return new Promise(function(resolve, reject) {
    baseConnector.getChanges(key, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
function processDownloadFile(dataConvert, fromFormatStr) {
  var error = constants.NO_ERROR;
  var fileData = fs.readFileSync(dataConvert.fileFrom);
  dataConvert.formatFrom = formatChecker.getFileFormat(fileData, fromFormatStr);
  switch (dataConvert.formatFrom) {
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML:
      //Заглушка для Html.dll, потому что она открывает только файлы с расширениями html и mht
      //не стал ставить для всех форматов, потому что остальные длл не смотрят на расширение
      var fileExt = path.extname(dataConvert.fileFrom);
      if ('.html' != fileExt) {
        var newName = dataConvert.fileFrom.substring(0, dataConvert.fileFrom.length - fileExt.length) + '.html';
        fs.renameSync(dataConvert.fileFrom, newName);
        dataConvert.fileFrom = newName;
      }
      break;
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO:
      error = constants.CONVERT_MS_OFFCRYPTO;
      break;
    case constants.AVS_OFFICESTUDIO_FILE_UNKNOWN:
      error = constants.CONVERT_UNKNOWN_FORMAT;
      break;
    //для txt и csv нужно расширение и разделитель
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT:
      //todo
      break;
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV:
      //todo
      break;
  }
  return error;
}
function* downloadFileFromStorage(id, strPath, dir) {
  var list = yield storage.listObjects(strPath);
  logger.debug('downloadFileFromStorage list %s (id=%s)', list.toString(), id);
  //create dirs
  var dirsToCreate = [];
  var dirStruct = {};
  list.forEach(function(file) {
    var curDirPath = dir;
    var curDirStruct = dirStruct;
    var parts = storage.getRelativePath(strPath, file).split('/');
    for (var i = 0; i < parts.length - 1; ++i) {
      var part = parts[i];
      curDirPath = path.join(curDirPath, part);
      if (!curDirStruct[part]) {
        curDirStruct[part] = {};
        dirsToCreate.push(curDirPath);
      }
    }
  });
  //make dirs
  for (var i = 0; i < dirsToCreate.length; ++i) {
    fs.mkdirSync(dirsToCreate[i]);
  }
  //download
  //todo Promise.all
  for (var i = 0; i < list.length; ++i) {
    var file = list[i];
    var fileRel = storage.getRelativePath(strPath, file);
    var data = yield storage.getObject(file);
    fs.writeFileSync(path.join(dir, fileRel), data);
  }
}
function pipeFile(fsFrom, fsTo) {
  return new Promise(function(resolve, reject) {
    fsFrom.pipe(fsTo, {end: false});
    fsFrom.on('end', function() {
      resolve();
    });
    fsFrom.on('error', function(e) {
      reject(e);
    });
  });
}
function* processDownloadFromStorage(dataConvert, cmd, task, tempDirs) {
  if (task.getFromOrigin()) {
    dataConvert.fileFrom = path.join(tempDirs.source, 'origin');
  } else if (task.getFromSettings()) {
    //todo
  } else {
    //перезаписываем некоторые файлы из m_sKey(например Editor.bin или changes)
    yield* downloadFileFromStorage(cmd.getSaveKey(), cmd.getSaveKey(), tempDirs.source);
    dataConvert.fileFrom = path.join(tempDirs.source, 'Editor.bin');
    //при необходимости собираем файл из частей, вида EditorN.bin
    var parsedFrom = path.parse(dataConvert.fileFrom);
    var list = yield utils.listObjects(parsedFrom.dir, true);
    list.sort(utils.compareStringByLength);
    var fsFullFile = null;
    for (var i = 0; i < list.length; ++i) {
      var file = list[i];
      var parsedFile = path.parse(file);
      if (parsedFile.name !== parsedFrom.name && parsedFile.name.startsWith(parsedFrom.name)) {
        if (!fsFullFile) {
          fsFullFile = yield utils.promiseCreateWriteStream(dataConvert.fileFrom);
        }
        var fsCurFile = yield utils.promiseCreateReadStream(file);
        yield pipeFile(fsCurFile, fsFullFile);
      }
    }
    if (fsFullFile) {
      fsFullFile.end();
    }
  }
  //mail merge
  var mailMergeSend = cmd.getMailMergeSend();
  if (mailMergeSend) {
    yield* downloadFileFromStorage(mailMergeSend.getJsonKey(), mailMergeSend.getJsonKey(), tempDirs.source);
    //разбиваем на 2 файла
    var data = fs.readFileSync(dataConvert.fileFrom);
    var head = data.slice(0, 11).toString('ascii');
    var index = head.indexOf(';');
    if (-1 != index) {
      var lengthBinary = parseInt(head.substring(0, index));
      var dataJson = data.slice(index + 1 + lengthBinary);
      fs.writeFileSync(path.join(tempDirs.source, 'Editor.json'), dataJson);
      var dataBinary = data.slice(index + 1, index + 1 + lengthBinary);
      fs.writeFileSync(dataConvert.fileFrom, dataBinary);
    } else {
      logger.error('mail merge format')
    }
  }
  if (dataConvert.fileFrom) {
    var fileData = fs.readFileSync(dataConvert.fileFrom);
    var fileExt = path.extname(dataConvert.fileFrom);
    dataConvert.formatFrom = formatChecker.getFileFormat(fileData, fileExt);
  }
  if (task.getFromChanges()) {
    var changesDir = path.join(tempDirs.source, 'changes');
    fs.mkdirSync(changesDir);
    var indexFile = 0;
    var changesAuthor = null;
    var changesHistoryData = [];
    //todo writeable stream
    let changesBuffers = null;
    let zip = new nodeZip();
    let changes = yield promiseGetChanges(cmd.getDocId());
    for (var i = 0; i < changes.length; ++i) {
      var change = changes[i];
      if (null === changesAuthor || changesAuthor !== change.dc_user_id_original) {
        if (null !== changesAuthor) {
          changesBuffers.push(new Buffer(']', 'utf8'));
          let dataZipFile = Buffer.concat(changesBuffers);
          changesBuffers = null;
          var fileName = 'changes' + (indexFile++) + '.json';
          var filePath = path.join(changesDir, fileName);
          fs.writeFileSync(filePath, dataZipFile);
          zip.file(fileName, dataZipFile, {binary: true});
        }
        changesAuthor = change.dc_user_id_original;
        var strDate = baseConnector.getDateTime(change.dc_date);
        changesHistoryData.push({'userid': changesAuthor, 'username': change.dc_user_name, 'date': strDate});
        changesBuffers = [];
        changesBuffers.push(new Buffer('[', 'utf8'));
      } else {
        changesBuffers.push(new Buffer(',', 'utf8'));
      }
      changesBuffers.push(new Buffer(change.dc_data, 'utf8'));
    }
    if (null !== changesBuffers) {
      changesBuffers.push(new Buffer(']', 'utf8'));
      let dataZipFile = Buffer.concat(changesBuffers);
      changesBuffers = null;
      var fileName = 'changes' + (indexFile++) + '.json';
      var filePath = path.join(changesDir, fileName);
      fs.writeFileSync(filePath, dataZipFile);
      zip.file(fileName, dataZipFile, {binary: true});
    }
    cmd.setUserId(changesAuthor);
    fs.writeFileSync(path.join(tempDirs.result, 'changesHistory.json'), JSON.stringify(changesHistoryData), 'utf8');
    let dataZip = zip.generate({type: 'nodebuffer', compression: 'DEFLATE'});
    fs.writeFileSync(path.join(tempDirs.result, 'changes.zip'), dataZip, 'binary');
  }
}
function processInnerFormats(dataConvert) {
  var toFormat = dataConvert.formatTo;
  var formatFrom = dataConvert.formatFrom;
  if (constants.AVS_OFFICESTUDIO_FILE_CANVAS === toFormat) {
    if (constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY === formatFrom ||
      0 !== (constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET & formatFrom)) {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET;
    } else if (constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY === formatFrom ||
      0 !== (constants.AVS_OFFICESTUDIO_FILE_PRESENTATION & formatFrom)) {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION;
    } else {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD;
    }
  } else if (constants.AVS_OFFICESTUDIO_FILE_OTHER_TEAMLAB_INNER === toFormat) {
    if (constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET === formatFrom ||
      constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY === formatFrom ||
      0 !== (constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET & formatFrom)) {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
    } else if (constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION === formatFrom ||
      constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY === formatFrom ||
      0 !== (constants.AVS_OFFICESTUDIO_FILE_PRESENTATION & formatFrom)) {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
    } else {
      toFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
    }
    var fileTo = dataConvert.fileTo;
    var ext = path.extname(fileTo);
    var fileToWithoutExt = fileTo.substring(0, fileTo.length - ext.length);
    dataConvert.fileTo = fileToWithoutExt + '.' + formatChecker.getStringFromFormat(toFormat);
  }
  dataConvert.formatTo = toFormat;
}
function* processUploadToStorage(dir, storagePath) {
  var list = yield utils.listObjects(dir);
  yield Promise.all(list.map(function(curValue) {
    var data = fs.readFileSync(curValue);
    var localValue = storagePath + '/' + curValue.substring(dir.length + 1);
    return storage.putObject(localValue, data, data.length);
  }));
}

function* postProcess(cmd, dataConvert, tempDirs, childRes, error) {
  var exitCode = childRes ? childRes.status : 0;
  var exitSignal = childRes ? childRes.signal : null;
  if (0 !== exitCode || null !== exitSignal) {
    if (-constants.CONVERT_MS_OFFCRYPTO == exitCode) {
      error = constants.CONVERT_MS_OFFCRYPTO;
    } else if (-constants.CONVERT_CORRUPTED == exitCode) {
      error = constants.CONVERT_CORRUPTED;
    } else {
      error = constants.CONVERT;
    }
    if (cfgErrorFiles) {
      var errorFile = path.join(tempDirs.temp, 'error.txt');
      fs.appendFileSync(errorFile, 'returnCode:' + exitCode + ';signal:' + exitSignal +';error:' + error + '\r\n');
      if (childRes) {
        if (childRes.error) {
          fs.appendFileSync(errorFile, childRes.error.toString() + '\r\n');
        }
        fs.appendFileSync(errorFile, childRes.stdout);
        fs.appendFileSync(errorFile, childRes.stderr);
      }
      yield* processUploadToStorage(tempDirs.temp, cfgErrorFiles + '/' + dataConvert.key);
      logger.debug('processUploadToStorage error complete(id=%s)', dataConvert.key);
    }
  }
  if (constants.NO_ERROR === error || constants.CONVERT_CORRUPTED === error) {
    yield* processUploadToStorage(tempDirs.result, dataConvert.key);
    logger.debug('processUploadToStorage complete(id=%s)', dataConvert.key);
  }
  cmd.setStatusInfo(error);
  if (cmd.getSaveKey() && dataConvert.fileTo) {
    cmd.setTitle(path.basename(dataConvert.fileTo));
  }
  var res = new commonDefines.TaskQueueData();
  res.setCmd(cmd);
  logger.debug('output (data=%s;id=%s)', JSON.stringify(res), dataConvert.key);
  return res;
}
function deleteFolderRecursive(strPath) {
  if (fs.existsSync(strPath)) {
    var files = fs.readdirSync(strPath);
    files.forEach(function(file) {
      var curPath = path.join(strPath, file);
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(strPath);
  }
}

function* ExecuteTask(task) {
  var resData;
  var tempDirs;
  var getTaskTime = new Date();
  var cmd = task.getCmd();
  var dataConvert = new TaskQueueDataConvert(task);
  logger.debug('Start Task(id=%s)', dataConvert.key);
  var error = constants.NO_ERROR;
  tempDirs = getTempDir();
  dataConvert.fileTo = path.join(tempDirs.result, task.getToFile());
  if (cmd.getUrl()) {
    dataConvert.fileFrom = path.join(tempDirs.source, dataConvert.key + '.' + cmd.getFormat());
    try {
      yield* downloadFile(cmd.getUrl(), dataConvert.fileFrom);
      logger.debug('downloadFile(id=%s)', dataConvert.key);
    } catch (err) {
      error = constants.CONVERT_DOWNLOAD;
      logger.error(err);
    }
    if (constants.NO_ERROR === error) {
      error = processDownloadFile(dataConvert, cmd.format);
    }
  } else if (cmd.getSaveKey()) {
    yield* downloadFileFromStorage(cmd.getDocId(), cmd.getDocId(), tempDirs.source);
    logger.debug('downloadFileFromStorage complete(id=%s)', dataConvert.key);
    yield* processDownloadFromStorage(dataConvert, cmd, task, tempDirs);
  } else {
    error = constants.UNKNOWN;
  }
  var childRes = null;
  if (constants.NO_ERROR === error) {
    processInnerFormats(dataConvert);

    var paramsFile = path.join(tempDirs.temp, 'params.xml');
    dataConvert.serialize(paramsFile);
    var childArgs;
    if (cfgArgs.length > 0) {
      childArgs = cfgArgs.trim().replace(/  +/g, ' ').split(' ');
    } else {
      childArgs = [];
    }
    childArgs.push(paramsFile);
    var waitMS = (task.getVisibilityTimeout() || 600) * 1000 - (new Date().getTime() - getTaskTime.getTime());
    childRes = childProcess.spawnSync(cfgFilePath, childArgs, {timeout: waitMS});
    logger.debug('ExitCode (code=%d;signal=%s;id=%s)', childRes.status, childRes.signal, dataConvert.key);
  }
  resData = yield* postProcess(cmd, dataConvert, tempDirs, childRes, error);
  logger.debug('postProcess (id=%s)', dataConvert.key);
  if (tempDirs) {
    deleteFolderRecursive(tempDirs.temp);
    logger.debug('deleteFolderRecursive (id=%s)', dataConvert.key);
  }
  return resData;
}

function receiveTask(data, dataRaw) {
  utils.spawn(function* () {
    try {
      var task = new commonDefines.TaskQueueData(JSON.parse(data));
      if (task) {
        var res = yield* ExecuteTask(task);
        if (res) {
          yield queue.addResponse(res);
        }
      }
    } catch (err) {
      logger.error(err);
    } finally {
      try {
        yield queue.removeTask(dataRaw);
      } catch (err) {
        logger.error(err);
      }
    }
  });
}
function run() {
  queue = new queueService();
  queue.on('task', receiveTask);
  queue.init(false, true, true, false, function(err) {
    if (null != err) {
      logger.error('createTaskQueue error :\r\n%s', err.stack);
    }
  });
}
exports.run = run;
