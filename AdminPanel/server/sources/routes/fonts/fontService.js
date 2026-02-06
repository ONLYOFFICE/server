'use strict';

const config = require('config');
const path = require('path');
const fs = require('fs');

// Font file magic bytes signatures
const FONT_SIGNATURES = {
  TTF: Buffer.from([0x00, 0x01, 0x00, 0x00]), // TrueType (.ttf, .tte)
  OTF: Buffer.from([0x4f, 0x54, 0x54, 0x4f]), // OpenType (OTTO) (.otf, .otc)
  TTC: Buffer.from([0x74, 0x74, 0x63, 0x66]), // TrueType Collection (ttcf) (.ttc)
  WOFF: Buffer.from([0x77, 0x4f, 0x46, 0x46]), // Web Open Font Format (wOFF)
  WOFF2: Buffer.from([0x77, 0x4f, 0x46, 0x32]) // Web Open Font Format 2 (wOF2)
};

const ALLOWED_EXTENSIONS = ['.ttf', '.tte', '.otf', '.otc', '.ttc', '.woff', '.woff2'];
const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

/**
 * Get the custom fonts directory path
 * Located next to signingKeyStorePath in the Data folder
 */
function getCustomFontsDir() {
  const signingPath = config.get('runtimeConfig.filePath');
  const dataDir = path.dirname(signingPath);
  return path.join(dataDir, 'custom-fonts');
}

/**
 * Get AllFonts.js path
 */
function getAllFontsJsPath() {
  const x2tPath = config.get('FileConverter.converter.x2tPath');
  const binDir = path.dirname(x2tPath);
  return path.join(binDir, 'AllFonts.js');
}

/**
 * Validate font file by checking magic bytes
 * @param {Buffer} buffer - File content buffer
 * @param {string} filename - Original filename
 * @returns {{valid: boolean, error?: string, type?: string}}
 */
function validateFontFile(buffer, filename) {
  if (!buffer || buffer.length < 4) {
    return {valid: false, error: 'File too small to be a valid font'};
  }

  if (buffer.length > MAX_FONT_FILE_SIZE) {
    return {valid: false, error: `File exceeds maximum size of ${MAX_FONT_FILE_SIZE / 1024 / 1024}MB`};
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {valid: false, error: `Invalid extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`};
  }

  const header = buffer.subarray(0, 4);

  const isTTF = header.equals(FONT_SIGNATURES.TTF);
  const isOTF = header.equals(FONT_SIGNATURES.OTF);
  const isTTC = header.equals(FONT_SIGNATURES.TTC);
  const isWOFF = header.equals(FONT_SIGNATURES.WOFF);
  const isWOFF2 = header.equals(FONT_SIGNATURES.WOFF2);

  if (!isTTF && !isOTF && !isTTC && !isWOFF && !isWOFF2) {
    return {valid: false, error: 'Invalid font file signature. File may be corrupted or not a valid font.'};
  }

  // Validate extension matches content
  if ((ext === '.ttf' || ext === '.tte') && !isTTF && !isTTC) {
    return {valid: false, error: `File extension ${ext} does not match actual font format`};
  }
  if ((ext === '.otf' || ext === '.otc') && !isOTF && !isTTC) {
    return {valid: false, error: `File extension ${ext} does not match actual font format`};
  }
  if (ext === '.ttc' && !isTTC) {
    return {valid: false, error: 'File extension .ttc does not match actual font format'};
  }
  if (ext === '.woff' && !isWOFF) {
    return {valid: false, error: 'File extension .woff does not match actual font format'};
  }
  if (ext === '.woff2' && !isWOFF2) {
    return {valid: false, error: 'File extension .woff2 does not match actual font format'};
  }

  let type = 'TTF';
  if (isOTF) type = 'OTF';
  if (isTTC) type = 'TTC';
  if (isWOFF) type = 'WOFF';
  if (isWOFF2) type = 'WOFF2';

  return {valid: true, type};
}

/**
 * Sanitize filename for safe storage
 */
function sanitizeFilename(filename) {
  // Remove path components, keep only filename
  const basename = path.basename(filename);
  // Replace potentially dangerous characters
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Parse AllFonts.js to extract font information
 * @returns {{fonts: Array<Object>, filesCount: number, customFilesCount: number}}
 */
function parseAllFonts() {
  const empty = {fonts: [], filesCount: 0, customFilesCount: 0};
  const allFontsPath = getAllFontsJsPath();

  if (!fs.existsSync(allFontsPath)) {
    return empty;
  }

  try {
    const content = fs.readFileSync(allFontsPath, 'utf8');

    // Extract __fonts_files array
    const filesMatch = content.match(/window\["__fonts_files"\]\s*=\s*\[([\s\S]*?)\];/);
    let fontFiles = [];
    if (filesMatch) {
      try {
        // Clean up the array content and parse
        const filesContent = filesMatch[1].trim();
        fontFiles = JSON.parse(`[${filesContent}]`);
      } catch {
        fontFiles = [];
      }
    }

    // Extract __fonts_infos array
    // Format: [fontName, indexR, faceIndexR, indexI, faceIndexI, indexB, faceIndexB, indexBI, faceIndexBI]
    const infosMatch = content.match(/window\["__fonts_infos"\]\s*=\s*\[([\s\S]*?)\];/);
    if (!infosMatch) {
      return empty;
    }

    const infosContent = infosMatch[1].trim();
    let fontInfos;
    try {
      fontInfos = JSON.parse(`[${infosContent}]`);
    } catch {
      return empty;
    }

    // Get custom fonts directory name for path matching
    const customFontsDir = getCustomFontsDir();
    const customDirName = path.basename(customFontsDir); // 'custom-fonts'

    const fonts = fontInfos.map(info => {
      const name = info[0];
      const hasRegular = info[1] !== -1;
      const hasItalic = info[3] !== -1;
      const hasBold = info[5] !== -1;
      const hasBoldItalic = info[7] !== -1;

      // Get file paths for each style
      const files = [];
      if (hasRegular && fontFiles[info[1]]) {
        files.push({style: 'Regular', path: fontFiles[info[1]], faceIndex: info[2]});
      }
      if (hasItalic && fontFiles[info[3]]) {
        files.push({style: 'Italic', path: fontFiles[info[3]], faceIndex: info[4]});
      }
      if (hasBold && fontFiles[info[5]]) {
        files.push({style: 'Bold', path: fontFiles[info[5]], faceIndex: info[6]});
      }
      if (hasBoldItalic && fontFiles[info[7]]) {
        files.push({style: 'BoldItalic', path: fontFiles[info[7]], faceIndex: info[8]});
      }

      // Determine source by checking if any file path contains custom-fonts directory
      const isCustom = files.some(f => f.path && f.path.includes(customDirName));

      return {
        name,
        hasRegular,
        hasItalic,
        hasBold,
        hasBoldItalic,
        source: isCustom ? 'custom' : 'system',
        files
      };
    });

    const customFilesCount = fontFiles.filter(f => f.includes(customDirName)).length;

    return {fonts, filesCount: fontFiles.length, customFilesCount};
  } catch {
    return empty;
  }
}

/**
 * Save uploaded font file
 * @param {Buffer} buffer - File content
 * @param {string} filename - Original filename
 * @returns {{success: boolean, error?: string, savedPath?: string}}
 */
function saveFontFile(buffer, filename) {
  const fontsDir = getCustomFontsDir();

  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, {recursive: true});
  }

  const sanitized = sanitizeFilename(filename);
  const targetPath = path.join(fontsDir, sanitized);

  // Check if file already exists
  const exists = fs.existsSync(targetPath);

  fs.writeFileSync(targetPath, buffer);

  return {
    success: true,
    savedPath: targetPath,
    overwritten: exists,
    filename: sanitized
  };
}

/**
 * Delete a custom font file
 * @param {string} filename - Font filename to delete
 * @returns {{success: boolean, error?: string, filename?: string}}
 */
function deleteFontFile(filename) {
  const fontsDir = getCustomFontsDir();
  const sanitized = sanitizeFilename(filename);
  const targetPath = path.join(fontsDir, sanitized);

  if (!fs.existsSync(targetPath)) {
    return {success: false, error: 'Font file not found'};
  }

  fs.unlinkSync(targetPath);
  return {success: true, filename: sanitized};
}

/**
 * Cleanup orphaned files in custom-fonts directory.
 * After regeneration, files that aren't referenced by any custom font in AllFonts.js
 * are duplicates of system fonts and can be safely removed.
 * @returns {{removed: string[], kept: string[]}}
 */
function cleanupOrphanedFiles() {
  const fontsDir = getCustomFontsDir();

  if (!fs.existsSync(fontsDir)) {
    return {removed: [], kept: []};
  }

  // Get all files in custom-fonts directory
  const dirFiles = fs.readdirSync(fontsDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
  });

  if (dirFiles.length === 0) {
    return {removed: [], kept: []};
  }

  // Get all file paths referenced by custom fonts in AllFonts.js
  const {fonts} = parseAllFonts();
  const customDirName = path.basename(fontsDir);
  const referencedFiles = new Set();

  for (const font of fonts) {
    for (const file of font.files) {
      if (file.path && file.path.includes(customDirName)) {
        // Extract filename from path
        const filename = file.path.split('/').pop().split('\\').pop();
        referencedFiles.add(filename);
      }
    }
  }

  // Delete unreferenced files
  const removed = [];
  const kept = [];
  for (const file of dirFiles) {
    if (referencedFiles.has(file)) {
      kept.push(file);
    } else {
      const filePath = path.join(fontsDir, file);
      fs.unlinkSync(filePath);
      removed.push(file);
    }
  }

  return {removed, kept};
}

/**
 * Get status information (without generator availability - that's checked in router)
 * @returns {Object}
 */
function getStatus() {
  const allFontsPath = getAllFontsJsPath();
  const customFontsDir = getCustomFontsDir();

  const {fonts, filesCount, customFilesCount} = parseAllFonts();
  const customFontsCount = fonts.filter(f => f.source === 'custom').length;

  return {
    allFontsPath: fs.existsSync(allFontsPath) ? allFontsPath : null,
    customFontsDir,
    customFontsCount,
    customFilesCount,
    totalFontsCount: fonts.length,
    totalFilesCount: filesCount
  };
}

module.exports = {
  // Constants
  MAX_FONT_FILE_SIZE,
  ALLOWED_EXTENSIONS,

  // Path getters
  getCustomFontsDir,

  // Validation
  validateFontFile,

  // Font operations
  parseAllFonts,
  saveFontFile,

  // Font deletion
  deleteFontFile,

  // Cleanup
  cleanupOrphanedFiles,

  // Status
  getStatus
};
