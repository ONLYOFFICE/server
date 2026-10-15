const {describe, test, expect, beforeEach, jest} = require('@jest/globals');

const MOD_PATH = '../../Common/sources/documentFormats';

let mod, readFile, ctx;

beforeEach(() => {
  jest.resetModules();
  readFile = jest.fn();
  jest.doMock('fs/promises', () => ({readFile}));
  mod = require(MOD_PATH);
  ctx = {logger: {warn: jest.fn()}};
});

const SAMPLE = JSON.stringify([
  {name: 'docx', type: 'word', actions: ['view', 'edit']},
  {name: 'odt', type: 'word', actions: ['view', 'lossy-edit']},
  {name: 'txt', type: 'word', actions: ['view']},
  {name: 'pdf', type: 'pdf', actions: ['view', 'fill']},
  {name: 'xlsx', type: 'cell', actions: ['view', 'edit']},
  {name: 'broken'}
]);

describe('getAllFormats', () => {
  test('groups formats by category from a valid array', async () => {
    readFile.mockResolvedValue(SAMPLE);
    const formats = await mod.getAllFormats(ctx, '/x/formats.json');
    expect(formats.wordEdit).toEqual(['docx', 'odt']);
    expect(formats.wordView).toEqual(['txt']);
    expect(formats.pdfView).toEqual(['pdf']);
    expect(formats.forms).toEqual(['pdf']);
    expect(formats.cellEdit).toEqual(['xlsx']);
    expect(formats.slideEdit).toEqual([]);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test('caches the parsed result and reads the file once', async () => {
    readFile.mockResolvedValue(JSON.stringify([{name: 'docx', type: 'word', actions: ['edit']}]));
    await mod.getAllFormats(ctx, '/a.json');
    await mod.getAllFormats(ctx, '/a.json');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  test('returns empty categories and warns when path is not configured', async () => {
    const formats = await mod.getAllFormats(ctx, '');
    expect(formats.wordEdit).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
  });

  test('does not cache read failures and retries until the file is available', async () => {
    readFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));
    let formats = await mod.getAllFormats(ctx, '/missing.json');
    expect(formats.wordEdit).toEqual([]);
    readFile.mockResolvedValueOnce(JSON.stringify([{name: 'docx', type: 'word', actions: ['edit']}]));
    formats = await mod.getAllFormats(ctx, '/missing.json');
    expect(formats.wordEdit).toEqual(['docx']);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  test('returns empty categories when JSON is not an array', async () => {
    readFile.mockResolvedValue(JSON.stringify({not: 'an array'}));
    const formats = await mod.getAllFormats(ctx, '/obj.json');
    expect(formats.wordEdit).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
  });
});
