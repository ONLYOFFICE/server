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
 *     // You can either provide a token, or let the signer fetch it (client_credentials)
 *     oauth: {
 *       tokenUrl: 'https://login.example.com/oauth2/token',
 *       clientId: '...',
 *       clientSecret: '...'
 *     },
 *
 *     // Optional: omit to auto-pick first credential from credentials/list
 *     credential: { id: '' },
 *
 *     // Optional: second factor is typically per-request
 *     auth: { kind: 'otp', getValue: async () => process.env.CSC_OTP }
 *   });
 */

const {signPdfWithSigner, OID, HASH_OID, parsePemChain, parsePemChainContent} = require('./pdfSigningCore');
const {axios} = require('./../../../Common/sources/utils');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 30000;
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

function normalizeProviderConfig(config) {
  const root = config || {};
  // Support both shapes:
  //  - { csc: {...}, keyStorePath: "..." }  (app-level config from converter)
  //  - { baseUrl, tokenUrl, clientId, ... }  (flat signer-level config)
  const csc = root.csc ? {...root.csc} : root;

  const keyStorePath = root.keyStorePath || csc.keyStorePath || '';

  const oauth = csc.oauth || {
    tokenUrl: csc.tokenUrl,
    clientId: csc.clientId,
    clientSecret: csc.clientSecret,
    accessToken: csc.accessToken,
    tokenProvider: csc.tokenProvider,
    grantType: csc.grantType,
    scope: csc.scope,
    audience: csc.audience
  };

  const credential = csc.credential || {
    id: csc.credentialId,
    userId: csc.userId,
    select: csc.credentialSelect,
    clientData: csc.clientData
  };

  const auth = csc.auth || {
    // Non-interactive default: do not require user input.
    // Override via custom config auth block if you ever need OTP/PIN.
    kind: csc.authKind || 'none',
    value: ''
  };

  return {
    baseUrl: stripTrailingSlash(csc.baseUrl || root.baseUrl),
    timeoutMs: csc.timeoutMs || root.timeoutMs || DEFAULT_TIMEOUT_MS,

    hashAlgorithm: csc.hashAlgorithm || 'sha256',

    // How to encode the hash in credentials/authorize.
    // Some vendors are stricter; default is standard base64.
    authorizeHashEncoding: csc.authorizeHashEncoding || 'base64', // 'base64' | 'base64url'

    // If set, overrides what we send as signAlgo / hashAlgo.
    // Otherwise we try to infer them.
    signAlgo: csc.signAlgo || '',
    hashAlgo: csc.hashAlgo || '',

    oauth: {
      tokenUrl: oauth?.tokenUrl || '',
      clientId: oauth?.clientId || '',
      clientSecret: oauth?.clientSecret || '',
      accessToken: oauth?.accessToken || '',
      grantType: oauth?.grantType || 'client_credentials',
      scope: oauth?.scope || '',
      audience: oauth?.audience || '',
      // Optional hook for non-standard auth flows (auth_code, device flow, etc.)
      tokenProvider: oauth?.tokenProvider
    },

    credential: {
      id: credential?.id || '',
      userId: credential?.userId,
      // Function (ids, rawResponse) => chosenId; otherwise first ID is used.
      select: credential?.select,
      // Provider-specific hint for credentials/list (e.g. SSL.com DS_ESEAL)
      clientData: credential?.clientData
    },

    auth: {
      // 'otp' | 'pin' | 'none'. Some providers accept both fields, some reject unknown ones.
      kind: auth?.kind || 'none',
      value: auth?.value || '',
      getValue: auth?.getValue
    },

    // You can inject fixed chain to skip credentials/info (e.g. in offline tests).
    certificateChainDer: csc.certificateChainDer || root.certificateChainDer,
    // Fallback chain sources (used when credentials/info doesn't return certs).
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

function defaultSignAlgoFromKeyType(keyType) {
  // Many CSC providers expect key algorithm OID in signAlgo and hashAlgo separately.
  // Example: RSA -> 1.2.840.113549.1.1.1, EC -> 1.2.840.10045.2.1
  if (!keyType) return OID.rsaEncryption;
  if (keyType === 'rsa' || keyType === 'rsa-pss') return OID.rsaEncryption;
  if (keyType === 'ec') return OID.ecPublicKey;
  // Unknown: fall back to RSA (most common for interoperability)
  return OID.rsaEncryption;
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
 * - Do NOT persist OTP/PIN; accept it as a per-request value (hook).
 */
function inferDefaultClientData(cfg) {
  // SSL.com uses clientData=DS_ESEAL to list eSeal credentials for non-interactive mode.
  try {
    const s = String(cfg?.baseUrl || '');
    if (/\.ssl\.com\b/i.test(s)) return 'DS_ESEAL';
  } catch {
    // ignore
  }
  return null;
}

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

  // ----------------------------
  // Low-level HTTP
  // ----------------------------

  async _post(path, token, body) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = `${this.cfg.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return axios.post(url, body, {headers, timeout: this.cfg.timeoutMs});
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

    // Default: OAuth2 client_credentials with form body
    if (this.cfg.oauth.grantType !== 'client_credentials') {
      throw new Error(
        `Unsupported OAuth grantType in default flow: ${this.cfg.oauth.grantType}. Provide oauth.tokenProvider or pre-set oauth.accessToken.`
      );
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.oauth.clientId,
      client_secret: this.cfg.oauth.clientSecret
    });
    if (this.cfg.oauth.scope) params.set('scope', this.cfg.oauth.scope);
    if (this.cfg.oauth.audience) params.set('audience', this.cfg.oauth.audience);

    const resp = await axios.post(this.cfg.oauth.tokenUrl, params, {
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      timeout: this.cfg.timeoutMs
    });

    const token = resp?.data?.access_token;
    if (!token) throw new Error('OAuth token endpoint returned no access_token');

    const expiresIn = Number(resp?.data?.expires_in || 0);
    this._cachedToken = token;
    this._cachedTokenExp = expiresIn ? now + expiresIn * 1000 - 5000 : now + DEFAULT_TOKEN_CACHE_MS;
    return token;
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

    // Provider-specific hint (e.g. SSL.com eSealing / DS_ESEAL). Safe no-op for others.
    const clientData = this.cfg.credential.clientData || inferDefaultClientData(this.cfg);
    if (clientData) body.clientData = clientData;

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
      const status = e?.response?.status;
      const data = e?.response?.data;
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
      const signAlgo = defaultSignAlgoFromKeyType(keyType);
      return {hashAlgo, signAlgo};
    } catch {
      // Fallback to RSA
      return {hashAlgo, signAlgo: OID.rsaEncryption};
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
async function signPdfFile(inputPath, outputPath, config) {
  const signer = new CscSigner(config);
  const certificateChainDer = await signer.getCertificateChainDer();

  return signPdfWithSigner(inputPath, outputPath, {...config, certificateChainDer}, digest => signer.sign(digest));
}

module.exports = {
  CscSigner,
  signPdfFile
};
