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
const {Readable, Writable} = require('stream');
const {pipeline} = require('node:stream/promises');

const {
  parseDigestDictionary,
  getRawContentEncoding,
  validateCallerDigest,
  planIntegrityChecks,
  IntegrityStream
} = require('../../Common/sources/downloadIntegrity');

const body = Buffer.from('valid content data');
const otherBody = Buffer.from('tampered content data');

function hashBase64(algorithm, buf) {
  return crypto.createHash(algorithm).update(buf).digest('base64');
}

function devNull() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}

async function runIntegrityStream(plan, chunks, response) {
  const stream = new IntegrityStream(plan, response);
  await pipeline(Readable.from(chunks), stream, devNull());
  return stream;
}

describe('parseDigestDictionary', () => {
  test('parses RFC 9530 colon form', () => {
    expect(parseDigestDictionary('sha-256=:AAAA:')).toEqual({'sha-256': 'AAAA'});
  });

  test('parses legacy form without colons', () => {
    expect(parseDigestDictionary('SHA-256=AAAA')).toEqual({'sha-256': 'AAAA'});
  });

  test('parses multiple entries and drops parameters', () => {
    expect(parseDigestDictionary('sha-256=:AAAA:;q=1, md5=BBBB')).toEqual({'sha-256': 'AAAA', md5: 'BBBB'});
  });

  test('returns empty object for garbage and empty input', () => {
    expect(parseDigestDictionary('not a digest header')).toEqual({});
    expect(parseDigestDictionary(undefined)).toEqual({});
  });
});

describe('getRawContentEncoding', () => {
  test('finds content-encoding in rawHeaders case-insensitively', () => {
    const response = {request: {res: {rawHeaders: ['Content-Type', 'text/plain', 'Content-Encoding', 'gzip']}}};
    expect(getRawContentEncoding(response)).toBe('gzip');
  });

  test('returns undefined when header or rawHeaders are absent', () => {
    expect(getRawContentEncoding({request: {res: {rawHeaders: ['Content-Type', 'text/plain']}}})).toBeUndefined();
    expect(getRawContentEncoding({})).toBeUndefined();
  });
});

describe('validateCallerDigest', () => {
  const sha256 = hashBase64('sha256', body);

  test('normalizes a well-formed digest', () => {
    expect(validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256})).toEqual({
      source: 'WOPI SHA256',
      nodeAlgorithm: 'sha256',
      expectedBase64: sha256
    });
  });

  test('trims surrounding whitespace', () => {
    const result = validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: `  ${sha256}\n`});
    expect(result.expectedBase64).toBe(sha256);
  });

  test('accepts a value without base64 padding', () => {
    const result = validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256.replace(/=+$/, '')});
    expect(result.nodeAlgorithm).toBe('sha256');
  });

  test('returns null for missing input or fields', () => {
    expect(validateCallerDigest(undefined)).toBeNull();
    expect(validateCallerDigest({nodeAlgorithm: 'sha256', expectedBase64: sha256})).toBeNull();
    expect(validateCallerDigest({source: 'WOPI SHA256', expectedBase64: sha256})).toBeNull();
    expect(validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256'})).toBeNull();
  });

  test('returns null for unknown algorithms', () => {
    expect(validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'crc32c', expectedBase64: sha256})).toBeNull();
  });

  test('returns null for a value of the wrong digest size', () => {
    expect(validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: 'AAAA'})).toBeNull();
  });

  test('returns null for a malformed base64 string', () => {
    expect(validateCallerDigest({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: 'not base64!'})).toBeNull();
  });
});

describe('planIntegrityChecks', () => {
  const sha256 = hashBase64('sha256', body);
  const sha512 = hashBase64('sha512', body);
  const md5 = hashBase64('md5', body);

  test('returns null when nothing is verifiable', () => {
    expect(planIntegrityChecks({}, 200, undefined)).toBeNull();
    expect(planIntegrityChecks({'content-type': 'application/json'}, 200, undefined)).toBeNull();
  });

  describe('Content-Length', () => {
    test('planned on identity responses', () => {
      const plan = planIntegrityChecks({'content-length': '18'}, 200, undefined);
      expect(plan.expectedLength).toBe(18);
      expect(plan.digest).toBeNull();
    });

    test('skipped when the raw response was encoded (axios strips the header)', () => {
      expect(planIntegrityChecks({'content-length': '18'}, 200, 'gzip')).toBeNull();
    });

    test('skipped when content-encoding survives in headers', () => {
      expect(planIntegrityChecks({'content-length': '18', 'content-encoding': 'deflate'}, 200, undefined)).toBeNull();
    });

    test('ignores unparsable values', () => {
      expect(planIntegrityChecks({'content-length': 'abc'}, 200, undefined)).toBeNull();
    });
  });

  describe('Repr-Digest', () => {
    test('chosen on identity responses', () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'Repr-Digest', nodeAlgorithm: 'sha256', expectedBase64: sha256});
    });

    test('skipped when the response was encoded (RFC 9530 B.4: representation data includes the content coding)', () => {
      expect(planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, 'gzip')).toBeNull();
    });

    test('strongest offered algorithm wins', () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:, sha-512=:${sha512}:`}, 200, undefined);
      expect(plan.digest.nodeAlgorithm).toBe('sha512');
    });

    test('unsupported algorithms are skipped, not failed', () => {
      expect(planIntegrityChecks({'repr-digest': 'unixsum=:AAAA:'}, 200, undefined)).toBeNull();
    });

    test('values with a wrong digest size are skipped, not failed', () => {
      expect(planIntegrityChecks({'repr-digest': 'sha-256=:AAAA:'}, 200, undefined)).toBeNull();
    });

    test('preferred over Content-Digest', () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`, 'content-digest': `sha-256=:${sha256}:`}, 200, undefined);
      expect(plan.digest.source).toBe('Repr-Digest');
    });
  });

  describe('Content-Digest and legacy Digest', () => {
    test('Content-Digest chosen on identity responses', () => {
      const plan = planIntegrityChecks({'content-digest': `sha256=:${sha256}:`}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'Content-Digest', nodeAlgorithm: 'sha256'});
    });

    test('Content-Digest skipped when response was encoded (digest describes encoded bytes)', () => {
      expect(planIntegrityChecks({'content-digest': `sha-256=:${sha256}:`}, 200, 'gzip')).toBeNull();
    });

    test('RFC 3230 Digest chosen on identity responses', () => {
      const plan = planIntegrityChecks({digest: `SHA-256=${sha256}`}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'Digest', nodeAlgorithm: 'sha256'});
    });

    test('RFC 3230 sha token maps to sha1', () => {
      const sha1 = hashBase64('sha1', body);
      const plan = planIntegrityChecks({digest: `sha=${sha1}`}, 200, undefined);
      expect(plan.digest.nodeAlgorithm).toBe('sha1');
    });
  });

  describe('x-amz-checksum', () => {
    test('plain full-object checksum is chosen', () => {
      const plan = planIntegrityChecks({'x-amz-checksum-sha256': sha256}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'x-amz-checksum-sha256', nodeAlgorithm: 'sha256'});
    });

    test('multipart composite value with -N suffix is skipped', () => {
      expect(planIntegrityChecks({'x-amz-checksum-sha256': `${sha256}-3`}, 200, undefined)).toBeNull();
    });

    test('x-amz-checksum-type COMPOSITE disables the whole source', () => {
      expect(planIntegrityChecks({'x-amz-checksum-sha256': sha256, 'x-amz-checksum-type': 'COMPOSITE'}, 200, undefined)).toBeNull();
    });

    test('non-checksum control headers are never mistaken for digests', () => {
      expect(planIntegrityChecks({'x-amz-checksum-algorithm': 'SHA256', 'x-amz-checksum-mode': 'ENABLED'}, 200, undefined)).toBeNull();
    });

    test('suffix in the header name is not a digest header', () => {
      expect(planIntegrityChecks({'x-amz-checksum-sha256-1': sha256}, 200, undefined)).toBeNull();
    });

    test('algorithms Node cannot compute are skipped', () => {
      expect(planIntegrityChecks({'x-amz-checksum-crc32c': 'AAAAAA=='}, 200, undefined)).toBeNull();
      expect(planIntegrityChecks({'x-amz-checksum-crc64nvme': 'AAAAAAAAAAA='}, 200, undefined)).toBeNull();
    });

    test('skipped when response was encoded', () => {
      expect(planIntegrityChecks({'x-amz-checksum-sha256': sha256}, 200, 'gzip')).toBeNull();
    });
  });

  describe('x-goog-hash', () => {
    test('md5 entry is chosen, crc32c is ignored', () => {
      const plan = planIntegrityChecks({'x-goog-hash': `crc32c=AAAAAA==, md5=${md5}`}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'x-goog-hash', nodeAlgorithm: 'md5'});
    });

    test('crc32c-only header yields no plan', () => {
      expect(planIntegrityChecks({'x-goog-hash': 'crc32c=AAAAAA=='}, 200, undefined)).toBeNull();
    });

    test('skipped when GCS decompressive transcoding is possible', () => {
      expect(planIntegrityChecks({'x-goog-hash': `md5=${md5}`, 'x-goog-stored-content-encoding': 'gzip'}, 200, undefined)).toBeNull();
    });
  });

  describe('Content-MD5 and ETag', () => {
    test('well-formed Content-MD5 is chosen on identity responses', () => {
      const plan = planIntegrityChecks({'content-md5': md5}, 200, undefined);
      expect(plan.digest).toMatchObject({source: 'Content-MD5', nodeAlgorithm: 'md5'});
    });

    test('malformed Content-MD5 is skipped, not failed', () => {
      expect(planIntegrityChecks({'content-md5': 'not base64!'}, 200, undefined)).toBeNull();
    });

    test('Content-MD5 skipped when response was encoded', () => {
      expect(planIntegrityChecks({'content-md5': md5}, 200, 'gzip')).toBeNull();
    });

    test('ETag is never used: SSE-KMS and multipart ETags look like MD5 but are not', () => {
      const md5Hex = crypto.createHash('md5').update(body).digest('hex');
      expect(planIntegrityChecks({etag: `"${md5Hex}"`}, 200, undefined)).toBeNull();
    });
  });

  describe('206 Partial Content', () => {
    test('digests are skipped because headers describe the whole object', () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`, 'content-length': '5'}, 206, undefined);
      expect(plan.digest).toBeNull();
      expect(plan.expectedLength).toBe(5);
    });
  });

  describe('trailers', () => {
    test('announced digest trailers are planned only on identity responses', () => {
      expect(planIntegrityChecks({trailer: 'Repr-Digest'}, 200, 'gzip')).toBeNull();
      expect(planIntegrityChecks({trailer: 'Content-Digest'}, 200, 'gzip')).toBeNull();
      const plan = planIntegrityChecks({trailer: 'Repr-Digest, Content-Digest'}, 200, undefined);
      expect(plan.trailerSources).toEqual(['repr-digest', 'content-digest']);
    });

    test('trailers are not planned when a header digest is already chosen', () => {
      const plan = planIntegrityChecks({trailer: 'Repr-Digest', 'repr-digest': `sha-256=:${sha256}:`}, 200, undefined);
      expect(plan.trailerSources).toEqual([]);
    });
  });

  describe('caller-provided digest', () => {
    const callerDigest = {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256};

    test('planned on an identity response with no other verifiable source', () => {
      const plan = planIntegrityChecks({}, 200, undefined, callerDigest);
      expect(plan.callerDigest).toMatchObject({source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256});
      expect(plan.digest).toBeNull();
    });

    test('survives transport encoding that axios has already decoded', () => {
      const plan = planIntegrityChecks({}, 200, 'gzip', callerDigest);
      expect(plan.callerDigest.nodeAlgorithm).toBe('sha256');
      // header-derived checks stay disabled because the coding was applied to their bytes
      expect(plan.digest).toBeNull();
      expect(plan.expectedLength).toBeUndefined();
    });

    test('skipped when a coding still remains on the delivered stream', () => {
      expect(planIntegrityChecks({'content-encoding': 'gzip'}, 200, undefined, callerDigest)).toBeNull();
    });

    test('skipped on a 206 partial response', () => {
      expect(planIntegrityChecks({}, 206, undefined, callerDigest)).toBeNull();
    });

    test('malformed caller digest is skipped, not failed', () => {
      expect(planIntegrityChecks({}, 200, undefined, {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: 'bad'})).toBeNull();
    });

    test('verified alongside a header digest', () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined, callerDigest);
      expect(plan.digest.source).toBe('Repr-Digest');
      expect(plan.callerDigest.source).toBe('WOPI SHA256');
    });

    test('applied when content-encoding is explicitly identity', () => {
      const plan = planIntegrityChecks({'content-encoding': 'identity'}, 200, undefined, callerDigest);
      expect(plan.callerDigest.nodeAlgorithm).toBe('sha256');
    });

    test('suppresses fallback trailers when a caller digest already covers the bytes', () => {
      const plan = planIntegrityChecks({trailer: 'Repr-Digest'}, 200, undefined, callerDigest);
      expect(plan.callerDigest.nodeAlgorithm).toBe('sha256');
      expect(plan.trailerSources).toEqual([]);
    });
  });
});

describe('IntegrityStream', () => {
  const sha256 = hashBase64('sha256', body);
  const md5 = hashBase64('md5', body);

  test('passes on matching digest and reports the verified source', async () => {
    const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined);
    const stream = await runIntegrityStream(plan, [body]);
    expect(stream.integrity).toEqual({source: 'Repr-Digest', algorithm: 'sha256'});
  });

  test('fails with EBADDIGEST on mismatching digest', async () => {
    const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined);
    await expect(runIntegrityStream(plan, [otherBody])).rejects.toMatchObject({code: 'EBADDIGEST'});
  });

  test('verifies md5 sources in stream mode', async () => {
    const plan = planIntegrityChecks({'x-goog-hash': `md5=${md5}`}, 200, undefined);
    const half = Math.floor(body.length / 2);
    const stream = await runIntegrityStream(plan, [body.subarray(0, half), body.subarray(half)]);
    expect(stream.integrity).toEqual({source: 'x-goog-hash', algorithm: 'md5'});
  });

  test('fails with EBADCONTENTLENGTH when byte count differs', async () => {
    const plan = planIntegrityChecks({'content-length': '999'}, 200, undefined);
    await expect(runIntegrityStream(plan, [body])).rejects.toMatchObject({code: 'EBADCONTENTLENGTH'});
  });

  test('passes when byte count matches Content-Length', async () => {
    const plan = planIntegrityChecks({'content-length': String(body.length)}, 200, undefined);
    const stream = await runIntegrityStream(plan, [body]);
    expect(stream.bytesReceived).toBe(body.length);
  });

  test('tolerates missing base64 padding in the expected value', async () => {
    const plan = planIntegrityChecks({'x-amz-checksum-sha256': sha256.replace(/=+$/, '')}, 200, undefined);
    const stream = await runIntegrityStream(plan, [body]);
    expect(stream.integrity.source).toBe('x-amz-checksum-sha256');
  });

  describe('caller-provided digest', () => {
    const callerDigest = {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: sha256};

    test('passes and reports the caller source on a match', async () => {
      const plan = planIntegrityChecks({}, 200, undefined, callerDigest);
      const stream = await runIntegrityStream(plan, [body]);
      expect(stream.integrity).toEqual({source: 'WOPI SHA256', algorithm: 'sha256'});
    });

    test('fails with EBADDIGEST on a mismatch', async () => {
      const plan = planIntegrityChecks({}, 200, undefined, callerDigest);
      await expect(runIntegrityStream(plan, [otherBody])).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test('verifies a header digest and the caller digest together', async () => {
      const plan = planIntegrityChecks({'x-goog-hash': `md5=${md5}`}, 200, undefined, callerDigest);
      const stream = await runIntegrityStream(plan, [body]);
      expect(stream.bytesReceived).toBe(body.length);
    });

    test('fails when the caller digest is wrong even if a header digest matches', async () => {
      const wrongCaller = {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: hashBase64('sha256', otherBody)};
      const plan = planIntegrityChecks({'x-goog-hash': `md5=${md5}`}, 200, undefined, wrongCaller);
      await expect(runIntegrityStream(plan, [body])).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test('does not double-finalize when a header digest shares the caller algorithm', async () => {
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined, callerDigest);
      const stream = await runIntegrityStream(plan, [body]);
      expect(stream.bytesReceived).toBe(body.length);
    });

    test('fails when a shared-algorithm caller digest is wrong but the header digest matches', async () => {
      const wrongCaller = {source: 'WOPI SHA256', nodeAlgorithm: 'sha256', expectedBase64: hashBase64('sha256', otherBody)};
      const plan = planIntegrityChecks({'repr-digest': `sha-256=:${sha256}:`}, 200, undefined, wrongCaller);
      await expect(runIntegrityStream(plan, [body])).rejects.toMatchObject({code: 'EBADDIGEST'});
    });
  });

  describe('trailer digests', () => {
    function responseWithTrailers(trailers) {
      return {request: {res: {trailers}}};
    }

    test('verifies sha-256 from an announced Repr-Digest trailer', async () => {
      const plan = planIntegrityChecks({trailer: 'Repr-Digest'}, 200, undefined);
      const response = responseWithTrailers({'repr-digest': `sha-256=:${sha256}:`});
      const stream = await runIntegrityStream(plan, [body], response);
      expect(stream.integrity).toEqual({source: 'repr-digest (trailer)', algorithm: 'sha256'});
    });

    test('fails with EBADDIGEST on mismatching trailer digest', async () => {
      const plan = planIntegrityChecks({trailer: 'Repr-Digest'}, 200, undefined);
      const response = responseWithTrailers({'repr-digest': `sha-256=:${hashBase64('sha256', otherBody)}:`});
      await expect(runIntegrityStream(plan, [body], response)).rejects.toMatchObject({code: 'EBADDIGEST'});
    });

    test('passes when the announced trailer never arrives', async () => {
      const plan = planIntegrityChecks({trailer: 'Repr-Digest'}, 200, undefined);
      const stream = await runIntegrityStream(plan, [body], responseWithTrailers({}));
      expect(stream.integrity).toBeNull();
    });
  });
});
