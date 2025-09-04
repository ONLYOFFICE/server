'use strict';
const config = require('config');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const cookieParser = require('cookie-parser');

const tenantBaseDir = config.get('tenants.baseDir');
const defaultTenantSecret = config.get('services.CoAuthoring.secret.browser.string');
const filenameSecret = config.get('tenants.filenameSecret');
const adminPanelJwtSecret = config.get('adminPanel.jwtSecret');

const router = express.Router();

router.use(express.json());
router.use(cookieParser());

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    const decoded = jwt.verify(token, adminPanelJwtSecret);
    res.json(decoded);

  } catch {
    res.status(401).json({error: 'Unauthorized'});
  }
});

router.post('/login', async (req, res) => {
  try {
    const {tenantName, secret} = req.body;
    
    if (!tenantName || !secret) {
      return res.status(400).json({error: 'Tenant name and secret are required'});
    }

    const tenant = await verifyTenantCredentials(tenantName, secret);
    if (!tenant) {
      return res.status(401).json({error: 'Invalid tenant name or secret'});
    }
    
    const token = jwt.sign({...tenant}, adminPanelJwtSecret, {expiresIn: '1h'});

    res.cookie('accessToken', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000,
      path: '/'
    });

    res.json({tenant: tenant.tenant, isAdmin: tenant.isAdmin});
  } catch (error) {
    console.error('Login error:', error);
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

async function verifyTenantCredentials(tenantName, secret) {
  if (tenantName === config.get('tenants.defaultTenant') && secret === defaultTenantSecret) {
    return {tenant: tenantName, isAdmin: true};
  }

  if (tenantBaseDir) {
    try {
      const tenantPath = path.join(tenantBaseDir, tenantName);
      const tenantSecretPath = path.join(tenantPath, filenameSecret);
      const tenantSecret = await fs.readFile(tenantSecretPath, 'utf8');
      if (tenantSecret.trim() === secret) {
        return {tenant: tenantName, isAdmin: true};
      }
    } catch {
      return null;
    }
  }
  
  return null;
}

module.exports = router;
