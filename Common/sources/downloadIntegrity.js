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

'use strict';

const crypto = require('crypto');
const {Transform} = require('stream');

// Node crypto names for algorithm tokens accepted from integrity headers
const NODE_ALGORITHM_BY_TOKEN = {
  'sha-512': 'sha512',
  sha512: 'sha512',
  'sha-256': 'sha256',
  sha256: 'sha256',
  'sha-1': 'sha1',
  sha1: 'sha1',
  sha: 'sha1',
  md5: 'md5'
};
// Relative strength used to pick one algorithm when a header offers several
const ALGORITHM_STRENGTH = {sha512: 4, sha256: 3, sha1: 2, md5: 1};
const DIGEST_BYTE_LENGTH = {sha512: 64, sha256: 32, sha1: 20, md5: 16};
// S3 checksum algorithms Node can compute, strongest first (crc/xxhash are not in Node crypto)
const AMZ_ALGORITHM_PREFERENCE = ['sha512', 'sha256', 'sha1', 'md5'];

/**
 * Parse an RFC 9530 / RFC 3230 style digest dictionary header value.
 * Accepts both "alg=:base64:" (RFC 9530) and "alg=base64" (legacy) entries and drops ;parameters.
 *
 * @param {string} [value] - Header value, e.g. "sha-256=:AAAA:, md5=BBBB"
 * @returns {Object<string, string>} Map of lowercase algorithm token to base64 value
 */
function parseDigestDictionary(value) {
  const result = {};
  if (!value) {
    return result;
  }
  for (const item of String(value).split(',')) {
    const [pair] = item.trim().split(';', 1);
    const match = pair.match(/^([A-Za-z0-9-]+)=:?([A-Za-z0-9+/]+={0,2}):?$/);
    if (match) {
      result[match[1].toLowerCase()] = match[2];
    }
  }
  return result;
}

/**
 * Check that a base64 value decodes to the exact digest size of the algorithm.
 * Values of the wrong size are treated as not comparable rather than as mismatches.
 *
 * @param {string} nodeAlgorithm - Node crypto algorithm name
 * @param {string} base64Value - Candidate digest value
 * @returns {boolean} Whether the value can be a digest of that algorithm
 */
function isPlausibleBase64Digest(nodeAlgorithm, base64Value) {
  return Buffer.from(base64Value, 'base64').length === DIGEST_BYTE_LENGTH[nodeAlgorithm];
}

/**
 * Pick the strongest verifiable digest from a parsed dictionary.
 *
 * @param {Object<string, string>} dictionary - Result of parseDigestDictionary
 * @returns {{nodeAlgorithm: string, expectedBase64: string}|null} Chosen digest or null
 */
function pickStrongestDigest(dictionary) {
  let best = null;
  for (const [token, expectedBase64] of Object.entries(dictionary)) {
    const nodeAlgorithm = NODE_ALGORITHM_BY_TOKEN[token];
    if (!nodeAlgorithm || !isPlausibleBase64Digest(nodeAlgorithm, expectedBase64)) {
      continue;
    }
    if (!best || ALGORITHM_STRENGTH[nodeAlgorithm] > ALGORITHM_STRENGTH[best.nodeAlgorithm]) {
      best = {nodeAlgorithm, expectedBase64};
    }
  }
  return best;
}

/**
 * Select a verifiable S3 checksum header, skipping composite (multipart) checksums.
 *
 * @param {object} headers - Response headers (lowercase keys)
 * @returns {{nodeAlgorithm: string, expectedBase64: string, source: string}|null} Chosen digest or null
 */
function selectAmzChecksum(headers) {
  // Composite checksums hash the part checksums, not the object bytes, so they are not comparable
  if ('COMPOSITE' === String(headers['x-amz-checksum-type'] || '').toUpperCase()) {
    return null;
  }
  for (const name of AMZ_ALGORITHM_PREFERENCE) {
    const value = headers['x-amz-checksum-' + name];
    if (!value) {
      continue;
    }
    const expectedBase64 = String(value).trim();
    // A trailing -N marks a multipart composite value even without x-amz-checksum-type
    if (/-\d+$/.test(expectedBase64) || !isPlausibleBase64Digest(name, expectedBase64)) {
      continue;
    }
    return {nodeAlgorithm: name, expectedBase64, source: 'x-amz-checksum-' + name};
  }
  return null;
}

/**
 * Select a verifiable digest from the GCS x-goog-hash header.
 *
 * @param {object} headers - Response headers (lowercase keys)
 * @returns {{nodeAlgorithm: string, expectedBase64: string, source: string}|null} Chosen digest or null
 */
function selectGoogHash(headers) {
  // GCS decompressive transcoding serves bytes that differ from the stored object the hash describes
  const stored = String(headers['x-goog-stored-content-encoding'] || '').toLowerCase();
  if (stored && 'identity' !== stored) {
    return null;
  }
  const candidate = pickStrongestDigest(parseDigestDictionary(headers['x-goog-hash']));
  return candidate ? {...candidate, source: 'x-goog-hash'} : null;
}

/**
 * Select the single digest source to verify, in priority order.
 * The caller guarantees an identity response, so every source describes the observed bytes.
 * ETag is deliberately not used: S3 SSE-KMS/SSE-C and multipart ETags look like MD5 but are not.
 *
 * @param {object} headers - Response headers (lowercase keys)
 * @returns {{nodeAlgorithm: string, expectedBase64: string, source: string}|null} Chosen digest or null
 */
function selectDigestSource(headers) {
  let candidate = pickStrongestDigest(parseDigestDictionary(headers['repr-digest']));
  if (candidate) {
    return {...candidate, source: 'Repr-Digest'};
  }
  candidate = pickStrongestDigest(parseDigestDictionary(headers['content-digest']));
  if (candidate) {
    return {...candidate, source: 'Content-Digest'};
  }
  candidate = pickStrongestDigest(parseDigestDictionary(headers['digest']));
  if (candidate) {
    return {...candidate, source: 'Digest'};
  }
  candidate = selectAmzChecksum(headers);
  if (candidate) {
    return candidate;
  }
  candidate = selectGoogHash(headers);
  if (candidate) {
    return candidate;
  }
  const contentMd5 = headers['content-md5'];
  if (contentMd5) {
    const expectedBase64 = String(contentMd5).trim();
    if (isPlausibleBase64Digest('md5', expectedBase64)) {
      return {nodeAlgorithm: 'md5', expectedBase64, source: 'Content-MD5'};
    }
  }
  return null;
}

/**
 * Collect digest headers announced to arrive in HTTP trailers.
 * Only sha-256 is verified from trailers, so the stream hashes sha256 speculatively.
 *
 * @param {object} headers - Response headers (lowercase keys)
 * @returns {string[]} Trailer header names to check after the body ends
 */
function selectTrailerDigestSources(headers) {
  const announced = String(headers['trailer'] || '')
    .toLowerCase()
    .split(',')
    .map(item => item.trim());
  const sources = [];
  if (announced.includes('repr-digest')) {
    sources.push('repr-digest');
  }
  if (announced.includes('content-digest')) {
    sources.push('content-digest');
  }
  return sources;
}

/**
 * Extract the raw content-encoding header from an axios response.
 * Axios 1.x deletes content-encoding from response.headers when it decompresses,
 * so the original value survives only in the underlying IncomingMessage.rawHeaders.
 *
 * @param {object} response - Axios response object
 * @returns {string|undefined} Original content-encoding value, if the response had one
 */
function getRawContentEncoding(response) {
  const rawHeaders = response?.request?.res?.rawHeaders;
  if (!rawHeaders) {
    return undefined;
  }
  for (let i = 0; i < rawHeaders.length - 1; i += 2) {
    if ('content-encoding' === rawHeaders[i].toLowerCase()) {
      return rawHeaders[i + 1];
    }
  }
  return undefined;
}

/**
 * Decide which integrity checks are safe for this response, before reading the body.
 * Returns null when nothing is verifiable so callers can skip the integrity stream entirely.
 *
 * @param {object} headers - Response headers (lowercase keys)
 * @param {number} statusCode - HTTP status code of the response
 * @param {string} [rawContentEncoding] - Original content-encoding from getRawContentEncoding
 * @returns {{expectedLength: number|undefined, digest: object|null, trailerSources: string[]}|null} Plan or null
 */
function planIntegrityChecks(headers, statusCode, rawContentEncoding) {
  if (!headers) {
    return null;
  }
  const encoding = String(rawContentEncoding || headers['content-encoding'] || '').toLowerCase();
  // RFC 9530 ties every digest (incl. Repr-Digest, see B.4) and content-length to the content coding, while axios yields decoded bytes
  if (encoding && 'identity' !== encoding) {
    return null;
  }
  // A 206 body is a range while digest headers describe the whole representation
  const isPartial = 206 === statusCode;

  let expectedLength;
  if (undefined !== headers['content-length']) {
    const parsed = parseInt(headers['content-length'], 10);
    if (!isNaN(parsed)) {
      expectedLength = parsed;
    }
  }

  const digest = isPartial ? null : selectDigestSource(headers);
  const trailerSources = isPartial || digest ? [] : selectTrailerDigestSources(headers);

  if (undefined === expectedLength && !digest && 0 === trailerSources.length) {
    return null;
  }
  return {expectedLength, digest, trailerSources};
}

function stripBase64Padding(value) {
  return String(value).replace(/=+$/, '');
}

/**
 * Pass-through stream that counts bytes, hashes only the planned algorithms and
 * validates the download in _flush, so any consumer pipeline fails on mismatch.
 * Errors carry code EBADCONTENTLENGTH or EBADDIGEST.
 *
 * @class IntegrityStream
 * @extends {Transform}
 */
class IntegrityStream extends Transform {
  /**
   * @param {object} plan - Result of planIntegrityChecks
   * @param {object} [response] - Axios response, needed only for trailer digests
   */
  constructor(plan, response) {
    super();
    this.plan = plan;
    this.response = response;
    this.bytesReceived = 0;
    this.integrity = null;
    this.hashes = new Map();
    if (plan.digest) {
      this.hashes.set(plan.digest.nodeAlgorithm, crypto.createHash(plan.digest.nodeAlgorithm));
    }
    if (plan.trailerSources.length > 0 && !this.hashes.has('sha256')) {
      this.hashes.set('sha256', crypto.createHash('sha256'));
    }
  }

  _transform(chunk, _encoding, callback) {
    this.bytesReceived += chunk.length;
    for (const hash of this.hashes.values()) {
      hash.update(chunk);
    }
    callback(null, chunk);
  }

  _flush(callback) {
    try {
      this._validate();
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _validate() {
    const {expectedLength, digest, trailerSources} = this.plan;
    if (undefined !== expectedLength && expectedLength !== this.bytesReceived) {
      const err = new Error(`Content-Length mismatch: expected ${expectedLength} bytes, received ${this.bytesReceived}`);
      err.code = 'EBADCONTENTLENGTH';
      throw err;
    }
    if (digest) {
      const actualBase64 = this.hashes.get(digest.nodeAlgorithm).digest('base64');
      this._compareDigest(digest.source, digest.nodeAlgorithm, digest.expectedBase64, actualBase64);
    } else if (trailerSources.length > 0) {
      this._validateTrailers(trailerSources);
    }
  }

  _compareDigest(source, algorithm, expectedBase64, actualBase64) {
    if (stripBase64Padding(expectedBase64) !== stripBase64Padding(actualBase64)) {
      const err = new Error(`${source} mismatch for ${algorithm}: expected ${expectedBase64}, actual ${actualBase64}`);
      err.code = 'EBADDIGEST';
      throw err;
    }
    this.integrity = {source, algorithm};
  }

  _validateTrailers(trailerSources) {
    const trailers = this.response?.request?.res?.trailers;
    if (!trailers) {
      return;
    }
    for (const source of trailerSources) {
      const dictionary = parseDigestDictionary(trailers[source]);
      for (const [token, expectedBase64] of Object.entries(dictionary)) {
        if ('sha256' === NODE_ALGORITHM_BY_TOKEN[token] && isPlausibleBase64Digest('sha256', expectedBase64)) {
          const actualBase64 = this.hashes.get('sha256').digest('base64');
          this._compareDigest(`${source} (trailer)`, 'sha256', expectedBase64, actualBase64);
          return;
        }
      }
    }
  }
}

exports.parseDigestDictionary = parseDigestDictionary;
exports.getRawContentEncoding = getRawContentEncoding;
exports.planIntegrityChecks = planIntegrityChecks;
exports.IntegrityStream = IntegrityStream;
