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

const {describe, test, expect} = require('@jest/globals');
const crypto = require('crypto');
const config = require('../../Common/node_modules/config');

const operationContext = require('../../Common/sources/operationContext');
const utils = require('../../Common/sources/utils');

const ctx = new operationContext.Context();
const minimumIterationsByteLength = 4;

function sha256Base64(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64');
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('validateDownloadIntegrity', () => {
  const validBody = Buffer.from('valid content data');
  const tamperedBody = Buffer.from('tampered content data');

  function expectIntegrityError(headers, body, expectedCode) {
    let error;
    try {
      utils.validateDownloadIntegrity(headers, body);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe(expectedCode);
  }

  describe('Content-Length', () => {
    test('accepts when Content-Length matches', () => {
      expect(() => {
        utils.validateDownloadIntegrity({'content-length': '' + validBody.length}, validBody);
      }).not.toThrow();
    });

    test('throws EBADCONTENTLENGTH when Content-Length too large', () => {
      expectIntegrityError({'content-length': '999'}, validBody, 'EBADCONTENTLENGTH');
    });

    test('throws EBADCONTENTLENGTH when Content-Length too small', () => {
      expectIntegrityError({'content-length': '1'}, validBody, 'EBADCONTENTLENGTH');
    });

    test('passes when Content-Length is missing', () => {
      expect(() => {
        utils.validateDownloadIntegrity({}, validBody);
      }).not.toThrow();
    });
  });

  describe('Content-Digest (RFC 3230)', () => {
    test('accepts when sha256 matches', () => {
      const expected = sha256Base64(validBody);
      expect(() => {
        utils.validateDownloadIntegrity({'content-digest': 'sha256=:' + expected + ':'}, validBody);
      }).not.toThrow();
    });

    test('throws EBADDIGEST when sha256 does not match', () => {
      const expected = sha256Base64(validBody);
      expectIntegrityError({'content-digest': 'sha256=:' + expected + ':'}, tamperedBody, 'EBADDIGEST');
    });

    test('passes when Content-Digest is missing', () => {
      expect(() => {
        utils.validateDownloadIntegrity({}, validBody);
      }).not.toThrow();
    });
  });

  describe('x-amz-checksum', () => {
    test('accepts when sha256 matches', () => {
      const expected = sha256Base64(validBody);
      expect(() => {
        utils.validateDownloadIntegrity({'x-amz-checksum-sha256': expected}, validBody);
      }).not.toThrow();
    });

    test('throws EBADAMZCHECKSUM when sha256 does not match', () => {
      const expected = sha256Base64(validBody);
      expectIntegrityError({'x-amz-checksum-sha256': expected}, tamperedBody, 'EBADAMZCHECKSUM');
    });

    test('passes when no x-amz-checksum headers present', () => {
      expect(() => {
        utils.validateDownloadIntegrity({}, validBody);
      }).not.toThrow();
    });
  });

  describe('combined validation', () => {
    test('passes when all headers match', () => {
      const b64 = sha256Base64(validBody);
      const headers = {
        'content-length': '' + validBody.length,
        'content-digest': 'sha256=:' + b64 + ':',
        'x-amz-checksum-sha256': b64
      };
      expect(() => {
        utils.validateDownloadIntegrity(headers, validBody);
      }).not.toThrow();
    });

    test('throws first mismatch when multiple headers are present', () => {
      const b64 = sha256Base64(validBody);
      const headers = {
        'content-length': '' + validBody.length,
        'content-digest': 'sha256=:' + b64 + ':',
        'x-amz-checksum-sha256': b64
      };
      // Use body with same length but different content so Content-Length passes,
      // then Content-Digest fails
      const sameLenTampered = Buffer.from('VALID content data');
      expectIntegrityError(headers, sameLenTampered, 'EBADDIGEST');
    });
  });

  describe('stream info (non-buffer)', () => {
    test('accepts when Content-Length matches byteCount', () => {
      const info = {byteCount: validBody.length, sha256Hex: sha256Hex(validBody)};
      expect(() => {
        utils.validateDownloadIntegrity({'content-length': '' + validBody.length}, info);
      }).not.toThrow();
    });

    test('throws EBADCONTENTLENGTH when byteCount differs', () => {
      const info = {byteCount: validBody.length, sha256Hex: sha256Hex(validBody)};
      expectIntegrityError({'content-length': '999'}, info, 'EBADCONTENTLENGTH');
    });

    test('throws EBADDIGEST when sha256Hex does not match Content-Digest', () => {
      const info = {byteCount: validBody.length, sha256Hex: sha256Hex(validBody)};
      const wrongDigest = sha256Base64(Buffer.from('different data'));
      expectIntegrityError({'content-digest': 'sha256=:' + wrongDigest + ':'}, info, 'EBADDIGEST');
    });
  });

  describe('Content-Length with content-encoding (gzip)', () => {
    test('skips Content-Length check when content-encoding is present', () => {
      const headers = {
        'content-length': '1',
        'content-encoding': 'gzip'
      };
      expect(() => {
        utils.validateDownloadIntegrity(headers, validBody);
      }).not.toThrow();
    });

    test('skips Content-Length check with any content-encoding', () => {
      const headers = {
        'content-length': '1',
        'content-encoding': 'deflate'
      };
      expect(() => {
        utils.validateDownloadIntegrity(headers, validBody);
      }).not.toThrow();
    });

    test('still checks Content-Length when content-encoding is absent', () => {
      expectIntegrityError({'content-length': '1'}, validBody, 'EBADCONTENTLENGTH');
    });
  });

  describe('x-amz-checksum with unknown algorithms', () => {
    test('skips CRC32 (unsupported by Node.js crypto)', () => {
      const body = Buffer.from('test data for crc32');
      expect(() => {
        utils.validateDownloadIntegrity({'x-amz-checksum-crc32': 'somebase64'}, body);
      }).not.toThrow();
    });

    test('skips CRC32C (unsupported by Node.js crypto)', () => {
      const body = Buffer.from('test data for crc32c');
      expect(() => {
        utils.validateDownloadIntegrity({'x-amz-checksum-crc32c': 'somebase64'}, body);
      }).not.toThrow();
    });

    test('skips SHA1 in stream mode (only sha256 tracked)', () => {
      const info = {byteCount: 10, sha256Hex: 'abc'};
      expect(() => {
        utils.validateDownloadIntegrity({'x-amz-checksum-sha1': 'base64hash'}, info);
      }).not.toThrow();
    });
  });

  describe('x-goog-hash (Google Cloud Storage)', () => {
    test('accepts when md5 matches', () => {
      const md5 = crypto.createHash('md5').update(validBody).digest('base64');
      expect(() => {
        utils.validateDownloadIntegrity({'x-goog-hash': 'md5=' + md5}, validBody);
      }).not.toThrow();
    });

    test('throws EBADDIGEST when md5 does not match', () => {
      const wrongMd5 = crypto.createHash('md5').update(Buffer.from('different')).digest('base64');
      expectIntegrityError({'x-goog-hash': 'md5=' + wrongMd5}, validBody, 'EBADDIGEST');
    });

    test('skips CRC32C in x-goog-hash (unsupported)', () => {
      const body = Buffer.from('test');
      expect(() => {
        utils.validateDownloadIntegrity({'x-goog-hash': 'crc32c=AAAA'}, body);
      }).not.toThrow();
    });

    test('handles multiple comma-separated algorithms in x-goog-hash', () => {
      const body = Buffer.from('test data');
      const md5 = crypto.createHash('md5').update(body).digest('base64');
      expect(() => {
        utils.validateDownloadIntegrity({'x-goog-hash': 'crc32c=AAAA, md5=' + md5}, body);
      }).not.toThrow();
    });

    test('throws on md5 mismatch even when crc32c is present', () => {
      const body = Buffer.from('test data');
      const wrongMd5 = crypto.createHash('md5').update(Buffer.from('wrong')).digest('base64');
      expectIntegrityError({'x-goog-hash': 'crc32c=AAAA, md5=' + wrongMd5}, body, 'EBADDIGEST');
    });
  });

  describe('Repr-Digest (RFC 9530)', () => {
    test('accepts when sha-256 matches', () => {
      const expected = sha256Base64(validBody);
      expect(() => {
        utils.validateDownloadIntegrity({'repr-digest': 'sha-256=:' + expected + ':'}, validBody);
      }).not.toThrow();
    });

    test('throws EBADDIGEST when sha-256 does not match', () => {
      const expected = sha256Base64(validBody);
      expectIntegrityError({'repr-digest': 'sha-256=:' + expected + ':'}, tamperedBody, 'EBADDIGEST');
    });

    test('passes when Repr-Digest is missing', () => {
      expect(() => {
        utils.validateDownloadIntegrity({}, validBody);
      }).not.toThrow();
    });

    test('supports multiple algorithms in Repr-Digest', () => {
      const sha256b64 = sha256Base64(validBody);
      const sha512b64 = crypto.createHash('sha512').update(validBody).digest('base64');
      expect(() => {
        utils.validateDownloadIntegrity({'repr-digest': 'sha-256=:' + sha256b64 + ', sha-512=:' + sha512b64 + ':'}, validBody);
      }).not.toThrow();
    });
  });

  describe('false positive prevention', () => {
    test('no headers at all - no check performed', () => {
      expect(() => {
        utils.validateDownloadIntegrity({}, Buffer.from('any data'));
      }).not.toThrow();
    });

    test('gzip with all headers - only digest checks run, Content-Length skipped', () => {
      const body = Buffer.from('compressed representation');
      const b64 = sha256Base64(body);
      const headers = {
        'content-length': '1',
        'content-encoding': 'gzip',
        'content-digest': 'sha256=:' + b64 + ':',
        'x-amz-checksum-sha256': b64
      };
      expect(() => {
        utils.validateDownloadIntegrity(headers, body);
      }).not.toThrow();
    });

    test('Content-Length matches but body is gzipped - no false positive', () => {
      // Content-Length of 1 and body of 18 bytes - if gzip, this should be skipped
      const headers = {
        'content-length': '1',
        'content-encoding': 'gzip'
      };
      expect(() => {
        utils.validateDownloadIntegrity(headers, Buffer.from('some real content'));
      }).not.toThrow();
    });
  });
});

describe('AES encryption & decryption', () => {
  test('Iterations range', async () => {
    const configuration = config.util.cloneDeep(config.get('aesEncrypt.config'));
    const encrypted = await utils.encryptPassword(ctx, 'secretstring');
    const {iterationsByteLength = 5} = configuration;

    const [iterationsHex] = encrypted.split(':');
    const iterations = parseInt(iterationsHex, 16);

    const iterationsLength = iterationsByteLength < minimumIterationsByteLength ? minimumIterationsByteLength : iterationsByteLength;
    expect(iterations).toBeGreaterThanOrEqual(Math.pow(10, iterationsLength - 1));
    expect(iterations).toBeLessThanOrEqual(Math.pow(10, iterationsLength) - 1);
  });

  test('Correct workflow', async () => {
    const encrypted = await utils.encryptPassword(ctx, 'secretstring');
    const decrypted = await utils.decryptPassword(ctx, encrypted);
    expect(decrypted).toEqual('secretstring');
  });
});
