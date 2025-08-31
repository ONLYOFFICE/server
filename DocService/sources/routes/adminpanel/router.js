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

'use strict';
const config = require('config');
const express = require('express');
const operationContext = require('../../../../Common/sources/operationContext');
const tenantBaseDir = config.get('tenants.baseDir');
// const isMultitenantMode = config.get('tenants.isMultitenantMode');
const defaultTenantSecret = config.get('services.CoAuthoring.secret.browser.string');
const filenameSecret = config.get('tenants.filenameSecret');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const router = express.Router();

// Middleware to parse JSON request bodies
router.use(express.json());

// Middleware to parse cookies
router.use(cookieParser());

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({error: 'Unauthorized'});
    }

    // Try to verify with default tenant secret first
    try {
      const decoded = jwt.verify(token, defaultTenantSecret);
      res.json(decoded);
    } catch {
      // If default secret fails, try to find the tenant and verify with their secret
      const tenantList = fs.readdirSync(tenantBaseDir);
      for (const tenant of tenantList) {
        try {
          const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
          const decoded = jwt.verify(token, tenantSecret);
          res.json({
            tenant: decoded.tenant,
            isAdmin: decoded.isAdmin
          });
          return;
        } catch {
          // Continue to next tenant
          continue;
        }
      }
      // If no tenant secret works, return unauthorized
      return res.status(401).json({error: 'Invalid token'});
    }
  } catch (error) {
    console.log('error', error);
    res.status(401).json({error: 'Unauthorized'});
  }
});

router.post('/login', async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initDefault();
  try {
    const {secret} = req.body;
    const tenant = findTenantBySecret(secret);
    if (!tenant) {
      return res.status(401).json({error: 'Invalid secret'});
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
    ctx.logger.error('Config get error: %s', error.stack);
    res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/logout', async (req, res) => {
  try {
    // Clear the httpOnly accessToken cookie
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/'
    });

    res.json({message: 'Logged out successfully'});
  } catch (error) {
    console.log('logout error', error);
    res.status(500).json({error: 'Internal server error'});
  }
});

//TODO: make function async, use cache
function findTenantBySecret(secret) {
  if (secret === defaultTenantSecret) {
    return {
      tenant: config.get('tenants.defaultTenant'),
      isAdmin: true
    };
  }

  const tenantList = fs.readdirSync(tenantBaseDir);
  for (const tenant of tenantList) {
    const tenantSecret = fs.readFileSync(path.join(tenantBaseDir, tenant, filenameSecret), 'utf8');
    if (tenantSecret === secret) {
      return {
        tenant,
        isAdmin: true
      };
    }
  }
  return null;
}

module.exports = router;
