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
const config = require('config');
const operationContext = require('../../../Common/sources/operationContext');
const utils = require('../../../Common/sources/utils');
const aiProxyHandler = require('../ai/aiProxyHandler');

const router = express.Router();

const cfgPluginsUri = 'services.CoAuthoring.plugins.uri';
const cfgPluginsAutostart = 'services.CoAuthoring.plugins.autostart';
const cfgStaticContent = 'services.CoAuthoring.server.static_content';

//plugin folders are served by the static content route, so the browser gets a config.json url relative to it
const PLUGINS_BASE_URL = '../../../..';

const isAiPlugin = guid => 'string' === typeof guid && aiProxyHandler.AI_PLUGIN_GUIDS.includes(guid.toLowerCase());

router.get('/', async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    if (!config.has(cfgStaticContent) || !config.has(cfgPluginsUri)) {
      res.sendStatus(404);
      return;
    }
    //the scan itself is cached in getInstalledPlugins and dropped by the plugins folder watcher
    let plugins = await utils.getInstalledPlugins();
    let autostart = config.get(cfgPluginsAutostart);
    //do not advertise the bundled AI Tools at all when ai is turned off for this tenant
    if (!aiProxyHandler.isAiEnabled(ctx)) {
      plugins = plugins.filter(plugin => !isAiPlugin(plugin.guid));
      autostart = Array.isArray(autostart) ? autostart.filter(guid => !isAiPlugin(guid)) : autostart;
    }
    const pluginsUri = config.get(cfgPluginsUri);
    const pluginsData = plugins.map(plugin => PLUGINS_BASE_URL + pluginsUri + '/' + plugin.name + '/config.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({url: '', pluginsData, autostart}));
  } catch (e) {
    ctx.logger.error('plugins.json error: %s', e.stack);
    res.sendStatus(404);
  }
});

module.exports = router;
