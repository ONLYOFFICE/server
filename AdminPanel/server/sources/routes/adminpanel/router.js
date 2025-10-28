'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const operationContext = require('../../../../../Common/sources/operationContext');
const passwordManager = require('../../passwordManager');
const bootstrap = require('../../bootstrap');
const adminPanelJwtSecret = require('../../jwtSecret');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const commonDefines = require('../../../../../Common/sources/commondefines');

const router = express.Router();

router.use(express.json());
router.use(cookieParser());

/**
 * Create session cookie with standard options
 * @param {import('express').Response} res - Express response
 * @param {import('express').Request} req - Express request
 * @param {string} token - JWT token
 */
function setAuthCookie(res, req, token) {
  res.cookie('accessToken', token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000,
    path: '/'
  });
}

/**
 * Middleware to verify JWT token
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Next middleware
 */
function requireAuth(req, res, next) {
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
}

/**
 * Check if AdminPanel setup is required
 */
router.get('/setup/required', async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);
    const setupRequired = await passwordManager.isSetupRequired(ctx);

    // If setup required but no valid code, generate new one (lazy generation)
    if (setupRequired) {
      const hasCode = bootstrap.hasValidBootstrapToken();
      if (!hasCode) {
        const {code, expiresAt} = await bootstrap.generateBootstrapToken(ctx);
        ctx.logger.warn('Bootstrap code generated on demand | Code: ' + code + ' | Expires: ' + expiresAt.toISOString());
      }
    }

    res.json({setupRequired});
  } catch (error) {
    ctx.logger.error('Setup check error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

/**
 * Complete initial setup with password
 * Requires valid bootstrap token
 */
router.post('/setup', async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);

    const setupRequired = await passwordManager.isSetupRequired(ctx);
    if (!setupRequired) {
      return res.status(400).json({error: 'Setup already completed'});
    }

    const {bootstrapToken, password} = req.body;

    // Verify bootstrap token
    if (!bootstrapToken) {
      return res.status(400).json({error: 'Bootstrap token is required'});
    }

    const tokenValid = await bootstrap.verifyBootstrapToken(ctx, bootstrapToken);
    if (!tokenValid) {
      ctx.logger.warn('Invalid or expired bootstrap token attempt');
      return res.status(401).json({error: 'Invalid or expired bootstrap token'});
    }

    if (!password) {
      return res.status(400).json({error: 'Password is required'});
    }

    if (password.length < passwordManager.PASSWORD_MIN_LENGTH) {
      return res.status(400).json({error: `Password must be at least ${passwordManager.PASSWORD_MIN_LENGTH} characters long`});
    }

    if (password.length > passwordManager.PASSWORD_MAX_LENGTH) {
      return res.status(400).json({error: `Password must not exceed ${passwordManager.PASSWORD_MAX_LENGTH} characters`});
    }

    await passwordManager.saveAdminPassword(ctx, password);

    // Invalidate bootstrap token after successful setup
    await bootstrap.invalidateBootstrapToken(ctx);

    const token = jwt.sign({tenant: 'localhost', isAdmin: true}, adminPanelJwtSecret, {expiresIn: '1h'});
    setAuthCookie(res, req, token);

    ctx.logger.info('AdminPanel setup completed successfully');
    res.json({message: 'Setup completed successfully'});
  } catch (error) {
    ctx.logger.error('Setup error: %s', error.stack);
    res.status(500).json({error: error.message || 'Internal server error'});
  }
});

/**
 * Change admin password
 */
router.post('/change-password', requireAuth, async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);

    const {currentPassword, newPassword} = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({error: 'Current password and new password are required'});
    }

    if (newPassword.length < passwordManager.PASSWORD_MIN_LENGTH) {
      return res.status(400).json({error: `Password must be at least ${passwordManager.PASSWORD_MIN_LENGTH} characters long`});
    }

    if (newPassword.length > passwordManager.PASSWORD_MAX_LENGTH) {
      return res.status(400).json({error: `Password must not exceed ${passwordManager.PASSWORD_MAX_LENGTH} characters`});
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({error: 'New password must be different from current password'});
    }

    const isValid = await passwordManager.verifyAdminPassword(ctx, currentPassword);
    if (!isValid) {
      return res.status(401).json({error: 'Current password is incorrect'});
    }

    await passwordManager.saveAdminPassword(ctx, newPassword);

    ctx.logger.info('AdminPanel password changed successfully');
    res.json({message: 'Password changed successfully'});
  } catch (error) {
    ctx.logger.error('Change password error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

router.get('/me', (req, res) => {
  try {
    const token = req.cookies?.accessToken;
    if (!token) {
      return res.json({authorized: false});
    }
    const decoded = jwt.verify(token, adminPanelJwtSecret);
    return res.json({authorized: true, ...decoded});
  } catch {
    return res.json({authorized: false});
  }
});

router.post('/login', async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);

    const setupRequired = await passwordManager.isSetupRequired(ctx);
    if (setupRequired) {
      return res.status(403).json({error: 'Setup required', setupRequired: true});
    }

    const {password} = req.body;
    if (!password) {
      return res.status(400).json({error: 'Password is required'});
    }

    const isValid = await passwordManager.verifyAdminPassword(ctx, password);
    if (!isValid) {
      ctx.logger.warn('Failed login attempt for AdminPanel');
      return res.status(401).json({error: 'Invalid password'});
    }

    const token = jwt.sign({tenant: 'localhost', isAdmin: true}, adminPanelJwtSecret, {expiresIn: '1h'});
    setAuthCookie(res, req, token);

    ctx.logger.info('AdminPanel login successful');
    res.json({tenant: 'localhost', isAdmin: true});
  } catch (error) {
    ctx.logger.error('Login error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/logout', async (req, res) => {
  try {
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/'
    });
    res.json({message: 'Logged out successfully'});
  } catch {
    res.status(500).json({error: 'Internal server error'});
  }
});

/**
 * Generate JWT token for Document Server requests
 */
router.post('/generate-docserver-token', requireAuth, async (req, res) => {
  const ctx = new operationContext.Context();
  try {
    ctx.initFromRequest(req);

    const body = req.body;

    const secret = await tenantManager.getTenantSecret(ctx, commonDefines.c_oAscSecretType.Inbox);

    if (!secret) {
      return res.status(500).json({error: 'JWT secret not configured'});
    }

    const tenTokenInboxAlgorithm = ctx.getCfg('services.CoAuthoring.token.inbox.algorithm', 'HS256');
    const tenTokenInboxExpires = ctx.getCfg('services.CoAuthoring.token.inbox.expires', '5m');

    const options = {algorithm: tenTokenInboxAlgorithm, expiresIn: tenTokenInboxExpires};
    const token = jwt.sign(body, secret, options);

    ctx.logger.info('Generated Document Server JWT token');
    res.json({token});
  } catch (error) {
    ctx.logger.error('JWT token generation error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

module.exports = router;
