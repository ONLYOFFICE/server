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
﻿'use strict';var config = require('config');var utils = require('./utils');var logger = require('./logger');var storage = require('./' + config.get('storage.name'));function getStoragePath(strPath) {  return strPath.replace(/\\/g, '/');}exports.getObject = function(strPath) {  return storage.getObject(getStoragePath(strPath));};exports.putObject = function(strPath, buffer, contentLength) {  return storage.putObject(getStoragePath(strPath), buffer, contentLength);};exports.listObjects = function(strPath) {  return storage.listObjects(getStoragePath(strPath)).catch(function(e) {    logger.error('storage.listObjects:\r\n%s', e.stack);    return [];  });};exports.deleteObject = function(strPath) {  return storage.deleteObject(getStoragePath(strPath));};exports.deleteObjects = function(strPaths) {  var StoragePaths = strPaths.map(function(curValue) {    return getStoragePath(curValue);  });  return storage.deleteObjects(StoragePaths);};exports.deletePath = function(strPath) {  return exports.listObjects(getStoragePath(strPath)).then(function(list) {    return exports.deleteObjects(list);  });};exports.getSignedUrl = function(baseUrl, strPath, optUrlExpires, optFilename) {  return storage.getSignedUrl(baseUrl, getStoragePath(strPath), optUrlExpires, optFilename);};exports.getSignedUrls = function(baseUrl, strPath, optUrlExpires) {  return exports.listObjects(getStoragePath(strPath)).then(function(list) {    return Promise.all(list.map(function(curValue) {      return exports.getSignedUrl(baseUrl, curValue, optUrlExpires);    })).then(function(urls) {      var outputMap = {};      for (var i = 0; i < list.length && i < urls.length; ++i) {        outputMap[exports.getRelativePath(strPath, list[i])] = urls[i];      }      return outputMap;    });  });};exports.getSignedUrlsByArray = function(baseUrl, list, optPath, optUrlExpires) {  return Promise.all(list.map(function(curValue) {    return exports.getSignedUrl(baseUrl, curValue, optUrlExpires);  })).then(function(urls) {    var outputMap = {};    for (var i = 0; i < list.length && i < urls.length; ++i) {      if (optPath) {        outputMap[exports.getRelativePath(optPath, list[i])] = urls[i];      } else {        outputMap[list[i]] = urls[i];      }    }    return outputMap;  });};exports.getRelativePath = function(strBase, strPath) {  return strPath.substring(strBase.length + 1);};