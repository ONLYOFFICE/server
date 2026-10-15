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

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const apicache = require('apicache');
const config = require('config');
const operationContext = require('../../../Common/sources/operationContext');

const router = express.Router();

const cfgDocumentFormatsFile = config.get('services.CoAuthoring.server.documentFormatsFile');
const cfgDocbuilderEnable = config.get('services.CoAuthoring.server.docbuilderEnable');
const cfgConvertServiceEnable = config.get('services.CoAuthoring.server.convertServiceEnable');

const LOCALE_SUBDIR = path.join('apps', 'documenteditor', 'main', 'locale');

let cachedLocales = null;

/**
 * Returns UI locale codes from documenteditor locale files, normalized to canonical BCP 47
 * via Intl.getCanonicalLocales. Cached for process lifetime.
 * @param {object} ctx - Operation context for logging
 * @param {string} webAppsPath - Resolved path to web-apps root
 * @returns {Promise<string[]>} Sorted canonical locale tags (e.g. ['de', 'en', 'ru', 'zh-CN'])
 */
async function getSupportedLocales(ctx, webAppsPath) {
  if (cachedLocales) return cachedLocales;
  const localeDir = path.resolve(webAppsPath, LOCALE_SUBDIR);
  try {
    const entries = await fs.readdir(localeDir, {withFileTypes: true});
    cachedLocales = entries
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(e => {
        const tag = path.basename(e.name, '.json');
        try {
          return Intl.getCanonicalLocales(tag)[0];
        } catch {
          ctx.logger.warn('getSupportedLocales: invalid BCP 47 locale tag in filename: %s', tag);
          return tag;
        }
      });
    cachedLocales.sort((a, b) => a.localeCompare(b));
    return cachedLocales;
  } catch {
    return [];
  }
}

/**
 * Returns supported document formats from JSON file
 * @route GET /meta/formats
 */
router.get('/formats', apicache.middleware('5 min'), async (req, res) => {
  if (cfgDocumentFormatsFile) {
    res.sendFile(path.resolve(cfgDocumentFormatsFile));
  } else {
    res.sendStatus(404);
  }
});

/**
 * Returns tenant-specific client configuration for document editor integration
 * @route GET /meta/config
 */
router.get('/config', async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();

    const webAppsPath = ctx.config?.services?.CoAuthoring?.server?.static_content?.['/web-apps']?.path;
    const langs = webAppsPath ? await getSupportedLocales(ctx, webAppsPath) : [];

    const convertServiceEnabled = !!ctx.getCfg('services.CoAuthoring.server.convertServiceEnable', cfgConvertServiceEnable);
    const docbuilderEnabled = !!ctx.getCfg('services.CoAuthoring.server.docbuilderEnable', cfgDocbuilderEnable);

    const clientConfig = {
      authorization: {
        header: ctx.config?.services?.CoAuthoring?.token?.inbox?.header,
        prefix: ctx.config?.services?.CoAuthoring?.token?.inbox?.prefix
      },
      urls: {
        api: `/web-apps/apps/api/documents/api.js`,
        command: `/command`
      },
      limits: {
        maxFileSize: ctx.config?.FileConverter?.converter?.maxDownloadBytes
      },
      langs
    };

    // discovery semantics: a url is advertised only while its api is enabled
    if (convertServiceEnabled) {
      clientConfig.urls.converter = `/converter`;
      clientConfig.urls.converterFromFile = `/converter/from-file`;
    }
    if (docbuilderEnabled) {
      clientConfig.urls.docbuilder = `/docbuilder`;
      clientConfig.urls.docbuilderFromFile = `/docbuilder/from-file`;
    }

    res.json(clientConfig);
  } catch (err) {
    ctx.logger.error('meta/config error: %s', err.stack);
    res.sendStatus(500);
  }
});

module.exports = router;
