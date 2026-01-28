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

/**
 * Simple auth middleware - validates JWT token from cookies
 * Use for routes that only need authentication check without tenant context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAuth = (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized'});
    }
    const decoded = jwt.verify(token, adminPanelJwtSecret);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({error: 'Unauthorized'});
  }
};

/**
 * Admin-only auth middleware - validates JWT and checks isAdmin flag
 * Builds on requireAuth, adds isAdmin check
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({error: 'Admin access required'});
    }
    next();
  });
};

module.exports = {
  validateJWT,
  requireAuth,
  requireAdmin
};
