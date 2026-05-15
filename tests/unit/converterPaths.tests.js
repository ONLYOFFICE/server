/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * Unit tests for FileConverter/sources/converterPaths.js.
 *
 * Key invariant: resolveConverterPath() must produce the same absolute path
 * regardless of process.cwd().  Embedded mode runs converter.js inside the
 * DocService process, which may have been started from any working directory.
 */

'use strict';

const {describe, beforeEach, afterEach, test, expect, jest: jestGlobals} = require('@jest/globals');
const path = require('path');

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || path.join(__dirname, '..', '..', 'Common', 'config');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIR_DOCSERVICE = path.join(REPO_ROOT, 'DocService');
const DIR_FILECONVERTER = path.join(REPO_ROOT, 'FileConverter');

const {resolveConverterPath, FC_DEFAULT_BASE} = require('../../FileConverter/sources/converterPaths');

describe('converterPaths.FC_DEFAULT_BASE', () => {
  test('is the FileConverter package directory, not process.cwd()', () => {
    expect(FC_DEFAULT_BASE).toBe(path.resolve(REPO_ROOT, 'FileConverter'));
    expect(FC_DEFAULT_BASE).not.toBe(process.cwd());
  });
});

describe('resolveConverterPath - falsy / null sentinel', () => {
  test('empty string returns empty string', () => {
    expect(resolveConverterPath('')).toBe('');
  });

  test('null returns empty string', () => {
    expect(resolveConverterPath(null)).toBe('');
  });

  test('undefined returns empty string', () => {
    expect(resolveConverterPath(undefined)).toBe('');
  });

  test('literal "null" string (default.json sentinel) returns empty string', () => {
    expect(resolveConverterPath('null')).toBe('');
  });
});

describe('resolveConverterPath - absolute paths pass through', () => {
  const absPath =
    process.platform === 'win32' ? 'C:\\Program Files\\onlyoffice\\bin\\x2t.exe' : '/var/www/onlyoffice/documentserver/server/FileConverter/bin/x2t';

  test('absolute path is returned unchanged', () => {
    expect(resolveConverterPath(absPath)).toBe(absPath);
  });
});

describe('resolveConverterPath - relative paths anchored to FileConverter/', () => {
  const ORIGINAL_CWD = process.cwd();

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
  });

  const cases = [
    ['repository root', REPO_ROOT],
    ['DocService', DIR_DOCSERVICE],
    ['FileConverter', DIR_FILECONVERTER]
  ];

  test.each(cases)('bin/x2t resolves identically when cwd = %s', (_label, cwd) => {
    const expected = path.join(FC_DEFAULT_BASE, 'bin', 'x2t');
    process.chdir(cwd);
    expect(resolveConverterPath('bin/x2t')).toBe(expected);
  });

  test.each(cases)('bin/docbuilder resolves identically when cwd = %s', (_label, cwd) => {
    const expected = path.join(FC_DEFAULT_BASE, 'bin', 'docbuilder');
    process.chdir(cwd);
    expect(resolveConverterPath('bin/docbuilder')).toBe(expected);
  });

  test.each(cases)('nested relative path resolves identically when cwd = %s', (_label, cwd) => {
    const expected = path.join(FC_DEFAULT_BASE, 'fonts', 'truetype');
    process.chdir(cwd);
    expect(resolveConverterPath('fonts/truetype')).toBe(expected);
  });
});

describe('converterPaths - pkg packaged executable', () => {
  // FC_DEFAULT_BASE is evaluated at module-load time, so each test re-requires
  // the module after patching process.pkg / process.execPath.
  let savedPkg;
  let savedExecPath;

  beforeEach(() => {
    savedPkg = process.pkg;
    savedExecPath = process.execPath;
    jestGlobals.resetModules();
  });

  afterEach(() => {
    if (savedPkg === undefined) delete process.pkg;
    else process.pkg = savedPkg;
    process.execPath = savedExecPath;
  });

  const installRoot = process.platform === 'win32' ? 'C:\\onlyoffice\\server' : '/opt/onlyoffice/server';

  test('DocService executable: FC_DEFAULT_BASE resolves to sibling FileConverter/', () => {
    process.pkg = {};
    process.execPath = path.join(installRoot, 'DocService', process.platform === 'win32' ? 'docservice.exe' : 'docservice');

    const {FC_DEFAULT_BASE: base} = require('../../FileConverter/sources/converterPaths');
    expect(base).toBe(path.join(installRoot, 'FileConverter'));
  });

  test('FileConverter converter executable: FC_DEFAULT_BASE resolves to sibling FileConverter/', () => {
    process.pkg = {};
    process.execPath = path.join(installRoot, 'FileConverter', process.platform === 'win32' ? 'converter.exe' : 'converter');

    const {FC_DEFAULT_BASE: base} = require('../../FileConverter/sources/converterPaths');
    expect(base).toBe(path.join(installRoot, 'FileConverter'));
  });

  test('both pkg executable locations produce the same FC_DEFAULT_BASE', () => {
    process.pkg = {};
    process.execPath = path.join(installRoot, 'DocService', process.platform === 'win32' ? 'docservice.exe' : 'docservice');
    const {FC_DEFAULT_BASE: fromDocService} = require('../../FileConverter/sources/converterPaths');

    jestGlobals.resetModules();
    process.execPath = path.join(installRoot, 'FileConverter', process.platform === 'win32' ? 'converter.exe' : 'converter');
    const {FC_DEFAULT_BASE: fromConverter} = require('../../FileConverter/sources/converterPaths');

    expect(fromDocService).toBe(fromConverter);
  });

  test('relative path resolved against pkg FC_DEFAULT_BASE', () => {
    process.pkg = {};
    process.execPath = path.join(installRoot, 'DocService', process.platform === 'win32' ? 'docservice.exe' : 'docservice');

    const {resolveConverterPath: resolve, FC_DEFAULT_BASE: base} = require('../../FileConverter/sources/converterPaths');
    expect(resolve('bin/x2t')).toBe(path.join(base, 'bin', 'x2t'));
  });
});
