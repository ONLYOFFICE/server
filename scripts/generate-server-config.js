'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config: schema key prefix → output file mapping
// Sorted longest-prefix-first so the most-specific entry wins.
// ---------------------------------------------------------------------------

// Positions follow the helpcenter page order (intro=1, then sections as they appear).
// CoAuthoring sub-sections appear as a flat list right after External request (position 20),
// matching the helpcenter layout.
const PREFIX_FILE_MAP = [
  // CoAuthoring sub-sections — flat list starting at position 21 (after External request)
  {prefix: 'services.CoAuthoring', file: 'services.md', title: 'Document Server services', position: 21},
  {prefix: 'services.CoAuthoring.server', file: 'server.md', title: 'Server', position: 22},
  {prefix: 'services.CoAuthoring.editor', file: 'editor.md', title: 'Editor', position: 23},
  {prefix: 'services.CoAuthoring.sql', file: 'sql.md', title: 'SQL', position: 24},
  {prefix: 'services.CoAuthoring.redis', file: 'redis.md', title: 'Redis', position: 25},
  {prefix: 'services.CoAuthoring.token', file: 'token.md', title: 'Token', position: 26},
  {prefix: 'services.CoAuthoring.expire', file: 'expiration.md', title: 'Expiration', position: 27},
  {prefix: 'services.CoAuthoring.autoAssembly', file: 'auto-assembly.md', title: 'Auto assembly', position: 28},
  {prefix: 'services.CoAuthoring.callbackBackoffOptions', file: 'callback-backoff.md', title: 'Callback backoff options', position: 29},
  {prefix: 'services.CoAuthoring.ipfilter', file: 'ip-filter.md', title: 'IP filter', position: 30},
  {prefix: 'services.CoAuthoring.plugins', file: 'plugins.md', title: 'Plugins', position: 31},
  {prefix: 'services.CoAuthoring.pubsub', file: 'pubsub.md', title: 'PubSub service', position: 32},
  {prefix: 'services.CoAuthoring.request-filtering-agent', file: 'request-filtering.md', title: 'Request Filtering Agent', position: 33},
  {prefix: 'services.CoAuthoring.requestDefaults', file: 'request-defaults.md', title: 'Default request', position: 34},
  {prefix: 'services.CoAuthoring.requestDefault', file: 'request-defaults.md', title: 'Default request', position: 34},
  {prefix: 'services.CoAuthoring.socketio', file: 'socketio.md', title: 'Socket.IO', position: 35},
  {prefix: 'services.CoAuthoring.sockjs', file: 'sockjs.md', title: 'SockJs', position: 36},
  {prefix: 'services.CoAuthoring.themes', file: 'themes.md', title: 'Themes', position: 37},
  {prefix: 'services.CoAuthoring.utils', file: 'utils.md', title: 'Utils', position: 38},
  // secret stays in root security.md (merged with AES + OpenPGP)
  {prefix: 'services.CoAuthoring.secret', file: 'security.md', title: 'Security', mergeOrder: 3, subTitle: 'Secret key', position: 15},

  // Merged security.md (AES + OpenPGP + Secret key)
  {prefix: 'aesEncrypt', file: 'security.md', title: 'Security', mergeOrder: 1, subTitle: 'AES-256-GCM algorithm', position: 15},
  {prefix: 'openpgpjs', file: 'security.md', title: 'Security', mergeOrder: 2, subTitle: 'OpenPGP protocol', position: 15},

  // Top-level sections
  {prefix: 'activemq', file: 'activemq.md', title: 'ActiveMQ', position: 13},
  {prefix: 'adminPanel', file: 'admin-panel.md', title: 'Admin Panel', position: 2},
  {prefix: 'aiSettings', file: 'ai-settings.md', title: 'AI plugin settings', position: 4},
  {prefix: 'bottleneck', file: 'bottleneck.md', title: 'Bottleneck', position: 16},
  {prefix: 'FileConverter', file: 'converter.md', title: 'Converter', position: 40},
  {prefix: 'dnscache', file: 'dns-cache.md', title: 'DNS cache', position: 14},
  {prefix: 'email', file: 'email.md', title: 'Email', position: 8},
  {prefix: 'externalRequest', file: 'external-request.md', title: 'External request', position: 20},
  {prefix: 'license', file: 'license.md', title: 'License', position: 39},
  {prefix: 'log', file: 'logger.md', title: 'Logger', position: 5},
  {prefix: 'notification', file: 'notification.md', title: 'Notification', position: 9},
  {prefix: 'queue', file: 'queues.md', title: 'Queues', position: 7},
  {prefix: 'rabbitmq', file: 'rabbitmq.md', title: 'RabbitMQ', position: 12},
  {prefix: 'runtimeConfig', file: 'runtime-config.md', title: 'Runtime config', position: 6},
  {prefix: 'statsd', file: 'statsd.md', title: 'StatsD', position: 3},
  {prefix: 'storage', file: 'storage.md', title: 'Document storage service', position: 10},
  {prefix: 'persistentStorage', file: 'persistent-storage.md', title: 'Persistent storage', position: 11},
  {prefix: 'tenants', file: 'tenants.md', title: 'Tenants', position: 19},
  {prefix: 'win-ca', file: 'win-ca.md', title: 'Windows System Root certificates', position: 17},
  {prefix: 'wopi', file: 'wopi.md', title: 'WOPI', position: 18}
];

// Sort longest prefix first for greedy matching (more specific wins)
PREFIX_FILE_MAP.sort((a, b) => b.prefix.length - a.prefix.length);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path key against a nested object.
 * Returns undefined if path does not exist.
 */
function resolvePath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Walk a JSON-Schema tree and collect x-scope values keyed by dot-path.
 */
function collectScopes(schema, prefix, out) {
  if (!schema || typeof schema !== 'object') return;
  if (schema['x-scope']) {
    const raw = schema['x-scope'];
    out[prefix] = Array.isArray(raw) ? raw : [raw];
  }
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      collectScopes(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

/**
 * Collect all leaf-key dot-paths from a nested object.
 */
function collectLeafKeys(obj, prefix, out) {
  if (obj == null || typeof obj !== 'object') {
    out.push(prefix);
    return;
  }
  if (Array.isArray(obj)) {
    out.push(prefix);
    return;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out.push(prefix);
    return;
  }
  for (const k of keys) {
    collectLeafKeys(obj[k], prefix ? `${prefix}.${k}` : k, out);
  }
}

/**
 * Convert a JSON Schema node's type to a human-readable doc type string.
 */
function schemaTypeToDoc(node) {
  const t = node.type;
  if (!t || t === 'string') return 'string';
  if (t === 'integer') return 'integer';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  if (t === 'array') {
    const itemType = node.items && node.items.type;
    if (itemType === 'object') return 'array of objects';
    if (itemType) return `array of ${itemType}s`;
    return 'array';
  }
  return String(t);
}

/**
 * Walk a JSON Schema and emit one param record per node that has a `description`.
 */
function walkSchema(node, prefix, out) {
  if (!node || typeof node !== 'object') return;
  if (node.description && prefix) {
    out.push({
      key: prefix,
      docTypeRaw: schemaTypeToDoc(node),
      description: node.description,
      defaultValue: node.default, // may be undefined
      xExample: node['x-example'], // custom example override (optional)
      xNote: node['x-note'], // custom :::note admonition text (optional)
      xWarning: node['x-warning'] // explicit :::warning override (optional)
    });
  }
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) {
      walkSchema(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

/**
 * Find the best-matching PREFIX_FILE_MAP entry for a dot-path key.
 */
function findMapping(key) {
  for (const entry of PREFIX_FILE_MAP) {
    if (key === entry.prefix || key.startsWith(entry.prefix + '.')) {
      return entry;
    }
  }
  return null;
}

/**
 * Format a default value for the `Type: X` badge line.
 * Returns the text to place inside the code span (e.g. `"value"`, `true`, `[]`),
 * or null when the value is too complex/long to display on one line.
 */
function formatDefaultBadge(value) {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (value === '') return '""';
  if (typeof value === 'string') {
    if (value.length > 60) return null;
    return `"${value}"`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const json = JSON.stringify(value);
    return json.length <= 100 ? json : null;
  }
  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return '{}';
    return null; // too complex for a single-line badge
  }
  return String(value);
}

/**
 * Return Docusaurus admonitions for a parameter, or an empty string.
 *
 * Rules:
 *   :::warning  — schema has x-warning: true, OR last key segment contains "pass"/"secret"
 *                 (type must not be object)
 *   :::note     — schema has x-note field (exact text used as-is)
 */
function getAdmonitions(param) {
  const parts = [];
  const lastSegment = param.key.split('.').pop().toLowerCase();

  const warnExplicit = param.xWarning === true;
  // Match the FULL last key segment — avoids false positives like "filenameSecret" or "bypass"
  const warnHeuristic = param.docTypeRaw !== 'object' && /^(pass(word|phrase|s)?|secret(string|key|accesskey|s)?)$/i.test(lastSegment);

  if (warnExplicit || warnHeuristic) {
    parts.push(
      ':::warning\n' + 'Do not store sensitive values in version control. ' + 'Consider using environment variables or a secrets manager.\n' + ':::'
    );
  }

  if (param.xNote) {
    parts.push(`:::note\n${param.xNote}\n:::`);
  }

  return parts.length ? parts.join('\n\n') + '\n\n' : '';
}

/**
 * Wrap a value at its dot-path prefix to produce a nested object.
 * E.g. ('services.CoAuthoring.redis', {...}) => {services:{CoAuthoring:{redis:{...}}}}
 */
function wrapAtPrefix(prefix, value) {
  const parts = prefix.split('.');
  let obj = value;
  for (let i = parts.length - 1; i >= 0; i--) {
    obj = {[parts[i]]: obj};
  }
  return obj;
}

/**
 * Deep-merge source into target (objects only; arrays are replaced).
 */
function deepMerge(target, source) {
  const result = Object.assign({}, target);
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && result[k] && typeof result[k] === 'object' && !Array.isArray(result[k])) {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Determine if a param key is a child of an object-type entry.
 * Uses a pre-built Map<key, param> for O(1) parent lookups.
 */
function isChildOfObject(key, paramByKey) {
  const parts = key.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const parent = paramByKey.get(parts.slice(0, i).join('.'));
    if (parent && parent.docTypeRaw === 'object') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let outDir = path.join(__dirname, '..', 'docs-output');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outDir = path.resolve(args[i + 1]);
      i++;
    }
  }

  const rootDir = path.join(__dirname, '..');

  // Load inputs
  const defaultConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'Common/config/default.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(rootDir, 'Common/config/schemas/config.schema.json'), 'utf8'));

  // Walk schema to collect all documented params
  const allParams = [];
  walkSchema(schema, '', allParams);

  // Build scope lookup
  const scopeMap = {};
  collectScopes(schema, '', scopeMap);

  // Build default.json leaf keys for gap detection
  const defaultLeafKeys = [];
  collectLeafKeys(defaultConfig, '', defaultLeafKeys);
  const schemaKeySet = new Set(allParams.map(p => p.key));

  // Group params by output file, then by merge group within that file
  // fileGroups: file → Map<groupKey, {title, mergeOrder, subTitle, params: []}>
  const fileGroupMaps = {};
  const unmappedKeys = [];

  for (const param of allParams) {
    const mapping = findMapping(param.key);
    if (!mapping) {
      unmappedKeys.push(param.key);
      continue;
    }
    const {file, title, mergeOrder = 0, subTitle = null, subDir = null} = mapping;
    const fileKey = subDir ? `${subDir}/${file}` : file;
    const groupKey = `${mergeOrder}|${subTitle || ''}`;

    if (!fileGroupMaps[fileKey]) fileGroupMaps[fileKey] = new Map();
    if (!fileGroupMaps[fileKey].has(groupKey)) {
      fileGroupMaps[fileKey].set(groupKey, {title, mergeOrder, subTitle, subDir, mappingPrefix: mapping.prefix, params: []});
    }
    fileGroupMaps[fileKey].get(groupKey).params.push(param);
  }

  // Flatten to sorted groups per file
  const fileGroups = {};
  for (const [file, groupMap] of Object.entries(fileGroupMaps)) {
    fileGroups[file] = [...groupMap.values()].sort((a, b) => a.mergeOrder - b.mergeOrder);
  }

  // Build section intro map: schema-prefix → x-section-intro text
  // Keyed by prefix so merged files (security.md) get per-group intros under each sub-heading
  const sectionIntroMap = {};
  for (const entry of PREFIX_FILE_MAP) {
    if (sectionIntroMap[entry.prefix]) continue;
    const parts = entry.prefix.split('.');
    let node = schema;
    for (const p of parts) node = node?.properties?.[p];
    const intro = node?.['x-section-intro'];
    if (intro) sectionIntroMap[entry.prefix] = intro;
  }

  // Remove section-root nodes that have children in the same group.
  // These are object nodes from the Copy schema whose descriptions bloat the output
  // (e.g. a `rabbitmq` root node above the `rabbitmq.url`, `rabbitmq.socketOptions`, … entries).
  // Exception: keep the root when it is the ONLY param (e.g. services.CoAuthoring in services.md).
  for (const groups of Object.values(fileGroups)) {
    for (const group of groups) {
      const prefix = group.mappingPrefix;
      const hasChildren = group.params.some(p => p.key !== prefix && p.key.startsWith(prefix + '.'));
      if (hasChildren) {
        group.params = group.params.filter(p => p.key !== prefix);
      }
    }
  }

  // Create output directory
  fs.mkdirSync(outDir, {recursive: true});

  // Remove legacy directories from old structures
  for (const legacyDir of ['services', 'coauthoring']) {
    const p = path.join(outDir, legacyDir);
    if (fs.existsSync(p)) fs.rmSync(p, {recursive: true, force: true});
  }

  // Clean up old flat files that now live in a subdirectory
  const movedToSubDir = new Set();
  for (const entry of PREFIX_FILE_MAP) {
    if (entry.subDir) movedToSubDir.add(entry.file);
  }
  for (const fname of movedToSubDir) {
    const oldPath = path.join(outDir, fname);
    if (fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch (_) {
        /* file may not exist */
      }
    }
  }

  // Write root _category_.json
  fs.writeFileSync(path.join(outDir, '_category_.json'), JSON.stringify({label: 'Server configuration', position: 1}, null, 2) + '\n');

  // Create _category_.json files for each subdirectory
  const subDirCategories = new Map();
  for (const entry of PREFIX_FILE_MAP) {
    if (entry.subDir && entry.categoryLabel && !subDirCategories.has(entry.subDir)) {
      subDirCategories.set(entry.subDir, {label: entry.categoryLabel, position: entry.categoryPosition || 99});
    }
  }
  for (const [subDir, cat] of subDirCategories) {
    const subDirPath = path.join(outDir, subDir);
    fs.mkdirSync(subDirPath, {recursive: true});
    fs.writeFileSync(path.join(subDirPath, '_category_.json'), JSON.stringify({label: cat.label, position: cat.position}, null, 2) + '\n');
  }

  // Write static intro page (position 1 — always first in sidebar)
  const introContent = `---
sidebar_position: 1
---

# Introduction

To change any ONLYOFFICE Docs server settings, configure the corresponding parameter in the **ONLYOFFICE Docs** configuration file, which can be found at the following path:

- For Linux: \`/etc/onlyoffice/documentserver/default.json\`
- For Windows: \`%ProgramFiles%\\ONLYOFFICE\\DocumentServer\\config\\default.json\`

If you want to change it, you can use the \`local.json\` file, where all the edited parameters should be stored. This file is located in the same directory as the \`default.json\` file, and the whole object structure for the necessary parameter must be retained.

:::warning
Please do not edit the contents of the \`default.json\` file directly. The default values will be restored each time you restart Docker container or upgrade **ONLYOFFICE Docs** to a new version, and all your changes will be lost.
:::

Default server settings are described below.
`;
  fs.writeFileSync(path.join(outDir, 'intro.md'), introContent);

  let filesGenerated = 0;
  let totalParamsWritten = 0;
  let paramsWithScope = 0;

  // Assign sidebar_position from PREFIX_FILE_MAP position field (min when file has multiple entries)
  const filePositions = {};
  for (const [fileKey, groups] of Object.entries(fileGroups)) {
    const positions = groups.map(g => {
      const entry = PREFIX_FILE_MAP.find(e => {
        const eKey = e.subDir ? `${e.subDir}/${e.file}` : e.file;
        return eKey === fileKey && (g.subTitle ? e.subTitle === g.subTitle : !e.subTitle);
      });
      return entry && entry.position != null ? entry.position : 99;
    });
    filePositions[fileKey] = Math.min(...positions);
  }

  // Generate each file
  for (const [fileKey, groups] of Object.entries(fileGroups)) {
    const isMerged = groups.length > 1;
    const title = groups[0].title;
    const pos = filePositions[fileKey] || 1;

    const outPath = path.join(outDir, fileKey);
    fs.mkdirSync(path.dirname(outPath), {recursive: true});
    const stream = fs.createWriteStream(outPath, {encoding: 'utf8'});
    const w = s => stream.write(s);

    w(`---\nsidebar_position: ${pos}\n---\n\n`);
    w(`# ${title}\n\n`);
    // For single-group files, write the section intro after the page title
    if (!isMerged && sectionIntroMap[groups[0].mappingPrefix]) {
      w(sectionIntroMap[groups[0].mappingPrefix] + '\n\n');
    }

    for (const group of groups) {
      const params = group.params;
      // Build lookup map once per group for O(1) parent resolution
      const paramByKey = new Map(params.map(p => [p.key, p]));

      if (isMerged && group.subTitle) {
        w(`## ${group.subTitle}\n\n`);
        // For merged files, write each group's intro after its sub-heading
        if (sectionIntroMap[group.mappingPrefix]) {
          w(sectionIntroMap[group.mappingPrefix] + '\n\n');
        }
      }

      for (const param of params) {
        const child = isChildOfObject(param.key, paramByKey);
        const headingLevel = isMerged && group.subTitle ? (child ? '####' : '###') : child ? '###' : '##';

        const scope = scopeMap[param.key];

        const realDefault = resolvePath(defaultConfig, param.key);
        const effectiveDefault = realDefault !== undefined ? realDefault : param.defaultValue;

        const defaultBadge = param.docTypeRaw !== 'object' ? formatDefaultBadge(effectiveDefault) : null;
        const desc = (param.description || '').trim();

        w(`${headingLevel} ${param.key}\n\n`);
        if (defaultBadge !== null) {
          w(`\`Type: ${param.docTypeRaw}\`   \`Default: ${defaultBadge}\`\n\n`);
        } else {
          w(`\`Type: ${param.docTypeRaw}\`\n\n`);
        }
        w(`${desc}\n\n`);
        w(getAdmonitions(param));

        totalParamsWritten++;
        if (scope) paramsWithScope++;
      }
    }

    // Section-level JSON example block — built from default.json values for each group's prefix.
    // Groups are merged into one JSON object (deep-merge), then wrapped at their dot-path.
    // Skipped when the resolved value is undefined or produces JSON > 3000 chars (too large to be useful).
    let exampleObj = {};
    let hasExample = false;
    for (const group of groups) {
      const val = resolvePath(defaultConfig, group.mappingPrefix);
      if (val === undefined || val === null) continue;
      const wrapped = wrapAtPrefix(group.mappingPrefix, val);
      exampleObj = deepMerge(exampleObj, wrapped);
      hasExample = true;
    }
    if (hasExample) {
      const json = JSON.stringify(exampleObj, null, 2);
      if (json.length <= 3000) {
        w(`## Example\n\n`);
        w('```json\n');
        w(json + '\n');
        w('```\n\n');
      }
    }

    stream.end();
    filesGenerated++;
  }

  // Report: gaps between default.json and schema docs
  const inDefaultNotInSchema = defaultLeafKeys.filter(k => !schemaKeySet.has(k));
  const inSchemaNotInDefault = allParams.filter(p => resolvePath(defaultConfig, p.key) === undefined).map(p => p.key);

  // Report: default value mismatches (schema default vs default.json)
  // Skips object-type params — their JSON.stringify comparison is order-sensitive and noisy.
  const defaultMismatches = [];
  for (const param of allParams) {
    if (param.defaultValue === undefined) continue;
    if (param.docTypeRaw === 'object') continue; // skip object-level nodes
    const real = resolvePath(defaultConfig, param.key);
    if (real === undefined) continue;
    if (JSON.stringify(real) !== JSON.stringify(param.defaultValue)) {
      defaultMismatches.push({
        key: param.key,
        schema: param.defaultValue,
        defaultJson: real
      });
    }
  }

  const report = {
    generated: new Date().toISOString(),
    stats: {
      totalSchemaParams: allParams.length,
      totalParamsWritten,
      filesGenerated,
      paramsWithScope,
      unmappedKeys: unmappedKeys.length
    },
    unmappedKeys,
    inDefaultNotInSchema,
    inSchemaNotInDefault,
    defaultMismatches
  };

  const reportPath = path.join(__dirname, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  // Summary
  console.log(`Generated ${filesGenerated} files with ${totalParamsWritten} parameters in ${outDir}`);
  console.log(`  Schema params total    : ${allParams.length}`);
  console.log(`  Params with scope info : ${paramsWithScope}`);
  console.log(`  Unmapped keys          : ${unmappedKeys.length}`);
  console.log(`  In default, not schema : ${inDefaultNotInSchema.length}`);
  console.log(`  In schema, not default : ${inSchemaNotInDefault.length}`);
  console.log(`  Default value mismatches: ${defaultMismatches.length}`);
  console.log(`Report: ${reportPath}`);
}

main();
