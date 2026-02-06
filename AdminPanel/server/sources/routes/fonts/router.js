'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const crypto = require('crypto');
const tenantManager = require('../../../../../Common/sources/tenantManager');
const {validateJWT} = require('../../middleware/auth');
const fontService = require('./fontService');

const router = express.Router();

// Generation configuration
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let currentGeneration = null;

// Script search configuration (production mode - like letsencrypt)
const SCRIPT_NAME = 'documentserver-generate-allfonts';
const SCRIPT_SEARCH_PATHS = ['/usr/bin', path.resolve(process.cwd(), '../../bin')];
const SCRIPT_EXTENSIONS = ['.sh', '.ps1', '.bat'];

// Development mode: direct allfontsgen.exe path and arguments
const DEV_ALLFONTSGEN_PATH = path.resolve(process.cwd(), '../FileConverter/bin/allfontsgen.exe');
const DEV_ALLFONTSGEN_ARGS = [
  '--input=../../../core-fonts',
  '--input=../../../server/custom-fonts',
  '--allfonts-web=../../../sdkjs/common/AllFonts.js',
  '--allfonts=./AllFonts.js',
  '--images=../../../sdkjs/common/Images',
  '--selection=./font_selection.bin',
  '--use-system=true',
  '--output-web=../../../fonts'
];

/**
 * Check if running in development mode
 */
function isDevelopmentMode() {
  return process.env.NODE_ENV && process.env.NODE_ENV.startsWith('development-');
}

/**
 * Find generate-allfonts script in known locations (production mode)
 * @returns {string|null} Script path or null if not found
 */
function findGenerateScript() {
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
 * Get generator configuration based on environment
 * @returns {{available: boolean, path?: string, args?: string[], cwd?: string}}
 */
function getGeneratorConfig() {
  if (isDevelopmentMode()) {
    if (fs.existsSync(DEV_ALLFONTSGEN_PATH)) {
      return {
        available: true,
        path: DEV_ALLFONTSGEN_PATH,
        args: DEV_ALLFONTSGEN_ARGS,
        cwd: path.dirname(DEV_ALLFONTSGEN_PATH)
      };
    }
    return {available: false};
  }

  // Production mode
  const scriptPath = findGenerateScript();
  if (scriptPath) {
    return {
      available: true,
      path: scriptPath,
      args: [],
      cwd: path.dirname(scriptPath)
    };
  }
  return {available: false};
}

/**
 * Get spawn arguments for script execution
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

  // For .sh, .bat, .exe and others - run directly
  return {
    command: scriptPath,
    args
  };
}
router.use(cookieParser());
router.use(express.json());

// Raw file parser for binary uploads (same pattern as signing-certificate)
const rawFileParser = bodyParser.raw({
  inflate: true,
  limit: fontService.MAX_FONT_FILE_SIZE,
  type() {
    return true;
  }
});

/**
 * Check admin-only access
 */
function requireAdmin(ctx, res) {
  if (tenantManager.isMultitenantMode(ctx) && !tenantManager.isDefaultTenant(ctx)) {
    res.status(403).json({error: 'Only admin can manage fonts'});
    return false;
  }
  return true;
}

/**
 * Get current generation status
 */
function getGenerationStatus() {
  if (!currentGeneration) {
    return {status: 'idle'};
  }
  return {
    jobId: currentGeneration.jobId,
    status: currentGeneration.status,
    startedAt: currentGeneration.startedAt,
    completedAt: currentGeneration.completedAt,
    error: currentGeneration.error
  };
}

/**
 * Run font generator process
 * @param {Object} ctx - Request context with logger
 * @param {Object} config - Generator config from getGeneratorConfig()
 */
function runGenerator(ctx, config) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    let done = false;

    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(() => {
      ac.abort();
      finish(new Error('Font generation timed out after 10 minutes'));
    }, GENERATION_TIMEOUT_MS);

    const {command, args} = getSpawnArgs(config.path, config.args);

    ctx.logger.debug('Spawning: %s %s (cwd: %s)', command, args.join(' '), config.cwd);

    const proc = spawn(command, args, {
      signal: ac.signal,
      cwd: config.cwd,
      windowsHide: true
    });

    proc.stdout.on('data', data => {
      ctx.logger.info('allfontsgen: %s', data.toString().trim());
    });

    proc.stderr.on('data', data => {
      ctx.logger.warn('allfontsgen stderr: %s', data.toString().trim());
    });

    proc.on('error', err => {
      if (err.name === 'AbortError') {
        finish(new Error('Font generation timed out after 10 minutes'));
      } else {
        finish(new Error(`Failed to start generator: ${err.message}`));
      }
    });

    proc.on('close', (code, signal) => {
      if (signal) {
        finish(new Error(`Process killed by ${signal}`));
      } else if (code === 0) {
        finish(null);
      } else {
        finish(new Error(`Font generation failed with exit code ${code}`));
      }
    });
  });
}

/**
 * GET /status
 * Check feature availability and current status
 */
router.get('/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const status = fontService.getStatus();
    const generatorConfig = getGeneratorConfig();
    const generatorStatus = getGenerationStatus();

    res.json({
      ...status,
      available: generatorConfig.available,
      generatorPath: generatorConfig.path || null,
      isGenerating: generatorStatus.status === 'running',
      generationStatus: generatorStatus
    });
  } catch (error) {
    ctx.logger.error('Font status check error: %s', error.stack);
    res.status(500).json({error: 'Failed to check font status'});
  }
});

/**
 * GET /
 * Get list of all fonts
 */
router.get('/', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const {filter, source} = req.query;
    let {fonts} = fontService.parseAllFonts();

    // Filter by name
    if (filter) {
      const filterLower = filter.toLowerCase();
      fonts = fonts.filter(f => f.name.toLowerCase().includes(filterLower));
    }

    // Filter by source
    if (source && source !== 'all') {
      fonts = fonts.filter(f => f.source === source);
    }

    const customCount = fonts.filter(f => f.source === 'custom').length;

    res.json({
      fonts,
      total: fonts.length,
      customCount
    });
  } catch (error) {
    ctx.logger.error('Font list error: %s', error.stack);
    res.status(500).json({error: 'Failed to get font list'});
  }
});

/**
 * POST /upload
 * Upload a single font file
 * Uses rawFileParser (same pattern as signing-certificate)
 * Filename passed via X-Filename header
 */
router.post('/upload', validateJWT, rawFileParser, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    // Get filename from header
    let filename = req.headers['x-filename'];
    if (!filename) {
      return res.status(400).json({error: 'X-Filename header is required'});
    }

    // Decode URI-encoded filename
    try {
      filename = decodeURIComponent(filename);
    } catch {
      // Use as-is if decode fails
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({error: 'No file uploaded'});
    }

    ctx.logger.info('Font upload started: %s (%d bytes)', filename, req.body.length);

    // Validate font file
    const validation = fontService.validateFontFile(req.body, filename);

    if (!validation.valid) {
      ctx.logger.warn('Font validation failed: %s - %s', filename, validation.error);
      return res.status(400).json({
        error: 'Invalid font file',
        message: validation.error
      });
    }

    // Save the file
    const saveResult = fontService.saveFontFile(req.body, filename);

    if (!saveResult.success) {
      return res.status(500).json({error: saveResult.error});
    }

    ctx.logger.info('Font uploaded: %s -> %s', filename, saveResult.filename);

    res.json({
      success: true,
      filename: saveResult.filename,
      originalName: filename,
      size: req.body.length,
      type: validation.type,
      overwritten: saveResult.overwritten
    });
  } catch (error) {
    ctx.logger.error('Font upload error: %s', error.stack);
    res.status(500).json({error: 'Failed to upload font'});
  }
});

/**
 * DELETE /:filename
 * Delete a custom font file
 */
router.delete('/:filename', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    const filename = req.params.filename;
    if (!filename) {
      return res.status(400).json({error: 'Filename is required'});
    }

    ctx.logger.info('Font delete requested: %s', filename);

    const result = fontService.deleteFontFile(filename);

    if (!result.success) {
      return res.status(404).json({error: result.error});
    }

    ctx.logger.info('Font deleted: %s', result.filename);

    res.json({
      success: true,
      filename: result.filename
    });
  } catch (error) {
    ctx.logger.error('Font delete error: %s', error.stack);
    res.status(500).json({error: 'Failed to delete font'});
  }
});

/**
 * POST /apply
 * Start font generation
 */
router.post('/apply', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    if (currentGeneration && currentGeneration.status === 'running') {
      return res.status(409).json({
        error: 'Generation in progress',
        message: 'Font generation is already running. Please wait for it to complete.'
      });
    }

    const generatorConfig = getGeneratorConfig();
    if (!generatorConfig.available) {
      return res.status(400).json({
        error: 'Generator not available',
        message: 'Font generator is not available on this installation'
      });
    }

    const jobId = crypto.randomUUID();

    currentGeneration = {
      jobId,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    };

    ctx.logger.info('Font generation started: jobId=%s, generator=%s', jobId, generatorConfig.path);

    // Start generation (don't await - return immediately)
    runGenerator(ctx, generatorConfig)
      .then(() => {
        currentGeneration.status = 'completed';
        currentGeneration.completedAt = new Date().toISOString();
        ctx.logger.info('Font generation completed: jobId=%s', jobId);

        // Cleanup orphaned custom font files (duplicates of system fonts)
        try {
          const cleanup = fontService.cleanupOrphanedFiles();
          if (cleanup.removed.length > 0) {
            ctx.logger.info('Cleaned up %d orphaned custom font file(s): %s', cleanup.removed.length, cleanup.removed.join(', '));
          }
        } catch (cleanupErr) {
          ctx.logger.warn('Font cleanup failed: %s', cleanupErr.message);
        }
      })
      .catch(err => {
        currentGeneration.status = 'failed';
        currentGeneration.completedAt = new Date().toISOString();
        currentGeneration.error = err.message;
        ctx.logger.error('Font generation failed: jobId=%s, error=%s', jobId, err.message);
      });

    res.json({
      jobId,
      status: 'running',
      message: 'Font generation started. This may take 1-5 minutes.'
    });
  } catch (error) {
    ctx.logger.error('Font apply error: %s', error.stack);
    res.status(500).json({error: 'Failed to start font generation'});
  }
});

/**
 * GET /apply/status
 * Get current generation status
 */
router.get('/apply/status', validateJWT, async (req, res) => {
  const ctx = req.ctx;
  try {
    if (!requireAdmin(ctx, res)) return;

    res.json(getGenerationStatus());
  } catch (error) {
    ctx.logger.error('Font apply status error: %s', error.stack);
    res.status(500).json({error: 'Failed to get generation status'});
  }
});

module.exports = router;
