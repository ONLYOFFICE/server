'use strict';

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {once} = require('events');

const STDERR_LIMIT = 8192;

/**
 * Find a script by name in known locations
 * @param {string} name - Script base name (without extension)
 * @param {string[]} searchPaths - Directories to search in
 * @param {string[]} [extensions] - Extensions to try (default: .sh, .ps1, .bat)
 * @returns {string|null} Full script path or null
 */
function findScript(name, searchPaths, extensions = ['.sh', '.ps1', '.bat']) {
  for (const searchPath of searchPaths) {
    for (const ext of extensions) {
      const scriptPath = path.join(searchPath, name + ext);
      if (fs.existsSync(scriptPath)) {
        return scriptPath;
      }
    }
  }
  return null;
}

/**
 * Get spawn command and args for a script based on its extension
 * @param {string} scriptPath - Full path to script
 * @param {string[]} args - Script arguments
 * @returns {{command: string, args: string[]}}
 */
function getSpawnArgs(scriptPath, args) {
  const ext = path.extname(scriptPath).toLowerCase();

  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
    };
  }

  if (ext === '.bat' || ext === '.cmd') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/c', scriptPath, ...args]
    };
  }

  if (ext === '.sh') {
    return {
      command: 'sudo',
      args: ['-n', scriptPath, ...args]
    };
  }

  // For .exe and others - run directly
  return {
    command: scriptPath,
    args
  };
}

/**
 * Run a script with timeout, logging, and stderr capture
 * @param {object} options
 * @param {string} options.scriptPath - Full path to script
 * @param {string[]} [options.args] - Script arguments
 * @param {string} [options.cwd] - Working directory
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @param {string} options.label - Log prefix (e.g. 'letsencrypt', 'allfontsgen')
 * @param {object} options.logger - Logger instance
 * @returns {Promise<void>}
 */
async function runScript({scriptPath, args = [], cwd, timeoutMs, label, logger}) {
  let stderr = '';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const spawnConfig = getSpawnArgs(scriptPath, args);
  logger.debug('Executing: %s %s', spawnConfig.command, spawnConfig.args.join(' '));

  const proc = spawn(spawnConfig.command, spawnConfig.args, {
    cwd,
    windowsHide: true,
    signal: ac.signal
  });

  proc.stdout.on('data', data => {
    logger.info('%s: %s', label, data.toString().trim());
  });

  proc.stderr.on('data', data => {
    const chunk = data.toString();
    logger.warn('%s: %s', label, chunk.trim());
    if (stderr.length < STDERR_LIMIT) {
      stderr += chunk;
    }
  });

  try {
    const [code, signal] = await once(proc, 'close');
    if (signal) {
      throw buildError(`Process killed by ${signal}`, stderr);
    }
    if (code !== 0) {
      throw buildError(`Process failed (exit code ${code})`, stderr);
    }
  } catch (err) {
    if (err.code === 'ABORT_ERR') {
      throw buildError('Process timed out', stderr);
    }
    // Spawn system error (ENOENT, EPERM, etc.)
    if (err.syscall) {
      throw buildError(`Failed to start: ${err.message}`, stderr);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build error with stderr appended to the message
 */
function buildError(message, stderr) {
  const tail = stderr.slice(-2048).trim();
  if (tail) {
    return new Error(`${message}\n${tail}`);
  }
  return new Error(message);
}

module.exports = {findScript, runScript};
