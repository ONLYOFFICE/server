# Path Resolution — Developer Guide

How file paths are resolved across ONLYOFFICE Docs services
and what every developer must know when reading, adding, or modifying paths.

---

## Convention

All relative paths in config files (`development-windows.json`, `production-linux.json`)
are written relative to `server/DocService/`. This is a project-wide convention —
it applies even when the same config is read by AdminPanel or FileConverter.

`Common/sources/pathUtils.js` provides two functions that make the resolution anchor
explicit, so paths resolve correctly regardless of which service reads them.

---

## The Two Functions

### `resolveConfigPath(value)` — config path → filesystem

Use when `config.get(...)` returns a filesystem path (for `fs.*`, `path.*`, `require()`, etc.).
Relative → resolved from `server/DocService/`; absolute → unchanged; falsy → as-is.

```js
const {resolveConfigPath} = require('./pathUtils'); // or relative path to Common/sources/
const logPath = resolveConfigPath(config.get('log.filePath'));
// "../Common/config/log4js/development.json" → "<absolute>/server/Common/config/log4js/development.json"
```

### `resolveAppPath(devRoot, value)` — service-specific path

Use for paths hardcoded in source (not from config), relative to a service's own root.
Dev: resolves from `devRoot`; pkg: from `process.cwd()` (set by launcher); absolute → unchanged.

```js
const {resolveAppPath} = require('../../../server/Common/sources/pathUtils');
const clientBuild = resolveAppPath(path.resolve(__dirname, '../..'), 'client/build');
```

### Which one to use?

- Path from `config.get(...)` → `resolveConfigPath(value)`
- Path relative to a service root → `resolveAppPath(devRoot, value)`
- Already absolute or a Node module → no wrapper needed

---

## Rules for Developers

### Adding a New Config Path

1. Add the key to `default.json` with an empty string `""` as the default value.
2. Add the dev value to `development-windows.json` (and other platform variants).
   Write it **relative to `server/DocService/`** — this is the anchor convention.
3. At the point of use, wrap with `resolveConfigPath`:
   ```js
   const myPath = resolveConfigPath(config.get('myFeature.somePath'));
   ```
4. Never use the raw value from `config.get()` directly in `fs.*` or `path.resolve()`.

### Adding a Service-Specific Path

1. Compute `devRoot` using `path.resolve(__dirname, '...')` to reach the service's root directory.
2. Use `resolveAppPath(devRoot, 'relative/path')`.
3. Do NOT compute `devRoot` from `process.cwd()` — that defeats the purpose.

### Environment Variable Paths (Launchers, Tests)

Always construct **absolute paths** from a known anchor — never relative:

```python
# Python (run-develop.py)
server_root = os.path.dirname(os.path.abspath(__file__))
base.set_env('NODE_CONFIG_DIR', os.path.join(server_root, 'Common', 'config'))
```

```js
// Node.js (env-setup.js)
process.env.NODE_CONFIG_DIR = path.resolve(__dirname, '../Common/config');
```

Relative env var paths break because child process CWD differs per service.

---

## Common Pitfalls

| Pitfall                                | Example                                         | Fix                                       |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| Config value used without resolving    | `fs.readFileSync(config.get('x.path'))`         | `fs.readFileSync(resolveConfigPath(...))` |
| Bare `path.resolve` with relative path | `path.resolve('client/build')`                  | `resolveAppPath(devRoot, 'client/build')` |
| `process.cwd()` as anchor              | `path.join(process.cwd(), '..', 'bin')`         | Derive from `__dirname` or config         |
| Forgetting pkg mode                    | Hardcoded `__dirname` that doesn't exist in pkg | `resolveAppPath` handles both modes       |
| Case sensitivity                       | Windows: `Bin` = `bin`; Linux: `Bin` ≠ `bin`    | Use exact case from config/filesystem     |

---

## How Anchors Work

**Dev mode** — `_configAnchor` is computed at load time via `__dirname`:
`Common/sources/ + ../../DocService = server/DocService/`.
`resolveAppPath` uses the `devRoot` passed by the caller.

**pkg mode** — both functions resolve from `process.cwd()`, which the launcher
sets to the service's installation directory:

| Service    | CWD (set by launcher) | `../Common/config` resolves to |
| ---------- | --------------------- | ------------------------------ |
| DocService | `server/DocService/`  | `server/Common/config/` ✓      |
| AdminPanel | `server/AdminPanel/`  | `server/Common/config/` ✓      |

Launchers that set CWD: systemd `WorkingDirectory=`, Python `run_process_in_dir()`.

Production configs typically use absolute paths (`/etc/onlyoffice/...`),
so `resolveConfigPath` passes them through unchanged.

---

## Known CWD-Dependent Paths

Some paths in DocService and FileConverter still rely on `CWD = server/DocService/`
and do not go through `resolveConfigPath`. They work because DocService is always
launched from that directory.

Key examples:

- `storage.fs.folderPath` → `../App_Data`
- `services.CoAuthoring.server.static_content[*].path` → `../../sdkjs`, `../../fonts`, etc.
- `FileConverter.converter.x2tPath` → `../FileConverter/Bin/x2t.exe`

> **Note**: `static_content` is an object keyed by URL prefix (`/fonts`, `/sdkjs`, etc.).
> The filesystem path is stored in `.path` inside each entry. When searching for
> CWD-dependent paths, look for `.path` inside `static_content` iteration — not a
> fixed config key.

**If you modify any of these paths or their consumers**, add `resolveConfigPath`
at the point of use to make them CWD-independent.

---

## Testing Checklist

When changing path-related code, verify:

- [ ] **DocService starts** — `node sources/server.js` from `server/DocService/`
- [ ] **AdminPanel starts** — via `run-develop.py` or with env vars set externally
- [ ] **Logs are written** — log4js config loaded (check first console line)
- [ ] **runtime.json** — read/written correctly (check for warnings)
- [ ] **License file** — read correctly (check `updateLicense` log line)
- [ ] **Static assets** — `/admin` serves the client build (open in browser)
- [ ] **Tests pass** — `npm test` from any CWD (not just `server/DocService/`)
