'use strict';
const config = require('config');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const tenantBaseDir = config.get('tenants.baseDir');
const defaultTenantSecret = config.get('services.CoAuthoring.secret.browser.string');
const filenameSecret = config.get('tenants.filenameSecret');

const router = express.Router();

router.use(express.json());
router.use(cookieParser());

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    try {
      const decoded = jwt.verify(token, defaultTenantSecret);
      res.json(decoded);
    } catch {
      if (tenantBaseDir && fs.existsSync(tenantBaseDir)) {
        const tenantList = fs.readdirSync(tenantBaseDir);
        for (const tenant of tenantList) {
          try {
            const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
            const decoded = jwt.verify(token, tenantSecret);
            res.json({tenant: decoded.tenant, isAdmin: decoded.isAdmin});
            return;
          } catch {
            continue;
          }
        }
      }
      return res.status(401).json({error: 'Invalid token'});
    }
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

    const tenant = verifyTenantCredentials(tenantName, secret);
    if (!tenant) {
      return res.status(401).json({error: 'Invalid tenant name or secret'});
    }
    
    const token = jwt.sign({...tenant}, secret, {expiresIn: '1h'});

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

function verifyTenantCredentials(tenantName, secret) {
  // Check if it's the default tenant
  if (tenantName === config.get('tenants.defaultTenant') && secret === defaultTenantSecret) {
    return {tenant: tenantName, isAdmin: true};
  }
  
  // Check tenant-specific secrets
  if (tenantBaseDir && fs.existsSync(tenantBaseDir)) {
    const tenantPath = path.join(tenantBaseDir, tenantName);
    if (fs.existsSync(tenantPath)) {
      const tenantSecretPath = path.join(tenantPath, filenameSecret);
      if (fs.existsSync(tenantSecretPath)) {
        const tenantSecret = fs.readFileSync(tenantSecretPath, 'utf8');
        if (tenantSecret === secret) {
          return {tenant: tenantName, isAdmin: true};
        }
      }
    }
  }
  
  return null;
}

module.exports = router;
