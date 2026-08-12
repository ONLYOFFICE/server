/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU AGPL v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const {describe, expect, beforeAll, afterAll, beforeEach, it} = require('@jest/globals');
const net = require('net');
const https = require('https');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

// Suppress DEBUG noise from the egress helpers; matches production log level
require('../../Common/sources/logger').configureLogger({categories: {default: {level: 'warn'}}});

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
// Explicit short timeout so a hung tunnel fails the test quickly instead of hitting the jest hook timeout
const REQUEST_TIMEOUT = {connectionAndInactivity: '5s', wholeCycle: '5s'};
// Jest timeout kept above the network timeout so the request error surfaces instead of a jest kill
const JEST_TIMEOUT = 15000;

// Throwaway self-signed localhost pair (valid to 2126), used only to stand up the https origin stub below
const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCqhK2DPgygFYIC
yWxrR7jOVyEfLCY8gcPoGKwvDnbZWMYMkH3YtrE/cJ+fJXDKtwx7PLRgLQhSyLXL
P+FYhrvh4SK1NdWAiJjBpgBezX/uq/xoGJbr0pW1S35dlVxQ3jGyO9mC59evb3jq
w3cRsIaY0TrfpGwHxHktKN1bucp6ul0FVr2/1rXVUB5SJ996Acqjf1m2d2IdmTNw
Mozd3BMavegPpqCEvMEhSylQ0KpcXQj3/G1riNaUuwspuRbaEZsDP+G8uPkyQPQ3
rogutnGuJwf46wPIOv1GjJpx7uCJ3xiCLAq61T7rwqj1smuqOOV33m+3UQs2PKPD
q7z8WhBBAgMBAAECggEAPKqUovdt/Xx5c21fPfHX/c2A8rq95dQTM52nkNxYC27q
k2jK5VHmUNhMag4jiXPDpIrN79PFvNI835GcJmdVLAFx3D/JdH/kvSzGv/Pj+rHE
zPJGq6MR8VzpGfl8TScoTi297rV2hqulvPyK/cess2zpQc0ZRFAx/o+l5a79q1jS
IiaB0DYVYp1SnJYKv/0aq/bnVB0gCLTi2fs/T9916Swm57eyENSHlSpPoEV6cnpX
Py/cRraxhdv+6VH3u+aFjWixmHoioPJF9mYlSXxJag4WtSS9f6BA01DDmZASKOSD
mSjmVvjc4nEwo6dczC2wZSebbIKkDjGyL1TjmNzmkwKBgQDoXbdVybFbDl278opj
A70eRWv1iglz9A5hceQe+suC/C4VA9/KkqvPjHbtQTbeJE/yIXpO5hnxBYZ5go7R
fhfgeyfn2RitNSx/vjsqJdeb5RGA8PblbXeW0wVzKKa0ZTNcXFgFNpfZBUbAM8tw
G+x4466GQ87KzaOGBOY/VXBm/wKBgQC73JXklIj/IsUzpuFlL3gymEKOLMPJhqoc
XQvMP2dNXQzSzOcAiigVZ6OjBj1fBNF9p1s1dM4oDLzPCPnZ9fJ0kQRk+AjDoTHe
ocExQQHOMIPYV3HUn8sNp7CZ96uozDVUCL/aPMR9UkiwjOTaagt8aEUNQlIS0CtG
TXggKPrIvwKBgGuP3isPB1NQLiGvX1IATA30MsphkIilY/bFosSYcZZ7p9VAitqZ
1IBp1C91bbGc+4jo6FYXe9CvLxWWUwg0p1bZi5puS1b6c1PaukaDZ/AZNGYMpS2E
48PkgPRS0ABXjFPnxzL6l4X1RE/6aeTGeEtpkcNDJjmIwXZrVC3jHfn/AoGAZFAm
jhcujCZR7QHYa4KMiV+6cla++TZ6UYjxys+0ZqAgP9QAKc6cFsnvnBax4LIe9xzN
XF8R0lry2w6s89Eb9ViWYx/69hN2IK55DcbrouFPFc+jzejBsXnwmFajCBB7DXNa
lrtKJK0yeWvSrDpiBb1b2fenAbq80N5/HZUkTNsCgYBcsoa+4V0J6sH7BB3nF6ti
lcODcnz1vjp3ahxuwbFvBzC3gSuvbbmbCXjTNrcFHqp8OUMezsCOuvWJc47qasK4
K3xOz4E/sY5WbvlQ49Yl38HgmUkUZTh519eH7uwsX1wIofjsM78Xd9rJq1tW9tq7
2ZtDLKLnGwRKzoetUObY+A==
-----END PRIVATE KEY-----`;
const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUF1+LiRdhREq0gPKYVYBc7tw/N38wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDgxMjEzMzYwNloYDzIxMjYw
NzE5MTMzNjA2WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCqhK2DPgygFYICyWxrR7jOVyEfLCY8gcPoGKwvDnbZ
WMYMkH3YtrE/cJ+fJXDKtwx7PLRgLQhSyLXLP+FYhrvh4SK1NdWAiJjBpgBezX/u
q/xoGJbr0pW1S35dlVxQ3jGyO9mC59evb3jqw3cRsIaY0TrfpGwHxHktKN1bucp6
ul0FVr2/1rXVUB5SJ996Acqjf1m2d2IdmTNwMozd3BMavegPpqCEvMEhSylQ0Kpc
XQj3/G1riNaUuwspuRbaEZsDP+G8uPkyQPQ3rogutnGuJwf46wPIOv1GjJpx7uCJ
3xiCLAq61T7rwqj1smuqOOV33m+3UQs2PKPDq7z8WhBBAgMBAAGjbzBtMB0GA1Ud
DgQWBBT36L5Eb5E6b2W9tIzo7gWHDDvxrzAfBgNVHSMEGDAWgBT36L5Eb5E6b2W9
tIzo7gWHDDvxrzAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGHBH8AAAGCCWxv
Y2FsaG9zdDANBgkqhkiG9w0BAQsFAAOCAQEAOVjuMAvlQI7XObM5cS4Lda/JwDhv
fe8B5qGa8KYQx9ir3AZHeTIbzKdEIkDijmQzrARuWVY1gw8BaR9kGkG/gMrxHFgm
siRrsM5yANvGkWn4utl37rlT8BSXtLodNxMlTxMsnpAIfDXh4R045SVvb47Hms8N
3CF6cWi+ZNsQIirs+Mr1BKIfbA5OaE9AMHMRG1oWcLQJDa/17hxyz9Z+Hjgz3pdF
LihrexHwVVSGKtNF8HG5OfZ2b+3ZYcEjQhLDISGdVNgbLCjq5AeRfu68xwLfv1cd
YMg7tj/wIu4RFfStH1rEggJSKsEffgwu0wZ4uMTBNBOUL6g/ffFWebgz9A==
-----END CERTIFICATE-----`;

// Build a context whose config overrides externalRequest and requestDefaults, mirroring the tenant override mechanism
function makeCtx(action) {
  const c = new operationContext.Context();
  c.config = {
    externalRequest: {
      action: {
        allow: true,
        blockPrivateIP: false,
        proxyUrl: '',
        proxyUser: {username: '', password: ''},
        proxyHeaders: {},
        ...action
      },
      directIfIn: {allowList: [], jwtToken: true}
    },
    services: {
      CoAuthoring: {
        // The origin stub below is self-signed; the TLS options must survive the CONNECT tunnel (lost in axios 1.16.1)
        requestDefaults: {headers: {'User-Agent': 'DocumentServer'}, rejectUnauthorized: false}
      }
    }
  };
  return c;
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// Bug 82673: https targets sent through an HTTP forward proxy must open a CONNECT tunnel instead of an absolute-form request that exposes headers and body to the proxy
describe('external request via HTTP forward proxy (bug 82673)', () => {
  let proxy, proxyPort;
  let origin, originPort;
  // Full request head of each proxy hit and {auth, body} of each origin hit
  let proxyHits;
  let originHits;
  // Live proxy sockets to destroy on teardown, otherwise keep-alive tunnels keep close() from completing
  const proxySockets = new Set();
  const savedEnv = {};

  beforeAll(async () => {
    for (const key of PROXY_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }

    // https origin stub behind the proxy: records the auth headers and body of what actually reaches the target
    origin = https.createServer({key: TEST_TLS_KEY, cert: TEST_TLS_CERT}, (req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        originHits.push({auth: req.headers.authorization, proxyAuth: req.headers['proxy-authorization'], body});
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end('{"ok":true}');
      });
    });
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    originPort = origin.address().port;

    // Forward proxy stub: relays CONNECT tunnels byte-for-byte and rejects anything else, recording each request head
    proxy = net.createServer(socket => {
      proxySockets.add(socket);
      socket.on('close', () => proxySockets.delete(socket));
      let buffered = Buffer.alloc(0);
      // Accumulate until the end of the request head; a CONNECT head may span multiple TCP chunks
      const onData = chunk => {
        buffered = Buffer.concat([buffered, chunk]);
        const headEnd = buffered.indexOf('\r\n\r\n');
        if (-1 === headEnd) {
          return;
        }
        socket.removeListener('data', onData);
        const head = buffered.subarray(0, headEnd + 4).toString();
        proxyHits.push(head);
        const target = head.match(/^CONNECT ([^ :]+):(\d+) /);
        if (!target) {
          socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        // Pin localhost to IPv4 so CI resolvers preferring ::1 cannot bypass the origin listening on 127.0.0.1
        const upstreamHost = target[1] === 'localhost' ? '127.0.0.1' : target[1];
        const upstream = net.connect(parseInt(target[2], 10), upstreamHost, () => {
          socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
          // Bytes past the head already belong to the tunnel and must reach the origin
          const leftover = buffered.subarray(headEnd + 4);
          if (leftover.length > 0) {
            upstream.write(leftover);
          }
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        proxySockets.add(upstream);
        upstream.on('close', () => proxySockets.delete(upstream));
        upstream.on('error', () => socket.destroy());
      };
      socket.on('data', onData);
      socket.on('error', () => {});
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = proxy.address().port;
  });

  afterAll(async () => {
    for (const key of PROXY_ENV_KEYS) {
      if (undefined === savedEnv[key]) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    origin.closeAllConnections();
    for (const socket of proxySockets) {
      socket.destroy();
    }
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => origin.close(resolve))]);
  });

  beforeEach(() => {
    proxyHits = [];
    originHits = [];
    for (const key of PROXY_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it(
    'relays an https request through the env HTTPS_PROXY with CONNECT, hiding credentials and body from the proxy',
    async () => {
      process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
      const ctx = makeCtx({});
      // isInJwtToken=true takes the directIfIn branch, the path the AI proxy uses for matched providers
      const result = await utils.httpRequest(
        ctx,
        'POST',
        `https://localhost:${originPort}/v1/chat`,
        {Authorization: 'Bearer sk-secret', 'Content-Type': 'application/json'},
        '{"secret-body":1}',
        REQUEST_TIMEOUT,
        null,
        true,
        {maxRedirects: 0}
      );
      expect(result.response.status).toBe(200);
      expect(await readAll(result.stream)).toBe('{"ok":true}');
      // The proxy must see one CONNECT and no target request data; the tunneled request must reach the origin intact
      expect(proxyHits.length).toBe(1);
      expect(proxyHits[0].startsWith(`CONNECT localhost:${originPort} `)).toBe(true);
      expect(proxyHits[0].includes('sk-secret')).toBe(false);
      expect(proxyHits[0].includes('secret-body')).toBe(false);
      expect(originHits).toEqual([{auth: 'Bearer sk-secret', proxyAuth: undefined, body: '{"secret-body":1}'}]);
    },
    JEST_TIMEOUT
  );

  it(
    'sends proxy credentials on the CONNECT request only when using the configured proxyUrl with proxyUser',
    async () => {
      const ctx = makeCtx({proxyUrl: `http://127.0.0.1:${proxyPort}`, proxyUser: {username: 'user', password: 'pa:ss'}});
      const result = await utils.httpRequest(
        ctx,
        'POST',
        `https://localhost:${originPort}/v1/chat`,
        {Authorization: 'Bearer sk-secret', 'Content-Type': 'application/json'},
        '{"secret-body":1}',
        REQUEST_TIMEOUT,
        null,
        false,
        {maxRedirects: 0}
      );
      expect(result.response.status).toBe(200);
      expect(await readAll(result.stream)).toBe('{"ok":true}');
      // Proxy auth belongs to the CONNECT request; the tunneled request must carry the target auth and never the proxy auth
      expect(proxyHits.length).toBe(1);
      expect(proxyHits[0].startsWith(`CONNECT localhost:${originPort} `)).toBe(true);
      // Header names are case-insensitive on the wire, so locate the line by name and compare the value exactly
      const proxyAuthLine = proxyHits[0].split('\r\n').find(line => line.toLowerCase().startsWith('proxy-authorization:'));
      expect(proxyAuthLine?.replace(/^[^:]+:\s*/, '')).toBe('Basic ' + Buffer.from('user:pa:ss').toString('base64'));
      expect(proxyHits[0].includes('sk-secret')).toBe(false);
      expect(originHits).toEqual([{auth: 'Bearer sk-secret', proxyAuth: undefined, body: '{"secret-body":1}'}]);
    },
    JEST_TIMEOUT
  );

  it('fails closed on proxyHeaders for https targets instead of leaking them past the proxy', async () => {
    const ctx = makeCtx({proxyUrl: `http://127.0.0.1:${proxyPort}`, proxyHeaders: {'X-Proxy-Extra': 'extra-value'}});
    await expect(
      utils.httpRequest(ctx, 'POST', `https://localhost:${originPort}/v1/chat`, {}, '{}', REQUEST_TIMEOUT, null, false, {maxRedirects: 0})
    ).rejects.toThrow('proxyHeaders is not supported for HTTPS');
    expect(proxyHits.length).toBe(0);
    expect(originHits.length).toBe(0);
  });
});
