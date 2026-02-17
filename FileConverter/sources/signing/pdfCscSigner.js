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
 * PDF CSC Signer — PAdES-B-B signing via Cloud Signature Consortium API.
 *
 * Uses pdfSigningCore for:
 *  - PDF placeholder operations
 *  - CMS/PAdES container assembly
 *
 * This module handles only the remote signing part (CSC signHash).
 *
 * Typical flow (provider-agnostic):
 *  1) (optional) /info discovery
 *  2) OAuth2 -> access_token (or tokenProvider / pre-set accessToken)
 *  3) /credentials/list -> credentialID (unless provided)
 *  4) /credentials/info -> certificate chain + auth hints (best-effort)
 *  5) /credentials/authorize -> SAD
 *  6) /signatures/signHash -> raw signature bytes
 *
 * Usage:
 *   const { signPdfFile } = require('./pdfCscSigner');
 *
 *   await signPdfFile('input.pdf', 'signed.pdf', {
 *     baseUrl: 'https://cs.example.com/csc/v2',
 *
 *     // You can either provide a token, or let the signer fetch it via OAuth
 *     oauth: {
 *       tokenUrl: 'https://login.example.com/oauth2/token',
 *       clientId: '...',
 *       clientSecret: '...'
 *     },
 *
 *     // Optional: omit to auto-pick first credential from credentials/list
 *     credential: { id: '' }
 *   });
 */

const {signPdfWithSigner, OID, HASH_OID, parsePemChain, parsePemChainContent} = require('./pdfSigningCore');
const {axios} = require('./../../../Common/sources/utils');
const {fetchOAuthToken} = require('./../../../Common/sources/signing/cscOAuth');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_TOKEN_CACHE_MS = 55 * 60 * 1000; // 55 minutes

// =============================================================================
// Helpers
// =============================================================================

function stripTrailingSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

function b64(buf) {
  return Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf).toString('base64');
}

function b64url(buf) {
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

/**
 * Normalize provider config from flat or nested shape into internal structure.
 * Supports both flat config (from JSON file) and nested config (programmatic).
 *
 * @param {Object} config
 * @returns {Object} normalized config
 */
function normalizeProviderConfig(config) {
  const root = config || {};
  // Support both shapes:
  //  - { csc: {...}, keyStorePath: "..." }  (app-level config from converter)
  //  - { baseUrl, tokenUrl, clientId, ... }  (flat signer-level config)
  const csc = root.csc ? {...root.csc} : {...root};

  const keyStorePath = root.keyStorePath || csc.keyStorePath || '';

  // OAuth (prefer nested oauth block, fallback to flat fields)
  const oauthSrc = csc.oauth || {};
  const oauth = {
    tokenUrl: pick(oauthSrc, ['tokenUrl']) ?? csc.tokenUrl,
    clientId: pick(oauthSrc, ['clientId']) ?? csc.clientId,
    clientSecret: pick(oauthSrc, ['clientSecret']) ?? csc.clientSecret,
    accessToken: pick(oauthSrc, ['accessToken']) ?? csc.accessToken,
    tokenProvider: pick(oauthSrc, ['tokenProvider']) ?? csc.tokenProvider,
    grantType: pick(oauthSrc, ['grantType']) ?? csc.grantType ?? '',
    clientAuth: pick(oauthSrc, ['clientAuth']) ?? csc.clientAuth ?? '',
    tokenBodyFormat: pick(oauthSrc, ['tokenBodyFormat']) ?? csc.tokenBodyFormat ?? '',
    scope: pick(oauthSrc, ['scope']) ?? csc.scope,
    audience: pick(oauthSrc, ['audience']) ?? csc.audience,
    // Only for grant_type=password
    username: pick(oauthSrc, ['username']) ?? csc.username,
    password: pick(oauthSrc, ['password']) ?? csc.password
  };

  const credentialSrc = csc.credential || {};
  const credential = {
    id: pick(credentialSrc, ['id']) ?? csc.credentialId,
    userId: pick(credentialSrc, ['userId']) ?? csc.userId,
    select: pick(credentialSrc, ['select']) ?? csc.credentialSelect,
    // Provider-specific hint for credentials/list (e.g. eSeal credential type)
    clientData: pick(credentialSrc, ['clientData']) ?? csc.clientData
  };

  const authSrc = csc.auth || {};
  const auth = {
    // Non-interactive default: no OTP/PIN required
    kind: pick(authSrc, ['kind']) ?? csc.authKind ?? 'none',
    value: pick(authSrc, ['value']) ?? '',
    getValue: pick(authSrc, ['getValue'])
  };

  return {
    baseUrl: stripTrailingSlash(csc.baseUrl || root.baseUrl),
    timeoutMs: csc.timeoutMs || root.timeoutMs || DEFAULT_TIMEOUT_MS,

    hashAlgorithm: csc.hashAlgorithm || 'sha256',
    authorizeHashEncoding: csc.authorizeHashEncoding || 'base64',

    signAlgo: csc.signAlgo || '',
    hashAlgo: csc.hashAlgo || '',

    oauth: {
      tokenUrl: oauth?.tokenUrl || '',
      clientId: oauth?.clientId || '',
      clientSecret: oauth?.clientSecret || '',
      accessToken: oauth?.accessToken || '',
      grantType: oauth?.grantType || '',
      clientAuth: oauth?.clientAuth || '',
      tokenBodyFormat: oauth?.tokenBodyFormat || '',
      scope: oauth?.scope || '',
      audience: oauth?.audience || '',
      username: oauth?.username || '',
      password: oauth?.password || '',
      tokenProvider: oauth?.tokenProvider
    },

    credential: {
      id: credential?.id || '',
      userId: credential?.userId,
      select: credential?.select,
      clientData: credential?.clientData
    },

    auth: {
      kind: auth?.kind || 'none',
      value: auth?.value || '',
      getValue: auth?.getValue
    },

    certificateChainDer: csc.certificateChainDer || root.certificateChainDer,
    certificateChainPem: csc.certificateChainPem || root.certificateChainPem || '',
    keyStorePath: keyStorePath || ''
  };
}

function derFromB64(b64str) {
  return Buffer.from(String(b64str).replace(/\s/g, ''), 'base64');
}

function parseCertificatesFromCredentialsInfo(data) {
  // CSC spec allows returning certificate(s) and chain; vendors vary a bit.
  // Try common shapes:
  //  - { certificates: ["base64Der", ...] }
  //  - { cert: { certificates: [...] } }
  //  - { cert: { certificate: "base64Der" } }
  const certs = pick(data, ['certificates']) || pick(data?.cert, ['certificates']) || pick(data?.cert, ['certificate']);
  if (!certs) return [];
  if (Array.isArray(certs)) return certs.map(derFromB64);
  return [derFromB64(certs)];
}

function detectKeyTypeFromDer(leafDer) {
  try {
    if (!leafDer) return null;
    if (typeof crypto.X509Certificate !== 'function') return null;
    const x = new crypto.X509Certificate(leafDer);
    const pub = x.publicKey;
    return pub && pub.asymmetricKeyType ? String(pub.asymmetricKeyType) : null;
  } catch {
    return null;
  }
}

function defaultSignAlgoFromKeyType(keyType, hashAlgorithm) {
  // CSC providers typically expect the combined signature algorithm OID
  // (e.g. ecdsaWithSHA256), not just the key algorithm OID (e.g. ecPublicKey).
  const hash = hashAlgorithm || 'sha256';
  if (keyType === 'ec') {
    const map = {sha256: OID.ecdsaWithSHA256, sha384: OID.ecdsaWithSHA384, sha512: OID.ecdsaWithSHA512};
    return map[hash] || OID.ecdsaWithSHA256;
  }
  // RSA: use sha*WithRSA
  const map = {sha256: OID.sha256WithRSA, sha384: OID.sha384WithRSA, sha512: OID.sha512WithRSA};
  return map[hash] || OID.sha256WithRSA;
}

function defaultHashAlgoOid(hashAlgorithm) {
  const oid = HASH_OID[hashAlgorithm];
  if (!oid) throw new Error(`Unsupported hashAlgorithm: ${hashAlgorithm}`);
  return oid;
}

// =============================================================================
// CSC Signer (provider-agnostic, v2+ oriented)
// =============================================================================

/**
 * Provider-agnostic CSC signer that implements:
 *   sign(digest: Buffer) -> Promise<Buffer>
 *
 * Notes for interoperability:
 * - Always send both hashAlgo + signAlgo in signatures/signHash, because many providers require them.
 * - Non-interactive only: OTP/PIN/SMS flows are not supported.
 */
class CscSigner {
  /**
   * @param {Object} config - see normalizeProviderConfig()
   */
  constructor(config) {
    this.cfg = normalizeProviderConfig(config);
    if (!this.cfg.baseUrl) throw new Error('CSC baseUrl is required');

    // Caches
    this._cachedToken = null;
    this._cachedTokenExp = 0;
    this._cachedCredentialId = null;
    this._cachedCredentialInfo = null;
    this._cachedCertChainDer = null;
  }

  /**
   * Extract structured error info from HTTP response (no credentials, no full bodies).
   * @param {*} respData
   * @returns {string}
   */
  _formatErrorDetail(respData) {
    if (respData == null) return '';
    if (typeof respData === 'object') {
      return respData.error_description || respData.error || respData.message || respData.detail || respData.code || '';
    }
    const s = String(respData).trim();
    if (s.startsWith('<!DOCTYPE') || s.startsWith('<html')) return 'HTML response (check URL)';
    return '';
  }

  async _post(path, token, body) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = `${this.cfg.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    try {
      return await axios.post(url, body, {headers, timeout: this.cfg.timeoutMs});
    } catch (e) {
      const status = e?.response?.status;
      const respData = e?.response?.data;
      const detail = this._formatErrorDetail(respData);
      const msg = `CSC ${path} failed (HTTP ${status || 'N/A'}): ${detail} — url=${url}`;
      const wrapped = new Error(msg);
      wrapped.cause = e;
      wrapped.status = status;
      wrapped.responseData = respData;
      throw wrapped;
    }
  }

  // ----------------------------
  // Token
  // ----------------------------

  async getAccessToken() {
    if (this.cfg.oauth.accessToken) return this.cfg.oauth.accessToken;

    const now = Date.now();
    if (this._cachedToken && this._cachedTokenExp && now < this._cachedTokenExp) {
      return this._cachedToken;
    }

    if (typeof this.cfg.oauth.tokenProvider === 'function') {
      const t = await this.cfg.oauth.tokenProvider();
      if (typeof t === 'string' && t) {
        this._cachedToken = t;
        this._cachedTokenExp = now + DEFAULT_TOKEN_CACHE_MS;
        return t;
      }
      if (t && typeof t === 'object' && t.access_token) {
        this._cachedToken = String(t.access_token);
        const expiresIn = Number(t.expires_in || 0);
        this._cachedTokenExp = expiresIn ? now + expiresIn * 1000 - 5000 : now + DEFAULT_TOKEN_CACHE_MS;
        return this._cachedToken;
      }
    }

    if (!this.cfg.oauth.tokenUrl || !this.cfg.oauth.clientId) return null;

    // Check module-level token cache (survives across CscSigner instances)
    const cacheKey = _tokenCacheKey(this.cfg.oauth);
    const cached = _tokenCache.get(cacheKey);
    if (cached) {
      if (cached.exp > now) {
        this._cachedToken = cached.token;
        this._cachedTokenExp = cached.exp;
        return cached.token;
      }
      _tokenCache.delete(cacheKey);
    }

    try {
      const data = await fetchOAuthToken({...this.cfg.oauth, timeout: this.cfg.timeoutMs});
      const token = data?.access_token;
      if (!token) throw new Error('Token endpoint returned no access_token');

      const expiresIn = Number(data.expires_in || 0);
      this._cachedToken = String(token);
      this._cachedTokenExp = expiresIn ? now + expiresIn * 1000 - 5000 : now + DEFAULT_TOKEN_CACHE_MS;
      _tokenCache.set(cacheKey, {token: this._cachedToken, exp: this._cachedTokenExp});
      return this._cachedToken;
    } catch (e) {
      const status = e?.response?.status;
      const detail = this._formatErrorDetail(e?.response?.data);
      const netErr = !status ? ` cause=${e?.code || e?.message || 'unknown'}` : '';
      throw new Error(`OAuth token request failed (HTTP ${status || 'N/A'}): ${detail}${netErr} — url=${this.cfg.oauth.tokenUrl}`);
    }
  }

  // ----------------------------
  // Credentials
  // ----------------------------

  async resolveCredentialId(token) {
    if (this.cfg.credential.id) return this.cfg.credential.id;
    if (this._cachedCredentialId) return this._cachedCredentialId;

    const body = {};
    // CSC allows optional userID depending on the auth model; keep if userId provided.
    if (this.cfg.credential.userId) body.userID = this.cfg.credential.userId;

    // Provider-specific hint for credentials/list (e.g. eSeal credential type)
    if (this.cfg.credential.clientData) body.clientData = this.cfg.credential.clientData;

    const resp = await this._post('/credentials/list', token, body);

    // Common shapes:
    //  - { credentialIDs: ["..."] }
    //  - { credentials: [{ credentialID: "..."}, ...] }
    const ids =
      resp?.data?.credentialIDs ||
      (Array.isArray(resp?.data?.credentials) ? resp.data.credentials.map(x => x.credentialID).filter(Boolean) : null) ||
      [];

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('No credentialIDs returned by credentials/list');
    }

    const chosen = typeof this.cfg.credential.select === 'function' ? this.cfg.credential.select(ids, resp.data) : ids[0];

    if (!chosen) throw new Error('Credential selector returned empty credentialID');

    this._cachedCredentialId = chosen;
    return chosen;
  }

  async getCredentialInfo(token, credentialId) {
    if (this._cachedCredentialInfo && this._cachedCredentialInfo.credentialID === credentialId) {
      return this._cachedCredentialInfo;
    }

    // Request "as much as possible", but stay compatible.
    // Vendors vary in flags; extra fields are usually ignored, but not always.
    // We keep a conservative primary request and a fallback.
    const primaryBody = {
      credentialID: credentialId,
      certificates: 'chain',
      certInfo: true,
      authInfo: true
    };

    let resp;
    try {
      resp = await this._post('/credentials/info', token, primaryBody);
    } catch {
      // fallback
      resp = await this._post('/credentials/info', token, {credentialID: credentialId});
    }

    const info = resp.data || {};
    this._cachedCredentialInfo = {...info, credentialID: credentialId};
    return this._cachedCredentialInfo;
  }

  async getCertificateChainDer() {
    if (Array.isArray(this.cfg.certificateChainDer) && this.cfg.certificateChainDer.length > 0) {
      return this.cfg.certificateChainDer;
    }
    if (this._cachedCertChainDer) return this._cachedCertChainDer;

    // Try dynamic fetch from credentials/info
    try {
      const token = await this.getAccessToken();
      const credentialId = await this.resolveCredentialId(token);
      const info = await this.getCredentialInfo(token, credentialId);

      const chain = parseCertificatesFromCredentialsInfo(info);
      if (chain.length) {
        this._cachedCertChainDer = chain;
        return chain;
      }
    } catch (_ignored) {
      // Fall through to local chain sources
    }

    // Fallback: PEM string
    if (this.cfg.certificateChainPem) {
      const chain = parsePemChainContent(this.cfg.certificateChainPem);
      this._cachedCertChainDer = chain;
      return chain;
    }

    // Fallback: PEM file path
    const chainPath = this.cfg.keyStorePath;
    if (chainPath) {
      const chain = parsePemChain(chainPath);
      this._cachedCertChainDer = chain;
      return chain;
    }

    throw new Error(
      'Could not obtain certificate chain: provider did not return it via credentials/info and no local PEM chain was provided (keyStorePath)'
    );
  }

  // ----------------------------
  // Authorization + signHash
  // ----------------------------

  async _getSecondFactorValue() {
    if (typeof this.cfg.auth.getValue === 'function') {
      const v = await this.cfg.auth.getValue();
      return v ? String(v) : '';
    }
    return this.cfg.auth.value ? String(this.cfg.auth.value) : '';
  }

  _encodeAuthorizeHash(digestBuf) {
    return this.cfg.authorizeHashEncoding === 'base64url' ? b64url(digestBuf) : b64(digestBuf);
  }

  async authorizeCredential(token, credentialId, digestBuf) {
    const factorValue = await this._getSecondFactorValue();

    const payload = {
      credentialID: credentialId,
      numSignatures: 1,
      hash: [this._encodeAuthorizeHash(digestBuf)]
    };

    // CSC supports both PIN and OTP concepts; vendors choose.
    if (factorValue) {
      if (this.cfg.auth.kind === 'otp') payload.OTP = factorValue;
      else if (this.cfg.auth.kind === 'pin') payload.PIN = factorValue;
      // If kind is unknown, don't send anything - safer.
    }

    let resp;
    try {
      resp = await this._post('/credentials/authorize', token, payload);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.responseData || e?.response?.data;
      const msg = String(data?.error_description || data?.error || data?.message || e?.message || '');
      if (/otp|pin|2fa|second\s*factor/i.test(msg)) {
        throw new Error('CSC provider requires OTP/PIN (interactive 2FA). This integration is configured for non-interactive signing only.');
      }
      if (status) throw new Error(`credentials/authorize failed (HTTP ${status}): ${msg || 'no details'}`);
      throw e;
    }

    const sad = resp?.data?.SAD;
    if (!sad) throw new Error('credentials/authorize returned no SAD');
    return sad;
  }

  async signHash(token, credentialId, sad, digestBuf, algos) {
    const payload = {
      credentialID: credentialId,
      SAD: sad,
      hash: [b64(digestBuf)],
      hashAlgo: algos.hashAlgo,
      signAlgo: algos.signAlgo
    };

    const resp = await this._post('/signatures/signHash', token, payload);

    const sigs = resp?.data?.signatures;
    if (!Array.isArray(sigs) || sigs.length === 0) throw new Error('signatures/signHash returned no signatures');

    return Buffer.from(sigs[0], 'base64');
  }

  async _resolveAlgorithms(token, credentialId) {
    const hashAlgo = this.cfg.hashAlgo || defaultHashAlgoOid(this.cfg.hashAlgorithm);

    if (this.cfg.signAlgo) {
      return {hashAlgo, signAlgo: this.cfg.signAlgo};
    }

    // Infer from the leaf certificate, if available.
    try {
      const info = await this.getCredentialInfo(token, credentialId);
      const chain = parseCertificatesFromCredentialsInfo(info);
      const leaf = chain[0];
      const keyType = detectKeyTypeFromDer(leaf);
      const signAlgo = defaultSignAlgoFromKeyType(keyType, this.cfg.hashAlgorithm);
      return {hashAlgo, signAlgo};
    } catch {
      // Fallback to RSA with SHA-256
      return {hashAlgo, signAlgo: OID.sha256WithRSA};
    }
  }

  /**
   * Sign digest bytes (already a hash) remotely via CSC.
   *
   * @param {Buffer} digestBuf
   * @returns {Promise<Buffer>} raw signature bytes
   */
  async sign(digestBuf) {
    const token = await this.getAccessToken();
    const credentialId = await this.resolveCredentialId(token);
    const algos = await this._resolveAlgorithms(token, credentialId);

    const sad = await this.authorizeCredential(token, credentialId, digestBuf);
    return this.signHash(token, credentialId, sad, digestBuf, algos);
  }
}

// =============================================================================
// Convenience wrapper for signing a PDF using CSC signHash
// =============================================================================

/**
 * Sign a PDF file using a CSC signer.
 * Unlike the old version, the certificate chain can be fetched dynamically via credentials/info.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {Object} config - CscSigner config + signPdfWithSigner options
 * @returns {Promise<void>}
 */
// Module-level OAuth token cache: avoids re-fetching tokens on every signPdfFile call.
// Keyed by JSON of all oauth-relevant fields so config changes invalidate the cache.
const _tokenCache = new Map();

function _tokenCacheKey(oauth) {
  return JSON.stringify({
    tokenUrl: oauth.tokenUrl,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    grantType: oauth.grantType,
    clientAuth: oauth.clientAuth,
    tokenBodyFormat: oauth.tokenBodyFormat,
    username: oauth.username,
    password: oauth.password,
    scope: oauth.scope,
    audience: oauth.audience
  });
}

async function signPdfFile(inputPath, outputPath, config) {
  const signer = new CscSigner(config);
  const certificateChainDer = await signer.getCertificateChainDer();

  return signPdfWithSigner(inputPath, outputPath, {...config, certificateChainDer}, digest => signer.sign(digest));
}

module.exports = {
  CscSigner,
  signPdfFile
};
