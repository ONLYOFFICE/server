'use strict';

const crypto = require('crypto');

//todo Need common secret in case of cluster deployment
// const config = require('config');
// const adminPanelJwtSecret = config.get('adminPanel.secret');

// Generate random JWT secret once for cluster deployment
const adminPanelJwtSecret = crypto.randomBytes(64).toString('hex');

module.exports = adminPanelJwtSecret;
