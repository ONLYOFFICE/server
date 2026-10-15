/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
'use strict';

const cluster = require('cluster');
const moduleReloader = require('./../../Common/sources/moduleReloader');
const config = moduleReloader.requireConfigWithRuntime();
const logger = require('./../../Common/sources/logger');
const operationContext = require('./../../Common/sources/operationContext');
const runtimeConfigManager = require('./../../Common/sources/runtimeConfigManager');

if (cluster.isMaster) {
  const runtimeProfile = require('./../../Common/sources/runtime/profile');
  if (runtimeProfile.isMemoryRuntime()) {
    operationContext.global.logger.warn(
      'convertermaster: memory runtime detected - embedded converter runs inside DocService; no workers will be forked'
    );
    // Keep the process alive so the supervisor does not restart it.
    setInterval(() => {}, 86400000);
  } else {
    const fs = require('fs');
    const os = require('os');
    const license = require('./../../Common/sources/license');

    const {resolveConfigPath} = require('./../../Common/sources/pathUtils');
    const cfgLicenseFile = resolveConfigPath(config.get('license.license_file'));
    const cfgMaxProcessCount = config.get('FileConverter.converter.maxprocesscount');

    let workersCount = 0;
    const readLicense = async function () {
      const numCPUs = os.cpus().length;
      const availableParallelism = os.availableParallelism?.();
      operationContext.global.logger.warn('num of CPUs: %d; availableParallelism: %s', numCPUs, availableParallelism);
      workersCount = Math.ceil((availableParallelism || numCPUs) * cfgMaxProcessCount);
      const [licenseInfo] = await license.readLicense(cfgLicenseFile);
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
  }
} else {
  const converter = require('./converter');
  converter.run();
  //Initialize watch here to avoid circular import with operationContext
  runtimeConfigManager.initRuntimeConfigWatcher(operationContext.global).catch(err => {
    operationContext.global.logger.warn('initRuntimeConfigWatcher error: %s', err.stack);
  });
}

process.on('uncaughtException', err => {
  operationContext.global.logger.error(new Date().toUTCString() + ' uncaughtException:', err.message);
  operationContext.global.logger.error(err.stack);
  logger.shutdown(() => {
    process.exit(1);
  });
});

//after all required modules in all files
moduleReloader.finalizeConfigWithRuntime();
