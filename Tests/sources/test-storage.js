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
var fs = require("fs");
var path = require("path");
var storage = require('./../../Common/sources/storage-base');
var utils = require('./../../Common/sources/utils');
var http = require('http');

utils.spawn(function *() {
  try {
    var filesDir = "../files";
    var testDir = "testDir";
    var randDirNames = ['1', '1/11', '1/11/111', '2', '2/22', '2/22/222', '3', '3/33' , '3/33/333'];
    var filesAll = fs.readdirSync(filesDir);
    var files = filesAll.filter(function(file) {
      var stats = fs.statSync(path.join(filesDir, file));
      if(stats.isDirectory()) {
        return false;
      }
      else {
        return true;
      }
    });
    var filePaths = [];
    var fileStoragePaths = [];

    //putObject
    for (var i = 0; i < files.length; ++i) {
      var file = files[i];
      var filePath = filesDir + "/" + file;
      var numberRand = Math.round(Math.random() * (randDirNames.length - 1));
      var storagePath = testDir + "/" + randDirNames[numberRand] + '/' + file;
      filePaths.push(filePath);
      fileStoragePaths.push(storagePath);
      var data = fs.readFileSync(filePath);
      yield storage.putObject(storagePath, data, data.length);
    }
    //overrride
    var data = fs.readFileSync(filePaths[0]);
    yield storage.putObject(fileStoragePaths[0], data, data.length);

    //getObject
    for (var i = 0; i < fileStoragePaths.length; ++i) {
      var strPath = fileStoragePaths[i];
      var data = yield storage.getObject(strPath);
      if (!data) {
        console.log(strPath);
      }
    }

    //listObjects
    var list = yield storage.listObjects(testDir);
    if (list.length != fileStoragePaths.length) {
      console.log(list);
    }

    //getSignedUrl
    for (var i = 0; i < fileStoragePaths.length; ++i) {
      var strPath = fileStoragePaths[i];
      var data = yield storage.getSignedUrl(strPath);
      if (!data) {
        console.log(strPath);
      }
    }
    //getSignedUrls
    var urls = yield storage.getSignedUrls(testDir);
    var count = 0;
    for(var i in urls) {
      count++;
    }
    if (count != fileStoragePaths.length) {
      console.log(urls);
    }
//    //download
//    http.get(urls[0], function(response) {
//      response.pipe(file);
//    }).on('error', function(e) {
//      console.log("Got error: " + e.message);
//    });

    //deleteObject
    var filePath = fileStoragePaths.pop();
    filePaths.pop();
    yield storage.deleteObject(filePath);

    //deleteObjects
    var deleteCount = Math.min(5, fileStoragePaths.length);
    var deleteFilePaths = fileStoragePaths.splice(0, deleteCount);
    filePaths.splice(0, deleteCount);
    yield storage.deleteObjects(deleteFilePaths);

//    //deleteObject
//    for (var i = 0; i < fileStoragePaths.length; ++i) {
//      var strPath = fileStoragePaths[i];
//      var data = yield storage.deleteObject(strPath);
//    }

    yield storage.deletePath(testDir);
  }
  catch (e) {
    console.log(e);
  }
});
