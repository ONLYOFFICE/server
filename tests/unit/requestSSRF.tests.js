const GOOD_HOST = '127.0.0.1';
const BAD_HOST = '127.0.0.2';

const GOOD_PORT = 4668;
const GOOD_PORT_REDIRECT = 4667;
const BAD_PORT = 4669;

process.env['NODE_CONFIG'] = JSON.stringify({
  "services": {
    "CoAuthoring": {
      "request-filtering-agent": {
        "allowPrivateIPAddress": false,
        "allowMetaIPAddress": false,
        "allowIPAddressList": [
          GOOD_HOST
        ]
      }
    }
  }
});

// Required modules
const { describe, test, expect, beforeAll, afterAll, it, jest } = require('@jest/globals');
const http = require('http');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');


// Common test parameters
const commonTestParams = {
  uri: `http://${GOOD_HOST}:${GOOD_PORT}`,
  timeout: 5000,
  limit: 1024 * 1024, // 1MB
  authorization: 'Bearer token123',
  filterPrivate: true,
  headers: { 'Accept': 'application/json' }
};
const ctx = operationContext.global;

describe('Server-Side Request Forgery (SSRF)', () => {
    let goodServer, goodServerRedirect, badServer;

    beforeAll(() => {
      
        goodServer = http.createServer(function (req, res) {
            res.write('good');
            res.end();
        }).listen(GOOD_PORT);

        goodServerRedirect = http.createServer(function (req, res) {
          console.log(`Received request for: ${req.url}`);

          // Set redirect status code (301 for permanent redirect, 302 for temporary)
          res.statusCode = 302;
          
          // Set the Location header to the redirect destination
          res.setHeader('Location', `http://${BAD_HOST}:${BAD_PORT}`);
          
          // You can add other headers if needed
          res.setHeader('Content-Type', 'text/plain');
          
          // Send a brief message in the body (optional)
          res.end(`Redirecting to http://${BAD_HOST}:${BAD_PORT}`);
        }).listen(GOOD_PORT_REDIRECT);

        badServer = http.createServer(function (req, res) {
            res.write('bad');
            res.end();
        }).listen(BAD_PORT);
    })

    afterAll(() => {
        goodServer.close();
        goodServerRedirect.close();
        badServer.close();
    });

    it('should fetch', async () => {
      const result = await utils.downloadUrlPromise(
        ctx,
        `http://${GOOD_HOST}:${GOOD_PORT}`,
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null
      );

      expect(result.body.toString()).toBe('good');
    });

    it('should not fetch: denied ip', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `http://${BAD_HOST}:${BAD_PORT}`,
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null
      )).rejects.toThrow();
    });

    it('should not fetch: redirect to denied ip', async () => {
      await expect(utils.downloadUrlPromise(
        ctx,
        `http://${GOOD_HOST}:${GOOD_PORT_REDIRECT}`,
        commonTestParams.timeout,
        commonTestParams.limit,
        null,
        false,
        null
      )).rejects.toThrow();
    });
});