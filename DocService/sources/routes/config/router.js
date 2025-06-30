const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const tenantManager = require('../../../../Common/sources/tenantManager');
const operationContext = require('../../../../Common/sources/operationContext');
const runtimeConfigManager = require('../../../../Common/sources/runtimeConfigManager');
const utils = require('../../../../Common/sources/utils');
const { getFilteredConfig, validate } = require('./config.service');

const router = express.Router();

const rawFileParser = bodyParser.raw(
    {inflate: true, limit: config.get('services.CoAuthoring.server.limits_tempfile_upload'), type: function() {return true;}});

router.get('/', async (req, res) => {
    let ctx = new operationContext.Context();
    try {
        ctx.initFromRequest(req);
        await ctx.initTenantCache();
        ctx.logger.debug('config get start');
        const filteredConfig = getFilteredConfig(ctx);
        res.setHeader('Content-Type', 'application/json');
        res.json(filteredConfig);
        ctx.logger.debug('Config get success');
    } catch (error) {
        ctx.logger.error('Config get error: %s', error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', rawFileParser, async (req, res) => {
    let ctx = new operationContext.Context();
    try {
        ctx.initFromRequest(req);
        await ctx.initTenantCache();
        const currentConfig = ctx.getFullCfg();
        const updateData = JSON.parse(req.body);
        
        const validationResult = validate(updateData, ctx);
        if (validationResult.error) {
            ctx.logger.error('Config save error: %s', validationResult.error);
            return res.status(400).json({
                error: validationResult.error
            });
        }

        const newConfig = utils.deepMergeObjects(currentConfig, validationResult.value);
        
        if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
            await tenantManager.setTenantConfig(ctx, newConfig);
        } else {
            await runtimeConfigManager.saveConfig(ctx, newConfig);
        }

        res.sendStatus(200);
    } catch (error) {
        ctx.logger.error('Configuration save error: %s', error.stack);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;