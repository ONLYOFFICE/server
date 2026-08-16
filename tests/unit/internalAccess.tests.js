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

// Bug 82817: /internal and /info must be loopback-only on the server side, independently of the nginx allow/deny block

'use strict';

const {describe, test, expect, jest, beforeEach, afterEach} = require('@jest/globals');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

function makeRequest(remoteAddress, forwardedForHeader) {
  const headers = {};
  if (forwardedForHeader) {
    headers['x-forwarded-for'] = forwardedForHeader;
  }
  return {socket: {remoteAddress}, headers, originalUrl: '/internal/cluster/inactive', url: '/internal/cluster/inactive'};
}

function makeResponse() {
  return {sendStatus: jest.fn()};
}

function mockConfig(overrides) {
  jest.spyOn(operationContext.Context.prototype, 'getCfg').mockImplementation((property, defaultValue) => {
    return Object.hasOwn(overrides, property) ? overrides[property] : defaultValue;
  });
}

describe('checkInternalAccess', () => {
  beforeEach(() => {
    jest.spyOn(operationContext.Context.prototype, 'initTenantCache').mockResolvedValue(undefined);
    mockConfig({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('allows a direct loopback ipv4 request', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  test('allows a direct loopback ipv6 request', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('::1'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  test('allows a loopback client proxied by nginx on the same host', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '127.0.0.1'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  test('denies a remote client proxied by nginx on the same host', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  // nginx appends the real peer to the client-supplied header, so the spoofed loopback entry sits to the left of it
  test('denies a spoofed X-Forwarded-For claiming loopback', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '127.0.0.1, 203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('denies a request arriving directly from a remote peer', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  // the loopback decision must not depend on the tenant cache, or a config failure would block a local shutdown call
  test('allows a loopback request when the tenant cache fails to load', async () => {
    operationContext.Context.prototype.initTenantCache.mockRejectedValue(new Error('config unavailable'));
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1'), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  test('still denies a remote peer when the tenant cache fails to load', async () => {
    operationContext.Context.prototype.initTenantCache.mockRejectedValue(new Error('config unavailable'));
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  // the inbound ip filter must not widen the loopback policy in either direction
  test('denies a remote peer when the inbound ip filter is off', async () => {
    mockConfig({'services.CoAuthoring.ipfilter.useforrequest': false});
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '10.0.0.7'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('denies a remote peer that the enabled inbound ip filter would allow', async () => {
    mockConfig({
      'services.CoAuthoring.ipfilter.useforrequest': true,
      'services.CoAuthoring.ipfilter.rules': [
        {address: '10.0.0.*', allowed: true},
        {address: '*', allowed: false}
      ]
    });
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '10.0.0.7'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('denies a remote peer under the default allow-all ip filter rules', async () => {
    mockConfig({
      'services.CoAuthoring.ipfilter.useforrequest': true,
      'services.CoAuthoring.ipfilter.rules': [{address: '*', allowed: true}]
    });
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('reports the denial with ipfilter.errorcode', async () => {
    mockConfig({'services.CoAuthoring.ipfilter.errorcode': 404});
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '203.0.113.5'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(404);
  });

  test('denies an unparseable forwarded address', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest('127.0.0.1', '203.0.113.5:54321'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('denies a request with an unparseable peer address', async () => {
    const res = makeResponse();
    const next = jest.fn();

    await utils.checkInternalAccess(makeRequest(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });
});

describe('isLoopbackAddress', () => {
  test('recognises loopback forms', () => {
    expect(utils.isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(utils.isLoopbackAddress('127.1.2.3')).toBe(true);
    expect(utils.isLoopbackAddress('::1')).toBe(true);
    expect(utils.isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test('rejects non-loopback and malformed values', () => {
    expect(utils.isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(utils.isLoopbackAddress('203.0.113.5')).toBe(false);
    expect(utils.isLoopbackAddress('::ffff:10.0.0.1')).toBe(false);
    expect(utils.isLoopbackAddress('')).toBe(false);
    expect(utils.isLoopbackAddress(undefined)).toBe(false);
    expect(utils.isLoopbackAddress('not-an-ip')).toBe(false);
  });
});
