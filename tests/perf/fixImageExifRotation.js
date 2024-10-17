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

const { readdir, mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("path");
// const Jimp = require('Jimp');
const utils = require('./../../Common/sources/utils');
const operationContext = require('./../../Common/sources/operationContext');
const utilsDocService = require("./../../DocService/sources/utilsDocService");

let ctx = operationContext.global;

let histograms = {};

async function beforeStart() {
  let timerify = function (func) {
    let histogram = createHistogram();
    histograms[func.name] = histogram;
    return performance.timerify(func, {histogram: histogram});
  }
  utilsDocService.fixImageExifRotation = timerify(utilsDocService.fixImageExifRotation);
  // Jimp.read = timerify(Jimp.read);

  const obs = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    entries.forEach((entry) => {
      let duration = Math.round(entry.duration * 1000) / 1000;
      console.log(`${entry.name}:${duration}ms`);
    });
  });
  obs.observe({ entryTypes: ['function']});
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

async function fixInDir(dirIn, dirOut) {
  ctx.logger.info("dirIn:%s", dirIn);
  ctx.logger.info("dirOut:%s", dirOut);
  let dirents = await readdir(dirIn, {withFileTypes : true, recursive: true});
  for (let dirent of dirents) {
    if (dirent.isFile()) {
      let file = dirent.name;
      ctx.logger.info("fixInDir:%s", file);
      let buffer = await readFile(path.join(dirent.path, file));
      let bufferNew = await utilsDocService.fixImageExifRotation(ctx, buffer);
      if (buffer !== bufferNew) {
        let outputPath = path.join(dirOut, dirent.path.substring(dirIn.length), file);
        await mkdir(path.dirname(outputPath), {recursive: true});
        await writeFile(outputPath, bufferNew);
      }
    }
  }
}

async function startTest() {
  let args = process.argv.slice(2);
  if (args.length < 2) {
    ctx.logger.error('missing arguments.USAGE: fixImageExifRotation.js "dirIn" "dirOut"');
    return;
  }
  ctx.logger.info("test started");
  await beforeStart();


  await fixInDir(args[0], args[1]);

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
