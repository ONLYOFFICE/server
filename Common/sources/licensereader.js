var fs = require('fs');
var crypto = require("crypto");
var utils = require('./utils');
var xmlParseString = require('xml2js').parseString;
var logger = require('./logger');
var config_server = require('config').get('services.CoAuthoring.server');

var cfgActiveconnectionsTrackingCleanupperiods = config_server.get('license_activeconnections_tracking_cleanupperiods');
var cfgActiveconnectionsTrackingInterval = config_server.get('license_activeconnections_tracking_interval');

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
ActiveConnectionsLicenseReader.prototype.getLicensesByTime = function(useTreshold) {
  var time = new Date();
  var res = [], item, startTime, endTime, endTimeTreshold;
  for (var i = 0; i < this._licenses.length; ++i) {
    item = this._licenses[i];
    startTime = item.getStartDate();
    endTime = item.getEndDate();
    endTimeTreshold = item.getEndDateThreshold();
    if ((startTime <= time) && (useTreshold ? (time <= endTimeTreshold) : (time <= endTime))) {
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
  var tresholdDate = this._licenses[0].getEndDateThreshold(), endDateTres;
  for (var i = 1; i < this._licenses.length; ++i) {
    endDateTres = this._licenses[i].getEndDateThreshold();

    if (tresholdDate < endDateTres)
      tresholdDate = endDateTres;
  }
  return tresholdDate;
};
ActiveConnectionsLicenseReader.prototype.getId = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getId();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomer = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomer();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerAddr = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomerAddr();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerWww = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomerWww();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerMail = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomerMail();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerInfo = function() {
  var res = null;

  var licenses = this.getLicensesByTime(false);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomerInfo();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCustomerLogo = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCustomerLogo();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getUserData = function() {
  var res = null;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
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
  if (0 < licenses.Count()) {
    res = licenses[0].getCanCoAuthoring();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getCanBranding = function() {
  var res = false;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getCanBranding();
  }

  return res;
};
ActiveConnectionsLicenseReader.prototype.getPermissions = function() {
  var res = EditorPermissions.PERMISSION_NONE;

  var licenses = this.getLicensesByTime(true);
  if (0 < licenses.Count()) {
    res = licenses[0].getPermissions();
  }

  return res;
};

function LicenseRights(bIsAllEnabled) {
  this._bCanOpen = true;
  this._bCanSave = true;
  this._bCanCoAuthoring = false;
  this._bCanExport = true;
  this._bCanPrint = true;
  this._bCanBranding = false;
  if (bIsAllEnabled) {
    this._bCanOpen = true;
    this._bCanSave = true;
    this._bCanCoAuthoring = true;
    this._bCanExport = true;
    this._bCanPrint = true;
    this._bCanBranding = true;
  }
}
function VKeyLicenseInfo() {
}
VKeyLicenseInfo.prototype.getRights = function() {
  errorCode = ErrorTypes.NoError;
  var oRights = new LicenseRights(true);
  // ToDo Affiliete
  return oRights;
};
VKeyLicenseInfo.prototype.read = function*(path) {
};

function ActiveConnectionLicenseInfo() {
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
ActiveConnectionLicenseInfo.prototype.track = function(userId, docId, isAlive) {
  this.trackInfo.track(userId, docId, isAlive);
};
ActiveConnectionLicenseInfo.prototype.getActiveUserCount = function() {
  return this.trackInfo.getActiveUserCount();
};
ActiveConnectionLicenseInfo.prototype.getInactiveUserCount = function() {
  return this.trackInfo.getInactiveUserCount();
};

function UserCountLicenseInfo() {
  UserCountLicenseInfo.superclass.constructor.apply(this, arguments);
}
extendClass(UserCountLicenseInfo, ActiveConnectionLicenseInfo);
UserCountLicenseInfo.prototype.track = function(userId, docId, isAlive) {
  this.trackInfo.track(userId, null, isAlive);
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

function TrackingValue() {
  this.inactiveTicks = 0;
  this.lastTrackingTime = new Date();
}
function TrackingDictionary() {
  this.dict = [];
  this.count = 0;
}
TrackingDictionary.prototype.add = function(key, value) {
  if (!this.dict.hasOwnProperty(key)) {
    ++this.count;
  }
  this.dict[key] = value;
};
TrackingDictionary.prototype.remove = function(key) {
  if (this.dict.hasOwnProperty(key)) {
    delete this.dict[key];
    --this.count;
  }
};
TrackingDictionary.prototype.removeOldItems = function(lastTime) {
  var newDict = [];
  var newCount = 0;
  if (null !== lastTime) {
    for (var i in this.dict) if (this.dict.hasOwnProperty(i)) {
      if (this.dict[i].lastTrackingTime > lastTime) {
        newDict[i] = this.dict[i];
        ++newCount;
      }
    }
  }
  if (this.count !== newCount) {
    this.dict = newDict;
    this.count = newCount;
  }
};
TrackingDictionary.prototype.getValue = function(key) {
  return this.dict[key];
};
TrackingDictionary.prototype.getCount = function() {
  return this.dict[key];
};

function BaseTrackingInfo() {
  this.oLastCleanupTime = new Date();

  this.license = null;

  this.activeUsers = new TrackingDictionary();
  this.inactiveUsers = new TrackingDictionary();
}
BaseTrackingInfo.prototype.setLicense = function(license) {
  this.license = license;
};
BaseTrackingInfo.prototype.getLicense = function() {
  return this.license;
};
BaseTrackingInfo.prototype.getActiveUserCount = function() {
  return this.activeUsers.getCount();
};
BaseTrackingInfo.prototype.getInactiveUserCount = function() {
  return this.inactiveUsers.getCount();
};
BaseTrackingInfo.prototype.track = function(userId, docId, isAlive) {
  if (null == userId)
    userId = '';

  if (null == docId)
    docId = '';

  var key = userId + docId;
  if ('' === key)
    key = 'empty';

  var value, now = new Date();
  if (0 === isAlive) {
    // inactive
    // find firstly in a list of inactive users
    if (value = this.inactiveUsers.getValue(key)) {
      // ok, this user/document is still inactive. update it state
      value.lastTrackingTime = now;
      ++value.inactiveTicks;
    } else {
      // this user/document pair is not exists in inactive list. may be it is a new user or
      // may be it is in a list of active user/dodcument pair
      if (value = this.activeUsers.getValue(key)) {
        // he is in active list
        // delete him from this list and insert into a inactive list
        this.activeUsers.remove(key);
      } else {
        // this is a new user
        value = new TrackingValue();
      }

      value.inactiveTicks = 1;
      value.lastTrackingTime = now;
      this.inactiveUsers.add(key, value);
    }
  } else {
    // active
    // find firstly in a list of active users
    if (value = this.activeUsers.getValue(key)) {
      // ok, this user/document is still inactive. update it state
      value.lastTrackingTime = now;
      value.inactiveTicks = 0;                // but it must be 0 anyway
    } else {
      // may be user/doc pair is inactive?
      if (value = this.inactiveUsers.getValue(key)) {
        // ok, let's move him to active list
        this.inactiveUsers.remove(key);
      } else {
        // create new
        value = new TrackingValue();
      }
      value.inactiveTicks = 0;
      value.lastTrackingTime = now;

      // there are no limitations for adding new users in 'track' method!
      this.activeUsers.add(key, value);
    }
  }

  // make cleanup (once per day)
  this.checkCleanUp(now);
};
BaseTrackingInfo.prototype.isQuotaExceed = function(userId, docId) {
  // no license, no quota
  if (null === this.license)
    return false;

  if (null == userId)
    userId = '';
  if (null == docId)
    docId = '';

  var count = this.getActiveUserCount();
  // ok anyway
  if (count < this.license.getUserQuota())
    return false;

  // quota is exeeded. try to find this user/document in active or inactive list
  var key = userId + docId;
  if ('' === key)
    key = 'empty';

  // if user/document is already exists in active list, return false.
  if (this.activeUsers.getValue(key))
    return false;
  // if user/document is already exists in inactive list, return false.
  if (this.inactiveUsers.getValue(key))
    return false;

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
BaseTrackingInfo.prototype.isLicenseDateTresholdExpired = function() {
  if (!this.license) {
    return true;
  }
  var now = new Date();
  var treshold = this.license.getEndDateThreshold();

  return now > treshold;
};
BaseTrackingInfo.prototype.checkCleanUp = function(now) {
  if (!now) {
    now = new Date();
  }
  now.setDate(now.getDate() - 1);
  if (now > this.oLastCleanupTime) {
    this.cleanup();
    this.oLastCleanupTime = now;
  }
};
BaseTrackingInfo.prototype.cleanup = function() {
  this.activeUsers.removeOldItems(null);
  this.inactiveUsers.removeOldItems(null);
};
function TrackingInfo() {
  TrackingInfo.superclass.constructor.apply(this, arguments);
  this.sdCleanupExpiredMinutes = 2.0;

  this._init();
}
extendClass(TrackingInfo, BaseTrackingInfo);
TrackingInfo.prototype._init = function() {
  var periods = cfgActiveconnectionsTrackingCleanupperiods || 2;
  var tracking_time = cfgActiveconnectionsTrackingInterval || 300;
  this.sdCleanupExpiredMinutes = periods * tracking_time / 60.0;
};
TrackingInfo.prototype.cleanup = function() {
  var active_count = this.getActiveUserCount();
  var inactive_count = this.getInactiveUserCount();
  var quota = (null === this.license) ? 2048 : this.license.getUserQuota();

  if (active_count >= (quota - 1)) {
    // cleanup active list
    this.cleanupTrackingDictionary(this.activeUsers);
  }
  if (inactive_count >= quota) {
    // cleanup inactive list
    this.cleanupTrackingDictionary(this.inactiveUsers);
  }
};
TrackingInfo.prototype.cleanupTrackingDictionary = function(dict) {
  var date = new Date();
  date.setMinutes(date.getMinutes() - this.sdCleanupExpiredMinutes);
  dict.removeOldItems(date);
};

function UserCount2TrackingInfo() {
  UserCount2TrackingInfo.superclass.constructor.apply(this, arguments);
}
extendClass(UserCount2TrackingInfo, BaseTrackingInfo);
UserCount2TrackingInfo.prototype.track = function(userId, docId, isAlive) {
  // don't use "docId" in ths scheme, 'isAlive' flag must be ignored
  return UserCount2TrackingInfo.superclass.track.call(this, userId, null, 1);
};
UserCount2TrackingInfo.prototype.isQuotaExceed = function(userId, docId) {
  // don't use "docId" in ths scheme
  return UserCount2TrackingInfo.superclass.isQuotaExceed.call(this, userId, null);
};

function* getLicenseFiles(path) {
  var res = [];
  var files = yield utils.listObjects(path);
  if (files) {
    for (var i = 0; i < files.length; ++i) {
      if (files[i].endsWith('.lic')) {
        res.push(files[i]);
      }
    }
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