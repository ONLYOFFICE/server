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

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const apicache = require('apicache');
const config = require('config');
const operationContext = require('../../../Common/sources/operationContext');

const router = express.Router();

const cfgDocumentFormatsFile = config.get('services.CoAuthoring.server.documentFormatsFile');

const LOCALE_SUBDIR = path.join('apps', 'documenteditor', 'main', 'locale');

let cachedLocales = null;

/**
 * Returns list of supported UI locale codes from documenteditor locale JSON files.
 * Result is cached for the lifetime of the process (locale files only change on product upgrade).
 * @param {string} webAppsPath - Resolved path to web-apps root
 * @returns {Promise<string[]>} Sorted list of locale codes (e.g. ['de', 'en', 'ru'])
 */
async function getSupportedLocales(webAppsPath) {
  if (cachedLocales) return cachedLocales;
  const localeDir = path.resolve(webAppsPath, LOCALE_SUBDIR);
  try {
    const entries = await fs.readdir(localeDir, {withFileTypes: true});
    cachedLocales = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => path.basename(e.name, '.json'));
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
    const langs = webAppsPath ? await getSupportedLocales(webAppsPath) : [];

    const clientConfig = {
      authorization: {
        header: ctx.config?.services?.CoAuthoring?.token?.inbox?.header,
        prefix: ctx.config?.services?.CoAuthoring?.token?.inbox?.prefix
      },
      urls: {
        api: `/web-apps/apps/api/documents/api.js`,
        command: `/command`,
        converter: `/converter`,
        docbuilder: `/docbuilder`
      },
      limits: {
        maxFileSize: ctx.config?.FileConverter?.converter?.maxDownloadBytes
      },
      langs
    };

    res.json(clientConfig);
  } catch (err) {
    ctx.logger.error('meta/config error: %s', err.stack);
    res.sendStatus(500);
  }
});

module.exports = router;
