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

import cluster from 'cluster';
import * as logger from './../../Common/sources/logger.js';
import * as operationContext from './../../Common/sources/operationContext.js';
import fs from 'fs';
import co from 'co';
import os from 'os';
import config from 'config';
import * as license from './../../Common/sources/license.js';
import * as converter from './converter.js';

if (cluster.isMaster) {
  const cfgLicenseFile = config.get('license.license_file');
  const cfgMaxProcessCount = config.get('FileConverter.converter.maxprocesscount');

  let workersCount = 0;
  const readLicense = async function () {
    const numCPUs = os.cpus().length;
    const availableParallelism = os.availableParallelism?.();
    operationContext.global.logger.warn('num of CPUs: %d; availableParallelism: %s', numCPUs, availableParallelism);
    workersCount = Math.ceil((availableParallelism || numCPUs) * cfgMaxProcessCount);
    let [licenseInfo] = await license.readLicense(cfgLicenseFile);
    workersCount = Math.min(licenseInfo.count, workersCount);
    //todo send license to workers for multi-tenancy
  };
  const updateWorkers = () => {
    let i;
    const arrKeyWorkers = Object.keys(cluster.workers);
    if (arrKeyWorkers.length < workersCount) {
      for (i = arrKeyWorkers.length; i < workersCount; ++i) {
        const newWorker = cluster.fork();
        operationContext.global.logger.warn('worker %s started.', newWorker.process.pid);
      }
    } else {
      for (i = workersCount; i < arrKeyWorkers.length; ++i) {
        const killWorker = cluster.workers[arrKeyWorkers[i]];
        if (killWorker) {
          killWorker.kill();
        }
      }
    }
  };
  const updateLicense = async () => {
    try {
      await readLicense();
      operationContext.global.logger.warn('update cluster with %s workers', workersCount);
      updateWorkers();
    } catch (err) {
      operationContext.global.logger.error('updateLicense error: %s', err.stack);
    }
  };

  cluster.on('exit', (worker, code, signal) => {
    operationContext.global.logger.warn('worker %s died (code = %s; signal = %s).', worker.process.pid, code, signal);
    updateWorkers();
  });

  updateLicense();

  fs.watchFile(cfgLicenseFile, updateLicense);
  setInterval(updateLicense, 86400000);
} else {
  converter.run();
}

process.on('uncaughtException', (err) => {
  operationContext.global.logger.error((new Date).toUTCString() + ' uncaughtException:', err.message);
  operationContext.global.logger.error(err.stack);
  logger.shutdown(() => {
    process.exit(1);
  });
});
