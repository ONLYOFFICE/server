import {useState, useEffect, useCallback, useRef} from 'react';
import Button from '../../../components/Button/Button';
import Input from '../../../components/Input/Input';
import Section from '../../../components/Section/Section';
import Note from '../../../components/Note/Note';
import Checkbox from '../../../components/Checkbox/Checkbox';
import Spinner from '../../../components/Spinner/Spinner';
import {getFontsStatus, getFontsList, uploadFonts, deleteFont, applyFontsChanges, getFontsApplyStatus} from '../../../api/fonts';
import styles from './FontsTab.module.scss';

// Documentation links for manual fonts configuration
const FONTS_DOCS = {
  linux: 'https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-fonts-linux.aspx',
  windows: 'https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-fonts-windows.aspx',
  kubernetes: 'https://github.com/ONLYOFFICE/Kubernetes-Docs-Shards?tab=readme-ov-file#6-add-custom-fonts'
};

// Supported font file extensions
const FONT_EXTENSIONS = '.ttf,.tte,.otf,.otc,.ttc,.woff,.woff2';

const POLL_INTERVAL_MS = 2000;

const FontsTab = () => {
  // Status state
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fonts list state
  const [fonts, setFonts] = useState([]);
  const [filter, setFilter] = useState('');
  const [showCustomOnly, setShowCustomOnly] = useState(false);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

  // Pending deletions state
  const [pendingDeletions, setPendingDeletions] = useState(new Set());

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState(null);

  // Messages
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Load status and fonts
  const loadData = useCallback(async () => {
    try {
      const [statusData, fontsData] = await Promise.all([getFontsStatus(), getFontsList()]);

      setStatus(statusData);
      setFonts(fontsData.fonts || []);
      setGenerating(statusData.isGenerating);

      if (statusData.isGenerating) {
        setGenerationStatus(statusData.generationStatus);
      }
    } catch (err) {
      if (err.message !== 'UNAUTHORIZED') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll generation status while generating
  useEffect(() => {
    if (!generating) return;

    const pollStatus = async () => {
      try {
        const genStatus = await getFontsApplyStatus();
        setGenerationStatus(genStatus);

        if (genStatus.status === 'completed' || genStatus.status === 'failed') {
          setGenerating(false);
          if (genStatus.status === 'completed') {
            setSuccess('Font cache regenerated successfully.');
          } else {
            setError(`Font generation failed: ${genStatus.error || 'Unknown error'}`);
          }
          // Reload fonts list
          loadData();
        }
      } catch {
        // Ignore polling errors
      }
    };

    const interval = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [generating, loadData]);

  // Add files to selection (shared by browse and drag&drop)
  const addFiles = files => {
    if (files.length === 0) return;
    const allowedExts = FONT_EXTENSIONS.split(',');
    const filtered = files.filter(f => allowedExts.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (filtered.length === 0) return;

    setSelectedFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      const newFiles = filtered.filter(f => !existingNames.has(f.name));
      return [...prev, ...newFiles];
    });
    setError(null);
  };

  // File selection via browse
  const handleFileSelect = event => {
    addFiles(Array.from(event.target.files || []));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  // Drag & drop handlers
  const handleDragEnter = e => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  };

  const handleDragLeave = e => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  };

  const handleDragOver = e => {
    e.preventDefault();
  };

  const handleDrop = e => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (uploading || generating) return;
    addFiles(Array.from(e.dataTransfer.files || []));
  };

  const handleRemoveFile = fileName => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleClearFiles = () => {
    setSelectedFiles([]);
  };

  // Pending deletion handlers
  const handleMarkForDeletion = fontName => {
    setPendingDeletions(prev => new Set([...prev, fontName]));
  };

  const handleUndoDeletion = fontName => {
    setPendingDeletions(prev => {
      const next = new Set(prev);
      next.delete(fontName);
      return next;
    });
  };

  const handleDeleteAllCustom = () => {
    const customFontNames = fonts.filter(f => f.source === 'custom').map(f => f.name);
    if (customFontNames.length === 0) return;
    setPendingDeletions(new Set(customFontNames));
  };

  // Check if there are pending changes
  const hasPendingChanges = selectedFiles.length > 0 || pendingDeletions.size > 0;
  const customFontsCount = fonts.filter(f => f.source === 'custom').length;

  // Apply pending changes (if any) and regenerate font cache
  const handleRegenerate = async () => {
    const parts = [];
    if (selectedFiles.length > 0) parts.push(`upload ${selectedFiles.length} font(s)`);
    if (pendingDeletions.size > 0) parts.push(`delete ${pendingDeletions.size} font(s)`);

    const confirmMsg = hasPendingChanges ? `Apply changes (${parts.join(', ')}) and regenerate font cache?` : 'Generate font cache?';

    if (
      !window.confirm(
        confirmMsg + '\n\nAll Document Server nodes need to be restarted to pick up the changes.\n\n' + 'This process may take 1-5 minutes. Continue?'
      )
    ) {
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const errors = [];

    try {
      // Phase 1: Upload new fonts
      if (selectedFiles.length > 0) {
        const result = await uploadFonts(selectedFiles);
        if (result.failed.length > 0) {
          const failedNames = result.failed.map(f => `${f.filename}: ${f.error}`).join('; ');
          errors.push(`Failed to upload: ${failedNames}`);
        }
      }

      // Phase 2: Delete pending fonts
      // Collect unique filenames first — multiple styles/fonts may share the same physical file (e.g. TTC collections)
      if (pendingDeletions.size > 0) {
        const deleteErrors = [];
        const filesToDelete = new Set();
        for (const fontName of pendingDeletions) {
          const font = fonts.find(f => f.name === fontName);
          if (!font || !font.files) continue;

          for (const file of font.files) {
            const filename = file.path.split('/').pop().split('\\').pop();
            filesToDelete.add(filename);
          }
        }
        for (const filename of filesToDelete) {
          try {
            await deleteFont(filename);
          } catch (err) {
            if (err.message !== 'Font file not found') {
              deleteErrors.push(`${filename}: ${err.message}`);
            }
          }
        }
        if (deleteErrors.length > 0) {
          errors.push(`Failed to delete: ${deleteErrors.join('; ')}`);
        }
      }

      // Phase 3: Generate font cache (always)
      const applyResult = await applyFontsChanges();
      setGenerating(true);
      setGenerationStatus({status: 'running', progress: 'Starting...', jobId: applyResult.jobId});

      // Clear pending state
      setSelectedFiles([]);
      setPendingDeletions(new Set());

      if (errors.length > 0) {
        setError(errors.join('\n'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Filter fonts
  const filteredFonts = fonts.filter(font => {
    if (showCustomOnly && font.source !== 'custom') return false;
    if (filter && !font.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  // Format file size
  const formatSize = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <Section title='Font Management' description='Manage custom fonts for Document Server'>
        <div className={styles.loading}>Loading...</div>
      </Section>
    );
  }

  if (!status?.available) {
    return (
      <Section title='Font Management' description='Configure custom fonts manually'>
        <Note type='note'>
          Automatic font management via Admin Panel is not available for this installation. Please follow the manual configuration instructions for
          your platform:
          <ul>
            <li>
              <a href={FONTS_DOCS.linux} target='_blank' rel='noopener noreferrer'>
                Linux installation guide
              </a>
            </li>
            <li>
              <a href={FONTS_DOCS.windows} target='_blank' rel='noopener noreferrer'>
                Windows installation guide
              </a>
            </li>
            <li>
              <a href={FONTS_DOCS.kubernetes} target='_blank' rel='noopener noreferrer'>
                Kubernetes configuration
              </a>
            </li>
          </ul>
        </Note>
      </Section>
    );
  }

  return (
    <Section title='Font Management' description='Upload and manage custom fonts for Document Server'>
      {/* Status Section */}
      <div className={styles.statusSection}>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>Total Fonts:</span>
          <span className={styles.statusValue}>
            {status.totalFontsCount} ({status.totalFilesCount} files)
          </span>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>Custom Fonts:</span>
          <span className={styles.statusValue}>
            {status.customFontsCount} ({status.customFilesCount} files)
          </span>
        </div>
      </div>

      {/* Generation Progress */}
      {generating && generationStatus && (
        <div className={styles.generationProgress}>
          <div className={styles.progressHeader}>
            <Spinner size={20} />
            <span className={styles.progressTitle}>Generating Font Cache...</span>
          </div>
          <div className={styles.progressStatus}>{generationStatus.progress || 'Processing...'}</div>
        </div>
      )}

      {/* Upload Section */}
      <div
        className={`${styles.uploadSection} ${dragging ? styles.uploadSectionDragging : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Note type='note'>
          Upload font files (TTF, TTE, OTF, OTC, TTC, WOFF, WOFF2) to add custom fonts. You can also drag and drop files here. Document Server must be
          restarted to use the new fonts.
        </Note>

        <input ref={fileInputRef} type='file' accept={FONT_EXTENSIONS} multiple onChange={handleFileSelect} style={{display: 'none'}} />

        <div className={styles.fileInputRow}>
          <Input
            label='Select Font Files'
            value={selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : ''}
            readOnly
            placeholder='No files selected'
          />
          <Button onClick={handleBrowseClick} disableResult disabled={uploading || generating}>
            Browse
          </Button>
        </div>

        {selectedFiles.length > 0 && (
          <div className={styles.selectedFiles}>
            {selectedFiles.map(file => (
              <div key={file.name} className={styles.selectedFile}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatSize(file.size)}</span>
                <button className={styles.removeFile} onClick={() => handleRemoveFile(file.name)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {hasPendingChanges && (
          <div className={styles.pendingSummary}>
            {[
              selectedFiles.length > 0 && `${selectedFiles.length} font(s) to upload`,
              pendingDeletions.size > 0 && `${pendingDeletions.size} font(s) to delete`
            ]
              .filter(Boolean)
              .join(', ')}
          </div>
        )}

        <div className={styles.uploadActions}>
          <Button onClick={handleRegenerate} disabled={uploading || generating}>
            {uploading ? 'Applying...' : 'Generate'}
          </Button>
          {selectedFiles.length > 0 && (
            <Button onClick={handleClearFiles} disableResult disabled={uploading}>
              Clear
            </Button>
          )}
        </div>

        {error && <div className={styles.messageError}>{error}</div>}
        {success && <div className={styles.messageSuccess}>{success}</div>}
      </div>

      {/* Fonts Table */}
      <div className={styles.tableSection}>
        <div className={styles.tableControls}>
          <div className={styles.filterInput}>
            <Input label='Filter by name' value={filter} onChange={setFilter} placeholder='Search fonts...' />
          </div>
          <div className={styles.sourceFilter}>
            <Checkbox label='Show custom only' checked={showCustomOnly} onChange={setShowCustomOnly} />
          </div>
          {customFontsCount > 0 && (
            <Checkbox
              label='Mark all custom for deletion'
              checked={pendingDeletions.size >= customFontsCount}
              onChange={checked => {
                if (checked) {
                  handleDeleteAllCustom();
                } else {
                  setPendingDeletions(new Set());
                }
              }}
              disabled={uploading || generating}
            />
          )}
        </div>

        {filteredFonts.length === 0 ? (
          <div className={styles.emptyState}>{filter || showCustomOnly ? 'No fonts match the filter' : 'No fonts available'}</div>
        ) : (
          <table className={styles.fontsTable}>
            <thead>
              <tr>
                <th>Font Name</th>
                <th>Source</th>
                <th title='Regular'>Regular</th>
                <th title='Bold'>Bold</th>
                <th title='Italic'>Italic</th>
                <th title='Bold Italic'>Bold&amp;Italic</th>
              </tr>
            </thead>
            <tbody>
              {filteredFonts.map(font => {
                const isPendingDelete = pendingDeletions.has(font.name);
                return (
                  <tr key={font.name} className={isPendingDelete ? styles.pendingDeleteRow : undefined}>
                    <td className={styles.fontName}>
                      {font.source === 'custom' &&
                        (isPendingDelete ? (
                          <button className={styles.undoDelete} onClick={() => handleUndoDeletion(font.name)} title='Undo delete'>
                            ↩
                          </button>
                        ) : (
                          <button
                            className={styles.deleteFont}
                            onClick={() => handleMarkForDeletion(font.name)}
                            disabled={uploading || generating}
                            title='Mark for deletion'
                          >
                            ×
                          </button>
                        ))}
                      {font.name}
                    </td>
                    <td>
                      <span className={`${styles.fontSource} ${font.source === 'custom' ? styles.sourceCustom : styles.sourceSystem}`}>
                        {font.source}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.styleIndicator} ${font.hasRegular ? styles.styleYes : styles.styleNo}`}>
                        {font.hasRegular ? '✓' : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.styleIndicator} ${font.hasBold ? styles.styleYes : styles.styleNo}`}>
                        {font.hasBold ? '✓' : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.styleIndicator} ${font.hasItalic ? styles.styleYes : styles.styleNo}`}>
                        {font.hasItalic ? '✓' : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.styleIndicator} ${font.hasBoldItalic ? styles.styleYes : styles.styleNo}`}>
                        {font.hasBoldItalic ? '✓' : '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
};

export default FontsTab;
