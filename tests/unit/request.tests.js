const {describe, test, expect, beforeAll, afterAll} = require('@jest/globals');
const {Readable} = require('stream');
const {buffer} = require('node:stream/consumers');
const http = require('http');
const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

// Create operation context for tests
const ctx = new operationContext.Context();

// Test server setup
let server;
let proxyServer;
const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const PROXY_PORT = PORT + 2000;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
// Track requests going through the proxy
const proxiedRequests = [];

const getStatusCode = response => response.statusCode || response.status;

function createMockContext(overrides = {}) {
  const defaultCtx = {
    getCfg(key, _) {
      switch (key) {
        case 'services.CoAuthoring.requestDefaults':
          return {
            headers: {
              'User-Agent': 'DocumentServer',
              Connection: 'Keep-Alive'
            },
            decompress: true,
            rejectUnauthorized: true,
            followRedirect: false
          };
        case 'services.CoAuthoring.token.outbox.header':
          return 'Authorization';
        case 'services.CoAuthoring.token.outbox.prefix':
          return 'Bearer ';
        case 'externalRequest.action':
          return {
            allow: true,
            blockPrivateIP: false,
            proxyUrl: '',
            proxyUser: {
              username: '',
              password: ''
            },
            proxyHeaders: {}
          };
        case 'services.CoAuthoring.request-filtering-agent':
          return {
            allowPrivateIPAddress: false,
            allowMetaIPAddress: false
          };
        case 'externalRequest.directIfIn':
          return {
            allowList: [],
            jwtToken: true
          };
        default:
          return undefined;
      }
    },
    logger: {
      debug() {}
    }
  };

  // Return a mock context with overridden values if any
  return {
    ...defaultCtx,
    getCfg(key, _) {
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
      res.json({success: true});
    });

    // Endpoint that simulates timeout
    app.get('/api/timeout', (_req, _res) => {
      // Never send response to trigger timeout
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
      res.status(500).json({error: 'Internal Server Error'});
    });

    // Endpoint that simulates a slow response headers
    app.get('/api/slow-headers', (_req, res) => {
      // Delay sending headers
      setTimeout(() => {
        res.json({success: true});
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
    app.get('/api/slow-body', (_req, res) => {
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
      res.json({received: req.body});
    });

    // POST endpoint that times out
    app.post('/api/timeout', express.json(), (_req, _res) => {
      // Never send response to trigger timeout
    });

    app.get('/api/binary', (_req, res) => {
      // PNG file signature as binary data
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      res.setHeader('content-type', 'image/png');
      res.setHeader('content-length', binaryData.length);
      res.send(binaryData);
    });

    // Large file endpoint
    app.get('/api/large', (_req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.send(Buffer.alloc(2 * 1024 * 1024)); //2MB
    });

    // Large file endpoint with truly no content-length header
    app.get('/api/large-chunked', (_req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('transfer-encoding', 'chunked');
      res.write(Buffer.alloc(2 * 1024 * 1024));
      res.end();
    });

    // Endpoint that returns data with correct Content-Digest header
    app.get('/api/content-digest-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      res.setHeader('content-digest', 'sha256=:' + sha256 + ':');
      res.send(body);
    });

    // Endpoint that returns data with wrong Content-Digest header
    app.get('/api/content-digest-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      // Send wrong body but correct hash for different body
      const wrongBody = Buffer.from('tampered content data');
      res.setHeader('content-digest', 'sha256=:' + sha256 + ':');
      res.send(wrongBody);
    });

    // Endpoint that returns plain content with no integrity headers (for a caller-provided digest)
    app.get('/api/plain-content', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('content-type', 'application/octet-stream');
      res.send(body);
    });

    // Endpoint that returns data with correct x-amz-checksum-sha256 header
    app.get('/api/amz-checksum-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      res.setHeader('x-amz-checksum-sha256', sha256);
      res.send(body);
    });

    // Endpoint that returns data with wrong x-amz-checksum-sha256 header
    app.get('/api/amz-checksum-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      // Send wrong body but correct hash for different body
      const wrongBody = Buffer.from('tampered content data');
      res.setHeader('x-amz-checksum-sha256', sha256);
      res.send(wrongBody);
    });

    // Endpoint that returns gzipped data (Content-Length = compressed size != decompressed body size
    // Integrity check must skip Content-Length when content-encoding is present)
    app.get('/api/gzip-content-length', (_req, res) => {
      const body = Buffer.from('valid content data');
      const compressed = zlib.gzipSync(body);
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'content-type': 'application/octet-stream'
      });
      res.end(compressed);
    });

    // Endpoint with gzip and conformant Content-Digest computed over the compressed bytes (RFC 9530)
    app.get('/api/gzip-content-digest-encoded', (_req, res) => {
      const body = Buffer.from('valid content data');
      const compressed = zlib.gzipSync(body);
      const sha256 = crypto.createHash('sha256').update(compressed).digest('base64');
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'content-digest': 'sha256=:' + sha256 + ':',
        'content-type': 'application/octet-stream'
      });
      res.end(compressed);
    });

    // Endpoint with gzip and a Content-Digest matching nothing (must be skipped, not failed)
    app.get('/api/gzip-content-digest-wrong', (_req, res) => {
      const body = Buffer.from('valid content data');
      const compressed = zlib.gzipSync(body);
      const sha256 = crypto.createHash('sha256').update(Buffer.from('unrelated bytes')).digest('base64');
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'content-digest': 'sha256=:' + sha256 + ':',
        'content-type': 'application/octet-stream'
      });
      res.end(compressed);
    });

    // Endpoint that returns data with correct x-goog-hash md5 header
    app.get('/api/x-goog-hash-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      const md5 = crypto.createHash('md5').update(body).digest('base64');
      res.setHeader('x-goog-hash', 'md5=' + md5);
      res.send(body);
    });

    // Endpoint that returns data with wrong x-goog-hash md5 header
    app.get('/api/x-goog-hash-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      const wrongMd5 = crypto.createHash('md5').update(Buffer.from('wrong data')).digest('base64');
      res.setHeader('x-goog-hash', 'md5=' + wrongMd5);
      res.send(body);
    });

    // Endpoint that returns x-goog-hash with multiple algorithms
    app.get('/api/x-goog-hash-multi', (_req, res) => {
      const body = Buffer.from('valid content data');
      const md5 = crypto.createHash('md5').update(body).digest('base64');
      res.setHeader('x-goog-hash', 'crc32c=AAAA, md5=' + md5);
      res.send(body);
    });

    // Endpoint that returns data with correct Repr-Digest sha-256 header
    app.get('/api/repr-digest-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      res.setHeader('repr-digest', 'sha-256=:' + sha256 + ':');
      res.send(body);
    });

    // Endpoint that returns data with wrong Repr-Digest sha-256 header
    app.get('/api/repr-digest-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      const wrongBody = Buffer.from('tampered content data');
      res.setHeader('repr-digest', 'sha-256=:' + sha256 + ':');
      res.send(wrongBody);
    });

    // Endpoint with gzip and Repr-Digest of the decompressed body (common but non-conformant, must be skipped)
    app.get('/api/repr-digest-gzip', (_req, res) => {
      const body = Buffer.from('valid content data');
      const compressed = zlib.gzipSync(body);
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'repr-digest': 'sha-256=:' + sha256 + ':',
        'content-type': 'application/octet-stream'
      });
      res.end(compressed);
    });

    // Endpoint with gzip and a Repr-Digest matching nothing (must be skipped, not failed)
    app.get('/api/gzip-repr-digest-wrong', (_req, res) => {
      const body = Buffer.from('valid content data');
      const compressed = zlib.gzipSync(body);
      const sha256 = crypto.createHash('sha256').update(Buffer.from('unrelated bytes')).digest('base64');
      res.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'repr-digest': 'sha-256=:' + sha256 + ':',
        'content-type': 'application/octet-stream'
      });
      res.end(compressed);
    });

    // Endpoint that returns x-amz-checksum-crc32 (unknown algorithm, should be skipped)
    app.get('/api/amz-checksum-crc32', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('x-amz-checksum-crc32', 'somecrc32hash');
      res.send(body);
    });

    // Endpoint that mimics S3 multipart GET: composite checksum value with -N suffix (must be skipped)
    app.get('/api/amz-checksum-multipart', (_req, res) => {
      const body = Buffer.from('valid content data');
      const composite = crypto.createHash('sha256').update(Buffer.from('checksum of checksums')).digest('base64');
      res.setHeader('x-amz-checksum-sha256', composite + '-2');
      res.send(body);
    });

    // Endpoint that mimics S3 multipart GET flagged via x-amz-checksum-type COMPOSITE (must be skipped)
    app.get('/api/amz-checksum-composite-type', (_req, res) => {
      const body = Buffer.from('valid content data');
      const unrelated = crypto.createHash('sha256').update(Buffer.from('unrelated bytes')).digest('base64');
      res.setHeader('x-amz-checksum-sha256', unrelated);
      res.setHeader('x-amz-checksum-type', 'COMPOSITE');
      res.send(body);
    });

    // Endpoint with correct legacy Content-MD5 header
    app.get('/api/content-md5-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('content-md5', crypto.createHash('md5').update(body).digest('base64'));
      res.send(body);
    });

    // Endpoint with wrong legacy Content-MD5 header
    app.get('/api/content-md5-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('content-md5', crypto.createHash('md5').update(Buffer.from('unrelated bytes')).digest('base64'));
      res.send(body);
    });

    // Endpoint with correct RFC 3230 Digest header
    app.get('/api/digest-rfc3230-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('digest', 'SHA-256=' + crypto.createHash('sha256').update(body).digest('base64'));
      res.send(body);
    });

    // Endpoint with a correct ownCloud OC-Checksum header (hex SHA1)
    app.get('/api/oc-checksum-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('oc-checksum', 'SHA1:' + crypto.createHash('sha1').update(body).digest('hex'));
      res.send(body);
    });

    // Endpoint with a wrong ownCloud OC-Checksum header (hex SHA1)
    app.get('/api/oc-checksum-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      res.setHeader('oc-checksum', 'SHA1:' + crypto.createHash('sha1').update(Buffer.from('unrelated bytes')).digest('hex'));
      res.send(body);
    });

    // Endpoint returning 206 with a whole-object digest header and a partial body
    app.get('/api/partial-digest-206', (_req, res) => {
      const full = Buffer.from('valid content data');
      const part = full.subarray(0, 5);
      const sha256 = crypto.createHash('sha256').update(full).digest('base64');
      res.writeHead(206, {
        'content-range': 'bytes 0-4/' + full.length,
        'repr-digest': 'sha-256=:' + sha256 + ':',
        'content-length': part.length,
        'content-type': 'application/octet-stream'
      });
      res.end(part);
    });

    // Endpoint sending a correct Repr-Digest in HTTP trailers (chunked response)
    app.get('/api/trailer-repr-digest-ok', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(body).digest('base64');
      res.setHeader('Trailer', 'Repr-Digest');
      res.setHeader('content-type', 'application/octet-stream');
      res.write(body);
      res.addTrailers({'Repr-Digest': 'sha-256=:' + sha256 + ':'});
      res.end();
    });

    // Endpoint sending a wrong Repr-Digest in HTTP trailers (chunked response)
    app.get('/api/trailer-repr-digest-bad', (_req, res) => {
      const body = Buffer.from('valid content data');
      const sha256 = crypto.createHash('sha256').update(Buffer.from('unrelated bytes')).digest('base64');
      res.setHeader('Trailer', 'Repr-Digest');
      res.setHeader('content-type', 'application/octet-stream');
      res.write(body);
      res.addTrailers({'Repr-Digest': 'sha-256=:' + sha256 + ':'});
      res.end();
    });

    // Endpoint that returns data with correct Content-Length
    app.get('/api/content-length-ok', (_req, res) => {
      const body = Buffer.from('exact length content');
      res.setHeader('content-length', body.length);
      res.send(body);
    });

    // Endpoint that returns data with wrong Content-Length (too large),
    // then forcefully closes the connection so the client sees a truncated response.
    app.get('/api/content-length-mismatch', (_req, res) => {
      const body = Buffer.from('actual content');
      res.writeHead(200, {
        'content-length': 999,
        'content-type': 'application/octet-stream'
      });
      res.write(body);
      res.destroy();
    });

    // Endpoint that mirrors whole request - handles any HTTP method
    app.use('/api/mirror', express.json(), express.urlencoded({extended: true}), (req, res) => {
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
    proxyApp.use((req, res) => {
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
        headers: {...req.headers}
      };

      const proxyReq = http.request(options, proxyRes => {
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
      proxyReq.on('error', error => {
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
          {timeout: {connectionAndInactivity: '100ms'}, limit: 1024 * 1024} // connectionAndInactivity shorter than the server delay
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
        {timeout: {connectionAndInactivity: '300ms'}, limit: 1024 * 1024} // connectionAndInactivity longer than the server delay (200ms)
      );

      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({success: true});
    });

    test.concurrent('wholeCycle triggers even when server starts sending data but does not complete', async () => {
      try {
        await utils.downloadUrlPromise(
          ctx,
          `${BASE_URL}/api/partial-response`,
          {timeout: {wholeCycle: '1s'}, limit: 1024 * 1024} // wholeCycle shorter than time needed for response
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
          {timeout: {connectionAndInactivity: '150ms'}, limit: 1024 * 1024} // connectionAndInactivity shorter than the second delay
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
        {timeout: {connectionAndInactivity: '250ms'}, limit: 1024 * 1024} // connectionAndInactivity longer than the longest delay (2s)
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
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/slow-body`, {timeout: {wholeCycle: '1s'}, limit: 1024 * 1024});

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
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/data`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });

      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({success: true});
    });

    test.concurrent('throws error on timeout', async () => {
      try {
        await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/timeout`, {
          timeout: {wholeCycle: '1s', connectionAndInactivity: '500ms'},
          limit: 1024 * 1024
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('ESOCKETTIMEDOUT');
      }
    });

    test.concurrent('throws error on wholeCycle timeout', async () => {
      try {
        await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/timeout`, {
          timeout: {wholeCycle: '1s', connectionAndInactivity: '5000ms'},
          limit: 1024 * 1024
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('ETIMEDOUT');
      }
    });

    test.concurrent('follows redirects correctly', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/redirect`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });

      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      expect(JSON.parse(result.body.toString())).toEqual({success: true});
    });

    test.concurrent(`doesn't follow redirects(maxRedirects=0)`, async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {
            'User-Agent': 'DocumentServer',
            Connection: 'Keep-Alive'
          },
          decompress: true,
          rejectUnauthorized: false,
          followRedirect: true,
          maxRedirects: 0
        }
      });

      try {
        await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/redirect`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });
      } catch (error) {
        // New implementation path (Axios)
        expect(error.statusCode).toBe(302);
      }
    });

    test.concurrent(`doesn't follow redirects(followRedirect=false)`, async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {
            'User-Agent': 'DocumentServer',
            Connection: 'Keep-Alive'
          },
          decompress: true,
          rejectUnauthorized: false,
          followRedirect: false,
          maxRedirects: 100
        }
      });

      try {
        await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/redirect`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });

        // Old implementation path
      } catch (error) {
        // New implementation path (Axios)
        expect(error.statusCode).toBe(302);
      }
    });

    test.concurrent('throws error on server error', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/error`, {timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'}, limit: 1024 * 1024})
      ).rejects.toMatchObject({code: 'ERR_BAD_RESPONSE'});
    });

    test.concurrent('throws error when content-length exceeds limit', async () => {
      try {
        await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/large`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }

      try {
        await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/large-chunked`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
    });

    test.concurrent('throws error when content-length exceeds limit with stream', async () => {
      try {
        const {stream} = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/large`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024,
          returnStream: true
        });
        await buffer(stream);
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
      try {
        const {stream} = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/large-chunked`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024,
          returnStream: true
        });
        await buffer(stream);
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.code).toBe('EMSGSIZE');
      }
    });

    test.concurrent('enables compression when gzip is true', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'DocumentServer'},
          gzip: true,
          rejectUnauthorized: false
        }
      });

      const response = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror`, {timeout: {wholeCycle: '2s'}, limit: 1024 * 1024});

      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      // When gzip is true, 'accept-encoding' should include 'gzip'
      expect(responseBody.headers?.['accept-encoding']).toBeDefined();
      expect(responseBody.headers?.['accept-encoding']).toMatch(/gzip/i);
    });

    test.concurrent('disables compression when gzip is false', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'DocumentServer'},
          gzip: false,
          rejectUnauthorized: false
        }
      });

      const response = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror`, {timeout: {wholeCycle: '2s'}, limit: 1024 * 1024});

      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      expect(responseBody.headers?.['accept-encoding'] === 'identity' || responseBody.headers?.['accept-encoding'] === undefined).toBe(true);
    });

    test.concurrent('enables keep-alive when forever is true', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'DocumentServer'},
          forever: true,
          rejectUnauthorized: false
        }
      });

      const response = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror`, {timeout: {wholeCycle: '2s'}, limit: 1024 * 1024});

      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      // When forever is true, connection should be 'keep-alive'
      expect(responseBody.headers?.connection?.toLowerCase()).toMatch(/keep-alive/i);
    });

    test.concurrent('disables keep-alive when forever is false', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {
            'User-Agent': 'DocumentServer'
          },
          forever: false,
          rejectUnauthorized: false
        }
      });

      const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });

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
      const defaultHeaders = {'user-agent': 'DocumentServer'};
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: defaultHeaders
        }
      });
      const customHeaders = {'custom-header': 'test-value', 'set-cookie': ['cookie']};
      const customQueryParams = {'custom-query-param': 'value'};
      const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror?${new URLSearchParams(customQueryParams).toString()}`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        headers: customHeaders
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.headers).toMatchObject({...defaultHeaders, ...customHeaders});
      expect(body.query).toMatchObject(customQueryParams);
    });

    test.concurrent('replays x-amz-checksum-mode when the presigned URL is signed with it', async () => {
      const url = `${BASE_URL}/api/mirror?X-Amz-Signature=fake&X-Amz-SignedHeaders=host%3Bx-amz-checksum-mode`;
      const result = await utils.downloadUrlPromise(ctx, url, {timeout: {wholeCycle: '5s'}, limit: 1024 * 1024});
      const body = JSON.parse(result.body);
      expect(body.headers['x-amz-checksum-mode']).toBe('ENABLED');
    });

    test.concurrent('does not send x-amz-checksum-mode for an ordinary host-only presigned URL', async () => {
      const url = `${BASE_URL}/api/mirror?X-Amz-Signature=fake&X-Amz-SignedHeaders=host`;
      const result = await utils.downloadUrlPromise(ctx, url, {timeout: {wholeCycle: '5s'}, limit: 1024 * 1024});
      const body = JSON.parse(result.body);
      expect(body.headers['x-amz-checksum-mode']).toBeUndefined();
    });

    test.concurrent('does not send x-amz-checksum-mode for a non-S3 URL', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/mirror`, {timeout: {wholeCycle: '5s'}, limit: 1024 * 1024});
      const body = JSON.parse(result.body);
      expect(body.headers['x-amz-checksum-mode']).toBeUndefined();
    });

    test.concurrent('successfully routes GET request through a real proxy', async () => {
      try {
        // Create context with proxy configuration
        const mockCtx = createMockContext({
          'externalRequest.action': {
            allow: true,
            blockPrivateIP: false,
            proxyUrl: PROXY_URL,
            proxyUser: {
              username: 'proxyuser',
              password: 'proxypass'
            },
            proxyHeaders: {
              'X-Proxy-Custom': 'custom-value'
            }
          }
        });

        // Make a GET request through the proxy
        const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/data`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });

        // Verify the request was successful
        expect(result).toBeDefined();
        expect(getStatusCode(result.response)).toBe(200);
        expect(JSON.parse(result.body.toString())).toEqual({success: true});

        // Verify the request went through our proxy
        expect(proxiedRequests.length).toBeGreaterThan(0);
        const proxyRequest = proxiedRequests.find(r => r.method === 'GET' && r.url.includes('/api/data'));
        expect(proxyRequest).toBeDefined();
        expect(proxyRequest.url).toContain(`${BASE_URL}/api/data`);
        // Check for Base64 encoded authorization header (starts with "Basic ")
        expect(proxyRequest.headers['proxy-authorization']).toMatch(/^Basic /);
        expect(proxyRequest.headers['x-proxy-custom']).toBe('custom-value');
      } finally {
        // No need to clean up proxy server here anymore
      }
    });

    test.concurrent('passes validation when Content-Length matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-length-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws ESOCKETTIMEDOUT when Content-Length header says more bytes than body', async () => {
      // The server sends Content-Length: 999 but only 14 bytes of body, then destroys the connection.
      // The client detects the mismatch as an incomplete response -> ESOCKETTIMEDOUT.
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-length-mismatch`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'ESOCKETTIMEDOUT'});
    });

    test.concurrent('passes validation when Content-Digest sha256 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-digest-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when Content-Digest sha256 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-digest-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('passes validation when x-amz-checksum-sha256 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
      // observability: the verified source/algorithm is exposed for the downloadFile complete log
      expect(result.getIntegrity()).toEqual({source: 'x-amz-checksum-sha256', algorithm: 'sha256'});
    });

    test.concurrent('getIntegrity reports the caller-provided WOPI digest source', async () => {
      const sha256 = crypto.createHash('sha256').update(Buffer.from('valid content data')).digest('base64');
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/plain-content`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        expectedDigest: {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256}
      });
      expect(result.getIntegrity()).toEqual({source: 'WOPI SHA256', algorithm: 'sha256'});
    });

    test.concurrent('getIntegrity returns null when no external digest was verified', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/plain-content`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
      expect(result.getIntegrity()).toBeNull();
    });

    test.concurrent('getIntegrity reports the source after a returnStream download is consumed', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        returnStream: true
      });
      // integrity is only populated once the stream ends, mirroring downloadFile which reads it after its pipeline
      await buffer(result.stream);
      expect(result.getIntegrity()).toEqual({source: 'x-amz-checksum-sha256', algorithm: 'sha256'});
    });

    test.concurrent('throws EBADDIGEST when x-amz-checksum-sha256 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('passes when x-amz-checksum-sha256 carries a multipart -N suffix (composite, skipped)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-multipart`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes when x-amz-checksum-type is COMPOSITE (skipped)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-composite-type`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes with gzip Content-Length mismatch (skip check)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/gzip-content-length`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('skips Content-Digest under gzip (digest of encoded bytes is not comparable)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/gzip-content-digest-encoded`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('does not fail on unverifiable Content-Digest under gzip', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/gzip-content-digest-wrong`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes when x-amz-checksum-crc32 (unsupported, skipped)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/amz-checksum-crc32`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes validation when x-goog-hash md5 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/x-goog-hash-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when x-goog-hash md5 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/x-goog-hash-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('passes with x-goog-hash multi (crc32c skipped, md5 matches)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/x-goog-hash-multi`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes validation when Repr-Digest sha-256 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/repr-digest-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when Repr-Digest sha-256 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/repr-digest-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('skips Repr-Digest under gzip (RFC 9530 ties digests to the content coding)', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/repr-digest-gzip`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('does not fail on unverifiable Repr-Digest under gzip', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/gzip-repr-digest-wrong`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(result).toBeDefined();
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes validation when Content-MD5 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-md5-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when Content-MD5 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/content-md5-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('passes validation when RFC 3230 Digest matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/digest-rfc3230-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes validation when OC-Checksum SHA1 matches', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/oc-checksum-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when OC-Checksum SHA1 does not match', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/oc-checksum-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('skips digest checks on 206 partial responses', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/partial-digest-206`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(206);
      expect(result.body.length).toBe(5);
    });

    test.concurrent('verifies Repr-Digest delivered in HTTP trailers', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/trailer-repr-digest-ok`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST for wrong Repr-Digest in HTTP trailers', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/trailer-repr-digest-bad`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('throws EBADDIGEST in stream mode for wrong Repr-Digest', async () => {
      const {stream} = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/repr-digest-bad`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        returnStream: true
      });
      await expect(buffer(stream)).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('throws EBADDIGEST in stream mode for wrong x-goog-hash md5', async () => {
      const {stream} = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/x-goog-hash-bad`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        returnStream: true
      });
      await expect(buffer(stream)).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('sends Want-Repr-Digest when checksumVerification is enabled', async () => {
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/mirror`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(JSON.parse(result.body).headers['want-repr-digest']).toBe('sha-256=10');
    });

    test.concurrent('checksumVerification=false disables digest checks and Want-Repr-Digest', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'Node.js/6.13'},
          checksumVerification: false,
          rejectUnauthorized: false
        }
      });
      const mirror = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/mirror`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(JSON.parse(mirror.body).headers['want-repr-digest']).toBeUndefined();
      const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/repr-digest-bad`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('passes when a caller-provided expectedDigest matches', async () => {
      const sha256 = crypto.createHash('sha256').update(Buffer.from('valid content data')).digest('base64');
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/plain-content`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        expectedDigest: {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256}
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('throws EBADDIGEST when a caller-provided expectedDigest does not match', async () => {
      const wrong = crypto.createHash('sha256').update(Buffer.from('tampered content data')).digest('base64');
      await expect(
        utils.downloadUrlPromise(ctx, `${BASE_URL}/api/plain-content`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024,
          expectedDigest: {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: wrong}
        })
      ).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test.concurrent('verifies a caller-provided expectedDigest against decoded bytes under gzip', async () => {
      const sha256 = crypto.createHash('sha256').update(Buffer.from('valid content data')).digest('base64');
      const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/gzip-content-length`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        expectedDigest: {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256}
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('checksumVerification=false disables caller-provided expectedDigest verification', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'Node.js/6.13'},
          checksumVerification: false,
          rejectUnauthorized: false
        }
      });
      const wrong = crypto.createHash('sha256').update(Buffer.from('tampered content data')).digest('base64');
      const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/plain-content`, {
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        limit: 1024 * 1024,
        expectedDigest: {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: wrong}
      });
      expect(getStatusCode(result.response)).toBe(200);
    });

    test.concurrent('should return 205 status code for /status/205', async () => {
      try {
        await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/status/205`, {
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          limit: 1024 * 1024
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.message).toContain('Error response:');
        expect(error.statusCode).toBe(205);
      }
    });
  });

  test.concurrent('handles binary data correctly', async () => {
    const result = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/binary`, {
      timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
      limit: 1024 * 1024
    });

    // Expected binary data (PNG file signature)
    const expectedData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    const {stream} = await utils.downloadUrlPromise(ctx, `${BASE_URL}/api/binary`, {
      timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
      limit: 1024 * 1024,
      returnStream: true
    });
    const receivedData = await buffer(stream);
    const expectedData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(Buffer.isBuffer(receivedData)).toBe(true);
    expect(receivedData.length).toBe(expectedData.length);
    expect(Buffer.compare(receivedData, expectedData)).toBe(0);
  });

  test.concurrent('block external requests', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        allow: false, // Block all external requests
        blockPrivateIP: false,
        proxyUrl: '',
        proxyUser: {
          username: '',
          password: ''
        },
        proxyHeaders: {}
      }
    });

    // Use rejects.toThrow to test the error message
    await expect(
      utils.downloadUrlPromise(mockCtx, 'https://example.com/test', {timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'}, limit: 1024 * 1024})
    ).rejects.toThrow('Block external request. See externalRequest config options');
  });

  test.concurrent('allows request to external url in allowlist', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        allow: false, // Block external requests by default
        blockPrivateIP: false,
        proxyUrl: '',
        proxyUser: {
          username: '',
          password: ''
        },
        proxyHeaders: {}
      },
      'externalRequest.directIfIn': {
        allowList: [`${BASE_URL}`], // Allow our test server
        jwtToken: false
      }
    });

    const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/data`, {
      timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
      limit: 1024 * 1024
    });

    expect(result).toBeDefined();
    expect(getStatusCode(result.response)).toBe(200);
    expect(JSON.parse(result.body.toString())).toEqual({success: true});
  });

  test.concurrent('allows request when URL is in JWT token', async () => {
    const mockCtx = createMockContext({
      'externalRequest.action': {
        allow: false, // Block external requests by default
        blockPrivateIP: false,
        proxyUrl: '',
        proxyUser: {
          username: '',
          password: ''
        },
        proxyHeaders: {}
      },
      'externalRequest.directIfIn': {
        allowList: [], // Empty allowlist
        jwtToken: true // Allow URLs from JWT token
      }
    });

    const result = await utils.downloadUrlPromise(mockCtx, `${BASE_URL}/api/data`, {
      timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
      limit: 1024 * 1024,
      isInJwtToken: true
    });

    expect(result).toBeDefined();
    expect(getStatusCode(result.response)).toBe(200);
    expect(JSON.parse(result.body.toString())).toEqual({success: true});
  });

  describe('postRequestPromise', () => {
    test.concurrent('successfully posts data', async () => {
      const postData = JSON.stringify({test: 'data'});

      const result = await utils.postRequestPromise(ctx, `${BASE_URL}/api/post`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        headers: {'Content-Type': 'application/json'}
      });

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({received: {test: 'data'}});
    });

    test.concurrent('handles timeout during post', async () => {
      const postData = JSON.stringify({test: 'data'});

      await expect(
        utils.postRequestPromise(ctx, `${BASE_URL}/api/timeout`, {
          data: postData,
          dataSize: postData.length,
          timeout: {wholeCycle: '1s', connectionAndInactivity: '500ms'},
          headers: {'Content-Type': 'application/json'}
        })
      ).rejects.toMatchObject({code: 'ESOCKETTIMEDOUT'});
    });

    test.concurrent('handles post with Authorization header', async () => {
      const postData = JSON.stringify({test: 'data'});
      const authToken = 'test-auth-token';

      const result = await utils.postRequestPromise(ctx, `${BASE_URL}/api/post`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        authorization: authToken,
        headers: {'Content-Type': 'application/json'}
      });

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({received: {test: 'data'}});
    });

    test.concurrent('handles post with custom headers', async () => {
      const postData = JSON.stringify({test: 'data'});
      const customHeaders = {
        'X-Custom-Header': 'test-value',
        'Content-Type': 'application/json'
      };

      const result = await utils.postRequestPromise(ctx, `${BASE_URL}/api/post`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        headers: customHeaders
      });

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({received: {test: 'data'}});
    });

    test.concurrent('handles post with stream data', async () => {
      const postData = JSON.stringify({test: 'stream-data'});
      const postStream = new Readable({
        read() {
          this.push(postData);
          this.push(null);
        }
      });

      const result = await utils.postRequestPromise(ctx, `${BASE_URL}/api/post`, {
        dataStream: postStream,
        dataSize: postData.length,
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        headers: {'Content-Type': 'application/json'}
      });

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({received: {test: 'stream-data'}});
    });

    test.concurrent('throws error on wholeCycle timeout during post', async () => {
      const postData = JSON.stringify({test: 'data'});

      await expect(
        utils.postRequestPromise(ctx, `${BASE_URL}/api/timeout`, {
          data: postData,
          dataSize: postData.length,
          timeout: {wholeCycle: '1s', connectionAndInactivity: '5s'},
          headers: {'Content-Type': 'application/json'}
        })
      ).rejects.toMatchObject({code: 'ETIMEDOUT'});
    });

    test.concurrent('blocks external post requests when configured', async () => {
      const mockCtx = createMockContext({
        'externalRequest.action': {
          allow: false,
          blockPrivateIP: false,
          proxyUrl: '',
          proxyUser: {
            username: '',
            password: ''
          },
          proxyHeaders: {}
        }
      });

      const postData = JSON.stringify({test: 'data'});

      await expect(
        utils.postRequestPromise(mockCtx, 'https://example.com/api/post', {
          data: postData,
          dataSize: postData.length,
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          headers: {'Content-Type': 'application/json'}
        })
      ).rejects.toThrow('Block external request. See externalRequest config options');
    });

    test.concurrent('allows post request when URL is in JWT token', async () => {
      const mockCtx = createMockContext({
        'externalRequest.action': {
          allow: false,
          blockPrivateIP: false,
          proxyUrl: '',
          proxyUser: {
            username: '',
            password: ''
          },
          proxyHeaders: {}
        },
        'externalRequest.directIfIn': {
          allowList: [],
          jwtToken: true
        }
      });

      const postData = JSON.stringify({test: 'data'});

      const result = await utils.postRequestPromise(mockCtx, `${BASE_URL}/api/post`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
        isInJwtToken: true,
        headers: {'Content-Type': 'application/json'}
      });

      expect(result).toBeDefined();
      expect(result.response.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({received: {test: 'data'}});
    });

    test.concurrent('applies gzip setting to POST requests', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'DocumentServer'},
          gzip: false,
          rejectUnauthorized: false
        }
      });

      const postData = JSON.stringify({test: 'data'});

      const response = await utils.postRequestPromise(mockCtx, `${BASE_URL}/api/mirror`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '2s'},
        headers: {'Content-Type': 'application/json'}
      });

      // Parse the response body assuming it's JSON
      const responseBody = JSON.parse(response.body);

      expect(responseBody.headers?.['accept-encoding'] === 'identity' || responseBody.headers?.['accept-encoding'] === undefined).toBe(true);
    });

    test.concurrent('applies forever setting to POST requests', async () => {
      const mockCtx = createMockContext({
        'services.CoAuthoring.requestDefaults': {
          headers: {'User-Agent': 'DocumentServer'},
          forever: true,
          rejectUnauthorized: false
        }
      });

      const postData = JSON.stringify({test: 'data'});

      const response = await utils.postRequestPromise(mockCtx, `${BASE_URL}/api/mirror`, {
        data: postData,
        dataSize: postData.length,
        timeout: {wholeCycle: '2s'},
        headers: {'Content-Type': 'application/json'}
      });

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
            allow: true,
            blockPrivateIP: false,
            proxyUrl: PROXY_URL,
            proxyUser: {
              username: 'proxyuser',
              password: 'proxypass'
            },
            proxyHeaders: {
              'X-Post-Proxy': 'post-proxy-value'
            }
          }
        });

        // Test POST request
        const postData = JSON.stringify({nested: {test: 'complex-data'}});

        const postResult = await utils.postRequestPromise(mockCtx, `${BASE_URL}/api/post`, {
          data: postData,
          dataSize: postData.length,
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          authorization: 'auth-token',
          headers: {'Content-Type': 'application/json', 'X-Custom': 'test-value'}
        });

        // Verify the post request
        expect(postResult).toBeDefined();
        expect(postResult.response.statusCode).toBe(200);
        expect(JSON.parse(postResult.body)).toEqual({
          received: {nested: {test: 'complex-data'}}
        });

        // Verify proxy headers and auth
        const postProxyRequest = proxiedRequests.find(r => r.method === 'POST' && r.url.includes('/api/post'));

        expect(postProxyRequest).toBeDefined();
        // Check for Base64 encoded authorization header (starts with "Basic ")
        expect(postProxyRequest.headers['proxy-authorization']).toMatch(/^Basic /);
        expect(postProxyRequest.headers['x-post-proxy']).toBe('post-proxy-value');
        expect(postProxyRequest.headers['content-type']).toBe('application/json');
        expect(postProxyRequest.headers['x-custom']).toBe('test-value');
        expect(postProxyRequest.headers['authorization']).toContain('Bearer auth-token');

        // Verify post body was correctly sent
        expect(JSON.parse(postProxyRequest.body)).toEqual({nested: {test: 'complex-data'}});
      } finally {
        // No need to clean up proxy server here anymore
      }
    });

    test.concurrent('should return 205 status code for /status/205', async () => {
      try {
        const postData = JSON.stringify({test: 'data'});

        await utils.postRequestPromise(ctx, `${BASE_URL}/api/status/205`, {
          data: postData,
          dataSize: postData.length,
          timeout: {wholeCycle: '5s', connectionAndInactivity: '3s'},
          headers: {'Content-Type': 'application/json'}
        });
        throw new Error('Expected an error to be thrown');
      } catch (error) {
        expect(error.message).toContain('Error response:');
        expect(error.statusCode).toBe(205);
      }
    });
  });
});
