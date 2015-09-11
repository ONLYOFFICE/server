var fs = require('fs');
var crypto = require("crypto");
var utils = require('./../../Common/sources/utils');
var xmlParseString = require('xml2js').parseString;
var logger = require('./../../Common/sources/logger');
var configCoAuthoring = require('config').get('services.CoAuthoring');
var config_server = configCoAuthoring.get('server');
var commonDefines = require('./../../Common/sources/commondefines');
var constants = require('./../../Common/sources/constants');

var cfgActiveConnectionsTrackingCleanupPeriods = config_server.get('license_activeconnections_tracking_cleanupperiods');
var cfgActiveConnectionsTrackingInterval = config_server.get('license_activeconnections_tracking_interval');

var redis = require(configCoAuthoring.get('redis.name'));
var cfgRedisPrefix = configCoAuthoring.get('redis.prefix');
var cfgRedisHost = configCoAuthoring.get('redis.host');
var cfgRedisPort = configCoAuthoring.get('redis.port');
var redisKeyLicense = cfgRedisPrefix + 'license';

var redisClient = redis.createClient(cfgRedisPort, cfgRedisHost, {});
redisClient.on('error', function(err) {
  logger.error('redisClient error:\r\n%s', err.stack);
});

function extendClass (Child, Parent) {
  var F = function() { };
  F.prototype = Parent.prototype;
  Child.prototype = new F();
  Child.prototype.constructor = Child;
  Child.superclass = Parent.prototype;
}

var Key = new Buffer([127, 61, 35, 56, 57, 12, 30, 62, 21, 76, 33, 0, 95, 81, 1, 14, 6, 91, 15, 26, 30, 16, 22, 0, 32, 36, 115, 21, 12, 2, 42, 17, 67, 111, 96, 38, 33, 81, 55, 30, 80, 33, 97, 21, 27, 51, 52, 0, 15, 82, 45, 69, 18, 61, 33, 7, 35, 59, 21, 90, 120, 53, 58, 3, 79, 119, 8, 92, 37, 74, 59, 3, 6, 60, 26, 39, 101, 4, 87, 35, 2, 25, 89, 14, 16, 105, 20, 40, 7, 54, 56, 95, 30, 1, 58, 22, 28, 36, 82, 2, 37, 48, 19, 95, 42, 12, 7, 97, 82, 0, 39, 67, 98, 28, 48, 3, 49, 63, 57, 72, 49, 43, 58, 4, 22, 49, 22, 55, 94, 50, 11, 25, 48, 27, 81, 37, 95, 53, 65, 24, 15, 11, 94, 35, 21, 42, 95, 41, 88, 40, 89, 25, 53, 95, 92, 72, 125, 29, 95, 37, 16, 70, 89, 0, 21, 20, 40, 54, 1, 28, 53, 120, 13, 0, 56, 55, 33, 94, 41, 1, 91, 116, 109, 84, 88, 59, 40, 24, 40, 84, 55, 87, 6, 107, 23, 36, 41, 30, 70, 27, 15, 35, 61, 2, 70, 15, 23, 44, 26, 81, 39, 64, 52, 79, 69, 39, 68, 20, 12, 65, 26, 86, 24, 76, 25, 2, 63, 52, 30, 24, 37, 87, 108, 50, 46, 27, 102, 89, 114, 4, 67, 25, 32, 45, 10, 7, 50, 48, 87, 121, 22, 6, 35, 40, 17, 80, 85, 124, 15, 2, 30, 20, 20, 30, 52, 42, 68, 22, 50, 35, 13, 10, 36, 20, 50, 66, 12, 33, 88, 28, 108, 44, 24, 62, 19, 101, 14, 85, 33, 53, 52, 73, 37, 85, 49, 43, 68, 32, 14, 81, 94, 38, 41, 68, 8, 16, 16, 43, 30, 48, 73, 54, 23, 8, 10, 32, 18, 47, 1, 41, 41, 1, 76, 16, 121, 57, 58, 16, 7, 80, 51, 56, 5, 30, 21, 63, 13, 50, 60, 65, 33, 32, 38, 107, 14, 8, 5, 15, 56, 70, 37, 45, 63, 82, 53, 4, 2, 33, 45, 37, 13, 1, 91, 62, 80, 19, 28, 110, 33, 3, 68, 39, 5, 18, 27, 74, 79, 101, 42, 21, 28, 11, 23, 24, 17, 90, 111, 18, 46, 50, 69, 93, 44, 31, 24, 27, 78, 49, 11, 21, 83, 112, 78, 48, 125, 34, 36, 8, 87, 118, 32, 0, 25, 69, 108]);

function symmetricDecrypt(data) {
  var decipher = crypto.createDecipheriv('aes-256-cbc', Key.slice(0, 32/*256/8*/), Key.slice(0, 16/*128/8*/));
  var result = decipher.update(data, null, 'utf8');
  result += decipher.final('utf8');
  return result;
}

function promiseXmlParseString(xmlDoc) {
  return new Promise(function(resolve, reject) {
    xmlParseString(xmlDoc, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

var LicenseType = {
  NoValidation: 0,           // no validation
  ByVKey: 1,                 // pure saas scheme
  ByTimeUsage: 4,            // counts the time of usage of the editor
  ByDocumentSessions: 5,     // counts sessions of editing
  OpenSource: 6,
  ByActiveConnectionsAWS: 8, // active connections (editing) only on AWS Instance
  ByUserCount: 2,            // number of users limitation
  ByActiveConnections: 3,    // active connections (editing)
  ByUserCount2: 7            // number of users limitation
};
var EditorPermissions = {
  PERMISSION_NONE: 0,    // 0000
  PERMISSION_WRITER: 1,    // 0001
  PERMISSION_SPREADSHEET: 2,    // 0010
  PERMISSION_PRESENTATION: 4,    // 0100
  PERMISSION_ALL: 1 | 2 | 4
};

function LicenseReaderBase() {
  this._id = '';

  this._license_type = '';
  this._path = '';

  this._startDate = null;
  this._endDate = null;
  this._endDateThreshold = null;

  this._customer = '';
  this._customer_id = '';
  this._customer_addr = '';
  this._customer_www = '';
  this._customer_mail = '';
  this._customer_info = '';
  this._customer_logo = '';

  this._correct = false;
  this._found = false;

  this._can_co_authoring = false;
  this._can_branding = false;

  this._permissions = EditorPermissions.PERMISSION_NONE;

  this._user_data = '';
}
LicenseReaderBase.prototype._fillMembersBase = function(xmlDocObj) {
  var res = false;
  try {
    var startElem = xmlDocObj['root']['teamlaboffice'][0];
    if (startElem) {
      this._startDate = startElem.hasOwnProperty('startdate') ? new Date(startElem['startdate'][0]) : null;
      this._endDate = startElem.hasOwnProperty('enddate') ? new Date(startElem['enddate'][0]) : null;
      this._id = startElem.hasOwnProperty('id') ? startElem['id'][0] : '';

      if (null === this._startDate || null === this._endDate || null === this._id) {
        return false;
      }

      this._endDateThreshold = startElem.hasOwnProperty('enddatethreshold') ? new Date(startElem['enddatethreshold'][0]) : null;
      this._customer = startElem.hasOwnProperty('customer') ? startElem['customer'][0] : '';
      this._customer_id = startElem.hasOwnProperty('customer_id') ? startElem['customer_id'][0] : '';
      this._customer_addr = startElem.hasOwnProperty('customer_addr') ? startElem['customer_addr'][0] : '';
      this._customer_www = startElem.hasOwnProperty('customer_www') ? startElem['customer_www'][0] : '';
      this._customer_mail = startElem.hasOwnProperty('customer_mail') ? startElem['customer_mail'][0] : '';
      this._customer_info = startElem.hasOwnProperty('customer_info') ? startElem['customer_info'][0] : '';
      this._customer_logo = startElem.hasOwnProperty('customer_logo') ? startElem['customer_logo'][0] : '';
      this._license_type = startElem.hasOwnProperty('lictype') ? startElem['lictype'][0] : '';
      this._can_co_authoring = startElem.hasOwnProperty('can_co_authoring') ? ('true' === startElem['can_co_authoring'][0].toLowerCase()) : '';
      this._can_branding = startElem.hasOwnProperty('can_branding') ? ('true' === startElem['can_branding'][0].toLowerCase()) : '';
      this._user_data = startElem.hasOwnProperty('user_data') ? startElem['user_data'][0] : '';

      if (startElem.hasOwnProperty('permissions')) {
        var permissions = startElem['permissions'][0].toLowerCase();
        this._permissions |= -1 !== permissions.indexOf('w') ? EditorPermissions.PERMISSION_WRITER : EditorPermissions.PERMISSION_NONE;
        this._permissions |= -1 !== permissions.indexOf('e') ? EditorPermissions.PERMISSION_SPREADSHEET : EditorPermissions.PERMISSION_NONE;
        this._permissions |= -1 !== permissions.indexOf('p') ? EditorPermissions.PERMISSION_PRESENTATION : EditorPermissions.PERMISSION_NONE;
      } else {
        this._permissions = EditorPermissions.PERMISSION_NONE;
      }

      if (null === this._endDateThreshold) {
        this._endDateThreshold = new Date(this._endDate);
        this._endDateThreshold.setMonth(this._endDateThreshold.getMonth() + 1);
      }

      res = true;
    }
  } catch (e) {
    logger.error('error init:\r\n%s', e.stack);
  }
  return res && this.fillMembers(xmlDocObj);
};
LicenseReaderBase.prototype.fillMembers = function(xmlDocObj) {
  return true;
};
LicenseReaderBase.prototype.read = function*(path) {
  try {
    this._path = path;
    var xmlDoc = symmetricDecrypt(fs.readFileSync(this._path));
    this._found = true;

    if (this._fillMembersBase(yield promiseXmlParseString(xmlDoc))) {
      this._correct = true;
    }
  } catch (e) {
    logger.error('error init:\r\n%s', e.stack);
  }
};
LicenseReaderBase.prototype.getStartDate = function() {
  return this._startDate;
};
LicenseReaderBase.prototype.getEndDate = function() {
  return this._endDate;
};
LicenseReaderBase.prototype.getEndDateThreshold = function() {
  return this._endDateThreshold;
};
LicenseReaderBase.prototype.getId = function() {
  return this._id;
};
LicenseReaderBase.prototype.getCustomer = function() {
  return this._customer;
};
LicenseReaderBase.prototype.getCustomerId = function() {
  return this._customer_id;
};
LicenseReaderBase.prototype.getCustomerAddr = function() {
  return this._customer_addr;
};
LicenseReaderBase.prototype.getCustomerWww = function() {
  return this._customer_www;
};
LicenseReaderBase.prototype.getCustomerMail = function(){
  return this._customer_mail;
};
LicenseReaderBase.prototype.getCustomerInfo = function(){
  return this._customer_info;
};
LicenseReaderBase.prototype.getCustomerLogo = function(){
  return this._customer_logo;
};
LicenseReaderBase.prototype.getUserData = function(){
  return this._user_data;
};
LicenseReaderBase.prototype.isLicenseFound = function(){
  return this._found;
};
LicenseReaderBase.prototype.isLicenseCorrect = function(){
  return this._correct;
};
LicenseReaderBase.prototype.getPermissions = function(){
  return this._permissions;
};
LicenseReaderBase.prototype.getCanCoAuthoring = function(){
  return this._can_co_authoring;
};
LicenseReaderBase.prototype.getCanBranding = function(){
  return this._can_branding;
};

function ActiveConnectionsLicenseReaderSingle() {
  ActiveConnectionsLicenseReaderSingle.superclass.constructor.apply(this, arguments);
  this._quota = 0;
}
extendClass(ActiveConnectionsLicenseReaderSingle, LicenseReaderBase);
ActiveConnectionsLicenseReaderSingle.prototype.fillMembers = function(xmlDocObj) {
  var res = false;
  try {
    var startElem = xmlDocObj['root']['teamlaboffice'][0];
    if (startElem) {
      this._quota = startElem.hasOwnProperty('connectionquota') ? (startElem['connectionquota'][0]>>0) : null;
      res = true;
    }
  } catch (e) {
    logger.error('error init:\r\n%s', e.stack);
  }
  return res;
};
ActiveConnectionsLicenseReaderSingle.prototype.getUserQuota = function() {
  return this._quota;
};

function ActiveConnectionsLicenseReader() {
  this._licenses = [];
  this._correct = false;
}
ActiveConnectionsLicenseReader.prototype.createSingleFileReader = function*(path) {
  var res = new ActiveConnectionsLicenseReaderSingle();
  yield* res.read(path);
  return res;
};
ActiveConnectionsLicenseReader.prototype.read = function*(path) {
  var files = yield* getLicenseFiles(path);
  for (var i = 0; i < files.length; ++i) {
    var item = yield* this.createSingleFileReader(files[i]);
    if (item.isLicenseFound() && item.isLicenseCorrect()) {
      this._licenses.push(item);
    }
  }
  this._correct = (0 < this._licenses.length);
};
ActiveConnectionsLicenseReader.prototype.getLicensesByTime = function(useThreshold) {
  var time = new Date();
  var res = [], item, startTime, endTime, endTimeThreshold;
  for (var i = 0; i < this._licenses.length; ++i) {
    item = this._licenses[i];
    startTime = item.getStartDate();
    endTime = item.getEndDate();
    endTimeThreshold = item.getEndDateThreshold();
    if ((startTime <= time) && (useThreshold ? (time <= endTimeThreshold) : (time <= endTime))) {
      res.push(item);
    }
  }
  return res;
};
ActiveConnectionsLicenseReader.prototype.getStartDate = function() {
  if (!this.isLicenseCorrect())
    return null;
  var minDate = this._licenses[0].getStartDate(), startDate;
  for (var i = 1; i < this._licenses.length; ++i) {
    startDate = this._licenses[i].getStartDate();

    if (minDate > startDate)
      minDate = startDate;
  }
  return minDate;
};
ActiveConnectionsLicenseReader.prototype.getEndDate = function() {
  if (!this.isLicenseCorrect())
    return null;
  var maxDate = this._licenses[0].getEndDate(), endDate;
  for (var i = 1; i < this._licenses.length; ++i) {
    endDate = this._licenses[i].getEndDate();

    if (maxDate < endDate)
      maxDate = endDate;
  }
  return maxDate;
};
ActiveConnectionsLicenseReader.prototype.getEndDateThreshold = function() {
  if (!this.isLicenseCorrect())
    return null;
  var thresholdDate = this._licenses[0].getEndDateThreshold(), endDateThreshold;
  for (var i = 1; i < this._licenses.length; ++i) {
    endDateThreshold = this._licenses[i].getEndDateThreshold();

    if (thresholdDate < endDateThreshold)
      thresholdDate = endDateThreshold;
  }
  return thresholdDate;
};
ActiveConnectionsLicenseReader.prototype.getId = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getId();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomer = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomer();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerId = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerId();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerAddr = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerAddr();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerWww = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerWww();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerMail = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerMail();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerInfo = function() {
  var res = null;

  var licenses = this.getLicensesByTime(false);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerInfo();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerLogo = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCustomerLogo();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getUserData = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getUserData();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.isLicenseFound = function() {
  return this._correct;
};
ActiveConnectionsLicenseReader.prototype.isLicenseCorrect = function() {
  return this._correct;
};
ActiveConnectionsLicenseReader.prototype.getUserQuota = function() {
  var res = false;
  var bHasLicense = false;

  var licenses = this.getLicensesByTime(true);
  for (var i = 0; i < licenses.length; ++i) {
    res += licenses[i].getUserQuota();
    bHasLicense = true;
  }
  if (!bHasLicense) {
    res = 100000;    // no limit connections (limit coAuthoring = false)
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCanCoAuthoring = function() {
  var res = false;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCanCoAuthoring();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCanBranding = function() {
  var res = false;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getCanBranding();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getPermissions = function() {
  var res = EditorPermissions.PERMISSION_NONE;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.length) {
    res = licenses[0].getPermissions();
  }

  return res;
};

function LicenseMetaData() {
  this.vkey = '';
  this.docId = '';
  this.userId = '';
  this.checkIP = false;
  this.currentIP = '';
  this.editorId = -1;
}
LicenseMetaData.prototype.init = function(vkey, docId, userId, editorId) {
  this.vkey = vkey;

  this.docId = docId;
  if (null == this.docId || '' === this.docId)
    this.docId = 'doc';

  this.userId = userId;
  if (null == this.userId || '' === this.userId)
    this.userId = 'usr';

  this.editorId = editorId;
};
function LicenseRights(bIsAllEnabled) {
  this.canOpen = true;
  this.canSave = true;
  this.canCoAuthoring = false;
  this.canExport = true;
  this.canPrint = true;
  this.canBranding = false;
  if (bIsAllEnabled) {
    this.enableAll();
  }
}
LicenseRights.prototype.enableAll = function() {
  this.canOpen = true;
  this.canSave = true;
  this.canCoAuthoring = true;
  this.canExport = true;
  this.canPrint = true;
  this.canBranding = true;
};

function BaseTrackingInfo() {
  this.oLastCleanupTime = new Date();

  this.license = null;
}
BaseTrackingInfo.prototype.setLicense = function(license) {
  this.license = license;
};
BaseTrackingInfo.prototype.getLicense = function() {
  return this.license;
};
BaseTrackingInfo.prototype.getActiveUserCount = function*() {
  return yield utils.promiseRedis(redisClient, redisClient.hlen, redisKeyLicense);
};
BaseTrackingInfo.prototype.track = function*(userId, docId, isAlive) {
  if (null == userId) {
    userId = '';
  }
  if (null == docId) {
    docId = '';
  }

  var key = userId + docId;
  if ('' === key) {
    key = 'empty';
  }

  var now = new Date();
  if (!isAlive) {
    // inactive
    yield* this.cleanup();
  } else {
    // active
    yield utils.promiseRedis(redisClient, redisClient.hset, redisKeyLicense, key, now.getTime());
  }

  // make cleanup (once per day)
  yield* this.checkCleanUp(now);
};
BaseTrackingInfo.prototype.isQuotaExceed = function*(userId, docId) {
  // no license, no quota
  if (null === this.license) {
    return false;
  }

  if (null == userId) {
    userId = '';
  }
  if (null == docId) {
    docId = '';
  }

  var count = yield* this.getActiveUserCount();
  // ok anyway
  if (count < this.license.getUserQuota()) {
    return false;
  }

  // quota is exeeded. try to find this user/document in active or inactive list
  var key = userId + docId;
  if ('' === key) {
    key = 'empty';
  }

  if (yield utils.promiseRedis(redisClient, redisClient.hexists, redisKeyLicense, key)) {
    return false;
  }

  // the quota is exceeded
  return true;
};
BaseTrackingInfo.prototype.isLicenseFileValid = function() {
  return (null != this.license
    && this.license.isLicenseFound()
    && this.license.isLicenseCorrect());
};
BaseTrackingInfo.prototype.isLicenseDateValid = function() {
  if (!this.license) {
    return false;
  }
  var now = new Date();

  var start = this.license.getStartDate();
  var end = this.license.getEndDate();
  return (start < now && end > now);
};
BaseTrackingInfo.prototype.isLicenseEndDateGreater = function(time) {
  if (!this.license) {
    return false;
  }
  var end = this.license.getEndDate();
  return end > time;
};
BaseTrackingInfo.prototype.isLicenseDateThresholdExpired = function() {
  if (!this.license) {
    return true;
  }
  var now = new Date();
  var threshold = this.license.getEndDateThreshold();

  return now > threshold;
};
BaseTrackingInfo.prototype.getPermissions = function() {
  return this.license ? this.license.getPermissions() : EditorPermissions.PERMISSION_NONE;
};
BaseTrackingInfo.prototype.checkCleanUp = function*(now) {
  if (!now) {
    now = new Date();
  }
  now.setDate(now.getDate() - 1);
  if (now > this.oLastCleanupTime) {
    yield* this.cleanup();
    this.oLastCleanupTime = now;
  }
};
BaseTrackingInfo.prototype.removeByTime = function*(time) {
  logger.debug('removeByTime fields');
  var oAllFields = yield utils.promiseRedis(redisClient, redisClient.hgetall, redisKeyLicense);
  var arrToRemove = [];
  if (oAllFields) {
    for (var i in oAllFields) if (oAllFields.hasOwnProperty(i)) {
      if ((oAllFields[i] >> 0) <= time)
        arrToRemove.push(i);
    }
    if (0 < arrToRemove.length) {
      logger.debug(arrToRemove);
      arrToRemove.unshift(redisClient, redisClient.hdel, redisKeyLicense);
      yield utils.promiseRedis.apply(this, arrToRemove);
    }
  }
};
BaseTrackingInfo.prototype.cleanup = function*() {
  yield* this.removeByTime(Number.MAX_VALUE);
};
function TrackingInfo() {
  TrackingInfo.superclass.constructor.apply(this, arguments);
  this.sdCleanupExpiredMinutes = 2.0;

  this._init();
}
extendClass(TrackingInfo, BaseTrackingInfo);
TrackingInfo.prototype._init = function() {
  var periods = cfgActiveConnectionsTrackingCleanupPeriods || 2;
  var tracking_time = cfgActiveConnectionsTrackingInterval || 300;
  this.sdCleanupExpiredMinutes = periods * tracking_time / 60.0;
};
TrackingInfo.prototype.cleanup = function*() {
  var active_count = yield* this.getActiveUserCount();
  var quota = (null === this.license) ? 2048 : this.license.getUserQuota();

  if (active_count >= (quota - 1)) {
    // cleanup active list
    var date = new Date();
    date.setMinutes(date.getMinutes() - this.sdCleanupExpiredMinutes);
    yield* this.removeByTime(date.getTime());
  }
};

function UserCount2TrackingInfo() {
  UserCount2TrackingInfo.superclass.constructor.apply(this, arguments);
}
extendClass(UserCount2TrackingInfo, BaseTrackingInfo);
UserCount2TrackingInfo.prototype.track = function*(userId, docId, isAlive) {
  // don't use "docId" in ths scheme, 'isAlive' flag must be ignored
  return yield* UserCount2TrackingInfo.superclass.track.call(this, userId, null, true);
};
UserCount2TrackingInfo.prototype.isQuotaExceed = function*(userId, docId) {
  // don't use "docId" in ths scheme
  return yield* UserCount2TrackingInfo.superclass.isQuotaExceed.call(this, userId, null);
};

function VKeyLicenseInfo() {
}
VKeyLicenseInfo.prototype.getRights = function() {
  // ToDo Affiliete
  return new LicenseRights(true);
};
VKeyLicenseInfo.prototype.read = function*(path) {
};

function ActiveConnectionLicenseInfo() {
  this.m_dtBuildTime = new Date(); //ToDo возможно стоит от этого отказаться

  this.trackInfo = this.createTrackingInfo();
}
ActiveConnectionLicenseInfo.prototype.read = function*(path) {
  // set license reader
  this.trackInfo.setLicense(yield* this.createLicenseReader(path));
};
ActiveConnectionLicenseInfo.prototype.createLicenseReader = function*(path) {
  var res = new ActiveConnectionsLicenseReader();
  yield* res.read(path);
  return res;
};
ActiveConnectionLicenseInfo.prototype.createTrackingInfo = function() {
  return new TrackingInfo();
};
ActiveConnectionLicenseInfo.prototype.track = function*(userId, docId, isAlive) {
  yield* this.trackInfo.track(userId, docId, isAlive);
};
ActiveConnectionLicenseInfo.prototype.getActiveUserCount = function*() {
  return yield* this.trackInfo.getActiveUserCount();
};
ActiveConnectionLicenseInfo.prototype.getRights = function*(oLicenseMetaData) {
  var result = new commonDefines.ErrorWithResult();
  var oRights = result.data = new LicenseRights();

  if (!this.trackInfo.isLicenseFileValid()) {
    result.errorCode = constants.LICENSE_ERROR_FILE;

    // we have to allow editing in demo mode
    // we must verify only quota.
    // don't verify dates, build time, editor permissions

    // check connections quota
    if (yield* this.checkQuotaExceeded(oLicenseMetaData)) {
      result.errorCode = constants.LICENSE_ERROR_ACTIVE_CONNECTION_QUOTA_EXCEED;
    } else {
      oRights.canSave = true;
      oRights.canCoAuthoring = false;
      oRights.canExport = true;
    }
    return result;
  }

  // license file is valid, we have to work with license scheme
  var bValidDate = false;

  // check dates
  if (this.trackInfo.isLicenseDateValid()) {
    // valid date
    bValidDate = true;
  } else {
    // license dates are invalid, check threshold

    result.errorCode = constants.LICENSE_ERROR_INVALID_DATE;

    if (!this.trackInfo.isLicenseDateThresholdExpired()) {
      bValidDate = true;
    }
  }

  // check build time (it must be lower than license end time)
  var bBuildTimeValid = this.trackInfo.isLicenseEndDateGreater(this.m_dtBuildTime);
  var bQuotaExceed = true;
  var bEditorAllowed = false;

  var permissions = this.trackInfo.getPermissions();
  if (oLicenseMetaData.editorId === constants.EDITOR_TYPE_CONVERTATION
    && permissions !== EditorPermissions.PERMISSION_NONE) {
    // if ConvertService.ashx or FileUploader.ashx are used don't check quota
    bQuotaExceed = false;
    bEditorAllowed = true;
  } else {
    // check connections quota
    bQuotaExceed = yield* this.checkQuotaExceeded(oLicenseMetaData);
    if (bQuotaExceed) {
      result.errorCode = constants.LICENSE_ERROR_ACTIVE_CONNECTION_QUOTA_EXCEED;
    }

    // check editor id and permissions
    if ((oLicenseMetaData.editorId === constants.EDITOR_TYPE_WORD && 0 !== (permissions & EditorPermissions.PERMISSION_WRITER))
      || (oLicenseMetaData.editorId === constants.EDITOR_TYPE_SPREADSHEET && 0 !== (permissions & EditorPermissions.PERMISSION_SPREADSHEET))
      || (oLicenseMetaData.editorId === constants.EDITOR_TYPE_PRESENTATION && 0 !== (permissions & EditorPermissions.PERMISSION_PRESENTATION))) {
      // editor usage is allowed by license.
      bEditorAllowed = true;
    } else {
      // editor usage is not allowed by license
    }
  }

  // set up rights
  //oRights.CanBranding = oLicense.getCanBranding(); ToDo убрали взятие из лицензии. Теперь если есть лицензия, то разрешаем. Нет - без лицензии.
  oRights.canBranding = true;
  if (bValidDate && bEditorAllowed && !bQuotaExceed && bBuildTimeValid) {
    oRights.canSave = true;
    oRights.canExport = true;
    oRights.canCoAuthoring = true;
  }
  return result;
};
ActiveConnectionLicenseInfo.prototype.checkQuotaExceeded = function*(oLicenseMetaData) {
  var userId = this.getUserId(oLicenseMetaData);
  var documentId = this.getDocumentId(oLicenseMetaData);
  var bQuotaExceed = yield* this.trackInfo.isQuotaExceed(userId, documentId);

  if (bQuotaExceed) {
    // cleare lists of inactive users
    yield* this.trackInfo.cleanup();
    bQuotaExceed = yield* this.trackInfo.isQuotaExceed(userId, documentId);
  }

  return bQuotaExceed;
};
ActiveConnectionLicenseInfo.prototype.getUserId = function(oLicenseMetaData) {
  return oLicenseMetaData.userId;
};
ActiveConnectionLicenseInfo.prototype.getDocumentId = function(oLicenseMetaData) {
  return oLicenseMetaData.docId;
};

function UserCountLicenseInfo() {
  UserCountLicenseInfo.superclass.constructor.apply(this, arguments);
}
extendClass(UserCountLicenseInfo, ActiveConnectionLicenseInfo);
UserCountLicenseInfo.prototype.track = function*(userId, docId, isAlive) {
  yield* this.trackInfo.track(userId, null, isAlive);
};
ActiveConnectionLicenseInfo.prototype.getDocumentId = function(oLicenseMetaData) {
  return '';
};

function UserCount2LicenseInfo() {
  UserCount2LicenseInfo.superclass.constructor.apply(this, arguments);
}
extendClass(UserCount2LicenseInfo, UserCountLicenseInfo);
UserCount2LicenseInfo.prototype.createTrackingInfo = function() {
  return new UserCount2TrackingInfo();
};

function MockLicenseInfo() {
  // ToDo
}
function DocumentSessionLicenseInfo() {
  // ToDo
}
function ActiveConnectionAWSLicenseInfo() {
  // ToDo
}

function* getLicenseFiles(path) {
  var res = [];
  try {
    var files = yield utils.listObjects(path);
    if (files) {
      for (var i = 0; i < files.length; ++i) {
        if (files[i].endsWith('.lic')) {
          res.push(files[i]);
        }
      }
    }
  } catch (e) {
    logger.error('error getLicenseFiles:\r\n%s', e.stack);
  }
  return res;
}
function* getLicenseSimple(path) {
  var res = null;
  var files = yield* getLicenseFiles(path);
  if (0 < files.length) {
    res = new LicenseReaderBase();
    yield* res.read(files[0]);
  }
  return res;
}
function* getLicenseType(path) {
  var res = LicenseType.ByUserCount2;
  var oLicSimple;
  if ("VKEY" === path) {
    res = LicenseType.ByVKey;
  } else if (null !== (oLicSimple = yield* getLicenseSimple(path)) && oLicSimple.isLicenseFound() && oLicSimple.isLicenseCorrect()) {
    if (oLicSimple._license_type === "ActiveConnections")
      oLicenseType = LicenseType.ByActiveConnections;
    else if (oLicSimple._license_type === "UserCount")
      oLicenseType = LicenseType.ByUserCount;
    else if (oLicSimple._license_type === "UserCount2")
      oLicenseType = LicenseType.ByUserCount2;
    else if (oLicSimple._license_type === "DocumentSessions")
      oLicenseType = LicenseType.ByDocumentSessions;
    else if (oLicSimple._license_type === "ActiveConnectionsAWS")
      oLicenseType = LicenseType.ByActiveConnectionsAWS;
  }
  return res;
}

function* createLicenseInfo(path) {
  var lic = null;
  var oLicType = yield* getLicenseType(path);
  switch (oLicType) {
    case LicenseType.ByVKey:    // 1
      lic = new VKeyLicenseInfo();
      break;
    case LicenseType.ByDocumentSessions:    // 5
      lic = new DocumentSessionLicenseInfo();
      break;
    case LicenseType.ByActiveConnectionsAWS:    // 8
      lic = new ActiveConnectionAWSLicenseInfo();
      break;
    case LicenseType.ByUserCount:   // 2
      lic = new UserCountLicenseInfo();
      break;
    case LicenseType.ByActiveConnections:   // 3
      lic = new ActiveConnectionLicenseInfo();
      break;
    case LicenseType.ByUserCount2:    // 7
    default:
      lic = new UserCount2LicenseInfo();
      break;
  }
  if (lic) {
    yield* lic.read(path);
  }
  return lic;
}

exports.createLicenseInfo = createLicenseInfo;
exports.getLicenseType = getLicenseType;
exports.LicenseType = LicenseType;
exports.LicenseMetaData = LicenseMetaData;