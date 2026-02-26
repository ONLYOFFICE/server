'use strict';
const path = require('path');

// Anchor for resolving legacy config paths (originally written relative to server/DocService/).
//
// Dev mode:
//   __dirname = server/Common/sources/
//   __dirname + ../../DocService  →  server/DocService/   (explicit, CWD-independent)
//
// pkg mode (current):
//   process.cwd() — set by the launcher (systemd WorkingDirectory / run_process_in_dir)
//   to the service's installation directory, one level below the server root:
//     DocService  CWD = server/DocService/   → ../Common/config ✓
//     AdminPanel  CWD = server/AdminPanel/   → ../Common/config ✓
//   Fragile: relies on launcher convention rather than the binary's own location.
//
// TODO: prefer path.dirname(process.execPath) — always the directory containing the
//   binary regardless of CWD, so no launcher cooperation is required:
//     DocService  execPath = server/DocService/docservice   → dirname = server/DocService/ ✓
//     AdminPanel  execPath = server/AdminPanel/adminpanel   → dirname = server/AdminPanel/ ✓
const _configAnchor = process.pkg ? process.cwd() : path.resolve(__dirname, '../../DocService');

/**
 * Normalizes a legacy config path from the shared ONLYOFFICE Docs config.
 * Resolves relative paths from the server/DocService/ anchor, passes absolute paths through.
 * @param {string} value - value from config.get(...)
 * @returns {string} absolute path, or original falsy value if empty
 */
function resolveConfigPath(value) {
  if (!value || path.isAbsolute(value)) return value;
  return path.resolve(_configAnchor, value);
}

/**
 * Normalizes a service-specific path.
 * In pkg: resolves relative paths from process.cwd() (set by launcher).
 * TODO: use path.dirname(process.execPath) for CWD-independent resolution.
 * In dev: resolves from devRoot (pass path.resolve(__dirname, '...') at the call site).
 * Absolute paths are passed through unchanged.
 * @param {string} devRoot - service root for development (ignored in pkg mode)
 * @param {string} value - relative or absolute path
 * @returns {string} absolute path, or original falsy value if empty
 */
function resolveAppPath(devRoot, value) {
  if (!value || path.isAbsolute(value)) return value;
  const serviceRoot = process.pkg ? process.cwd() : devRoot;
  return path.resolve(serviceRoot, value);
}

module.exports = {resolveConfigPath, resolveAppPath};
