'use strict';

const crypto = require('crypto');
const config = require('config');

//todo Need common secret in case of cluster deployment
const adminPanelJwtSecret = config.has('adminPanel.secret') ? config.get('adminPanel.secret') : crypto.randomBytes(64).toString('hex');

module.exports = adminPanelJwtSecret;
