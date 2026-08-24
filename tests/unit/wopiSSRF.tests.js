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
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// WOPI-derived outbound requests must not bypass the externalRequest protection (ALLOWED_HOST is named by an ipfilter rule the way an administrator would; DENIED_HOST is not)
const ALLOWED_HOST = '127.0.0.1';
const DENIED_HOST = '127.0.0.2';

process.env['NODE_CONFIG'] = JSON.stringify({
  services: {
    CoAuthoring: {
      ipfilter: {
        rules: [
          {address: ALLOWED_HOST, allowed: true},
          {address: '*', allowed: true}
        ]
      },
      'request-filtering-agent': {
        allowPrivateIPAddress: false,
        allowMetaIPAddress: false,
        allowIPAddressList: [ALLOWED_HOST]
      }
    }
  }
});

const {describe, expect, beforeAll, afterAll, it, jest: jestApi} = require('@jest/globals');

// a developer's local runtime.json must not decide whether these tests pass, so the request contexts see the test config only
jestApi.mock('../../Common/sources/runtimeConfigManager', () => ({
  getConfig: () => Promise.resolve({}),
  initRuntimeConfigWatcher: () => Promise.resolve(),
  saveConfig: () => Promise.resolve()
}));
const http = require('http');
const dns = require('dns');
const express = require('express');

const realDnsLookup = dns.lookup;
const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');
const wopiClient = require('../../DocService/sources/wopiClient');
const wopiEgress = require('../../DocService/sources/wopiEgress');
const canvasService = require('../../DocService/sources/canvasservice');
const {mintWithSecretType} = require('./mintToken.helper');
const commonDefines = require('../../Common/sources/commondefines');
const config = require('../../Common/node_modules/config');

// Suppress DEBUG so the WOPI header debug lines do not serialize the BigInt X-WOPI-TimeStamp; matches production log level
require('../../Common/sources/logger').configureLogger({categories: {default: {level: 'warn'}}});

const ctx = operationContext.global;
const cfgTokenAlgorithm = config.get('services.CoAuthoring.token.session.algorithm');
const cfgTokenExpires = config.get('services.CoAuthoring.token.outbox.expires');
const checkFileInfoJson = JSON.stringify({BaseFileName: 'sample.docx', Size: 100, UserCanWrite: true, SupportsUpdate: true, SupportsLocks: true});

function listen(server, host) {
  return new Promise(resolve => (host ? server.listen(0, host, resolve) : server.listen(0, resolve)));
}
function close(server) {
  return new Promise(resolve => server.close(resolve));
}
// Flatten an error and its cause chain so the request-filtering-agent message can be matched regardless of axios wrapping
function errText(e) {
  let s = '';
  for (let c = e; c; c = c.cause) {
    s += `${c.message || ''} ${c.code || ''} `;
  }
  return s;
}
// Build a context whose config overrides only externalRequest, so action.allow and the proxy can be exercised
function makeCtx(externalRequest) {
  const c = new operationContext.Context();
  c.config = {
    externalRequest,
    services: {
      CoAuthoring: {
        ipfilter: {
          rules: [
            {address: ALLOWED_HOST, allowed: true},
            {address: '*', allowed: true}
          ],
          errorcode: 403
        },
        'request-filtering-agent': {allowPrivateIPAddress: false, allowMetaIPAddress: false, allowIPAddressList: [ALLOWED_HOST]}
      }
    }
  };
  return c;
}
function mintWopiToken(payload) {
  return mintWithSecretType(new operationContext.Context(), payload, commonDefines.c_oAscSecretType.Inbox, {
    algorithm: cfgTokenAlgorithm,
    expiresIn: cfgTokenExpires
  });
}

describe('WOPI SSRF (WOPI SSRF)', () => {
  let allowedServer, deniedServer, redirectServer, httpsRedirectServer, proxyServer, downloadServer, allowedRedirectServer, namedHopRedirectServer;
  let allowedPort, deniedPort, redirectPort, httpsRedirectPort, proxyPort, downloadPort, allowedRedirectPort, namedHopRedirectPort;
  const allowedHits = [];
  const deniedHits = [];
  const proxyHits = [];
  let deniedBytes = 0;

  beforeAll(async () => {
    allowedServer = http.createServer((req, res) => {
      allowedHits.push(req.url);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(checkFileInfoJson);
    });
    deniedServer = http.createServer((req, res) => {
      deniedHits.push(req.url);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(checkFileInfoJson);
    });
    proxyServer = http.createServer((req, res) => {
      proxyHits.push(req.url);
      // a forwarded request whose origin answers with a redirect, so the hop policy is what has to refuse it
      if (req.url.includes('/start')) {
        res.writeHead(302, {Location: `http://${DENIED_HOST}:${deniedPort}/redirected`});
        res.end();
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{}');
    });
    await Promise.all([listen(allowedServer), listen(deniedServer), listen(proxyServer)]);
    allowedPort = allowedServer.address().port;
    deniedPort = deniedServer.address().port;
    proxyPort = proxyServer.address().port;

    // Count raw bytes reaching the private host: a filtered request must not even send a TLS ClientHello
    deniedServer.on('connection', socket => socket.on('data', chunk => (deniedBytes += chunk.length)));

    redirectServer = http.createServer((req, res) => {
      res.writeHead(302, {Location: `http://${DENIED_HOST}:${deniedPort}/redirected`});
      res.end();
    });
    httpsRedirectServer = http.createServer((req, res) => {
      res.writeHead(302, {Location: `https://${DENIED_HOST}:${deniedPort}/redirected`});
      res.end();
    });
    allowedRedirectServer = http.createServer((req, res) => {
      res.writeHead(302, {Location: `http://${ALLOWED_HOST}:${allowedPort}/redirected`});
      res.end();
    });
    // redirects to a name that resolves to the private host, so a rule naming that host is what has to authorize the hop
    namedHopRedirectServer = http.createServer((req, res) => {
      res.writeHead(302, {Location: `http://hop.ssrf82516.test:${deniedPort}/named`});
      res.end();
    });
    await Promise.all([listen(redirectServer), listen(httpsRedirectServer), listen(allowedRedirectServer), listen(namedHopRedirectServer)]);
    namedHopRedirectPort = namedHopRedirectServer.address().port;
    redirectPort = redirectServer.address().port;
    httpsRedirectPort = httpsRedirectServer.address().port;
    allowedRedirectPort = allowedRedirectServer.address().port;

    const app = express();
    app.get('/downloadfile/:docid', (req, res) => canvasService.downloadFile(req, res));
    downloadServer = http.createServer(app);
    await listen(downloadServer, ALLOWED_HOST);
    downloadPort = downloadServer.address().port;
  });

  afterAll(async () => {
    await Promise.all([
      close(allowedServer),
      close(deniedServer),
      close(redirectServer),
      close(httpsRedirectServer),
      close(proxyServer),
      close(downloadServer),
      close(allowedRedirectServer),
      close(namedHopRedirectServer)
    ]);
  });

  describe('private-IP filter engages when isInJwtToken is false (the value WOPI now uses)', () => {
    // A live server on the loopback address is decisive: the host is reachable, so a rejection cannot be unreachability - the error must come from the filter.
    it('blocks a reachable private (loopback) host with a private-IP filter error', async () => {
      const before = deniedHits.length;
      let error;
      await utils.downloadUrlPromise(ctx, `http://${DENIED_HOST}:${deniedPort}`, {isInJwtToken: false}).catch(e => (error = e));
      expect(error).toBeDefined();
      expect(errText(error)).toMatch(/not allowed|private ip/i);
      expect(deniedHits.length).toBe(before);
    });

    it('allows a host listed in allowIPAddressList', async () => {
      const before = allowedHits.length;
      const result = await utils.downloadUrlPromise(ctx, `http://${ALLOWED_HOST}:${allowedPort}`, {isInJwtToken: false});
      expect(result.body.toString()).toBe(checkFileInfoJson);
      expect(allowedHits.length).toBe(before + 1);
    });

    // Resolve test hostnames to private-range IPs so the filter fires on the lookup event; asserting its error proves the rejection is the filter, not mere unreachability.
    describe('rejects private ranges resolved via DNS', () => {
      const DNS_CASES = [
        {label: 'rfc1918 10.x', host: 'p10.ssrf82516.test', ip: '10.0.0.1'},
        {label: 'rfc1918 172.16.x', host: 'p172.ssrf82516.test', ip: '172.16.0.1'},
        {label: 'rfc1918 192.168.x', host: 'p192.ssrf82516.test', ip: '192.168.0.1'},
        {label: 'link-local', host: 'plink.ssrf82516.test', ip: '169.254.0.1'},
        {label: 'cloud metadata', host: 'pmeta.ssrf82516.test', ip: '169.254.169.254'}
      ];
      const DNS_MAP = Object.fromEntries(DNS_CASES.map(c => [c.host, c.ip]));
      let dnsSpy;

      beforeAll(() => {
        dnsSpy = jestApi.spyOn(dns, 'lookup').mockImplementation((hostname, opts, cb) => {
          const callback = typeof opts === 'function' ? opts : cb;
          const ip = DNS_MAP[hostname];
          if (ip) {
            return process.nextTick(() => callback(null, opts && opts.all ? [{address: ip, family: 4}] : ip, 4));
          }
          return realDnsLookup(hostname, typeof opts === 'function' ? {} : opts, callback);
        });
      });
      afterAll(() => dnsSpy.mockRestore());

      it.each(DNS_CASES.map(c => [c.label, c.host]))(
        'rejects %s via the private-IP filter',
        async (_label, host) => {
          let error;
          await utils
            .downloadUrlPromise(ctx, `http://${host}`, {isInJwtToken: false, timeout: {wholeCycle: '2s', connectionAndInactivity: '2s'}})
            .catch(e => (error = e));
          expect(error).toBeDefined();
          expect(errText(error)).toMatch(/not allowed|private ip/i);
        },
        8000
      );
    });

    // IPv6 literals are rejected by URL normalization (uri-js-replace) before egress, not by the private-IP filter; either way ::1 is never fetched.
    it('does not fetch an IPv6 loopback literal', async () => {
      await expect(
        utils.downloadUrlPromise(ctx, 'http://[::1]:80', {isInJwtToken: false, timeout: {wholeCycle: '1500ms', connectionAndInactivity: '1500ms'}})
      ).rejects.toThrow();
    });
  });

  // GHSA-pw25-c82r-75mm: request-filtering-agent < 2.0.0 filtered http but let direct-IP https through, so isInJwtToken=false alone did not close internal SSRF
  describe('https to a private address is filtered (request-filtering-agent CVE regression)', () => {
    it('blocks https to a private IP and sends no bytes to it', async () => {
      const beforeHits = deniedHits.length;
      const beforeBytes = deniedBytes;
      let error;
      await utils
        .downloadUrlPromise(ctx, `https://${DENIED_HOST}:${deniedPort}/secret`, {
          isInJwtToken: false,
          timeout: {wholeCycle: '5s', connectionAndInactivity: '5s'}
        })
        .catch(e => (error = e));
      expect(error).toBeDefined();
      expect(errText(error)).toMatch(/not allowed|private ip/i);
      expect(deniedHits.length).toBe(beforeHits);
      expect(deniedBytes).toBe(beforeBytes);
    });

    it('blocks an allowed host that redirects to https on a private address', async () => {
      const beforeHits = deniedHits.length;
      const beforeBytes = deniedBytes;
      let error;
      await utils
        .downloadUrlPromise(ctx, `http://${ALLOWED_HOST}:${httpsRedirectPort}/start`, {
          isInJwtToken: false,
          timeout: {wholeCycle: '5s', connectionAndInactivity: '5s'}
        })
        .catch(e => (error = e));
      expect(error).toBeDefined();
      expect(errText(error)).toMatch(/not allowed|private ip/i);
      expect(deniedHits.length).toBe(beforeHits);
      expect(deniedBytes).toBe(beforeBytes);
    });
  });

  describe('WOPI egress is restricted to http(s)', () => {
    it.each([['file:///c:/windows/win.ini'], ['ftp://example.com/x'], ['gopher://example.com/x']])('rejects %s', async uri => {
      expect((await wopiEgress.evaluateDestination(ctx, uri)).status).not.toBe(0);
    });

    it('allows http and https', async () => {
      expect((await wopiEgress.evaluateDestination(ctx, `http://${ALLOWED_HOST}:${allowedPort}/wopi`)).status).toBe(0);
      expect((await wopiEgress.evaluateDestination(ctx, `https://${ALLOWED_HOST}:${allowedPort}/wopi`)).status).toBe(0);
    });
  });

  describe('the removed privilege: isInJwtToken true still bypasses the filter', () => {
    it('bypasses the filter and reaches the denied host (old WOPI behavior)', async () => {
      const before = deniedHits.length;
      const result = await utils.downloadUrlPromise(ctx, `http://${DENIED_HOST}:${deniedPort}`, {isInJwtToken: true});
      expect(result.body.toString()).toBe(checkFileInfoJson);
      expect(deniedHits.length).toBe(before + 1);
    });
  });

  describe('CheckFileInfo path (wopiClient.checkFileInfo)', () => {
    it('is blocked for a private wopiSrc', async () => {
      const before = deniedHits.length;
      const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctx, `http://${DENIED_HOST}:${deniedPort}/wopi`, 'tok');
      expect(fileInfo.error).toBe(true);
      expect(deniedHits.length).toBe(before);
    });

    it('succeeds for an allowed wopiSrc', async () => {
      const before = allowedHits.length;
      const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctx, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok');
      expect(fileInfo).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
      expect(allowedHits.length).toBe(before + 1);
    });

    it('is blocked when an allowed host redirects to a private address', async () => {
      const before = deniedHits.length;
      const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctx, `http://${ALLOWED_HOST}:${redirectPort}/wopi`, 'tok');
      expect(fileInfo.error).toBe(true);
      expect(deniedHits.length).toBe(before);
    });
  });

  describe('Canvas download path (canvasservice.downloadFile)', () => {
    // getWopiFileUrl serves the source from FileUrl or, when absent, TemplateSource; set only the key under test so each source is exercised
    async function downloadWithSource(sourceKey, sourceUrl) {
      const token = await mintWopiToken({
        fileInfo: {BaseFileName: 'a.docx', Size: 100, UserCanWrite: true, [sourceKey]: sourceUrl},
        userAuth: {wopiSrc: `http://${ALLOWED_HOST}:${allowedPort}/wopi`, access_token: 'tok', mode: 'edit'}
      });
      const res = await fetch(`http://${ALLOWED_HOST}:${downloadPort}/downloadfile/doc82516`, {headers: {Authorization: 'Bearer ' + token}});
      await res.arrayBuffer();
      return res;
    }

    describe.each(['FileUrl', 'TemplateSource'])('via %s', sourceKey => {
      it('does not fetch a private address', async () => {
        const before = deniedHits.length;
        const res = await downloadWithSource(sourceKey, `http://${DENIED_HOST}:${deniedPort}/file`);
        expect(res.status).not.toBe(200);
        expect(deniedHits.length).toBe(before);
      });

      it('fetches an allowed address', async () => {
        const before = allowedHits.length;
        const res = await downloadWithSource(sourceKey, `http://${ALLOWED_HOST}:${allowedPort}/file`);
        expect(res.status).toBe(200);
        expect(allowedHits.length).toBe(before + 1);
      });
    });
  });

  describe('exported WOPI functions do not reach a private host', () => {
    it('putRelativeFile is blocked', async () => {
      const before = deniedHits.length;
      const res = await wopiClient.putRelativeFile(ctx, `http://${DENIED_HOST}:${deniedPort}/wopi`, 'tok', Buffer.from('x'), undefined, 1, '.docx');
      expect(res).toBeUndefined();
      expect(deniedHits.length).toBe(before);
    });

    it('putFile is blocked', async () => {
      const before = deniedHits.length;
      const wopiParams = {
        commonInfo: {lockId: 'l', fileInfo: {BaseFileName: 'a.docx', SupportsUpdate: true, UserCanWrite: true}},
        userAuth: {wopiSrc: `http://${DENIED_HOST}:${deniedPort}/wopi`, access_token: 'tok'},
        LastModifiedTime: null
      };
      const res = await wopiClient.putFile(ctx, wopiParams, Buffer.from('x'), undefined, 1, 'user', true, false, false);
      expect(res).toBeNull();
      expect(deniedHits.length).toBe(before);
    });

    it('lock is blocked', async () => {
      const before = deniedHits.length;
      const res = await wopiClient.lock(
        ctx,
        'LOCK',
        'lockid',
        {SupportsLocks: true},
        {wopiSrc: `http://${DENIED_HOST}:${deniedPort}/wopi`, access_token: 'tok'}
      );
      expect(res.error).toBe(true);
      expect(deniedHits.length).toBe(before);
    });

    it('putRelativeFile reaches an allowed host', async () => {
      const before = allowedHits.length;
      const res = await wopiClient.putRelativeFile(ctx, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok', Buffer.from('x'), undefined, 1, '.docx');
      expect(res).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
      expect(allowedHits.length).toBe(before + 1);
    });
  });

  describe('WOPI honors externalRequest.action', () => {
    it('does not bypass action.allow=false', async () => {
      const before = allowedHits.length;
      const ctxNoAllow = makeCtx({
        action: {allow: false, blockPrivateIP: true, proxyUrl: '', proxyUser: {username: '', password: ''}, proxyHeaders: {}},
        directIfIn: {allowList: [], jwtToken: true}
      });
      const res = await wopiClient.putRelativeFile(
        ctxNoAllow,
        `http://${ALLOWED_HOST}:${allowedPort}/wopi`,
        'tok',
        Buffer.from('x'),
        undefined,
        1,
        '.docx'
      );
      expect(res).toBeUndefined();
      expect(allowedHits.length).toBe(before);
    });

    it('uses the configured proxy', async () => {
      const proxyBefore = proxyHits.length;
      const deniedBefore = deniedHits.length;
      const ctxProxy = makeCtx({
        action: {
          allow: true,
          blockPrivateIP: false,
          proxyUrl: `http://${ALLOWED_HOST}:${proxyPort}`,
          proxyUser: {username: '', password: ''},
          proxyHeaders: {}
        },
        directIfIn: {allowList: [], jwtToken: true}
      });
      const allowedBefore = allowedHits.length;
      await wopiClient.putRelativeFile(ctxProxy, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok', Buffer.from('x'), undefined, 1, '.docx');
      expect(proxyHits.length).toBe(proxyBefore + 1);
      expect(allowedHits.length).toBe(allowedBefore);
      expect(deniedHits.length).toBe(deniedBefore);
    });
  });

  // the destination policy is decided before egress, because the network filter alone is bypassed by a proxy or by blockPrivateIP=false
  describe('an explicit ipfilter allow lifts the private-address filter for that host only', () => {
    const PUBLIC_RULES = [{address: '*', allowed: true}];
    // No static allowIPAddressList here, so anything that gets through was lifted by the ipfilter rule itself
    function makeIpFilterCtx(rules, opt_agent, opt_action, opt_wopi) {
      const c = new operationContext.Context();
      c.config = {
        wopi: {requireIpFilterRule: true, ...opt_wopi},
        services: {
          CoAuthoring: {
            ipfilter: {rules, errorcode: 403},
            'request-filtering-agent': {
              allowPrivateIPAddress: false,
              allowMetaIPAddress: false,
              allowIPAddressList: [],
              denyIPAddressList: [],
              ...opt_agent
            }
          }
        }
      };
      if (opt_action) {
        const {directIfIn, ...action} = opt_action;
        c.config.externalRequest = {
          action: {allow: true, blockPrivateIP: true, proxyUrl: '', proxyUser: {username: '', password: ''}, proxyHeaders: {}, ...action},
          directIfIn: {allowList: [], jwtToken: true, ...directIfIn}
        };
      }
      return c;
    }
    const wopiUrl = host => `http://${host}:${deniedPort}/wopi`;

    it('reports the resolved addresses only when a bounded rule allowed the host', async () => {
      const explicit = await wopiEgress.evaluateDestination(makeIpFilterCtx([{address: DENIED_HOST, allowed: true}]), wopiUrl(DENIED_HOST));
      expect(explicit.status).toBe(0);
      expect(explicit.filterAllowIPs).toEqual([DENIED_HOST]);
    });

    // An administrator writes the standard compressed form, so a rule spelled ::1 has to name the same address as its expanded form
    it.each([['::1'], ['0:0:0:0:0:0:0:1']])('matches an ipv6 loopback address against a rule spelled %s', address => {
      const res = utils.checkIpFilterDetailed(
        makeIpFilterCtx([
          {address, allowed: true},
          {address: '*', allowed: false}
        ]),
        '::1'
      );
      expect(res.status).toBe(0);
      expect(res.matchedRule).toEqual({address, allowed: true});
    });

    it('lets a compressed ipv6 rule authorize a bracketed ipv6 WOPI url', async () => {
      const ctxAllow = makeIpFilterCtx([
        {address: '::1', allowed: true},
        {address: '*', allowed: false}
      ]);
      const res = await wopiEgress.evaluateDestination(ctxAllow, `http://[::1]:${deniedPort}/wopi`);
      expect(res.status).toBe(0);
      expect(res.filterAllowIPs).toEqual(['::1']);
      const refused = await wopiEgress.evaluateDestination(makeIpFilterCtx(PUBLIC_RULES), `http://[::1]:${deniedPort}/wopi`);
      expect(refused.status).not.toBe(0);
    });

    // Wildcard-only patterns match every destination, so they are not an admin decision about this host
    it.each([['*'], ['*.*.*.*']])('refuses a private host under the catch-all rule %s', async address => {
      const res = await wopiEgress.evaluateDestination(makeIpFilterCtx([{address, allowed: true}]), wopiUrl(DENIED_HOST));
      expect(res.status).not.toBe(0);
      expect(res.filterAllowIPs).toBeUndefined();
    });

    // Rules are first-match-wins, so a catch-all placed first swallows a later explicit rule
    it('honors rule order: the explicit rule must precede the catch-all', async () => {
      const first = await wopiEgress.evaluateDestination(
        makeIpFilterCtx([{address: DENIED_HOST, allowed: true}, ...PUBLIC_RULES]),
        wopiUrl(DENIED_HOST)
      );
      expect(first.status).toBe(0);
      const last = await wopiEgress.evaluateDestination(
        makeIpFilterCtx([...PUBLIC_RULES, {address: DENIED_HOST, allowed: true}]),
        wopiUrl(DENIED_HOST)
      );
      expect(last.status).not.toBe(0);
    });

    it('lets CheckFileInfo reach a private host the rules explicitly allow', async () => {
      const before = deniedHits.length;
      const ctxAllow = makeIpFilterCtx([{address: DENIED_HOST, allowed: true}]);
      const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxAllow, wopiUrl(DENIED_HOST), 'tok');
      expect(fileInfo).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
      expect(deniedHits.length).toBe(before + 1);
    });

    it('still blocks the same private host under the default catch-all rule', async () => {
      const before = deniedHits.length;
      const {fileInfo} = await wopiClient._checkFileInfoForTesting(makeIpFilterCtx(PUBLIC_RULES), wopiUrl(DENIED_HOST), 'tok');
      expect(fileInfo.error).toBe(true);
      expect(deniedHits.length).toBe(before);
    });

    // The network filter is not the decision point: each of these disables or sidesteps it, and the policy must still refuse
    describe('the refusal does not depend on the network filter', () => {
      const CASES = [
        ['a configured proxy, which the agent inspects instead of the target', {}, {useProxy: true}],
        ['blockPrivateIP disabled', {}, {blockPrivateIP: false}],
        ['allowPrivateIPAddress enabled', {allowPrivateIPAddress: true}, {}]
      ];
      it.each(CASES)('refuses a private WOPI host with %s', async (_label, agent, action) => {
        const beforeDenied = deniedHits.length;
        const beforeProxy = proxyHits.length;
        const {useProxy, ...rest} = action;
        const ctxCase = makeIpFilterCtx(PUBLIC_RULES, agent, {...rest, proxyUrl: useProxy ? `http://${ALLOWED_HOST}:${proxyPort}` : ''});
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxCase, wopiUrl(DENIED_HOST), 'tok');
        expect(fileInfo.error).toBe(true);
        expect(deniedHits.length).toBe(beforeDenied);
        expect(proxyHits.length).toBe(beforeProxy);
      });

      it('refuses cloud metadata even through a proxy and even with an explicit rule naming it', async () => {
        const beforeProxy = proxyHits.length;
        const ctxMeta = makeIpFilterCtx([{address: '169.254.169.254', allowed: true}], {}, {proxyUrl: `http://${ALLOWED_HOST}:${proxyPort}`});
        const res = await wopiEgress.evaluateDestination(ctxMeta, 'http://169.254.169.254/latest/meta-data/');
        expect(res.status).not.toBe(0);
        expect(res.filterAllowIPs).toBeUndefined();
        expect(proxyHits.length).toBe(beforeProxy);
      });

      it('refuses the ipv4-mapped form of a metadata address', async () => {
        const dnsSpy = jestApi.spyOn(dns, 'lookup').mockImplementation((hostname, opts, cb) => {
          const callback = typeof opts === 'function' ? opts : cb;
          if ('mapped.ssrf82516.test' === hostname) {
            const all = [{address: '::ffff:169.254.169.254', family: 6}];
            return process.nextTick(() => callback(null, opts && opts.all ? all : all[0].address, 6));
          }
          return realDnsLookup(hostname, typeof opts === 'function' ? {} : opts, callback);
        });
        try {
          const res = await wopiEgress.evaluateDestination(
            makeIpFilterCtx([{address: 'mapped.ssrf82516.test', allowed: true}]),
            'http://mapped.ssrf82516.test/wopi'
          );
          expect(res.status).not.toBe(0);
          expect(res.filterAllowIPs).toBeUndefined();
        } finally {
          dnsSpy.mockRestore();
        }
      });
    });

    // The agent checks allowIPAddressList before denyIPAddressList, so the deny has to be applied by the policy itself
    describe('an administrative deny outranks every allow', () => {
      const DENY_CASES = [
        ['an explicit ipfilter rule', [{address: DENIED_HOST, allowed: true}], {denyIPAddressList: [DENIED_HOST]}, {}],
        [
          'an explicit rule while a proxy is configured',
          [{address: DENIED_HOST, allowed: true}],
          {denyIPAddressList: [DENIED_HOST]},
          {useProxy: true}
        ],
        [
          'an explicit rule while blockPrivateIP is off',
          [{address: DENIED_HOST, allowed: true}],
          {denyIPAddressList: [DENIED_HOST]},
          {blockPrivateIP: false}
        ],
        [
          'the static allowIPAddressList, which does not permit a wopi destination at all',
          PUBLIC_RULES,
          {allowIPAddressList: [DENIED_HOST], denyIPAddressList: [DENIED_HOST]},
          {}
        ]
      ];
      it.each(DENY_CASES)('refuses a host allowed by %s', async (_label, rules, agent, action) => {
        const beforeDenied = deniedHits.length;
        const beforeProxy = proxyHits.length;
        const {useProxy, ...rest} = action;
        const ctxDeny = makeIpFilterCtx(rules, agent, {...rest, proxyUrl: useProxy ? `http://${ALLOWED_HOST}:${proxyPort}` : ''});
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxDeny, wopiUrl(DENIED_HOST), 'tok');
        expect(fileInfo.error).toBe(true);
        expect(deniedHits.length).toBe(beforeDenied);
        expect(proxyHits.length).toBe(beforeProxy);
      });
    });

    // wopi.requireIpFilterRule is the way out for an installation that used to reach a private WOPI host without any rule
    describe('wopi.requireIpFilterRule can be turned off', () => {
      it('reaches a private host with no rule naming it', async () => {
        const before = deniedHits.length;
        const ctxOff = makeIpFilterCtx(PUBLIC_RULES, {}, undefined, {requireIpFilterRule: false});
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxOff, wopiUrl(DENIED_HOST), 'tok');
        expect(fileInfo).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
        expect(deniedHits.length).toBe(before + 1);
      });

      it('still refuses cloud metadata and a denied address', async () => {
        const ctxOff = makeIpFilterCtx(PUBLIC_RULES, {}, undefined, {requireIpFilterRule: false});
        expect((await wopiEgress.evaluateDestination(ctxOff, 'http://169.254.169.254/latest/meta-data/')).status).not.toBe(0);
        const ctxOffDeny = makeIpFilterCtx(PUBLIC_RULES, {denyIPAddressList: [DENIED_HOST]}, undefined, {requireIpFilterRule: false});
        expect((await wopiEgress.evaluateDestination(ctxOffDeny, wopiUrl(DENIED_HOST))).status).not.toBe(0);
      });

      // Permitting a destination is not the same as choosing how to reach it: the usual externalRequest policy still decides that
      it('still sends the permitted request through the configured proxy', async () => {
        const beforeProxy = proxyHits.length;
        const beforeDenied = deniedHits.length;
        // the proxy itself sits on loopback here, so it has to be reachable for the request to get that far
        const ctxOff = makeIpFilterCtx(
          PUBLIC_RULES,
          {allowIPAddressList: [ALLOWED_HOST]},
          {proxyUrl: `http://${ALLOWED_HOST}:${proxyPort}`},
          {requireIpFilterRule: false}
        );
        await wopiClient._checkFileInfoForTesting(ctxOff, wopiUrl(DENIED_HOST), 'tok');
        expect(proxyHits.length).toBe(beforeProxy + 1);
        expect(deniedHits.length).toBe(beforeDenied);
      });

      it('still obeys action.allow=false', async () => {
        const beforeDenied = deniedHits.length;
        const ctxOff = makeIpFilterCtx(PUBLIC_RULES, {}, {allow: false}, {requireIpFilterRule: false});
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxOff, wopiUrl(DENIED_HOST), 'tok');
        expect(fileInfo.error).toBe(true);
        expect(deniedHits.length).toBe(beforeDenied);
      });

      // directIfIn is the other route into the direct branch, independent of isInJwtToken and a deliberate global override
      it('goes direct when a directIfIn prefix matches, bypassing the proxy', async () => {
        const beforeProxy = proxyHits.length;
        const beforeDenied = deniedHits.length;
        const ctxDirect = makeIpFilterCtx(
          PUBLIC_RULES,
          {},
          {proxyUrl: `http://${ALLOWED_HOST}:${proxyPort}`, directIfIn: {allowList: [`http://${DENIED_HOST}:${deniedPort}/`]}},
          {requireIpFilterRule: false}
        );
        await wopiClient._checkFileInfoForTesting(ctxDirect, wopiUrl(DENIED_HOST), 'tok');
        expect(deniedHits.length).toBe(beforeDenied + 1);
        expect(proxyHits.length).toBe(beforeProxy);
      });
    });

    it('classifies a mixed A/AAAA answer by its least public address', async () => {
      const dnsSpy = jestApi.spyOn(dns, 'lookup').mockImplementation((hostname, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if ('mixed.ssrf82516.test' === hostname) {
          const all = [
            {address: '93.184.216.34', family: 4},
            {address: '10.0.0.7', family: 4}
          ];
          return process.nextTick(() => callback(null, opts && opts.all ? all : all[0].address, 4));
        }
        return realDnsLookup(hostname, typeof opts === 'function' ? {} : opts, callback);
      });
      try {
        const wildcard = await wopiEgress.evaluateDestination(makeIpFilterCtx(PUBLIC_RULES), 'http://mixed.ssrf82516.test/wopi');
        expect(wildcard.status).not.toBe(0);
        // only the private address needs a rule, the public one carries itself
        const allowed = await wopiEgress.evaluateDestination(
          makeIpFilterCtx([{address: 'mixed.ssrf82516.test', allowed: true}, ...PUBLIC_RULES]),
          'http://mixed.ssrf82516.test/wopi'
        );
        expect(allowed.status).toBe(0);
        expect(allowed.filterAllowIPs).toEqual(['10.0.0.7']);
      } finally {
        dnsSpy.mockRestore();
      }
    });

    it('applies the same policy to the Canvas contents url', async () => {
      const allowed = await wopiEgress.evaluateDestination(
        makeIpFilterCtx([{address: DENIED_HOST, allowed: true}]),
        `http://${DENIED_HOST}:${deniedPort}/contents`
      );
      expect(allowed.status).toBe(0);
      expect(allowed.filterAllowIPs).toEqual([DENIED_HOST]);
      const refused = await wopiEgress.evaluateDestination(makeIpFilterCtx(PUBLIC_RULES), `http://${DENIED_HOST}:${deniedPort}/contents`);
      expect(refused.status).not.toBe(0);
    });
    // The scenario from the report: an unknown public destination (the report used webhook.site) must not be contacted at all
    describe('the reported scenario: an unknown public wopi host', () => {
      it('is refused before any request leaves', async () => {
        const before = allowedHits.length;
        const ctxPublicOnly = makeIpFilterCtx(PUBLIC_RULES);
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxPublicOnly, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok');
        expect(fileInfo.error).toBe(true);
        expect(allowedHits.length).toBe(before);
      });

      it('is contacted once a rule names it', async () => {
        const before = allowedHits.length;
        const ctxNamed = makeIpFilterCtx([{address: ALLOWED_HOST, allowed: true}, ...PUBLIC_RULES]);
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxNamed, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok');
        expect(fileInfo).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
        expect(allowedHits.length).toBe(before + 1);
      });

      it('is reachable again with the flag off, which is what the flag is for', async () => {
        const before = allowedHits.length;
        const ctxOff = makeIpFilterCtx(PUBLIC_RULES, {}, undefined, {requireIpFilterRule: false});
        const {fileInfo} = await wopiClient._checkFileInfoForTesting(ctxOff, `http://${ALLOWED_HOST}:${allowedPort}/wopi`, 'tok');
        expect(fileInfo).toEqual(expect.objectContaining({BaseFileName: 'sample.docx'}));
        expect(allowedHits.length).toBe(before + 1);
      });
    });
  });
  // the destination policy has to hold on every hop, or an allowed host redirects the server anywhere it likes
  describe('redirect hops are judged by the same rules', () => {
    function ctxWithRules(rules, opt_agent, opt_action, opt_wopi) {
      const c = new operationContext.Context();
      c.config = {
        wopi: {requireIpFilterRule: true, ...opt_wopi},
        services: {
          CoAuthoring: {
            ipfilter: {rules, errorcode: 403},
            'request-filtering-agent': {allowPrivateIPAddress: false, allowMetaIPAddress: false, ...opt_agent}
          }
        }
      };
      if (opt_action) {
        const {directIfIn, ...action} = opt_action;
        c.config.externalRequest = {
          action: {allow: true, blockPrivateIP: true, proxyUrl: '', proxyUser: {username: '', password: ''}, proxyHeaders: {}, ...action},
          directIfIn: {allowList: [], jwtToken: true, ...directIfIn}
        };
      }
      return c;
    }
    const allowedOnly = [
      {address: ALLOWED_HOST, allowed: true},
      {address: '*', allowed: true}
    ];
    const download = (c, uri) => wopiEgress.download(c, uri, {headers: {}});

    it('follows a hop to a host the rules name', async () => {
      const before = allowedHits.length;
      const res = await download(ctxWithRules(allowedOnly), `http://${ALLOWED_HOST}:${allowedRedirectPort}/start`);
      expect(res.body.toString()).toBe(checkFileInfoJson);
      expect(allowedHits.length).toBe(before + 1);
    });

    // Each of these removes or sidesteps the network filter, so only the per-hop policy can refuse the hop
    const HOP_CASES = [
      ['no proxy and the filter on', {}, {}],
      ['a proxy configured, which the filter would inspect instead of the target', {}, {useProxy: true}],
      ['blockPrivateIP disabled, so no agent is built at all', {}, {blockPrivateIP: false}],
      ['allowPrivateIPAddress enabled', {allowPrivateIPAddress: true}, {}],
      ['a directIfIn prefix matching the first url, which makes it a direct request', {}, {directIfInStart: true}]
    ];
    it.each(HOP_CASES)('refuses a hop to a host no rule names, with %s', async (_label, agent, action) => {
      const beforeDenied = deniedHits.length;
      const {useProxy, directIfInStart, ...rest} = action;
      const c = ctxWithRules(allowedOnly, agent, {
        ...rest,
        proxyUrl: useProxy ? `http://${ALLOWED_HOST}:${proxyPort}` : '',
        directIfIn: directIfInStart ? {allowList: [`http://${ALLOWED_HOST}:${redirectPort}/`]} : undefined
      });
      let error;
      await download(c, `http://${ALLOWED_HOST}:${redirectPort}/start`).catch(e => (error = e));
      expect(error).toBeDefined();
      expect(errText(error)).toMatch(/is not an allowed destination/);
      expect(deniedHits.length).toBe(beforeDenied);
    });

    // The hop gets its own allow list, otherwise a legitimate private target would be blocked by the first host's list
    it('reaches a private hop the rules name, computing a fresh allow list for it', async () => {
      const before = deniedHits.length;
      const c = ctxWithRules([{address: DENIED_HOST, allowed: true}, ...allowedOnly]);
      const res = await download(c, `http://${ALLOWED_HOST}:${redirectPort}/start`);
      expect(res.body.toString()).toBe(checkFileInfoJson);
      expect(deniedHits.length).toBe(before + 1);
    });

    describe('a hop named only by address', () => {
      let dnsSpy;
      beforeAll(() => {
        dnsSpy = jestApi.spyOn(dns, 'lookup').mockImplementation((hostname, opts, cb) => {
          const callback = typeof opts === 'function' ? opts : cb;
          if ('hop.ssrf82516.test' === hostname) {
            const all = [{address: DENIED_HOST, family: 4}];
            return process.nextTick(() => callback(null, opts && opts.all ? all : all[0].address, 4));
          }
          return realDnsLookup(hostname, typeof opts === 'function' ? {} : opts, callback);
        });
      });
      afterAll(() => dnsSpy.mockRestore());

      it('is allowed by a rule naming it, and its resolved private address is lifted for that hop', async () => {
        const before = deniedHits.length;
        const c = ctxWithRules([
          {address: ALLOWED_HOST, allowed: true},
          {address: 'hop.ssrf82516.test', allowed: true},
          {address: '*', allowed: true}
        ]);
        const res = await download(c, `http://${ALLOWED_HOST}:${namedHopRedirectPort}/start`);
        expect(res.body.toString()).toBe(checkFileInfoJson);
        expect(deniedHits.length).toBe(before + 1);
      });

      it('is refused by a deny rule on that address even with the flag off', async () => {
        const before = deniedHits.length;
        const c = ctxWithRules(
          [
            {address: DENIED_HOST, allowed: false},
            {address: '*', allowed: true}
          ],
          {},
          undefined,
          {
            requireIpFilterRule: false
          }
        );
        let error;
        await download(c, `http://${ALLOWED_HOST}:${namedHopRedirectPort}/start`).catch(e => (error = e));
        expect(error).toBeDefined();
        expect(errText(error)).toMatch(/is not an allowed destination/);
        expect(deniedHits.length).toBe(before);
      });
    });

    // Chain shapes are exercised without live servers, by driving the loop with a request function that only reports redirects
    describe('chain shapes', () => {
      let chainDnsSpy;
      beforeAll(() => {
        chainDnsSpy = jestApi.spyOn(dns, 'lookup').mockImplementation((hostname, opts, cb) => {
          const callback = typeof opts === 'function' ? opts : cb;
          if ('a.test' === hostname || 'b.test' === hostname) {
            const all = [{address: ALLOWED_HOST, family: 4}];
            return process.nextTick(() => callback(null, opts && opts.all ? all : all[0].address, 4));
          }
          return realDnsLookup(hostname, typeof opts === 'function' ? {} : opts, callback);
        });
      });
      afterAll(() => chainDnsSpy.mockRestore());
      const chainCtx = () =>
        ctxWithRules([
          {address: 'a.test', allowed: true},
          {address: 'b.test', allowed: true},
          {address: '*', allowed: true}
        ]);
      function driveChain(c, start, chain, opt_headers, opt_resource) {
        const seenHeaders = [];
        const seenUris = [];
        const spy = jestApi.spyOn(utils, 'downloadUrlPromise').mockImplementation((_ctx, hopUri, options) => {
          seenHeaders.push(options.headers);
          seenUris.push(hopUri);
          const next = chain[hopUri];
          if (!next) {
            return Promise.resolve({finalUri: hopUri});
          }
          return Promise.resolve().then(() => options.beforeRedirect({href: next}));
        });
        return wopiEgress
          .download(c, start, {headers: opt_headers, ...opt_resource})
          .then(res => ({...res, seenHeaders, seenUris}))
          .finally(() => spy.mockRestore());
      }

      it('refuses an https to http downgrade anywhere in the chain, not only at the first hop', async () => {
        await expect(
          driveChain(chainCtx(), 'http://a.test/1', {'http://a.test/1': 'https://a.test/2', 'https://a.test/2': 'http://a.test/3'})
        ).rejects.toThrow(/https to http downgrade/);
      });

      it('refuses a hop to a non-http scheme', async () => {
        await expect(driveChain(chainCtx(), 'http://a.test/1', {'http://a.test/1': 'file:///c:/windows/win.ini'})).rejects.toThrow(
          /unsupported scheme/
        );
      });

      it('refuses a chain that loops or runs too long', async () => {
        await expect(
          driveChain(chainCtx(), 'http://a.test/1', {'http://a.test/1': 'http://a.test/2', 'http://a.test/2': 'http://a.test/1'})
        ).rejects.toThrow(/too many hops or a loop/);
      });

      // CheckFileInfo redirects name a new WOPISrc, so the token has to travel with it or the new host answers 401
      it('re-attaches the access_token to a CheckFileInfo hop and re-signs the proof for it', async () => {
        const res = await driveChain(
          chainCtx(),
          'http://a.test/w?access_token=tok',
          {'http://a.test/w?access_token=tok': 'http://b.test/w2'},
          {},
          {
            kind: 'checkFileInfo',
            access_token: 'tok'
          }
        );
        expect(res.seenUris[1]).toBe('http://b.test/w2?access_token=tok');
        expect(res.seenHeaders[1]['X-WOPI-TimeStamp']).toBeDefined();
      });

      // the contents credential authenticates us to the WOPI host, not to whatever it redirected the bytes to
      it('keeps the contents credential on a same-origin hop and drops it across origins', async () => {
        const c = ctxWithRules(
          [
            {address: 'a.test', allowed: true},
            {address: 'b.test', allowed: true},
            {address: '*', allowed: true}
          ],
          {},
          undefined,
          {sendAuthorizationHeader: true}
        );
        const resource = {kind: 'contents', access_token: 'tok'};
        const sameOrigin = await driveChain(c, 'http://a.test/1', {'http://a.test/1': 'http://a.test/2'}, {}, resource);
        expect(sameOrigin.seenHeaders[1]['X-WOPI-TimeStamp']).toBeDefined();
        expect(sameOrigin.seenHeaders[1].Authorization).toBe('Bearer tok');
        const crossOrigin = await driveChain(c, 'http://a.test/1', {'http://a.test/1': 'http://b.test/2'}, {}, resource);
        expect(crossOrigin.seenHeaders[1]['X-WOPI-TimeStamp']).toBeUndefined();
        expect(crossOrigin.seenHeaders[1].Authorization).toBeUndefined();
      });

      // leaving the credential origin is one-way: a later hop back onto the same host must not revive the bearer
      it('never restores the contents credential once the chain has left its origin', async () => {
        const c = ctxWithRules(
          [
            {address: 'a.test', allowed: true},
            {address: 'b.test', allowed: true},
            {address: '*', allowed: true}
          ],
          {},
          undefined,
          {sendAuthorizationHeader: true}
        );
        const res = await driveChain(
          c,
          'http://a.test/1',
          {'http://a.test/1': 'http://b.test/2', 'http://b.test/2': 'http://b.test/3'},
          {},
          {kind: 'contents', access_token: 'tok'}
        );
        expect(res.seenUris).toEqual(['http://a.test/1', 'http://b.test/2', 'http://b.test/3']);
        for (const headers of [res.seenHeaders[1], res.seenHeaders[2]]) {
          expect(headers.Authorization).toBeUndefined();
          expect(headers['X-WOPI-TimeStamp']).toBeUndefined();
        }
      });

      // one budget covers the whole chain, so hops cannot multiply the configured timeout
      it('shares one whole-cycle budget across the hops instead of restarting it', async () => {
        const seenTimeouts = [];
        const spy = jestApi.spyOn(utils, 'downloadUrlPromise').mockImplementation((_ctx, uri, options) => {
          seenTimeouts.push(options.timeout.wholeCycle);
          const next = {'http://a.test/1': 'http://a.test/2', 'http://a.test/2': 'http://a.test/3'}[uri];
          if (!next) {
            return Promise.resolve({});
          }
          return new Promise(resolve => setTimeout(resolve, 40)).then(() => options.beforeRedirect({href: next}));
        });
        try {
          await wopiEgress.download(chainCtx(), 'http://a.test/1', {headers: {}, timeout: {wholeCycle: '5s'}});
        } finally {
          spy.mockRestore();
        }
        const asMs = value => Number(String(value).replace('ms', ''));
        expect(seenTimeouts).toHaveLength(3);
        expect(asMs(seenTimeouts[1])).toBeLessThan(asMs(seenTimeouts[0]));
        expect(asMs(seenTimeouts[2])).toBeLessThan(asMs(seenTimeouts[1]));
      });

      // proof headers and the bearer are signed for one url, so a hop drops them and only a caller holding the token gets them back
      it('drops the url-bound headers on a hop and keeps the rest', async () => {
        const carried = {Authorization: 'Bearer x', 'X-WOPI-Proof': 'sig', 'X-WOPI-MaxExpectedSize': '10'};
        const res = await driveChain(chainCtx(), 'http://a.test/1', {'http://a.test/1': 'http://b.test/2'}, carried);
        expect(res.seenHeaders[1].Authorization).toBeUndefined();
        expect(res.seenHeaders[1]['X-WOPI-Proof']).toBeUndefined();
        expect(res.seenHeaders[1]['X-WOPI-MaxExpectedSize']).toBe('10');
      });
    });
  });
});
