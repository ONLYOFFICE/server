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
