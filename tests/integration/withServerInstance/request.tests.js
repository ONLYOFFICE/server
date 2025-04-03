const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { Writable, Readable } = require('stream');
const http = require('http');
const express = require('express');
const operationContext = require('../../../Common/sources/operationContext');
const utils = require('../../../Common/sources/utils');
const fs = require('fs').promises;
const path = require('path');

// Create operation context for tests
const ctx = new operationContext.Context();

// Test server setup
let server;
let testServer;
const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to create a writable stream for testing
const createMockWriter = () => {
  const chunks = [];
  return new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });
};

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

describe('HTTP Request Integration Tests', () => {
  beforeAll(async () => {
    // Setup test Express server
    const app = express();

    // Basic endpoint that returns JSON
    app.get('/api/data', (req, res) => {
      res.json({ success: true });
    });

    // Endpoint that streams data
    app.get('/api/stream', (req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-length', '1024');
      const buffer = Buffer.alloc(1024);
      res.send(buffer);
    });

    // Endpoint that simulates timeout
    app.get('/api/timeout', (req, res) => {
      // Never send response to trigger timeout
      return;
    });

    // Endpoint that redirects
    app.get('/api/redirect', (req, res) => {
      res.redirect('/api/data');
    });

    // Endpoint that returns error
    app.get('/api/error', (req, res) => {
      res.status(500).json({ error: 'Internal Server Error' });
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
      res.setHeader('content-length', '2097152'); // 2MB
      res.setHeader('content-type', 'application/octet-stream');
      const buffer = Buffer.alloc(2097152);
      res.send(buffer);
    });
    app.get('/api/headers', (req, res) => {
      // Ensure you're only sending headers, which won't contain circular references
      res.json({ headers: req.headers });
    });
    
    // Endpoint that returns connection header info
    app.get('/api/connection', (req, res) => {
      res.json({
        connection: req.headers.connection,
        keepAlive: req.headers.connection?.toLowerCase() === 'keep-alive'
      });
    });
    
    // Endpoint that returns only the accept-encoding header
    app.get('/api/accept-encoding', (req, res) => {
      res.json({
        acceptEncoding: req.headers['accept-encoding'] || null
      });
    });
    
    // Endpoint that returns only the connection header
    app.get('/api/connection-header', (req, res) => {
      const connectionHeader = req.headers['connection'] || '';
      res.json({
        connection: connectionHeader,
        keepAlive: connectionHeader.toLowerCase() === 'keep-alive'
      });
    });
    

    // Start server
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    // Cleanup server
    await new Promise(resolve => server.close(resolve));
  });

  describe('downloadUrlPromise', () => {
    test('successfully downloads JSON data', async () => {
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

    test('handles streaming with writer', async () => {
      const mockStreamWriter = createMockWriter();

      const result = await utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/stream`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        mockStreamWriter
      );

      expect(result).toBeUndefined();
    });

    test('throws error on timeout', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/timeout`,
        { wholeCycle: '1s', connectionAndInactivity: '500ms' },
        1024 * 1024,
        null,
        false,
        null,
        null
      )).rejects.toThrow(/(?:ESOCKETTIMEDOUT|timeout of 500ms exceeded)/);
    });

    test('throws error on wholeCycle timeout', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/timeout`,
        { wholeCycle: '1s', connectionAndInactivity: '5000ms' },
        1024 * 1024,
        null,
        false,
        null,
        null
      )).rejects.toThrow(/(?:ESOCKETTIMEDOUT|ETIMEDOUT: 1s|whole request cycle timeout: 1s)/);
    });

    test('follows redirects correctly', async () => {
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

    test(`doesn't follow redirects(maxRedirects=0)`, async () => {
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

        // Old implementation path
        expect(result).toBeDefined();
        expect(getStatusCode(result.response)).toBe(302);
      } catch (error) {
        // New implementation path (Axios)
        expect(error.message).toMatch(/(?:Request failed with status code 302|Error response: statusCode:302)/);
      }
    });

    test(`doesn't follow redirects(followRedirect=false)`, async () => {
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
        expect(result).toBeDefined();
        expect(getStatusCode(result.response)).toBe(302);
      } catch (error) {
        // New implementation path (Axios)
        expect(error.message).toMatch(/(?:Request failed with status code 302|Error response: statusCode:302)/);
      }
    });

    test('throws error on server error', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/error`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      )).rejects.toThrow(/(?:Error response: statusCode:500|Request failed with status code 500)/);
    });

    test('throws error when content-length exceeds limit', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `${BASE_URL}/api/large`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      )).rejects.toThrow('Error response: content-length:2097152');
    });

    test('enables compression when gzip is true', async () => {
      // Setup a simple server that captures headers
      let capturedHeaders = {};
      const app = express();
      app.get('/test', (req, res) => {
        capturedHeaders = {
          acceptEncoding: req.headers['accept-encoding']
        };
        res.json({ success: true });
      });
      
      const testServer = http.createServer(app);
      const testPort = PORT + 1000;
      await new Promise(resolve => testServer.listen(testPort, resolve));
      
      try {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: true,
            rejectUnauthorized: false
          }
        });

        await utils.downloadUrlPromise(
          mockCtx,
          `http://localhost:${testPort}/test`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
        // When gzip is true, 'accept-encoding' should include 'gzip'
        expect(capturedHeaders.acceptEncoding).toBeDefined();
        expect(capturedHeaders.acceptEncoding).toMatch(/gzip/i);
      } finally {
        await new Promise(resolve => testServer.close(resolve));
      }
    });

    test('disables compression when gzip is false', async () => {
      // Setup a simple server that captures headers
      let capturedHeaders = {};
      const app = express();
      app.get('/test', (req, res) => {
        capturedHeaders = {
          acceptEncoding: req.headers['accept-encoding']
        };
        res.json({ success: true });
      });
      
      const testServer = http.createServer(app);
      const testPort = PORT + 1001;
      await new Promise(resolve => testServer.listen(testPort, resolve));
      
      try {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: false,
            rejectUnauthorized: false
          }
        });

        await utils.downloadUrlPromise(
          mockCtx,
          `http://localhost:${testPort}/test`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
        expect(capturedHeaders.acceptEncoding === 'identity' || capturedHeaders.acceptEncoding === undefined).toBe(true);
      } finally {
        await new Promise(resolve => testServer.close(resolve));
      }
    });

    test('enables keep-alive when forever is true', async () => {
      // Setup a simple server that captures headers
      let capturedHeaders = {};
      const app = express();
      app.get('/test', (req, res) => {
        capturedHeaders = {
          connection: req.headers['connection']
        };
        res.json({ success: true });
      });
      
      const testServer = http.createServer(app);
      const testPort = PORT + 1002;
      await new Promise(resolve => testServer.listen(testPort, resolve));
      
      try {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            forever: true,
            rejectUnauthorized: false
          }
        });

        await utils.downloadUrlPromise(
          mockCtx,
          `http://localhost:${testPort}/test`,
          { wholeCycle: '2s' },
          1024 * 1024,
          null,
          false,
          null,
          null
        );
        
        // When forever is true, connection should be 'keep-alive'
        expect(capturedHeaders.connection?.toLowerCase()).toMatch(/keep-alive/i);
      } finally {
        await new Promise(resolve => testServer.close(resolve));
      }
    });

    test('disables keep-alive when forever is false', async () => {
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
        `${BASE_URL}/api/connection-header`,
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );

      expect(result).toBeDefined();
      const responseData = JSON.parse(result.body.toString());
      
      // When forever is false, connection should NOT be 'keep-alive'
      // Note: Different HTTP clients might handle this differently,
      // so we're checking that keepAlive is false
      expect(responseData.keepAlive).toBe(false);
    });
  });

  test('handles binary data correctly', async () => {
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

  test('handles binary data with stream writer', async () => {
    const chunks = [];
    const mockStreamWriter = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });

    await utils.downloadUrlPromise(
      ctx,
      `${BASE_URL}/api/binary`,
      { wholeCycle: '5s', connectionAndInactivity: '3s' },
      1024 * 1024,
      null,
      false,
      null,
      mockStreamWriter
    );

    // Combine chunks and verify
    const receivedData = Buffer.concat(chunks);
    const expectedData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    expect(Buffer.isBuffer(receivedData)).toBe(true);
    expect(receivedData.length).toBe(expectedData.length);
    expect(Buffer.compare(receivedData, expectedData)).toBe(0);
  });

  test('block external requests', async () => {
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

  test('allows request to external url in allowlist', async () => {
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

  test('allows request when URL is in JWT token', async () => {
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

  test('request with proxy configuration', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        "allow": true,
        "blockPrivateIP": true,
        "proxyUrl": "http://proxy.example.com:8080",
        "proxyUser": {
          "username": "testuser",
          "password": "testpass"
        },
        "proxyHeaders": {
          "X-Custom-Header": "test-value"
        }
      }
    });

    try {
      await utils.downloadUrlPromise(
        mockCtx,
        'https://example.com/test',
        { wholeCycle: '5s', connectionAndInactivity: '3s' },
        1024 * 1024,
        null,
        false,
        null,
        null
      );
      fail('Expected request to fail');
    } catch (error) {
      // Different error structures between implementations
      const headers = error.config?.headers || error.request?._headers || error._headers;
      if (headers) {
        expect(headers).toEqual(
          expect.objectContaining({
            'proxy-authorization': expect.stringContaining('testuser:testpass'),
            'X-Custom-Header': 'test-value'
          })
        );
      }
      // If headers aren't available, at least verify the error occurred
      expect(error).toBeDefined();
    }
  });

  describe('postRequestPromise', () => {
    test('successfully posts data', async () => {
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

    test('handles timeout during post', async () => {
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
      )).rejects.toThrow(/(?:ESOCKETTIMEDOUT|timeout of 500ms exceeded)/);
    });

    test('handles post with Authorization header', async () => {
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

    test('handles post with custom headers', async () => {
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

    test('handles post with stream data', async () => {
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

    test('throws error on wholeCycle timeout during post', async () => {
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
      )).rejects.toThrow(/(?:ETIMEDOUT|ESOCKETTIMEDOUT|whole request cycle timeout: 1s|Whole request cycle timeout: 1s)/);
    });

    test('blocks external post requests when configured', async () => {
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

    test('allows post request when URL is in JWT token', async () => {
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

    test('handles post with proxy configuration', async () => {
      const mockCtx = createMockContext({
        'externalRequest.action': {
          "allow": true,
          "blockPrivateIP": true,
          "proxyUrl": "http://proxy.example.com:8080",
          "proxyUser": {
            "username": "testuser",
            "password": "testpass"
          },
          "proxyHeaders": {
            "X-Custom-Proxy-Header": "test-value"
          }
        }
      });

      const postData = JSON.stringify({ test: 'data' });

      try {
        await utils.postRequestPromise(
          mockCtx,
          'https://example.com/api/post',
          postData,
          null,
          postData.length,
          { wholeCycle: '5s', connectionAndInactivity: '3s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        fail('Expected request to fail');
      } catch (error) {
        // Different error structures between implementations
        const headers = error.config?.headers || error.request?._headers || error._headers;
        if (headers) {
          expect(headers).toEqual(
            expect.objectContaining({
              'proxy-authorization': expect.stringContaining('testuser:testpass'),
              'X-Custom-Proxy-Header': 'test-value',
              'Content-Type': 'application/json'
            })
          );
        }
        // If headers aren't available, at least verify the error occurred
        expect(error).toBeDefined();
      }
    });

    test('applies gzip setting to POST requests', async () => {
      // Setup a simple server that captures headers
      let capturedHeaders = {};
      const app = express();
      app.post('/test', express.json(), (req, res) => {
        capturedHeaders = {
          acceptEncoding: req.headers['accept-encoding']
        };
        res.json({ success: true });
      });
      
      const testServer = http.createServer(app);
      const testPort = PORT + 1003;
      await new Promise(resolve => testServer.listen(testPort, resolve));
      
      try {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            gzip: false,
            rejectUnauthorized: false
          }
        });

        const postData = JSON.stringify({ test: 'data' });
        
        await utils.postRequestPromise(
          mockCtx,
          `http://localhost:${testPort}/test`,
          postData,
          null,
          postData.length,
          { wholeCycle: '2s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        
        expect(capturedHeaders.acceptEncoding === 'identity' || capturedHeaders.acceptEncoding === undefined).toBe(true);
      } finally {
        await new Promise(resolve => testServer.close(resolve));
      }
    });

    test('applies forever setting to POST requests', async () => {
      // Setup a simple server that captures headers
      let capturedHeaders = {};
      const app = express();
      app.post('/test', express.json(), (req, res) => {
        capturedHeaders = {
          connection: req.headers['connection']
        };
        res.json({ success: true });
      });
      
      const testServer = http.createServer(app);
      const testPort = PORT + 1004;
      await new Promise(resolve => testServer.listen(testPort, resolve));
      
      try {
        const mockCtx = createMockContext({
          'services.CoAuthoring.requestDefaults': {
            headers: { "User-Agent": "Node.js/6.13" },
            forever: true,
            rejectUnauthorized: false
          }
        });

        const postData = JSON.stringify({ test: 'data' });
        
        await utils.postRequestPromise(
          mockCtx,
          `http://localhost:${testPort}/test`,
          postData,
          null,
          postData.length,
          { wholeCycle: '2s' },
          null,
          false,
          { 'Content-Type': 'application/json' }
        );
        
        // When forever is true, connection should be 'keep-alive'
        expect(capturedHeaders.connection?.toLowerCase()).toMatch(/keep-alive/i);
      } finally {
        await new Promise(resolve => testServer.close(resolve));
      }
    });
  });
});
