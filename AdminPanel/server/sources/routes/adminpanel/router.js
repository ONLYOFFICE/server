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
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const decoded = jwt.verify(token, defaultTenantSecret);
      res.json(decoded);
      return;
    } catch (defaultError) {
      if (tenantBaseDir && fs.existsSync(tenantBaseDir)) {
        const tenantList = fs.readdirSync(tenantBaseDir);
        for (const tenant of tenantList) {
          try {
            const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
            const decoded = jwt.verify(token, tenantSecret);
            res.json({ tenant: decoded.tenant, isAdmin: decoded.isAdmin });
            return;
          } catch (tenantError) {
            continue;
          }
        }
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { secret } = req.body;
    const tenant = findTenantBySecret(secret);
    if (!tenant) {
      return res.status(401).json({ error: 'Invalid secret' });
    }
    const token = jwt.sign({ ...tenant }, secret, { expiresIn: '1h' });

    res.cookie('accessToken', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000,
      path: '/'
    });

    res.json({ tenant: tenant.tenant, isAdmin: tenant.isAdmin });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/'
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function findTenantBySecret(secret) {
  if (secret === defaultTenantSecret) {
    return { tenant: config.get('tenants.defaultTenant'), isAdmin: true };
  }
  if (tenantBaseDir && fs.existsSync(tenantBaseDir)) {
    const tenantList = fs.readdirSync(tenantBaseDir);
    for (const tenant of tenantList) {
      const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
      if (tenantSecret === secret) {
        return { tenant, isAdmin: true };
      }
    }
  }
  return null;
}

module.exports = router;


