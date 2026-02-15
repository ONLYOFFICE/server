import {useState, useEffect, useCallback, useRef} from 'react';
import Button from '../../../components/Button/Button';
import Input from '../../../components/Input/Input';
import Section from '../../../components/Section/Section';
import Note from '../../../components/Note/Note';
import {getLicenseInfo, uploadLicense, revertLicense, validateLicense} from '../../../api/license';
import styles from './LicenseTab.module.scss';

// Package type constants (mirrors Common/sources/constants.js)
const PACKAGE_TYPE_OS = 0;
const PACKAGE_TYPE_I = 1;
const PACKAGE_TYPE_D = 2;

const CRITICAL_COLOR = '#ff0000';

function mapPackageType(packageType) {
  switch (packageType) {
    case PACKAGE_TYPE_OS:
      return 'Open source';
    case PACKAGE_TYPE_I:
      return 'Enterprise Edition';
    case PACKAGE_TYPE_D:
      return 'Developer Edition';
    default:
      return 'Unknown';
  }
}

function mapLicenseMode(mode) {
  if (mode & 1) return 'Trial';
  if (mode & 2) return 'Developer';
  if (mode & 4) return 'Limited';
  return 'Production';
}

const ACTIVATION_DOCS = [
  {label: 'Linux', url: 'https://helpcenter.onlyoffice.com/docs/installation/docs-enterprise-install-ubuntu.aspx'},
  {label: 'Windows', url: 'https://helpcenter.onlyoffice.com/docs/installation/docs-enterprise-install-windows.aspx'},
  {label: 'Docker', url: 'https://helpcenter.onlyoffice.com/docs/installation/docs-enterprise-install-docker.aspx'},
  {label: 'Kubernetes-Docs', url: 'https://github.com/ONLYOFFICE/Kubernetes-Docs?tab=readme-ov-file#1-deploy-the-onlyoffice-docs-license'},
  {
    label: 'Kubernetes-Docs-Shards',
    url: 'https://github.com/ONLYOFFICE/Kubernetes-Docs-Shards?tab=readme-ov-file#1-deploy-the-onlyoffice-docs-license'
  }
];

const BUY_LINKS = {
  [PACKAGE_TYPE_I]: 'https://www.onlyoffice.com/docs-enterprise-prices',
  [PACKAGE_TYPE_D]: 'https://www.onlyoffice.com/developer-edition-prices'
};

/**
 * Renders Dashboard-style info blocks for license data.
 * @param {Object} data - License data with raw fields (type, mode, startDate, endDate, etc.)
 * @param {Object} [options]
 * @param {boolean} [options.preview] - If true, hide the Build block (used for file validation preview)
 * @returns {JSX.Element}
 */
const renderInfoBlocks = (data, {preview} = {}) => {
  const mode = data.mode || 0;
  const isLimited = mode & 1 || mode & 4;
  const endDate = data.endDate ? new Date(data.endDate) : null;
  const startDate = data.startDate ? new Date(data.startDate) : null;
  const now = new Date();
  const licType = data.type;

  const isInvalid = licType === 2 || licType === 1 || licType === 6 || licType === 11;
  const isUpdateUnavailable = !isLimited && endDate && data.buildDate && new Date(data.buildDate) > endDate;
  const licValidText = isLimited ? 'Valid: ' : 'Updates available: ';
  const licValidColor = isInvalid || isUpdateUnavailable ? CRITICAL_COLOR : undefined;
  const isStartCritical = licType === 16 || (startDate && startDate > now);
  const trialText = mode & 1 ? 'Trial' : '';

  const isUsersModel = data.usersCount > 0;
  const limitEdit = isUsersModel ? data.usersCount : data.connections;
  const limitView = isUsersModel ? data.usersViewCount : data.connectionsView;
  const limitTitle = isUsersModel ? 'Users limit' : 'Connections limit';

  const buildDate = data.buildDate ? new Date(data.buildDate).toLocaleDateString() : '';

  return (
    <div className={styles.infoBlocks}>
      {!preview && (
        <div className={styles.infoBlock}>
          <div className={styles.infoBlockTitle}>Build</div>
          <div className={styles.infoBlockContent}>
            <div>Type: {mapPackageType(data.packageType)}</div>
            <div>Mode: {mapLicenseMode(mode)}</div>
            {buildDate && <div>Release date: {buildDate}</div>}
          </div>
        </div>
      )}

      <div className={styles.infoBlock}>
        <div className={styles.infoBlockTitle}>License</div>
        <div className={styles.infoBlockContent}>
          {!endDate ? (
            <div>No license</div>
          ) : (
            <>
              {startDate && (
                <div>
                  <span>Start date: </span>
                  <span style={isStartCritical ? {color: CRITICAL_COLOR} : undefined}>{startDate.toLocaleDateString()}</span>
                </div>
              )}
              <div>
                <span>{licValidText}</span>
                <span style={licValidColor ? {color: licValidColor} : undefined}>{endDate.toLocaleDateString()}</span>
              </div>
              {trialText && <div>{trialText}</div>}
            </>
          )}
        </div>
      </div>

      <div className={styles.infoBlock}>
        <div className={styles.infoBlockTitle}>{limitTitle}</div>
        <div className={styles.infoBlockContent}>
          <div>Editors: {limitEdit}</div>
          <div>Live Viewer: {limitView}</div>
        </div>
      </div>
    </div>
  );
};

const LicenseTab = () => {
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [licenseData, setLicenseData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const loadLicenseInfo = useCallback(async () => {
    try {
      const data = await getLicenseInfo();
      setLicenseData(data);
    } catch (err) {
      console.error('Failed to load license info:', err);
      setLicenseData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLicenseInfo();
  }, [loadLicenseInfo]);

  const showSuccess = message => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 5000);
  };

  /**
   * Process a selected or dropped file: validate and show preview
   * @param {File} file - License file to process
   */
  const processFile = async file => {
    setError(null);
    setSuccess(null);
    setSelectedFile(file);
    setPreviewData(null);
    setValidating(true);
    try {
      const data = await validateLicense(file);
      setPreviewData(data);
    } catch (err) {
      setError(err.message || 'Failed to validate license file');
    } finally {
      setValidating(false);
    }
  };

  const handleFileSelect = event => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handleBrowseClick = () => fileInputRef.current?.click();

  // Drag & Drop handlers
  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDragEnter = e => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const handleDragLeave = e => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (!window.confirm('Replace current license with the uploaded file?')) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await uploadLicense(selectedFile);
      setLicenseData(data);
      setSelectedFile(null);
      setPreviewData(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSuccess('License updated successfully');
    } catch (err) {
      setError(err.message || 'Failed to upload license');
    } finally {
      setUploading(false);
    }
  };

  const handleRevert = async () => {
    if (!window.confirm('Revert to the previous license?')) return;
    setReverting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await revertLicense();
      setLicenseData(data);
      showSuccess('License reverted to previous version');
    } catch (err) {
      setError(err.message || 'Failed to revert license');
    } finally {
      setReverting(false);
    }
  };

  /**
   * Render upload form with drag & drop zone and Browse button
   * @returns {JSX.Element}
   */
  const renderUploadForm = () => {
    const disabled = uploading || reverting;
    const formClass = [styles.formSection, dragActive ? styles.formSectionDragActive : ''].filter(Boolean).join(' ');

    return (
      <div
        className={formClass}
        onDragEnter={disabled ? handleDragOver : handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={disabled ? handleDragOver : handleDrop}
      >
        <input ref={fileInputRef} type='file' accept='.lic,.json' onChange={handleFileSelect} style={{display: 'none'}} />

        <div className={styles.fileInputRow}>
          <Input value={selectedFile ? selectedFile.name : ''} onChange={() => {}} placeholder='No file selected' readOnly label='License File' />
          <Button onClick={handleBrowseClick} disableResult disabled={disabled}>
            Browse
          </Button>
        </div>

        {validating && (
          <div className={styles.statusRow}>
            <span className={styles.statusLoading}>Validating license file...</span>
          </div>
        )}

        {previewData && (
          <div className={styles.previewSection}>
            <div className={styles.previewHeader}>Selected file info:</div>
            {renderInfoBlocks(previewData, {preview: true})}
            {!previewData.valid && <div className={styles.messageError}>This license file is invalid or expired and cannot be applied.</div>}
          </div>
        )}

        <div className={styles.actions}>
          <Button onClick={handleUpload} disabled={!selectedFile || disabled || validating || (previewData && !previewData.valid)}>
            {uploading ? 'Uploading...' : 'Apply License'}
          </Button>
        </div>

        {error && (
          <Note type='warning'>
            {error}
            <ul>
              {ACTIVATION_DOCS.map(doc => (
                <li key={doc.label}>
                  <a href={doc.url} target='_blank' rel='noopener noreferrer'>
                    {doc.label}
                  </a>
                </li>
              ))}
            </ul>
          </Note>
        )}
        {success && <div className={styles.messageSuccess}>{success}</div>}
      </div>
    );
  };

  if (loading) {
    return (
      <Section title='License' description='Product license information'>
        <div className={styles.statusLoading}>Loading...</div>
      </Section>
    );
  }

  if (!licenseData) {
    return (
      <Section title='License' description='Product license information'>
        <div className={styles.statusError}>Failed to load license information</div>
      </Section>
    );
  }

  const buildType = licenseData.buildPackageType ?? PACKAGE_TYPE_OS;
  const isOpenSource = buildType === PACKAGE_TYPE_OS;

  // Branch 1: Open Source — read-only stub, no upload
  if (isOpenSource) {
    return (
      <Section title='License' description='Product license information'>
        <Note type='note'>
          You are using Community Edition (open-source). A license file is not applicable for this edition. To enable advanced features, install{' '}
          <a href={BUY_LINKS[PACKAGE_TYPE_D]} target='_blank' rel='noopener noreferrer'>
            Developer
          </a>
          {' or '}
          <a href={BUY_LINKS[PACKAGE_TYPE_I]} target='_blank' rel='noopener noreferrer'>
            Enterprise
          </a>{' '}
          Edition.
        </Note>
        {renderInfoBlocks(licenseData)}
      </Section>
    );
  }

  const editionLabel = buildType === PACKAGE_TYPE_D ? 'Developer Edition' : 'Enterprise Edition';
  const buyUrl = BUY_LINKS[buildType];

  return (
    <Section title='License' description='Upload and manage your product license'>
      {renderInfoBlocks(licenseData)}

      {!licenseData.hasLicense && buyUrl && (
        <Note type='note'>
          You are using {editionLabel} without an active license. Purchase a license to unlock full features.
          <div style={{marginTop: 8}}>
            <Button onClick={() => window.open(buyUrl, '_blank')}>Buy Now</Button>
          </div>
        </Note>
      )}

      {licenseData.hasBackup && licenseData.backupInfo && (
        <Note type={licenseData.backupInfo.valid ? 'note' : 'warning'} title='Backup license available'>
          {renderInfoBlocks(licenseData.backupInfo, {preview: true})}
          {licenseData.backupInfo.valid ? (
            <Button onClick={handleRevert} disabled={reverting}>
              {reverting ? 'Reverting...' : 'Revert to Previous'}
            </Button>
          ) : (
            <div>Backup license is invalid or expired. Revert is not available.</div>
          )}
        </Note>
      )}

      {renderUploadForm()}
    </Section>
  );
};

export default LicenseTab;
