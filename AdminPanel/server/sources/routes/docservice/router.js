'use strict';

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const operationContext = require('../../../../../Common/sources/operationContext');
const adminPanelJwtSecret = require('../../jwtSecret');

const router = express.Router();

router.use(express.json());
router.use(cookieParser());

/**
 * Middleware to verify JWT token
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
 * Get DocService connection config
 */
function getDocServiceConfig(ctx) {
  const host = 'localhost';
  const port = parseInt(ctx.getCfg('services.CoAuthoring.server.port', 8000), 10);
  return {host, port};
}

/**
 * Make HTTP request to DocService
 */
function makeDocServiceRequest(options, ctx) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (err) {
          ctx.logger.error('Error parsing DocService response: %s', err.stack);
          reject(new Error('Invalid response from DocService'));
        }
      });
    });

    req.on('error', err => {
      reject(err);
    });

    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * GET /shutdown - Get shutdown status
 * Proxies to DocService GET /internal/cluster/inactive
 */
router.get('/shutdown', requireAuth, async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  const {host, port} = getDocServiceConfig(ctx);

  try {
    const options = {
      hostname: host,
      port,
      path: '/internal/cluster/inactive',
      method: 'GET',
      headers: {
        'X-Forwarded-For': req.ip
      }
    };

    const response = await makeDocServiceRequest(options, ctx);
    res.status(response.statusCode).json(response.data);
  } catch (error) {
    ctx.logger.error('Error getting shutdown status: %s', error.stack);
    res.status(500).json({error: 'Failed to get shutdown status'});
  }
});

/**
 * PUT /shutdown - Enter shutdown mode
 * Proxies to DocService PUT /internal/cluster/inactive
 */
router.put('/shutdown', requireAuth, async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  const {host, port} = getDocServiceConfig(ctx);

  try {
    ctx.logger.info('Entering shutdown mode via AdminPanel');

    const options = {
      hostname: host,
      port,
      path: '/internal/cluster/inactive',
      method: 'PUT',
      headers: {
        'X-Forwarded-For': req.ip
      }
    };

    const response = await makeDocServiceRequest(options, ctx);
    res.status(response.statusCode).json(response.data);
  } catch (error) {
    ctx.logger.error('Error entering shutdown mode: %s', error.stack);
    res.status(500).json({error: 'Failed to enter shutdown mode'});
  }
});

/**
 * DELETE /shutdown - Exit shutdown mode
 * Proxies to DocService DELETE /internal/cluster/inactive
 */
router.delete('/shutdown', requireAuth, async (req, res) => {
  const ctx = new operationContext.Context();
  ctx.initFromRequest(req);
  const {host, port} = getDocServiceConfig(ctx);

  try {
    ctx.logger.info('Exiting shutdown mode via AdminPanel');

    const options = {
      hostname: host,
      port,
      path: '/internal/cluster/inactive',
      method: 'DELETE',
      headers: {
        'X-Forwarded-For': req.ip
      }
    };

    const response = await makeDocServiceRequest(options, ctx);
    res.status(response.statusCode).json(response.data);
  } catch (error) {
    ctx.logger.error('Error exiting shutdown mode: %s', error.stack);
    res.status(500).json({error: 'Failed to exit shutdown mode'});
  }
});

module.exports = router;
