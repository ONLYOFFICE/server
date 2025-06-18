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

const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../Common/sources/tenantManager');
const operationContext = require('../../../Common/sources/operationContext');
const runtimeConfigManager = require('../../../Common/sources/runtimeConfigManager');

const router = express.Router();

const rawFileParser = bodyParser.raw(
    {inflate: true, limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'), type: function() {return true;}});

router.get('/', async (req, res) => {
  let ctx = new operationContext.Context();
  let result = '{}';
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();
    ctx.logger.debug('config get start');
    let cfg = ctx.getFullCfg();
    result = JSON.stringify(cfg);
  } catch (error) {
    ctx.logger.error('config get error: %s', error.stack);
  }
  finally {
    res.setHeader('Content-Type', 'application/json');
    res.send(result);
    ctx.logger.debug('config end');
  }
});

router.post('/', rawFileParser, async (req, res) => {
  let ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    await ctx.initTenantCache();

    let newConfig = JSON.parse(req.body);

    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      await tenantManager.setTenantConfig(ctx, newConfig);
    } else {
      await runtimeConfigManager.saveConfig(ctx, newConfig);
    }

    res.sendStatus(200);
  } catch (error) {
    ctx.logger.error('Configuration save error: %s', error.stack);
    res.status(500).json({
      error: 'Failed to save configuration',
      details: error.message
    });
  }
});


module.exports = router;
