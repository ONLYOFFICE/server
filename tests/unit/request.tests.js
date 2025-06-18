const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { Writable, Readable } = require('stream');
const { buffer } = require('node:stream/consumers');
const http = require('http');
const https = require('https');
const express = require('express');
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');
const fs = require('fs').promises;
const path = require('path');

// Create operation context for tests
const ctx = new operationContext.Context();

// Test server setup
let server;
let testServer;
let proxyServer;
const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const PROXY_PORT = PORT + 2000;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
// Track requests going through the proxy
const proxiedRequests = [];

const getStatusCode = (response) => response.statusCode || response.status;

function createMockContext(overrides = {}) {
  const defaultCtx = {
    getCfg: function(key, _) {
      switch (key) {
        case 'services.CoAuthoring.requestDefaults':
          return {
            "headers": {
              "User-Agent": "Node.js/6.13",
              "Connection": "Keep-Alive"
            },
            "decompress": true,
            "rejectUnauthorized": true,
            "followRedirect": false
          };
        case 'services.CoAuthoring.token.outbox.header':
          return "Authorization";
        case 'services.CoAuthoring.token.outbox.prefix':
          return "Bearer ";
        case 'externalRequest.action':
          return {
            "allow": true,
            "blockPrivateIP": false,
            "proxyUrl": "",
            "proxyUser": {
              "username": "",
              "password": ""
            },
            "proxyHeaders": {}
          };
        case 'services.CoAuthoring.request-filtering-agent':
          return {
            "allowPrivateIPAddress": false,
            "allowMetaIPAddress": false
          };
        case 'externalRequest.directIfIn':
          return {
            "allowList": [],
            "jwtToken": true
          };
        default:
          return undefined;
      }
    },
    logger: {
      debug: function() {},
    }
  };

  // Return a mock context with overridden values if any
  return {
    ...defaultCtx,
    getCfg: function(key, _) {
      // Return the override if it exists
      if (overrides[key]) {
        return overrides[key];
      }
      // Otherwise, return the default behavior
      return defaultCtx.getCfg(key, _);
    }
  };
}

describe('HTTP Request Unit Tests', () => {
  beforeAll(async () => {
    // Setup test Express server
    const app = express();

    // Basic endpoint that returns JSON
    app.get('/api/data', (req, res) => {
      res.json({ success: true });
    });

    // Endpoint that simulates timeout
    app.get('/api/timeout', (req, res) => {
      // Never send response to trigger timeout
      return;
    });

    app.use('/api/status/:code', (req, res) => {
      res.status(Number(req.params.code)).send();
    });

    // Endpoint that redirects
    app.get('/api/redirect', (req, res) => {
      res.redirect('/api/data');
    });

    // Endpoint that returns error
    app.get('/api/error', (req, res) => {
      res.status(500).json({ error: 'Internal Server Error' });
    });
    // Endpoint that simulates a slow response headers
    app.get('/api/slow-headers', (req, res) => {
      // Delay sending headers
      setTimeout(() => {
        res.json({ success: true });
      }, 200); // 200 ms delay before sending any response
    });


    // Endpoint that simulates partial response with incomplete body
    app.get('/api/partial-response', (req, res) => {
      // Send headers immediately
      res.setHeader('Content-Type', 'application/json');
      // Start sending data
      res.write('{"start": "This response');
     
      // But never finish the response (simulates a server that hangs after starting to send data)
      // This should trigger the wholeCycle timeout
    });


    // Endpoint that simulates slow/chunked response with inactivity periods
    app.get('/api/slow-body', (req, res) => {
      // Send headers immediately
      res.setHeader('Content-Type', 'application/json');
      res.write('{"part1": "First part of the response",');
     
      // Delay between chunks (simulates inactivity during response body transmission)
      setTimeout(() => {
        res.write('"part2": "Second part of the response",');
        // Final delay - this delay is longer than the connectionAndInactivity timeout should be
        setTimeout(() => {
          res.write('"part3": "third part",');
          setTimeout(() => {
            res.write('"part4": "Final part"}');
            res.end();
          }, 200);
        }, 100);
      }, 100);
    });

    // POST endpoint
    app.post('/api/post', express.json(), (req, res) => {
      res.json({ received: req.body });
    });

    // POST endpoint that times out
    app.post('/api/timeout', express.json(), (req, res) => {
      // Never send response to trigger timeout
      return;
    });

    app.get('/api/binary', (req, res) => {
      // PNG file signature as binary data
      const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      res.setHeader('content-type', 'image/png');
      res.setHeader('content-length', binaryData.length);
      res.send(binaryData);
    });
    
    // Large file endpoint
    app.get('/api/large', (req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.send(Buffer.alloc(2*1024*1024));//2MB
    });
    
    // Large file endpoint with truly no content-length header
    app.get('/api/large-chunked', (req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('transfer-encoding', 'chunked');
      res.write(Buffer.alloc(2*1024*1024));
      res.end();
    });
    
    // Endpoint that mirrors whole request - handles any HTTP method
    app.use('/api/mirror', express.json(), express.urlencoded({ extended: true }), (req, res) => {
      // Create a mirror response object with all request details
      const mirror = {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        params: req.params,
        headers: req.headers,
        body: req.body,
        protocol: req.protocol,
        ip: req.ip,
        hostname: req.hostname,
        originalUrl: req.originalUrl,
        xhr: req.xhr,
        secure: req.secure
      };
      
      // Send the mirror response back
      res.json(mirror);
    });

    // Start server
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
    
    // Setup proxy server
    const proxyApp = express();
    proxyApp.use((req, res, next) => {
      // Record request details
      const requestInfo = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: ''
      };
      proxiedRequests.push(requestInfo);
      
      // Collect body data if present
      req.on('data', chunk => {
        requestInfo.body += chunk.toString();
      });
      
      // Validate proxy authentication
      const authHeader = req.headers['proxy-authorization'];
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.status(407).set('Proxy-Authenticate', 'Basic').send('Proxy authentication required');
        return;
      }
      
      // Decode and verify credentials
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const [username, password] = credentials.split(':');
      
      // Expected credentials from config (will be overridden by test-specific values)
      const expectedUsername = 'proxyuser';
      const expectedPassword = 'proxypass';
      
      if (username !== expectedUsername || password !== expectedPassword) {
        res.status(407).set('Proxy-Authenticate', 'Basic').send('Invalid proxy credentials');
        return;
      }
      
      // Forward the request
      const targetUrl = new URL(req.url);
      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: { ...req.headers }
      };
      
      const proxyReq = http.request(options, (proxyRes) => {
        // Copy status code
        res.statusCode = proxyRes.statusCode;
        
        // Copy headers
        Object.keys(proxyRes.headers).forEach(key => {
          res.setHeader(key, proxyRes.headers[key]);
        });
        
        // Pipe response data
        proxyRes.pipe(res);
      });
      
      // Handle proxy errors
      proxyReq.on('error', (error) => {
        console.error('Proxy error:', error);
        res.statusCode = 500;
        res.end('Proxy Error');
      });
      
      // Pipe request data
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });
    
    proxyServer = http.createServer(proxyApp);
    await new Promise(resolve => proxyServer.listen(PROXY_PORT, resolve));
  });

  afterAll(async () => {
    // Cleanup servers
    await new Promise(resolve => server.close(resolve));
    if (proxyServer) {
      await new Promise(resolve => proxyServer.close(resolve));
    }
  });

  
  describe('specific timeout behaviors', () => {
    test.concurrent('connectionAndInactivity triggers when server delays response headers', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/slow-headers`,
          { connectionAndInactivity: '100ms' }, // connectionAndInactivity shorter than the server delay
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        // Different implementations might throw different error messages/codes
        expect(error.code).toBe('ESOCKETTIMEDOUT');
      }
    });


    test.concurrent('connectionAndInactivity does not trigger when longer than server delay', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/slow-headers`,
        { connectionAndInactivity: '300ms' }, // connectionAndInactivity longer than the server delay (200ms)
        1024 * 1024,
        null,
        false,
        null,
        null
      );
    
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({ success: true });
    });


    test.concurrent('wholeCycle triggers even when server starts sending data but does not complete', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/partial-response`,
          { wholeCycle: '1s' }, // wholeCycle shorter than time needed for response
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('ETIMEDOUT');
      }
    });


    test.concurrent('connectionAndInactivity triggers when server stops sending data midway', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/slow-body`,
          { connectionAndInactivity: '150ms' }, // connectionAndInactivity shorter than the second delay
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        // This should catch the inactivity timeout during body transmission
        expect(error.code).toBe('ESOCKETTIMEDOUT');
      }
    });
  
    test.concurrent('connectionAndInactivity does not trigger when longer than inactivity periods', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/slow-body`,
        { connectionAndInactivity: '250ms' }, // connectionAndInactivity longer than the longest delay (2s)
        1024 * 1024,
        null,
        false,
        null,
        null
      );
    
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      const responseBody = JSON.parse(result.body.toString());
      expect(responseBody.part1).toBe('First part of the response');
      expect(responseBody.part2).toBe('Second part of the response');
      expect(responseBody.part3).toBe('third part');
      expect(responseBody.part4).toBe('Final part');
    });
  
    test.concurrent('wholeCycle does not trigger when longer than total response time', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/slow-body`,
        { wholeCycle: '1s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );
    
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      const responseBody = JSON.parse(result.body.toString());
      expect(responseBody.part1).toBe('First part of the response');
      expect(responseBody.part2).toBe('Second part of the response');      
      expect(responseBody.part3).toBe('third part');
      expect(responseBody.part4).toBe('Final part');
    });
  });

  describe('downloadUrlPromise', () => {
    test.concurrent('successfully downloads JSON data', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/data`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );

      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({ success: true });
    });

    test.concurrent('throws error on timeout', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/timeout`,
          { wholeCycle: '1s', connectionAndInactivity: '500ms' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('ESOCKETTIMEDOUT');
      }
    });

    test.concurrent('throws error on wholeCycle timeout', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/timeout`,
          { wholeCycle: '1s', connectionAndInactivity: '5000ms' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('ETIMEDOUT');
      }

    });

    test.concurrent('follows redirects correctly', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/redirect`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );

      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({ success: true });
    });

    test.concurrent(`doesn't follow redirects(maxRedirects=0)`, async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          "headers": {
            "User-Agent": "Node.js/6.13",
            "Connection": "Keep-Alive"
          },
          "decompress": true,
          "rejectUnauthorized": false,
          "followRedirect": true,
          "maxRedirects": 0
        },
      });

      try {
        const result = await utils.downloadUrlPromise(
          mockCtx,
          `${BASE_URL}/api/redirect`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
      } catch (error) {
        // New implementation path (Axios)
        expect(error.statusCode).toBe(302)
      }
    });

    test.concurrent(`doesn't follow redirects(followRedirect=false)`, async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          "headers": {
            "User-Agent": "Node.js/6.13",
            "Connection": "Keep-Alive"
          },
          "decompress": true,
          "rejectUnauthorized": false,
          "followRedirect": false,
          "maxRedirects": 100
        },
      });

      try {
        const result = await utils.downloadUrlPromise(
          mockCtx,
          `${BASE_URL}/api/redirect`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );

        // Old implementation path
      } catch (error) {
        // New implementation path (Axios)
        expect(error.statusCode).toBe(302);
      }
    });

    test.concurrent('throws error on server error', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/error`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      )).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
    });

    test.concurrent('throws error when content-length exceeds limit', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/large`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
      
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/large-chunked`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
    });

    test.concurrent('throws error when content-length exceeds limit with stream', async () => {
      try {
        const {stream} = await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/large`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          true
        );
        const receivedData = await buffer(stream);
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
      try {
        const {stream} = await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/large-chunked`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          true
        );
        const receivedData = await buffer(stream);
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
    });

    test.concurrent('enables compression when gzip is true', async () => {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: true,
            rejectUnauthorized: false
          }
        });

      const response = await utils.downloadUrlPromise(
          mockCtx,
        `${BASE_URL}/api/mirror`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

        // When gzip is true, 'accept-encoding' should include 'gzip'
      expect(responseBody.headers?.['accept-encoding']).toBeDefined();
      expect(responseBody.headers?.['accept-encoding']).toMatch(/gzip/i);
    });

    test.concurrent('disables compression when gzip is false', async () => {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: false,
            rejectUnauthorized: false
          }
        });

      const response = await utils.downloadUrlPromise(
          mockCtx,
        `${BASE_URL}/api/mirror`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      expect(responseBody.headers?.['accept-encoding'] === 'identity' || responseBody.headers?.['accept-encoding'] === undefined).toBe(true);
    });

    test.concurrent('enables keep-alive when forever is true', async () => {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            forever: true,
            rejectUnauthorized: false
          }
        });

      const response = await utils.downloadUrlPromise(
          mockCtx,
        `${BASE_URL}/api/mirror`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

        // When forever is true, connection should be 'keep-alive'
      expect(responseBody.headers?.connection?.toLowerCase()).toMatch(/keep-alive/i);
    });

    test.concurrent('disables keep-alive when forever is false', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {
            "User-Agent": "Node.js/6.13"
          },
          forever: false,
          rejectUnauthorized: false
        }
      });

      const result = await utils.downloadUrlPromise(
        mockCtx,
        `${BASE_URL}/api/mirror`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      const responseBody = JSON.parse(result.body.toString());
      
      // When forever is false, connection should NOT be 'keep-alive'
      // Note: Different HTTP clients might handle this differently,
      // so we're checking that keepAlive is false
      expect(responseBody.headers?.connection?.toLowerCase()).not.toMatch(/keep-alive/i);
    });

    test.concurrent('test requestDefaults', async () => {
      const defaultHeaders = {"user-agent": "Node.js/6.13"};
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: defaultHeaders
        }
      });
      let customHeaders = {"custom-header": "test-value", "set-cookie": ["cookie"]};
      let customQueryParams = {"custom-query-param": "value"};
      const result = await utils.downloadUrlPromise(
        mockCtx,
        `${BASE_URL}/api/mirror?${new URLSearchParams(customQueryParams).toString()}`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        customHeaders
      );
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.headers).toMatchObject({...defaultHeaders, ...customHeaders});
      expect(body.query).toMatchObject(customQueryParams);
    });

    test.concurrent('successfully routes GET request through a real proxy', async () => {
      try {
        // Create context with proxy configuration
        const mockCtx = createMockContext({
          'externalRequest.action': {
            "allow": true,
            "blockPrivateIP": false,
            "proxyUrl": PROXY_URL,
            "proxyUser": {
              "username": "proxyuser",
              "password": "proxypass"
            },
            "proxyHeaders": {
              "X-Proxy-Custom": "custom-value"
            }
          }
        });
        
        // Make a GET request through the proxy
        const result = await utils.downloadUrlPromise(
          mockCtx,
          `${BASE_URL}/api/data`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
        // Verify the request was successful
        expect(result).toBeDefined();
        expect(getStatusCode(result.response)).toBe(200);
        expect(JSON.parse(result.body.toString())).toEqual({ success: true });
        
        // Verify the request went through our proxy
        expect(proxiedRequests.length).toBeGreaterThan(0);
        const proxyRequest = proxiedRequests.find(r => 
          r.method === 'GET' && r.url.includes('/api/data')
        );
        expect(proxyRequest).toBeDefined();
        expect(proxyRequest.url).toContain(`${BASE_URL}/api/data`);
        // Check for Base64 encoded authorization header (starts with "Basic ")
        expect(proxyRequest.headers['proxy-authorization']).toMatch(/^Basic /);
        expect(proxyRequest.headers['x-proxy-custom']).toBe('custom-value');
      } finally {
        // No need to clean up proxy server here anymore
      }
    });

    test.concurrent('should return 205 status code for /status/205', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/status/205`,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        )
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.message).toContain('Error response:')
        expect(error.statusCode).toBe(205);
      }
    });
  });

  test.concurrent('handles binary data correctly', async () => {
    const result = await utils.downloadUrlPromise(
      ctx,
      `${BASE_URL}/api/binary`,
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      false,
      null,
      null
    );

    // Expected binary data (PNG file signature)
    const expectedData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(getStatusCode(result.response)).toBe(200);
    expect(result.response.headers['content-type']).toBe('image/png');
    
    // Verify binary data
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.body.length).toBe(expectedData.length);
    expect(Buffer.compare(result.body, expectedData)).toBe(0);
  });

  test.concurrent('handles binary data with stream writer', async () => {
    const { stream } = await utils.downloadUrlPromise(
      ctx,
      `${BASE_URL}/api/binary`,
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      false,
      null,
      true
    );
    const receivedData = await buffer(stream);
    const expectedData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    expect(Buffer.isBuffer(receivedData)).toBe(true);
    expect(receivedData.length).toBe(expectedData.length);
    expect(Buffer.compare(receivedData, expectedData)).toBe(0);
  });

  test.concurrent('block external requests', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        "allow": false,  // Block all external requests
        "blockPrivateIP": false,
        "proxyUrl": "",
        "proxyUser": {
          "username": "",
          "password": ""
        },
        "proxyHeaders": {}
      }
    });

    // Use rejects.toThrow to test the error message
    await expect(utils.downloadUrlPromise(
      mockCtx,
      'https://example.com/test',
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      false,
      null,
      null
    )).rejects.toThrow('Block external request. See externalRequest config options');
  });

  test.concurrent('allows request to external url in allowlist', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        "allow": false,  // Block external requests by default
        "blockPrivateIP": false,
        "proxyUrl": "",
        "proxyUser": {
          "username": "",
          "password": ""
        },
        "proxyHeaders": {}
      },
      'externalRequest.directIfIn': {
        "allowList": [`${BASE_URL}`], // Allow our test server
        "jwtToken": false
      }
    });

    const result = await utils.downloadUrlPromise(
      mockCtx,
      `${BASE_URL}/api/data`,
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      false,
      null,
      null
    );

    expect(result).toBeDefined();
    expect(getStatusCode(result.response)).toBe(200);
    expect(JSON.parse(result.body.toString())).toEqual({ success: true });
  });

  test.concurrent('allows request when URL is in JWT token', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        "allow": false,  // Block external requests by default
        "blockPrivateIP": false,
        "proxyUrl": "",
        "proxyUser": {
          "username": "",
          "password": ""
        },
        "proxyHeaders": {}
      },
      'externalRequest.directIfIn': {
        "allowList": [], // Empty allowlist
        "jwtToken": true // Allow URLs from JWT token
      }
    });

    const result = await utils.downloadUrlPromise(
      mockCtx,
      `${BASE_URL}/api/data`,
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      true, // Indicate URL is from JWT token
      null,
      null
    );

    expect(result).toBeDefined();
    expect(getStatusCode(result.response)).toBe(200);
    expect(JSON.parse(result.body.toString())).toEqual({ success: true });
  });

  describe('postRequestPromise', () => {
    test.concurrent('successfully posts data', async () => {
      const postData = JSON.stringify({ test: 'data' });
      
      const result = await utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/post`,
        postData,
        null,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        null,
        false,
        { 'Content-Type': 'application/json' }
      );

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: { test: 'data' } });
    });

    test.concurrent('handles timeout during post', async () => {
      const postData = JSON.stringify({ test: 'data' });
      
      await expect(utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/timeout`,
        postData,
        null,
        postData.length,
        { wholeCycle: '1s', connectionAndInactivity: '500ms' },
        null,
        false,
        { 'Content-Type': 'application/json' }
      )).rejects.toMatchObject({ code: 'ESOCKETTIMEDOUT' });
    });

    test.concurrent('handles post with Authorization header', async () => {
      const postData = JSON.stringify({ test: 'data' });
      const authToken = 'test-auth-token';
      
      const result = await utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/post`,
        postData,
        null,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        authToken,
        false,
        { 'Content-Type': 'application/json' }
      );

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: { test: 'data' } });
    });

    test.concurrent('handles post with custom headers', async () => {
      const postData = JSON.stringify({ test: 'data' });
      const customHeaders = {
        'X-Custom-Header': 'test-value',
        'Content-Type': 'application/json'
      };
      
      const result = await utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/post`,
        postData,
        null,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        null,
        false,
        customHeaders
      );

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: { test: 'data' } });
    });

    test.concurrent('handles post with stream data', async () => {
      const postData = JSON.stringify({ test: 'stream-data' });
      const postStream = new Readable({
        read() {
          this.push(postData);
          this.push(null);
        }
      });

      const result = await utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/post`,
        null,
        postStream,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        null,
        false,
        { 'Content-Type': 'application/json' }
      );

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: { test: 'stream-data' } });
    });

    test.concurrent('throws error on wholeCycle timeout during post', async () => {
      const postData = JSON.stringify({ test: 'data' });
      
      await expect(utils.postRequestPromise(
        ctx,
        `${BASE_URL}/api/timeout`,
        postData,
        null,
        postData.length,
        { wholeCycle: '1s', connectionAndInactivity: '5s' },
        null,
        false,
        { 'Content-Type': 'application/json' }
      )).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    });

    test.concurrent('blocks external post requests when configured', async () => {
      const mockCtx = createMockContext({
        'externalRequest.action': {
          "allow": false,
          "blockPrivateIP": false,
          "proxyUrl": "",
          "proxyUser": {
            "username": "",
            "password": ""
          },
          "proxyHeaders": {}
        }
      });

      const postData = JSON.stringify({ test: 'data' });

      await expect(utils.postRequestPromise(
        mockCtx,
        'https://example.com/api/post',
        postData,
        null,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        null,
        false,
        { 'Content-Type': 'application/json' }
      )).rejects.toThrow('Block external request. See externalRequest config options');
    });

    test.concurrent('allows post request when URL is in JWT token', async () => {
      const mockCtx = createMockContext({
        'externalRequest.action': {
          "allow": false,
          "blockPrivateIP": false,
          "proxyUrl": "",
          "proxyUser": {
            "username": "",
            "password": ""
          },
          "proxyHeaders": {}
        },
        'externalRequest.directIfIn': {
          "allowList": [],
          "jwtToken": true
        }
      });

      const postData = JSON.stringify({ test: 'data' });

      const result = await utils.postRequestPromise(
        mockCtx,
        `${BASE_URL}/api/post`,
        postData,
        null,
        postData.length,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        null,
        true, // Indicate URL is from JWT token
        { 'Content-Type': 'application/json' }
      );

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ received: { test: 'data' } });
    });

    test.concurrent('applies gzip setting to POST requests', async () => {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: false,
            rejectUnauthorized: false
          }
        });

        const postData = JSON.stringify({ test: 'data' });
        
      const response = await utils.postRequestPromise(
          mockCtx,
        `${BASE_URL}/api/mirror`,
          postData,
          null,
          postData.length,
          { wholeCycle: '2s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        
      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      expect(responseBody.headers?.['accept-encoding'] === 'identity' || responseBody.headers?.['accept-encoding'] === undefined).toBe(true);
    });

    test.concurrent('applies forever setting to POST requests', async () => {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            forever: true,
            rejectUnauthorized: false
          }
        });

        const postData = JSON.stringify({ test: 'data' });
        
      const response = await utils.postRequestPromise(
          mockCtx,
        `${BASE_URL}/api/mirror`,
          postData,
          null,
          postData.length,
          { wholeCycle: '2s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        
      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

        // When forever is true, connection should be 'keep-alive'
      expect(responseBody.headers?.connection?.toLowerCase()).toMatch(/keep-alive/i);
    });

    test.concurrent('successfully routes POST request through a real proxy', async () => {
      try {
        // Create context with proxy configuration
        const mockCtx = createMockContext({
          'externalRequest.action': {
            "allow": true,
            "blockPrivateIP": false,
            "proxyUrl": PROXY_URL,
            "proxyUser": {
              "username": "proxyuser",
              "password": "proxypass"
            },
            "proxyHeaders": {
              "X-Post-Proxy": "post-proxy-value"
            }
          }
        });
        
        // Test POST request
        const postData = JSON.stringify({ nested: { test: 'complex-data' } });
        
        const postResult = await utils.postRequestPromise(
          mockCtx,
          `${BASE_URL}/api/post`,
          postData,
          null,
          postData.length,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          'auth-token', // With auth token
          false,
          { 'Content-Type': 'application/json', 'X-Custom': 'test-value' }
        );
        
        // Verify the post request
        expect(postResult).toBeDefined();
        expect(postResult.response.statusCode).toBe(200);
        expect(JSON.parse(postResult.body)).toEqual({ 
          received: { nested: { test: 'complex-data' } } 
        });
        
        // Verify proxy headers and auth
        const postProxyRequest = proxiedRequests.find(r => 
          r.method === 'POST' && r.url.includes('/api/post')
        );
        
        expect(postProxyRequest).toBeDefined();
        // Check for Base64 encoded authorization header (starts with "Basic ")
        expect(postProxyRequest.headers['proxy-authorization']).toMatch(/^Basic /);
        expect(postProxyRequest.headers['x-post-proxy']).toBe('post-proxy-value');
        expect(postProxyRequest.headers['content-type']).toBe('application/json');
        expect(postProxyRequest.headers['x-custom']).toBe('test-value');
        expect(postProxyRequest.headers['authorization']).toContain('Bearer auth-token');
        
        // Verify post body was correctly sent
        expect(JSON.parse(postProxyRequest.body)).toEqual({ nested: { test: 'complex-data' } });
      } finally {
        // No need to clean up proxy server here anymore
      }
    });

    test.concurrent('should return 205 status code for /status/205', async () => {
      try {
        const postData = JSON.stringify({ test: 'data' });

        const result = await utils.postRequestPromise(
          ctx,
          `${BASE_URL}/api/status/205`,
          postData,
          null,
          postData.length,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.message).toContain('Error response:')
        expect(error.statusCode).toBe(205);
      }
    });
  });
});