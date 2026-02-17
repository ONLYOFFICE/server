'use strict';

const {axios} = require('../utils');

/**
 * Resolve OAuth grant type from config.
 * Empty string = auto-detect based on username/password presence.
 *
 * @param {Object} cfg
 * @returns {string} 'client_credentials' | 'password'
 */
function resolveGrantType(cfg) {
  const gt = (cfg.grantType || '').toLowerCase();
  if (gt && gt !== 'client_credentials' && gt !== 'password') {
    throw new Error(`Unsupported OAuth grantType: "${gt}". Use 'client_credentials' or 'password'.`);
  }
  if (gt) return gt;
  return cfg.username && cfg.password ? 'password' : 'client_credentials';
}

/**
 * Fetch an OAuth2 token from a CSC-compatible token endpoint.
 * Supports client_credentials and password grants, flexible client auth.
 *
 * @param {Object} cfg
 * @param {string} cfg.tokenUrl
 * @param {string} cfg.clientId
 * @param {string} cfg.clientSecret
 * @param {string} [cfg.grantType]       - '' (auto), 'password', 'client_credentials'
 * @param {string} [cfg.clientAuth]       - '' (body), 'basic', 'body', 'both'
 * @param {string} [cfg.tokenBodyFormat]  - '' (form), 'form', 'json'
 * @param {string} [cfg.username]
 * @param {string} [cfg.password]
 * @param {string} [cfg.scope]
 * @param {string} [cfg.audience]
 * @param {number} [cfg.timeout=60000]
 * @returns {Promise<Object>} token response ({ access_token, expires_in, ... })
 */
async function fetchOAuthToken(cfg) {
  if (!cfg.tokenUrl) throw new Error('tokenUrl is required');
  if (!cfg.clientId) throw new Error('clientId is required');

  const grantType = resolveGrantType(cfg);

  if (grantType === 'password' && (!cfg.username || !cfg.password)) {
    throw new Error('Password grant requires username and password');
  }

  const authMode = (cfg.clientAuth || '').toLowerCase();
  const useBasic = authMode === 'basic' || authMode === 'both';
  const sendInBody = authMode === 'body' || authMode === 'both' || !authMode;

  const headers = {};
  if (useBasic) {
    headers['Authorization'] = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
  }

  const payload = {grant_type: grantType};
  if (grantType === 'password') {
    payload.username = cfg.username;
    payload.password = cfg.password;
  }
  if (sendInBody) {
    payload.client_id = cfg.clientId || '';
    payload.client_secret = cfg.clientSecret || '';
  }
  if (cfg.scope) payload.scope = cfg.scope;
  if (cfg.audience) payload.audience = cfg.audience;

  const fmt = (cfg.tokenBodyFormat || '').toLowerCase();
  let body;
  if (fmt === 'json') {
    headers['Content-Type'] = 'application/json';
    body = payload;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(payload).toString();
  }

  const resp = await axios.post(cfg.tokenUrl, body, {headers, timeout: cfg.timeout || 60000});
  return resp.data;
}

module.exports = {fetchOAuthToken, resolveGrantType};
