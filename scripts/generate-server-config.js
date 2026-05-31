'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config: schema key prefix -> output file mapping
// Sorted longest-prefix-first so the most-specific entry wins.
// ---------------------------------------------------------------------------

// Positions follow the helpcenter page order (intro=1, then sections as they appear).
// CoAuthoring sub-sections appear as a flat list right after External request (position 20),
// matching the helpcenter layout.
const PREFIX_FILE_MAP = [
  // CoAuthoring sub-sections -- flat list starting at position 21 (after External request)
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
    if (itemType === 'object') return 'object[]';
    if (itemType) return `${itemType}[]`;
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
 * Slugify a section title into a stable Docusaurus anchor.
 * "AES-256-GCM algorithm" -> "aes-256-gcm-algorithm"
 */
function sectionAnchor(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Internal-link rewriting
//
// Schema descriptions were authored for the legacy multi-page layout and use
// relative links like `./notification.md` or `./license.md#licensewarning_limit_percents`.
// In single-page mode every section lives on server-config.mdx, so those links
// must become same-page anchors:
//   ./notification.md                              -> #notification        (section H2 anchor)
//   ./storage.md                                   -> #document-storage-service
//   ./license.md#licensewarning_limit_percents     -> #license.warning_limit_percents (APITable row anchor)
//
// Rewriting lives here (not in the schema) so the fix survives regeneration and
// the schema descriptions stay layout-agnostic.
// ---------------------------------------------------------------------------

// Built in main() once allParams/PREFIX_FILE_MAP are known.
let FILE_TO_ANCHOR = {};
let OLD_SLUG_TO_KEY = {};

/**
 * Replicate the Docusaurus (GithubSlugger) id for a former `## <param.key>` heading.
 * Lowercase, drop every char except [a-z0-9_-]; dots disappear, underscores survive.
 * "license.warning_limit_percents" -> "licensewarning_limit_percents"
 */
function oldHeadingSlug(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '');
}

/**
 * Build the lookup tables used by rewriteInternalLinks().
 */
function buildLinkMaps(allParams) {
  FILE_TO_ANCHOR = {};
  for (const e of PREFIX_FILE_MAP) {
    if (FILE_TO_ANCHOR[e.file]) continue; // first mapping wins (merged files are unused as link targets)
    FILE_TO_ANCHOR[e.file] = sectionAnchor(e.subTitle || e.title);
  }
  OLD_SLUG_TO_KEY = {};
  for (const p of allParams) OLD_SLUG_TO_KEY[oldHeadingSlug(p.key)] = p.key;
}

/**
 * Rewrite legacy `](./file.md[#frag])` links into same-page anchors.
 * Fragment (a specific parameter) wins over the section file when both resolve.
 * Unresolved links are left untouched so they surface as build warnings.
 */
function rewriteInternalLinks(text) {
  if (!text) return text;
  return String(text).replace(/\]\(\.\/([a-zA-Z0-9._-]+)\.md(?:#([a-zA-Z0-9_-]+))?\)/g, (m, file, frag) => {
    if (frag && OLD_SLUG_TO_KEY[frag]) return `](#${OLD_SLUG_TO_KEY[frag]})`;
    const sectionFile = `${file}.md`;
    if (FILE_TO_ANCHOR[sectionFile]) return `](#${FILE_TO_ANCHOR[sectionFile]})`;
    return m;
  });
}

/**
 * Escape a string for placement inside a single Markdown table cell.
 * Pipes are escaped; newlines collapsed into <br/>.
 * Inline Markdown (code spans, links, bold) is preserved.
 */
function escapeTableCell(value) {
  if (value == null) return '';
  let s = String(value);
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\|/g, '\\|');
  s = s.replace(/\n+/g, '<br/>');
  return s;
}

/**
 * Build a single-cell description for the server-config.mdx page.
 * Appends admonitions inline as **Warning:** / **Note:** blocks.
 */
function descriptionForTable(param) {
  let desc = escapeTableCell(rewriteInternalLinks((param.description || '').trim()));

  const adm = [];
  const lastSegment = param.key.split('.').pop().toLowerCase();
  const warnExplicit = param.xWarning === true;
  const warnHeuristic = param.docTypeRaw !== 'object' && /^(pass(word|phrase|s)?|secret(string|key|accesskey|s)?)$/i.test(lastSegment);
  if (warnExplicit || warnHeuristic) {
    adm.push('**Warning:** Do not store sensitive values in version control. Consider using environment variables or a secrets manager.');
  }
  if (param.xNote) {
    adm.push(`**Note:** ${escapeTableCell(rewriteInternalLinks(param.xNote))}`);
  }
  if (adm.length) {
    if (desc) desc += '<br/><br/>';
    desc += adm.join('<br/><br/>');
  }
  return desc;
}

/**
 * Build a flat ordered list of sections (one entry per group) for the
 * server-config.mdx page. Each entry: {heading, position, group, mappingPrefix}.
 *
 * Sections are sorted by PREFIX_FILE_MAP `position`, then heading text.
 * For merged files (e.g. security.md), each subTitle becomes its own section.
 */
function buildOrderedSections(fileGroups) {
  const sections = [];
  for (const [fileKey, groups] of Object.entries(fileGroups)) {
    for (const group of groups) {
      const entry = PREFIX_FILE_MAP.find(e => {
        const eKey = e.subDir ? `${e.subDir}/${e.file}` : e.file;
        return eKey === fileKey && (group.subTitle ? e.subTitle === group.subTitle : !e.subTitle);
      });
      const position = entry && entry.position != null ? entry.position : 99;
      const heading = group.subTitle || group.title;
      sections.push({heading, position, group, mappingPrefix: group.mappingPrefix});
    }
  }
  sections.sort((a, b) => a.position - b.position || a.heading.localeCompare(b.heading));
  return sections;
}

/**
 * Resolve type/default badge string for a param the same way per-file output does.
 * Returns null when the default value cannot be shown inline.
 */
function resolveDefaultBadge(param, defaultConfig) {
  if (param.docTypeRaw === 'object') return null;
  const real = resolvePath(defaultConfig, param.key);
  const effective = real !== undefined ? real : param.defaultValue;
  return formatDefaultBadge(effective);
}

/**
 * Build a JSON example for one reference-table section. The example uses the
 * same data as the old per-section pages: default.json value wrapped at the
 * documented schema prefix. Large examples are omitted as before.
 */
function buildSectionExample(group, defaultConfig) {
  const val = resolvePath(defaultConfig, group.mappingPrefix);
  if (val === undefined || val === null) return null;
  const wrapped = wrapAtPrefix(group.mappingPrefix, val);
  const json = JSON.stringify(wrapped, null, 2);
  return json.length <= 3000 ? json : null;
}

/**
 * Static Introduction body, lifted verbatim from the former intro.md. Wrapped
 * under `## Introduction` inside server-config.mdx instead of being a
 * separate page.
 */
const INTRO_BODY = [
  'To change any ONLYOFFICE Docs server settings, configure the corresponding parameter in the **ONLYOFFICE Docs** configuration files, which are stored in the following directory:',
  '',
  '- For Linux: `/etc/onlyoffice/documentserver/`',
  '- For Windows: `%ProgramFiles%\\ONLYOFFICE\\DocumentServer\\config\\`',
  '',
  'The base settings are shipped in the `default.json` file located in that directory.',
  '',
  '### Configuration files {#configuration-files}',
  '',
  'ONLYOFFICE Docs reads its settings through the [node-config](https://github.com/node-config/node-config) library. On startup, node-config loads several configuration files from the directory above and merges them, so that each file overrides the values set by the files loaded before it. The full list of supported file names and their load order is described in the [node-config documentation](https://github.com/node-config/node-config/wiki/Configuration-Files).',
  '',
  'In a standard deployment, the files are applied in the following order, from the lowest priority to the highest (each file overrides the previous one):',
  '',
  '- `default.json` - the base settings shipped with ONLYOFFICE Docs.',
  '- `{NODE_ENV}.json` - the deployment-specific settings, where `{NODE_ENV}` is the value of the `NODE_ENV` environment variable, for example, `production-linux.json` or `production-windows.json`.',
  '- `local.json` - your own overrides that are applied to every deployment.',
  '- `local-{NODE_ENV}.json` - your own overrides that are applied to a single deployment only, for example, `local-production-linux.json`.',
  '- `runtime.json` - dynamic settings written by ONLYOFFICE Docs itself; loaded last, so it takes precedence over all the files above. See [Runtime config](#runtime-config).',
  '',
  'To change a parameter, do not edit `default.json` or the `{NODE_ENV}.json` files: they are overwritten on every restart or upgrade. Instead, add the parameter to the `local.json` file (or to a `local-{NODE_ENV}.json` file), keep the whole object structure of the parameter, and set the required value. The same parameter can also be set in `runtime.json`, but with caution: the running server rereads this file on every save and applies the change immediately, without a restart.',
  '',
  ':::warning',
  'Please do not edit the contents of the `default.json` file directly. The default values will be restored each time you restart Docker container or upgrade **ONLYOFFICE Docs** to a new version, and all your changes will be lost.',
  ':::'
].join('\n');

/**
 * Wipe everything inside outDir before writing the new single-page output.
 * Guarantees the workflow's `git add .` in api.onlyoffice.com commits deletions
 * for every per-section file from the legacy multi-page layout.
 */
function sweepOutDir(outDir) {
  if (!fs.existsSync(outDir)) return;
  for (const name of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, name), {recursive: true, force: true});
  }
}

/**
 * Write server-config.mdx: one long page, ## per section, APITable wrapping
 * a 4-column Markdown table per section. Param key in the first column drives
 * the row anchor produced by the APITable component.
 */
function writeReferenceTable(outDir, orderedSections, sectionIntroMap, defaultConfig, introBody, scopeMap) {
  const lines = [];
  let totalParamsWritten = 0;
  let paramsWithScope = 0;

  // No sidebar_label / sidebar_position here: this file is the category index
  // for the server-config folder, so the single sidebar item's label and position
  // come from _category_.json. That collapses the redundant "Server configuration"
  // > "Server configuration reference" nesting into one clickable item.
  //
  // The file MUST be named after its parent folder (server-config.mdx), not
  // index.mdx: api.onlyoffice.com's docusaurus.config.ts customizes
  // sidebarItemsGenerator to exclude `index` from the category-index convention
  // (`if (params.fileName.toLowerCase() === 'index') return false`). The
  // folder-name convention is not excluded and is already used elsewhere in that
  // repo (e.g. command-service/command-service.md).
  lines.push('---');
  lines.push('title: Server configuration');
  lines.push('toc_min_heading_level: 2');
  lines.push('toc_max_heading_level: 2');
  lines.push('pagination_prev: null');
  lines.push('pagination_next: null');
  lines.push('---');
  lines.push('');
  lines.push('# Server configuration');
  lines.push('');
  lines.push('```mdx-code-block');
  lines.push("import APITable from '@site/src/components/APITable/APITable';");
  lines.push('```');
  lines.push('');
  lines.push('## Introduction {#introduction}');
  lines.push('');
  lines.push(introBody.trim());
  lines.push('');

  for (const section of orderedSections) {
    const anchor = sectionAnchor(section.heading);
    lines.push(`## ${section.heading} {#${anchor}}`);
    lines.push('');
    if (sectionIntroMap[section.mappingPrefix]) {
      lines.push(rewriteInternalLinks(sectionIntroMap[section.mappingPrefix]));
      lines.push('');
    }

    lines.push('```mdx-code-block');
    lines.push('<APITable>');
    lines.push('```');
    lines.push('');
    lines.push('| Parameter | Type | Default | Description |');
    lines.push('|-----------|------|---------|-------------|');
    for (const param of section.group.params) {
      const badge = resolveDefaultBadge(param, defaultConfig);
      // Parameter and Type are plain text per the convention used in
      // adding-a-dms-provider.md / callback-handler.md / conversion-api/*.
      // Default keeps backticks because it's an actual literal value.
      const paramCell = param.key;
      const typeCell = param.docTypeRaw;
      const defaultCell = badge !== null ? `\`${badge}\`` : '';
      const descCell = descriptionForTable(param);
      lines.push(`| ${paramCell} | ${typeCell} | ${defaultCell} | ${descCell} |`);
      totalParamsWritten++;
      if (scopeMap[param.key]) paramsWithScope++;
    }
    lines.push('');
    lines.push('```mdx-code-block');
    lines.push('</APITable>');
    lines.push('```');
    lines.push('');

    const example = buildSectionExample(section.group, defaultConfig);
    if (example) {
      lines.push(`### Example {#${anchor}-example}`);
      lines.push('');
      lines.push('```json');
      lines.push(example);
      lines.push('```');
      lines.push('');
    }
  }

  fs.writeFileSync(path.join(outDir, 'server-config.mdx'), lines.join('\n'));
  return {totalParamsWritten, paramsWithScope};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let outDir = path.join(__dirname, '..', 'docs-output');
  let sectionFilter = null; // null = all sections; otherwise Set of accepted anchors

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--sections' && args[i + 1]) {
      sectionFilter = new Set(
        args[i + 1]
          .split(',')
          .map(s => sectionAnchor(s.trim()))
          .filter(Boolean)
      );
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

  // Build lookup tables for rewriting legacy per-section links to same-page anchors.
  buildLinkMaps(allParams);

  // Build scope lookup
  const scopeMap = {};
  collectScopes(schema, '', scopeMap);

  // Build default.json leaf keys for gap detection
  const defaultLeafKeys = [];
  collectLeafKeys(defaultConfig, '', defaultLeafKeys);
  const schemaKeySet = new Set(allParams.map(p => p.key));

  // Group params by output file, then by merge group within that file
  // fileGroups: file -> Map<groupKey, {title, mergeOrder, subTitle, params: []}>
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

  // Build section intro map: schema-prefix -> x-section-intro text
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
  // (e.g. a `rabbitmq` root node above the `rabbitmq.url`, `rabbitmq.socketOptions`, ... entries).
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

  // Single-page mode: wipe outDir completely so deletions of the legacy
  // per-section files (rabbitmq.md, intro.md, _category_.json, services/, ...)
  // make it into the api.onlyoffice.com commit via the workflow's `git add .`.
  sweepOutDir(outDir);
  fs.mkdirSync(outDir, {recursive: true});

  // Build the ordered section list for the single reference page. Docusaurus'
  // right-side "On this page" TOC provides section navigation from these H2s.
  let orderedSections = buildOrderedSections(fileGroups);
  if (sectionFilter) {
    const before = orderedSections.length;
    orderedSections = orderedSections.filter(s => sectionFilter.has(sectionAnchor(s.heading)));
    const missing = [...sectionFilter].filter(req => !orderedSections.some(s => sectionAnchor(s.heading) === req));
    console.log(`Section filter: kept ${orderedSections.length}/${before} sections`);
    if (missing.length) console.log(`  Unknown sections (ignored): ${missing.join(', ')}`);
  }

  // The single content page.
  const tableStats = writeReferenceTable(outDir, orderedSections, sectionIntroMap, defaultConfig, INTRO_BODY, scopeMap);
  const totalParamsWritten = tableStats.totalParamsWritten;
  const paramsWithScope = tableStats.paramsWithScope;

  // server-config.mdx is the category index for the server-config folder, so the folder
  // collapses into a single clickable sidebar item. This label and position
  // drive that one item (the doc's own sidebar_label/position are intentionally
  // omitted). Avoids the redundant "Server configuration" > "Server
  // configuration reference" two-level nesting.
  fs.writeFileSync(path.join(outDir, '_category_.json'), JSON.stringify({label: 'Server configuration', position: 1}, null, 2) + '\n');

  const filesGenerated = 2; // server-config.mdx + _category_.json

  // Report: gaps between default.json and schema docs
  const inDefaultNotInSchema = defaultLeafKeys.filter(k => !schemaKeySet.has(k));
  const inSchemaNotInDefault = allParams.filter(p => resolvePath(defaultConfig, p.key) === undefined).map(p => p.key);

  // Report: default value mismatches (schema default vs default.json)
  // Skips object-type params -- their JSON.stringify comparison is order-sensitive and noisy.
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
