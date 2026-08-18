'use strict';

// Verify (and optionally repair) the structural consistency between
// Common/config/default.json and Common/config/schemas/config.schema.json.
//
// For every terminal path in default.json (primitives, arrays, empty objects),
// the schema must:
//   1. expose a corresponding leaf node;
//   2. have a `type` that matches the JS type of the default value;
//   3. have a `default` value that deep-equals the value in default.json
//      (when `default` is set in the schema; absence is tolerated);
//   4. have a `x-tenantOverride` boolean annotation that matches the
//      classifier in this script.
//
// Modes:
//   --check (default) -- verify; exit non-zero on any mismatch.
//   --apply           -- inject missing x-tenantOverride annotations into the
//                        schema in place. Other inconsistencies (type, default)
//                        are reported and must be fixed manually -- this script
//                        does not mutate them automatically because they
//                        usually indicate a real bug in either file.
//
// x-tenantOverride semantic (bool):
//   true  -- supported tenant override OR deprecated/unused. Setting per-tenant is safe;
//            it either takes effect or is silently ignored.
//   false -- conditional / unsafe / global-only. Setting per-tenant either has no effect
//            or causes a silent inconsistency with shared/global state.
//
// Sources of truth for the classification:
//   docs/tenant-config-overrides.md     -- operator-facing guide
//   docs/tenant-config-override-audit.md -- detailed evidence trail
//
// Usage:
//   node scripts/check-config-schema.js          # check mode (CI-friendly)
//   node scripts/check-config-schema.js --check
//   node scripts/check-config-schema.js --apply

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_JSON = path.join(ROOT, 'Common/config/default.json');
const SCHEMA_JSON = path.join(ROOT, 'Common/config/schemas/config.schema.json');

const MODE = process.argv.includes('--apply') ? 'apply' : 'check';

// ===========================================================================
// Classification
// ===========================================================================

/**
 * Returns the boolean classification for a dotted path, or null if the path
 * is not explicitly known. A null result is treated as a check failure --
 * every terminal path must be classifiable so that new keys are forced
 * through the audit pipeline before merging.
 *
 * @param {string} p
 * @returns {boolean|null}
 */
function classify(p) {
  if (p.startsWith('aiSettings.')) return true;
  if (p.startsWith('notification.')) return true;
  if (p.startsWith('externalRequest.')) return true;
  if (p.startsWith('services.CoAuthoring.requestDefaults.')) return true;
  if (p.startsWith('services.CoAuthoring.callbackBackoffOptions.')) return true;
  if (p.startsWith('services.CoAuthoring.ipfilter.')) return true;

  if (p === 'services.CoAuthoring.utils.limits_image_types_upload') return true;
  if (p === 'services.CoAuthoring.utils.limits_document_types_upload') return true;
  if (p === 'services.CoAuthoring.utils.utils_common_fontdir') return true;
  if (p === 'services.CoAuthoring.utils.utils_fonts_search_patterns') return true;

  if (p.startsWith('services.CoAuthoring.token.')) return true;
  if (p.startsWith('services.CoAuthoring.secret.')) return true;

  if (p === 'services.CoAuthoring.editor.binaryChanges') return false;
  if (p.startsWith('services.CoAuthoring.editor.')) return true;

  if (p === 'services.CoAuthoring.autoAssembly.step') return false;
  if (p.startsWith('services.CoAuthoring.autoAssembly.')) return true;

  const expireTrue = new Set([
    'services.CoAuthoring.expire.saveLock',
    'services.CoAuthoring.expire.lockDoc',
    'services.CoAuthoring.expire.sessionidle',
    'services.CoAuthoring.expire.sessionclosecommand',
    'services.CoAuthoring.expire.updateVersionStatus',
    'services.CoAuthoring.expire.changeindex',
    'services.CoAuthoring.expire.lastsave'
  ]);
  if (expireTrue.has(p)) return true;
  if (p.startsWith('services.CoAuthoring.expire.')) return false;

  // documentFormatsFile is intentionally kept global; tenants cannot point WOPI
  // discovery at a different formats JSON. Both wopiClient.discovery() and the
  // /meta/formats handler read the module-level const.
  if (p === 'services.CoAuthoring.server.documentFormatsFile') return false;
  if (
    [
      'services.CoAuthoring.server.host',
      'services.CoAuthoring.server.port',
      'services.CoAuthoring.server.limits_tempfile_upload',
      'services.CoAuthoring.server.editorDataStorage',
      'services.CoAuthoring.server.editorStatStorage'
    ].includes(p)
  ) {
    return false;
  }
  if (
    ['services.CoAuthoring.server.mode', 'services.CoAuthoring.server.workerpercpu', 'services.CoAuthoring.server.healthcheckfilepath'].includes(p)
  ) {
    return true;
  }
  if (p.startsWith('services.CoAuthoring.server.')) return true;

  if (p.startsWith('services.CoAuthoring.sql.')) return false;
  if (p.startsWith('services.CoAuthoring.redis.')) return false;
  if (p.startsWith('services.CoAuthoring.pubsub.')) return true;
  if (p.startsWith('services.CoAuthoring.socketio.')) return false;
  if (p.startsWith('services.CoAuthoring.sockjs.')) return true;
  if (p.startsWith('services.CoAuthoring.plugins.')) return false;
  if (p.startsWith('services.CoAuthoring.themes.')) return false;
  if (p.startsWith('services.CoAuthoring.request-filtering-agent.')) return false;

  if (p === 'queue.type') return false;
  if (p === 'queue.visibilityTimeout') return false;
  if (p === 'queue.retentionPeriod') return true;

  if (p === 'rabbitmq.url') return false;
  if (p.startsWith('rabbitmq.socketOptions')) return false;
  if (p.startsWith('rabbitmq.')) return true;

  if (p.startsWith('activemq.')) return true;
  if (p.startsWith('dnscache.')) return false;
  if (p.startsWith('openpgpjs.')) return true;
  if (p.startsWith('aesEncrypt.')) return false;
  if (p.startsWith('bottleneck.')) return true;
  if (p.startsWith('win-ca.')) return false;

  if (p === 'wopi.htmlTemplate') return false;
  if (p === 'wopi.refreshLockInterval') return false;
  if (p === 'wopi.dummy.enable') return false;
  if (p.startsWith('wopi.')) return true;

  if (p.startsWith('tenants.')) return false;

  if (p === 'license.warning_limit_percents') return true;
  if (p === 'license.license_file') return false;
  // warning_license_expiration is now read via ctx.getCfg in notifyLicenseExpiration,
  // so tenants can control when the expiration warning starts firing.
  if (p === 'license.warning_license_expiration') return true;
  if (p === 'license.packageType') return true;

  if (p === 'FileConverter.converter.maxprocesscount') return false;
  if (p === 'FileConverter.converter.maxRedeliveredCount') return true;
  if (p.startsWith('FileConverter.converter.')) return true;

  if (['storage.name', 'storage.storageFolderName', 'storage.cacheFolderName', 'storage.useDirectStorageUrls'].includes(p)) {
    return false;
  }
  if (p === 'storage.urlExpires') return true;
  if (p.startsWith('storage.')) return true;

  // persistentStorage is annotated at the parent only (single flag), since its
  // body inherits structurally from storage. False because the inherited
  // sub-keys storageFolderName / cacheFolderName / name / useDirectStorageUrls
  // are unsafe at the leaf level.
  if (p === 'persistentStorage') return false;
  if (p.startsWith('persistentStorage.')) return false;

  if (p.startsWith('adminPanel.')) return true;
  if (p.startsWith('statsd.')) return false;
  if (p.startsWith('log.')) return false;
  if (p.startsWith('runtimeConfig.')) return false;

  if (p === 'email.smtpServerConfiguration.host') return true;
  if (p === 'email.smtpServerConfiguration.port') return false;
  if (p === 'email.smtpServerConfiguration.auth.user') return true;
  if (p === 'email.smtpServerConfiguration.auth.pass') return false;
  if (p.startsWith('email.connectionConfiguration.')) return false;
  if (p.startsWith('email.contactDefaults.')) return false;

  return null;
}

// ===========================================================================
// default.json walker
// ===========================================================================

/**
 * Yield terminal-path records from a parsed default.json. A terminal path is
 * a leaf primitive/array OR an empty object (e.g. persistentStorage: {}).
 *
 * @param {*} node
 * @param {string} prefix
 */
function* walkDefault(node, prefix = '') {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (keys.length === 0) {
      yield {path: prefix, isEmpty: true};
      return;
    }
    for (const k of keys) {
      const p = prefix ? prefix + '.' + k : k;
      yield* walkDefault(node[k], p);
    }
    return;
  }
  yield {path: prefix, isLeaf: true};
}

// ===========================================================================
// Position-aware schema text patcher (preserves original formatting)
// ===========================================================================

function findStringEnd(text, openPos) {
  let pos = openPos + 1;
  while (pos < text.length) {
    if (text[pos] === '\\') {
      pos += 2;
      continue;
    }
    if (text[pos] === '"') return pos;
    pos++;
  }
  return -1;
}

function findKeyInObject(text, fromPos, key) {
  let pos = fromPos;
  let depth = 0;
  while (pos < text.length) {
    const c = text[pos];
    if (c === '"') {
      const end = findStringEnd(text, pos);
      const content = text.slice(pos + 1, end);
      let next = end + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === ':' && depth === 0 && content === key) {
        return next;
      }
      pos = end + 1;
    } else if (c === '{' || c === '[') {
      depth++;
      pos++;
    } else if (c === '}' || c === ']') {
      if (depth === 0) return -1;
      depth--;
      pos++;
    } else {
      pos++;
    }
  }
  return -1;
}

function skipToValueOpen(text, colonPos) {
  let pos = colonPos + 1;
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  if (text[pos] !== '{') return -1;
  return pos + 1;
}

function findMatchingClose(text, insidePos) {
  let pos = insidePos;
  let depth = 1;
  while (pos < text.length && depth > 0) {
    const c = text[pos];
    if (c === '"') {
      pos = findStringEnd(text, pos) + 1;
    } else if (c === '{' || c === '[') {
      depth++;
      pos++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return pos;
      pos++;
    } else {
      pos++;
    }
  }
  return -1;
}

/**
 * Resolve a dotted user-facing path to the schema position of its value
 * object's closing brace. Walks via /properties/<part>/properties/<part>/...
 *
 * @param {string} text
 * @param {string} dottedPath
 * @returns {{ closePos: number, insidePos: number } | null}
 */
function resolvePath(text, dottedPath) {
  const parts = dottedPath.split('.');
  let pos = text.indexOf('{');
  if (pos < 0) return null;
  pos++;

  for (let i = 0; i < parts.length; i++) {
    const propsColonPos = findKeyInObject(text, pos, 'properties');
    if (propsColonPos < 0) return null;
    const propsInsidePos = skipToValueOpen(text, propsColonPos);
    if (propsInsidePos < 0) return null;
    const partColonPos = findKeyInObject(text, propsInsidePos, parts[i]);
    if (partColonPos < 0) return null;
    const partInsidePos = skipToValueOpen(text, partColonPos);
    if (partInsidePos < 0) return null;
    if (i === parts.length - 1) {
      const closePos = findMatchingClose(text, partInsidePos);
      if (closePos < 0) return null;
      return {closePos, insidePos: partInsidePos};
    }
    pos = partInsidePos;
  }
  return null;
}

function injectAnnotation(text, closePos, value) {
  let lineStart = closePos;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
  const braceLineIndent = text.slice(lineStart, closePos);
  const isMultiLineBlock = /^\s*$/.test(braceLineIndent);
  const propIndent = isMultiLineBlock ? braceLineIndent + '  ' : '  ';

  let lastChar = closePos - 1;
  while (lastChar > 0 && /\s/.test(text[lastChar])) lastChar--;

  const annotation = '"x-tenantOverride": ' + value;

  if (text[lastChar] === '{') {
    const insertion = '\n' + propIndent + annotation + '\n' + braceLineIndent;
    return text.slice(0, lastChar + 1) + insertion + text.slice(closePos);
  }
  const insertion = ',\n' + propIndent + annotation;
  return text.slice(0, lastChar + 1) + insertion + '\n' + braceLineIndent + text.slice(closePos);
}

// ===========================================================================
// Orchestration
// ===========================================================================

function collectTasks(defaultObj) {
  const tasks = [];
  for (const rec of walkDefault(defaultObj)) {
    if (!rec.path) continue;
    if (rec.path === 'persistentStorage') {
      // persistentStorage parent gets its own task below
      continue;
    }
    const verdict = classify(rec.path);
    tasks.push({path: rec.path, verdict});
  }
  tasks.push({path: 'persistentStorage', verdict: classify('persistentStorage')});
  return tasks;
}

/**
 * Read the x-tenantOverride boolean at a dotted user-facing path in the
 * parsed schema. Returns the value, or null if not present / not boolean.
 *
 * @param {object} schemaObj
 * @param {string} dottedPath
 */
function readAnnotation(schemaObj, dottedPath) {
  const parts = dottedPath.split('.');
  let node = schemaObj;
  for (const part of parts) {
    if (!node || typeof node !== 'object' || !node.properties || !node.properties[part]) {
      return {found: false};
    }
    node = node.properties[part];
  }
  if (!Object.prototype.hasOwnProperty.call(node, 'x-tenantOverride')) {
    return {found: false};
  }
  const v = node['x-tenantOverride'];
  if (typeof v !== 'boolean') {
    return {found: true, nonBoolean: v};
  }
  return {found: true, value: v};
}

function findExtraAnnotations(schemaObj, expectedPaths) {
  const expected = new Set(expectedPaths);
  const extra = [];
  function walk(node, prefix) {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'x-tenantOverride')) {
      if (!expected.has(prefix)) extra.push(prefix);
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const k of Object.keys(node.properties)) {
        const child = node.properties[k];
        const p = prefix ? prefix + '.' + k : k;
        walk(child, p);
      }
    }
  }
  walk(schemaObj, '');
  return extra;
}

// JS type of a default-value (JSON Schema vocabulary).
function jsTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typesCompatible(jsType, schemaType) {
  if (!schemaType) return null; // unspecified -- can't check
  const list = Array.isArray(schemaType) ? schemaType : [schemaType];
  if (jsType === 'integer') return list.includes('integer') || list.includes('number');
  return list.includes(jsType);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

function getSchemaNode(rootSchema, dottedPath) {
  const parts = dottedPath.split('.');
  let node = rootSchema;
  for (const part of parts) {
    if (!node || typeof node !== 'object' || !node.properties || !node.properties[part]) return null;
    node = node.properties[part];
  }
  return node;
}

// Build a per-path table of default-json terminals with their value.
function* walkDefaultWithValues(node, prefix = '') {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (keys.length === 0) {
      yield {path: prefix, value: node};
      return;
    }
    for (const k of keys) {
      yield* walkDefaultWithValues(node[k], prefix ? prefix + '.' + k : k);
    }
    return;
  }
  yield {path: prefix, value: node};
}

function runCheck(defaultObj, schemaObj) {
  const tasks = collectTasks(defaultObj);
  const expected = tasks.map(t => t.path);
  let pass = true;
  const report = {
    unclassified: [],
    missing: [],
    wrong: [],
    nonBoolean: [],
    extra: [],
    missingNode: [],
    typeMismatch: [],
    defaultMismatch: []
  };

  // x-tenantOverride checks (classification, annotation, etc.)
  for (const task of tasks) {
    if (task.verdict === null) {
      report.unclassified.push(task.path);
      pass = false;
      continue;
    }
    const annot = readAnnotation(schemaObj, task.path);
    if (!annot.found) {
      report.missing.push(task.path);
      pass = false;
      continue;
    }
    if ('nonBoolean' in annot) {
      report.nonBoolean.push({path: task.path, value: annot.nonBoolean});
      pass = false;
      continue;
    }
    if (annot.value !== task.verdict) {
      report.wrong.push({path: task.path, expected: task.verdict, actual: annot.value});
      pass = false;
    }
  }

  const extra = findExtraAnnotations(schemaObj, expected);
  if (extra.length > 0) {
    report.extra = extra;
    pass = false;
  }

  // Structural checks: schema completeness, type-match, default-match
  for (const {path: leafPath, value} of walkDefaultWithValues(defaultObj)) {
    if (!leafPath) continue;
    const node = getSchemaNode(schemaObj, leafPath);
    if (!node) {
      // Skip persistentStorage parent: it has no body in default.json,
      // and the tenant-override pass already verifies the parent annotation.
      if (leafPath === 'persistentStorage') continue;
      report.missingNode.push(leafPath);
      pass = false;
      continue;
    }
    const jsType = jsTypeOf(value);
    const typeOk = typesCompatible(jsType, node.type);
    if (typeOk === false) {
      report.typeMismatch.push({path: leafPath, jsType, schemaType: node.type});
      pass = false;
    }
    if (node.default !== undefined && !deepEqual(node.default, value)) {
      report.defaultMismatch.push({path: leafPath});
      pass = false;
    }
  }

  return {pass, report, total: tasks.length};
}

function runApply(defaultObj, schemaText) {
  const tasks = collectTasks(defaultObj);
  // Filter out unclassified tasks but report them
  const unclassified = tasks.filter(t => t.verdict === null).map(t => t.path);
  const classified = tasks.filter(t => t.verdict !== null);

  // Resolve positions, sort descending so earlier indexes stay valid as we splice
  const resolved = [];
  const unresolved = [];
  for (const task of classified) {
    const r = resolvePath(schemaText, task.path);
    if (!r) {
      unresolved.push(task.path);
      continue;
    }
    resolved.push({...task, closePos: r.closePos});
  }
  resolved.sort((a, b) => b.closePos - a.closePos);

  // Strip any existing x-tenantOverride first, so we are idempotent.
  // We do this by parsing, deleting, stringifying -- but that loses formatting.
  // Instead, on each path, check if already present and if so, skip (the apply
  // is a no-op when the schema already matches). For mismatches the operator
  // should manually edit or revert before re-running --apply.
  const schemaObj = JSON.parse(schemaText);
  let injected = 0;
  let skipped = 0;
  const mismatches = [];
  let text = schemaText;
  for (const task of resolved) {
    const annot = readAnnotation(schemaObj, task.path);
    if (annot.found && annot.value === task.verdict) {
      skipped++;
      continue;
    }
    if (annot.found && annot.value !== task.verdict) {
      mismatches.push({path: task.path, expected: task.verdict, actual: annot.value});
      continue;
    }
    text = injectAnnotation(text, task.closePos, String(task.verdict));
    injected++;
  }

  return {text, injected, skipped, unclassified, unresolved, mismatches, total: tasks.length};
}

// ===========================================================================
// Main
// ===========================================================================

function main() {
  const defaultObj = JSON.parse(fs.readFileSync(DEFAULT_JSON, 'utf8'));
  const schemaText = fs.readFileSync(SCHEMA_JSON, 'utf8');
  const schemaObj = JSON.parse(schemaText);

  if (MODE === 'check') {
    const {pass, report, total} = runCheck(defaultObj, schemaObj);
    console.log('check-config-schema --check');
    console.log('  total terminal paths in default.json: ' + total);
    if (report.missingNode.length) {
      console.error('  schema is missing a node for: ' + report.missingNode.length);
      report.missingNode.forEach(p => console.error('    ' + p));
    }
    if (report.typeMismatch.length) {
      console.error('  schema.type vs default-value mismatch: ' + report.typeMismatch.length);
      report.typeMismatch.forEach(m => console.error('    ' + m.path + ' js=' + m.jsType + ' schema=' + JSON.stringify(m.schemaType)));
    }
    if (report.defaultMismatch.length) {
      console.error('  schema.default does not match default.json value: ' + report.defaultMismatch.length);
      report.defaultMismatch.forEach(m => console.error('    ' + m.path));
    }
    if (report.unclassified.length) {
      console.error('  unclassified (need to be added to classify()): ' + report.unclassified.length);
      report.unclassified.forEach(p => console.error('    ' + p));
    }
    if (report.missing.length) {
      console.error('  missing x-tenantOverride in schema: ' + report.missing.length);
      report.missing.forEach(p => console.error('    ' + p));
    }
    if (report.wrong.length) {
      console.error('  wrong x-tenantOverride value (run --apply or fix classify()): ' + report.wrong.length);
      report.wrong.forEach(m => console.error('    ' + m.path + ' expected=' + m.expected + ' actual=' + m.actual));
    }
    if (report.nonBoolean.length) {
      console.error('  non-boolean x-tenantOverride: ' + report.nonBoolean.length);
      report.nonBoolean.forEach(m => console.error('    ' + m.path + ' = ' + JSON.stringify(m.value)));
    }
    if (report.extra.length) {
      console.error('  x-tenantOverride present at unexpected path: ' + report.extra.length);
      report.extra.forEach(p => console.error('    ' + p));
    }
    if (pass) {
      console.log('  OK');
      process.exit(0);
    }
    console.error('FAIL -- fix the issues above (or run `npm run config-schema:apply` for x-tenantOverride drift).');
    process.exit(1);
  }

  if (MODE === 'apply') {
    const {text, injected, skipped, unclassified, unresolved, mismatches, total} = runApply(defaultObj, schemaText);
    console.log('check-config-schema --apply');
    console.log('  total terminal paths in default.json: ' + total);
    console.log('  injected new annotations: ' + injected);
    console.log('  already up to date (skipped): ' + skipped);
    if (unclassified.length) {
      console.error('  unclassified (NOT annotated): ' + unclassified.length);
      unclassified.forEach(p => console.error('    ' + p));
    }
    if (unresolved.length) {
      console.error('  could not resolve in schema: ' + unresolved.length);
      unresolved.forEach(p => console.error('    ' + p));
    }
    if (mismatches.length) {
      console.error('  existing annotations disagree with classify(); not changed automatically: ' + mismatches.length);
      mismatches.forEach(m => console.error('    ' + m.path + ' classify=' + m.expected + ' schema=' + m.actual));
      console.error('  Resolve manually (edit schema or update classify()) and re-run.');
    }
    // Validate JSON after write
    try {
      JSON.parse(text);
    } catch (e) {
      console.error('Schema is not valid JSON after patch: ' + e.message);
      process.exit(1);
    }
    fs.writeFileSync(SCHEMA_JSON, text, 'utf8');
    if (unclassified.length || unresolved.length || mismatches.length) {
      process.exit(1);
    }
    process.exit(0);
  }

  console.error('Unknown mode: ' + MODE);
  process.exit(2);
}

main();
