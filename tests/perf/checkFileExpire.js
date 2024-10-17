/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const {
  createHistogram,
  performance,
  PerformanceObserver,
} = require('node:perf_hooks');

const co = require('co');
const taskResult = require('./../../DocService/sources/taskresult');
const storage = require('./../../Common/sources/storage-base');
const storageFs = require('./../../Common/sources/storage-fs');
const operationContext = require('./../../Common/sources/operationContext');
const utils = require('./../../Common/sources/utils');
const docsCoServer = require("./../../DocService/sources/DocsCoServer");
const gc = require("./../../DocService/sources/gc");

let ctx = operationContext.global;

let addRandomKeyTask;
let histograms = {};

async function beforeStart() {
  let timerify = function (func, name) {
    //todo remove anonymous functions. use func.name
    Object.defineProperty(func, 'name', {
      value: name
    });
    let histogram = createHistogram();
    histograms[func.name] = histogram;
    return performance.timerify(func, {histogram: histogram});
  }

  addRandomKeyTask = timerify(co.wrap(taskResult.addRandomKeyTask), "addRandomKeyTask");
  taskResult.getExpired = timerify(taskResult.getExpired, "getExpired");
  taskResult.remove = timerify(taskResult.remove, "remove");
  storage.putObject = timerify(storage.putObject, "putObject");
  storage.listObjects = timerify(storage.listObjects, "listObjects");
  storageFs.deletePath = timerify(storageFs.deletePath, "deletePath");
  storageFs.deleteObject = timerify(storageFs.deleteObject, "deleteObject");
  docsCoServer.getEditorsCountPromise = timerify(docsCoServer.getEditorsCountPromise, "getEditorsCountPromise");

  const obs = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    entries.forEach((entry) => {
      let duration = Math.round(entry.duration * 1000) / 1000;
      console.log(`${entry.name}:${duration}ms`);
    });
  });
  obs.observe({ entryTypes: ['function']});

  await docsCoServer.editorData.connect();
}

async function beforeEnd() {
  let logHistogram = function (histogram, name) {
    let mean = Math.round(histogram.mean / 1000) / 1000;
    let min = Math.round(histogram.min / 1000) / 1000;
    let max = Math.round(histogram.max / 1000) / 1000;
    let count = histogram.count;
    ctx.logger.info(`histogram ${name}: count=${count}, mean=${mean}ms, min=${min}ms, max=${max}ms`);
  }
  await utils.sleep(1000);
  for (let name in histograms) {
    logHistogram(histograms[name], name);
  }
}

async function addFileExpire(count, size, prefix, filesInFolder) {
  while (count > 0) {
    let task = await addRandomKeyTask(ctx, undefined, prefix, 8);
    let data = Buffer.alloc(size, 0);
    let rand = Math.floor(Math.random() * filesInFolder) + 1;
    for (let i = 0; i < rand && count > 0; i++) {
      await storage.putObject(ctx, `${task.key}/data${i}`, data, data.length);
      count--;
    }
  }
}

async function startTest() {
  let args = process.argv.slice(2);
  if (args.length < 4) {
    ctx.logger.error('missing arguments.USAGE: checkFileExpire.js [add-files-count] [file-size-bytes] [key-prefix] [seconds-to-expire]');
    return;
  }
  ctx.logger.info("test started");
  await beforeStart();

  await addFileExpire(parseInt(args[0]), parseInt(args[1]), args[2], parseInt(args[4] || 1));
  //delay to log observer events
  await utils.sleep(1000);
  await gc.checkFileExpire(args[3]);

  await beforeEnd();
  ctx.logger.info("test finished");
}

startTest().then(()=>{
  //delay to log observer events
  return utils.sleep(1000);
}).catch((err) => {
  ctx.logger.error(err.stack);
}).finally(() => {
  process.exit(0);
});
