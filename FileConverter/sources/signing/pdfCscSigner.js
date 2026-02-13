/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 */

'use strict';

/**
 * PDF CSC Signer — PAdES-B-B signing via Cloud Signature Consortium API v2.
 *
 * Uses pdfSigningCore for PDF placeholder operations and CMS assembly.
 * Only the CSC API calls are provider-specific.
 *
 * Implements ETSI TS 119 432 (CSC API v2) signing flow:
 *   1. OAuth2 client_credentials → access_token
 *   2. credentials/authorize → SAD (Signature Activation Data)
 *   3. signatures/signHash → raw signature
 *
 * Auth flexibility:
 *   - OAuth2 client_credentials (standard CSC flow): set clientId + clientSecret + tokenUrl
 *   - Pre-obtained token: set accessToken directly, skip tokenUrl/clientId/clientSecret
 *   - No auth (internal/test providers): leave all auth fields empty
 *
 * Supported certs: .crt / .pem only (no PFX/P12).
 *
 * Usage:
 *   const { signPdfFile } = require('./pdfCscSigner');
 *
 *   await signPdfFile('input.pdf', 'signed.pdf', {
 *     baseUrl: 'https://csc-provider.example.com/csc/v2',
 *     credentialId: 'my-credential-id',
 *     clientId: 'oauth-client-id',
 *     clientSecret: 'oauth-client-secret',
 *     tokenUrl: 'https://csc-provider.example.com/oauth2/token',
 *     certificateChainPath: '/path/to/chain.pem',
 *   });
 */

const {signPdfWithSigner, SIG_OID} = require('./pdfSigningCore');
const {axios} = require('./../../../Common/sources/utils');

const HTTP_TIMEOUT = 30000;

/**
 * Signs digests using CSC API v2 (ETSI TS 119 432).
 * Implements signer contract: sign(digest) → Buffer.
 */
class CscSigner {
  /**
   * @param {Object} config
   * @param {string} config.baseUrl - CSC API base URL (e.g. https://provider.com/csc/v2)
   * @param {string} config.credentialId - signing credential ID at the provider
   * @param {string} [config.tokenUrl] - OAuth2 token endpoint (skip for pre-obtained token)
   * @param {string} [config.clientId] - OAuth2 client ID
   * @param {string} [config.clientSecret] - OAuth2 client secret
   * @param {string} [config.accessToken] - pre-obtained bearer token (skips OAuth2 flow)
   * @param {string} [config.pin] - user PIN for credential authorization
   * @param {string} [config.signAlgo] - explicit OID (auto-detected from hash if omitted)
   * @param {string} [config.hashAlgorithm='sha256']
   */
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.credentialId = config.credentialId;
    this.tokenUrl = config.tokenUrl || '';
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
    this.accessToken = config.accessToken || '';
    this.pin = config.pin || '';
    this.hashAlgorithm = config.hashAlgorithm || 'sha256';
    this.signAlgo = config.signAlgo || '';

    if (!this.baseUrl) throw new Error('CSC baseUrl is required');
    if (!this.credentialId) throw new Error('CSC credentialId is required');
  }

  /**
   * Obtain OAuth2 access token via client_credentials grant.
   * Returns null if no tokenUrl configured (allows no-auth or pre-obtained token).
   *
   * @returns {Promise<string|null>}
   */
  async getAccessToken() {
    if (this.accessToken) return this.accessToken;
    if (!this.tokenUrl || !this.clientId) return null;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const resp = await axios.post(this.tokenUrl, params, {
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      timeout: HTTP_TIMEOUT
    });

    return resp.data.access_token;
  }

  /**
   * Authorize credential for signing (CSC credentials/authorize).
   *
   * @param {string|null} token - bearer token
   * @param {string} hashB64 - base64-encoded digest
   * @returns {Promise<string>} SAD (Signature Activation Data)
   */
  async authorizeCredential(token, hashB64) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const payload = {
      credentialID: this.credentialId,
      numSignatures: 1,
      hash: [hashB64]
    };
    if (this.pin) payload.PIN = this.pin;

    const resp = await axios.post(`${this.baseUrl}/credentials/authorize`, payload, {
      headers,
      timeout: HTTP_TIMEOUT
    });

    return resp.data.SAD;
  }

  /**
   * Sign hash remotely (CSC signatures/signHash).
   *
   * @param {string|null} token - bearer token
   * @param {string} sad - Signature Activation Data
   * @param {string} hashB64 - base64-encoded digest
   * @returns {Promise<Buffer>} raw signature bytes
   */
  async signHash(token, sad, hashB64) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Default to RSA OID; override via config.signAlgo for EC or other algorithms
    const signAlgo = this.signAlgo || SIG_OID[this.hashAlgorithm];

    const resp = await axios.post(
      `${this.baseUrl}/signatures/signHash`,
      {
        credentialID: this.credentialId,
        SAD: sad,
        hash: [hashB64],
        signAlgo
      },
      {headers, timeout: HTTP_TIMEOUT}
    );

    if (!resp.data.signatures?.length) {
      throw new Error('CSC API returned no signatures');
    }
    return Buffer.from(resp.data.signatures[0], 'base64');
  }

  /**
   * @param {Buffer} digest - pre-computed hash of DER SignedAttributes
   * @returns {Promise<Buffer>} raw signature bytes
   */
  async sign(digest) {
    const hashB64 = digest.toString('base64');
    const token = await this.getAccessToken();
    const sad = await this.authorizeCredential(token, hashB64);
    return this.signHash(token, sad, hashB64);
  }
}

/**
 * Sign a PDF file using a CSC API provider.
 *
 * @param {string} inputPath - PDF with placeholder from x2t
 * @param {string|null} outputPath - output path (null = overwrite)
 * @param {Object} config
 * @param {string} config.baseUrl - CSC API base URL
 * @param {string} config.credentialId - signing credential ID
 * @param {string} config.certificateChainPath - PEM bundle path
 * @param {string} [config.tokenUrl] - OAuth2 token endpoint
 * @param {string} [config.clientId] - OAuth2 client ID
 * @param {string} [config.clientSecret] - OAuth2 client secret
 * @param {string} [config.accessToken] - pre-obtained bearer token
 * @param {string} [config.pin] - user PIN
 * @param {string} [config.hashAlgorithm='sha256']
 * @returns {Promise<void>}
 */
async function signPdfFile(inputPath, outputPath, config) {
  const signer = new CscSigner(config);
  return signPdfWithSigner(inputPath, outputPath, config, digest => signer.sign(digest));
}

module.exports = {
  CscSigner,
  signPdfFile
};
