'use strict';

const jwt = require('jsonwebtoken');
const operationContext = require('../../../../Common/sources/operationContext');
const adminPanelJwtSecret = require('../jwtSecret');

/**
 * JWT Authentication Middleware
 * Validates JWT token from cookies and initializes operation context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const validateJWT = async (req, res, next) => {
  const ctx = new operationContext.Context();
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized - No token provided'});
    }
    const decoded = jwt.verify(token, adminPanelJwtSecret);
    ctx.init(decoded.tenant);
    await ctx.initTenantCache();
    req.user = decoded;
    req.ctx = ctx;
    return next();
  } catch {
    return res.status(401).json({error: 'Unauthorized'});
  }
};

module.exports = {
  validateJWT
};
