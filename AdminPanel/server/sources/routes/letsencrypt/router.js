'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const {spawn} = require('child_process');
const {validateJWT} = require('../../middleware/auth');
const tenantManager = require('../../../../../Common/sources/tenantManager');

const router = express.Router();
router.use(cookieParser());
router.use(express.json());

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (certbot can be slow)
const SCRIPT_NAME = 'documentserver-letsencrypt';
const SCRIPT_SEARCH_PATHS = ['/usr/bin', path.resolve(process.cwd(), '../../bin')];
const SCRIPT_EXTENSIONS = ['.sh', '.ps1', '.bat'];

/**
 * Installation error with details
 */
class InstallError extends Error {
  constructor(message, details = '') {
    super(message);
    this.details = details;
  }
}

/**
 * Find Let's Encrypt script in known locations
 * @returns {string|null} Script path or null if not found
 */
function findLetsEncryptScript() {
  for (const searchPath of SCRIPT_SEARCH_PATHS) {
    for (const ext of SCRIPT_EXTENSIONS) {
      const scriptPath = path.join(searchPath, SCRIPT_NAME + ext);
      if (fs.existsSync(scriptPath)) {
        return scriptPath;
      }
    }
  }
  return null;
}

/**
 * Check if script has executable permissions (Unix-like systems only)
 * @param {Object} ctx - Operation context
 * @param {string} scriptPath - Full path to script
 * @returns {boolean} True if executable or on Windows
 */
function isScriptExecutable(ctx, scriptPath) {
  try {
    if (process.platform === 'win32') {
      return true;
    }
    const stats = fs.statSync(scriptPath);
    return !!(stats.mode & fs.constants.S_IXUSR);
  } catch (e) {
    ctx.logger.error('Failed to check script permissions: %s', e.message);
    return false;
  }
}

/**
 * Get spawn arguments for script execution
 * @param {string} scriptPath - Full path to script
 * @param {string[]} args - Script arguments
 * @returns {{command: string, args: string[], options: object}}
 */
function getSpawnArgs(scriptPath, args) {
  const ext = path.extname(scriptPath);

  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      options: {}
    };
  }

  return {
    command: scriptPath,
    args,
    options: {}
  };
}

/**
 * Get certificate info via TLS connection
 */
function getCertificate(hostname) {
  return new Promise(resolve => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        rejectUnauthorized: false,
        servername: hostname,
        timeout: 2000
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.subject) return resolve(null);

        resolve({
          domain: cert.subject.CN || null,
          expiresAt: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
          issuer: cert.issuer?.O || null
        });
      }
    );

    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/**
 * Run installation script with timeout and proper cleanup
 * Uses AbortController (Node.js 15+) for clean cancellation
 * @param {string} scriptPath - Full path to script
 * @param {string} email - Email for Let's Encrypt
 * @param {string} domain - Domain name
 * @param {object} logger - Logger instance
 */
function runInstallScript(scriptPath, email, domain, logger) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    let stderr = '';
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve(result);
    };

    const spawnConfig = getSpawnArgs(scriptPath, [email, domain]);
    logger.debug('Executing: %s %s', spawnConfig.command, spawnConfig.args.join(' '));

    const proc = spawn(spawnConfig.command, spawnConfig.args, {
      ...spawnConfig.options,
      signal: ac.signal
    });

    // Timeout - AbortController handles the kill
    const timeout = setTimeout(() => ac.abort(), INSTALL_TIMEOUT_MS);

    proc.stdout.on('data', data => {
      logger.info('letsencrypt: %s', data.toString().trim());
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
      logger.warn('letsencrypt: %s', data.toString().trim());
    });

    proc.on('error', err => {
      const details = stderr.slice(-2048).trim();
      if (err.name === 'AbortError') {
        finish(new InstallError('Installation timed out after 5 minutes', details));
      } else {
        finish(new InstallError(`Failed to start script: ${err.message}`, details));
      }
    });

    proc.on('close', (code, signal) => {
      if (signal) {
        // Killed by external signal (not our timeout - that's handled in 'error')
        finish(new InstallError(`Process killed by ${signal}`, stderr.slice(-2048).trim()));
      } else if (code === 0) {
        finish(null);
      } else {
        finish(new InstallError(`Installation failed (exit code ${code})`, stderr.slice(-2048).trim()));
      }
    });
  });
}

// GET /status
router.get('/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  ctx.logger.info("Let's Encrypt status request");

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    const scriptPath = findLetsEncryptScript();
    if (!scriptPath || !isScriptExecutable(ctx, scriptPath)) {
      return res.json({available: false});
    }

    const hostname = req.hostname || req.headers.host?.split(':')[0];
    const certificate = hostname ? await getCertificate(hostname) : null;

    res.json({available: true, certificate});
  } catch (error) {
    ctx.logger.error('Status check error: %s', error.stack);
    res.status(500).json({error: 'Failed to check status'});
  }
});

// POST /install
router.post('/install', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  const {email, domain} = req.body;
  ctx.logger.info("Let's Encrypt install request: domain=%s email=%s", domain, email);

  try {
    if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
      return res.status(403).json({error: 'Admin only'});
    }

    // Basic validation (script does thorough validation)
    if (!email || !email.includes('@')) {
      return res.status(400).json({error: 'Valid email address required'});
    }
    if (!domain) {
      return res.status(400).json({error: 'Domain name required'});
    }

    const scriptPath = findLetsEncryptScript();
    if (!scriptPath) {
      return res.status(400).json({error: 'Installation script not found'});
    }

    await runInstallScript(scriptPath, email, domain, ctx.logger);

    ctx.logger.info('Certificate installed successfully for %s', domain);
    res.json({success: true});
  } catch (error) {
    ctx.logger.error('Installation failed: %s', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      details: error.details || null // Full stderr for debugging
    });
  }
});

module.exports = router;
