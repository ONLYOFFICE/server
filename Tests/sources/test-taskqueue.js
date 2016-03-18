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
var commonDefines  = require('./../../Common/sources/commondefines');
var taskQueue  = require('./../../Common/sources/taskqueue');
var config  = require('./../../Common/sources/config.json');
var utils  = require('./../../Common/sources/utils');

var task1 = new commonDefines.TaskQueueData();
task1.key = "1";
var task2 = new commonDefines.TaskQueueData();
task2.key = "2";
var task3 = new commonDefines.TaskQueueData();
task3.key = "3";
var task4 = new commonDefines.TaskQueueData();
task4.key = "4";

var res1;
var res2;
var res3;
var res4;
utils.spawn(function *() {
  try {
    var res;
    res = yield taskQueue.addTask(task1, constants.QUEUE_PRIORITY_LOW);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.addTask(task2, constants.QUEUE_PRIORITY_NORMAL);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.addTask(task3, constants.QUEUE_PRIORITY_RESPONSE);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.addTask(task4, constants.QUEUE_PRIORITY_HIGH);
    console.log(1 == res.affectedRows);

    res1 = yield taskQueue.getTask();
    console.log(task4.key == res1.key);

    res2 = yield taskQueue.getTaskResponse();
    console.log(task3.key == res2.key);

    res3 = yield taskQueue.getTask();
    console.log(task2.key == res3.key);

    res4 = yield taskQueue.getTask();
    console.log(task1.key == res4.key);

    var resnull = yield taskQueue.getTask();
    console.log(null == resnull);

    res = yield taskQueue.removeTask(res1.dataKey);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.removeTask(res2.dataKey);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.removeTask(res3.dataKey);
    console.log(1 == res.affectedRows);

    res = yield taskQueue.removeTask(res4.dataKey);
    console.log(1 == res.affectedRows);

    resnull = yield taskQueue.getTask();
    console.log(null == resnull);

    resnull = yield taskQueue.getTaskResponse();
    console.log(null == resnull);
  }
  catch(e) {
    console.log(e);
  }
});
