import {useState, useEffect, useRef, useCallback} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {uploadSigningCertificate, deleteSigningCertificate, getSigningCertificateStatus} from '../../../api';
import {saveConfig, resetConfig, selectConfig} from '../../../store/slices/configSlice';
import {getNestedValue} from '../../../utils/getNestedValue';
import {mergeNestedObjects} from '../../../utils/mergeNestedObjects';
import Button from '../../../components/Button/Button';
import Input from '../../../components/Input/Input';
import Section from '../../../components/Section/Section';
import PasswordInput from '../../../components/PasswordInput/PasswordInput';
import Note from '../../../components/Note/Note';
import styles from './SigningTab.module.scss';

const CLOUD_PREFIX = 'FileConverter.converter.signing';

/** @param {string} prefix @param {Object} config @param {string} key @returns {string} */
const cfgVal = (prefix, config, key) => getNestedValue(config, `${prefix}.${key}`) || '';

const SigningTab = () => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const fileInputRef = useRef(null);

  // Certificate state (unified — P12 or PEM chain at signingKeyStorePath)
  const [certExists, setCertExists] = useState(false);
  const [certType, setCertType] = useState(null); // 'p12' | 'pem' | null
  const [certCount, setCertCount] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [savedPassphrase, setSavedPassphrase] = useState('');

  // AWS KMS
  const [aws, setAws] = useState({endpoint: '', keyId: '', accessKeyId: '', secretAccessKey: ''});
  const [savedAwsKeyId, setSavedAwsKeyId] = useState('');

  // UI
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const showSuccess = msg => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const activeProvider = savedAwsKeyId ? 'awsKms' : null;

  // ─── Load status & config ─────────────────────────────────────────────────

  const checkCertStatus = useCallback(async () => {
    try {
      const status = await getSigningCertificateStatus();
      setCertExists(status.exists);
      setCertType(status.type || null);
      setCertCount(status.certCount || null);
    } catch (err) {
      console.error('Status check failed:', err);
    }
  }, []);

  useEffect(() => {
    checkCertStatus();
  }, [checkCertStatus]);

  useEffect(() => {
    if (!config) return;
    const pp = getNestedValue(config, 'FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE') || '';
    setPassphrase(pp);
    setSavedPassphrase(pp);

    const a = {
      endpoint: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'endpoint'),
      keyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'keyId'),
      accessKeyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'accessKeyId'),
      secretAccessKey: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'secretAccessKey')
    };
    setAws(a);
    setSavedAwsKeyId(a.keyId);
  }, [config]);

  // ─── Provider save/disable ────────────────────────────────────────────────

  /** @param {string} subKey @param {Object} values @param {Function} setSavedFn @param {string} activeValue */
  const handleProviderSave = async (subKey, values, setSavedFn, activeValue) => {
    try {
      setError(null);
      await dispatch(saveConfig(mergeNestedObjects([{[`${CLOUD_PREFIX}.${subKey}`]: values}]))).unwrap();
      setSavedFn(activeValue);
      showSuccess(`${subKey} settings saved`);
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  /** @param {string} subKey @param {Function} resetStateFn @param {Function} setSavedFn @param {string} label */
  const handleProviderDisable = async (subKey, resetStateFn, setSavedFn, label) => {
    if (!window.confirm(`Clear ${label} settings?`)) return;
    try {
      setError(null);
      await dispatch(resetConfig([`${CLOUD_PREFIX}.${subKey}`])).unwrap();
      resetStateFn();
      setSavedFn('');
      showSuccess(`${label} settings cleared`);
    } catch (err) {
      setError(err.message || 'Failed to clear');
    }
  };

  // ─── Certificate Handlers (unified P12 or PEM) ────────────────────────────

  /** @param {Event} e */
  const handleFileSelect = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(p12|pfx|pem|crt|cer)$/i.test(file.name)) {
      setError('Accepted: .p12, .pfx, .pem, .crt, .cer');
      setSelectedFile(null);
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const handleCertSave = async () => {
    try {
      setError(null);
      let uploaded = false;
      if (selectedFile) {
        const result = await uploadSigningCertificate(selectedFile, passphrase);
        uploaded = true;
        setCertType(result?.type || null);
        setCertCount(result?.certCount || null);
      }
      const ppChanged = passphrase !== savedPassphrase;
      if (passphrase) {
        await dispatch(
          saveConfig(mergeNestedObjects([{'FileConverter.converter.spawnOptions': {env: {SIGNING_KEYSTORE_PASSPHRASE: passphrase}}}]))
        ).unwrap();
      } else if (ppChanged) {
        await dispatch(resetConfig(['FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE'])).unwrap();
      }
      if (uploaded) setCertExists(true);
      setSavedPassphrase(passphrase);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSuccess(uploaded ? 'Certificate uploaded' : 'Passphrase saved');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  const handleCertRemove = async () => {
    if (!certExists) return;
    if (!window.confirm('Remove the signing certificate and clear passphrase?')) return;
    try {
      setError(null);
      await deleteSigningCertificate();
      if (savedPassphrase) await dispatch(resetConfig(['FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE'])).unwrap();
      setCertExists(false);
      setCertType(null);
      setCertCount(null);
      setSelectedFile(null);
      setPassphrase('');
      setSavedPassphrase('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSuccess('Certificate removed');
    } catch (err) {
      setError(err.message || 'Failed to remove');
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  /** @param {string} field */
  const awsField = field => ({value: aws[field], onChange: v => setAws(prev => ({...prev, [field]: v}))});

  /** @returns {string} */
  const certStatusLabel = () => {
    if (!certExists) return 'No certificate';
    if (certType === 'pem') return `PEM chain (${certCount || '?'} cert${certCount !== 1 ? 's' : ''})`;
    if (certType === 'p12') return 'P12/PFX (local signing)';
    return 'Installed';
  };

  return (
    <>
      {/* ── Cloud Signing ──────────────────────────────────────────── */}
      <Section title='Cloud PDF Signing' description='Sign PDFs using a cloud KMS provider. Configure one provider below.'>
        <Note type='note'>
          {activeProvider
            ? 'Cloud signing active via AWS KMS. Upload a PEM certificate chain (leaf + intermediates) in the certificate section below.'
            : 'No cloud provider configured. Set an AWS KMS Key ID to enable.'}
        </Note>

        <div className={styles.providerSection}>
          {activeProvider ? (
            <span className={styles.statusBadge + ' ' + styles.statusEnabled}>Active: {activeProvider}</span>
          ) : (
            <span className={styles.statusBadge + ' ' + styles.statusDisabled}>Disabled</span>
          )}
        </div>

        {/* AWS KMS */}
        <h4 className={styles.providerTitle}>AWS KMS</h4>
        <div className={styles.providerSettings}>
          <Input label='Key ID' {...awsField('keyId')} placeholder='arn:aws:kms:...' description='Asymmetric RSA key ARN or ID.' />
          <Input label='Access Key ID' {...awsField('accessKeyId')} placeholder='Default credential chain' />
          <PasswordInput label='Secret Access Key' {...awsField('secretAccessKey')} placeholder='Default credential chain' />
          <Input
            label='Endpoint'
            {...awsField('endpoint')}
            placeholder='https://kms.eu-west-1.amazonaws.com'
            description='KMS-compatible endpoint URL. Empty = default AWS.'
          />
        </div>
        <div className='form-row'>
          <div className='actions-section'>
            <Button onClick={() => handleProviderSave('awsKms', aws, setSavedAwsKeyId, aws.keyId)} disabled={!aws.keyId && !savedAwsKeyId}>
              Save
            </Button>
            {!!savedAwsKeyId && (
              <Button
                onClick={() =>
                  handleProviderDisable(
                    'awsKms',
                    () => setAws({endpoint: '', keyId: '', accessKeyId: '', secretAccessKey: ''}),
                    setSavedAwsKeyId,
                    'AWS KMS'
                  )
                }
                className='delete-button'
              >
                Disable
              </Button>
            )}
          </div>
        </div>
      </Section>

      <hr className={styles.sectionDivider} />

      {/* ── Signing Certificate (unified) ──────────────────────────── */}
      <Section title='Signing Certificate' description='P12/PFX for local signing or PEM chain (leaf + intermediates) for cloud signing'>
        <Note type='note'>
          {activeProvider
            ? 'Cloud signing is active. Upload a PEM file with the certificate chain (leaf + intermediates concatenated).'
            : 'Upload a PKCS#12 (.p12/.pfx) certificate for local PDF form signing via x2t.'}
        </Note>

        <div className='form-row'>
          <div className='certificate-status'>
            <span className='certificate-label'>Certificate Status:</span>
            {certExists ? (
              <span className='certificate-installed'>{certStatusLabel()}</span>
            ) : (
              <span className='certificate-not-installed'>No certificate</span>
            )}
          </div>
        </div>

        <div className='form-row'>
          <input ref={fileInputRef} type='file' accept='.p12,.pfx,.pem,.crt,.cer' onChange={handleFileSelect} style={{display: 'none'}} />
          <div className='file-input-row'>
            <Input
              label='Certificate File'
              value={selectedFile ? selectedFile.name : ''}
              onChange={() => {}}
              placeholder='No file selected'
              readOnly
            />
            <Button onClick={() => fileInputRef.current?.click()} disableResult>
              Browse
            </Button>
          </div>
        </div>

        {!activeProvider && (
          <div className='form-row'>
            <PasswordInput
              label='Passphrase'
              value={passphrase}
              onChange={setPassphrase}
              placeholder='Leave empty if not encrypted'
              description='Passphrase for PKCS#12 certificate. Not needed for PEM.'
            />
          </div>
        )}

        <div className='form-row'>
          <div className='actions-section'>
            <Button onClick={handleCertSave} disabled={!selectedFile && passphrase === savedPassphrase}>
              Save
            </Button>
            {certExists && (
              <Button onClick={handleCertRemove} className='delete-button'>
                Remove
              </Button>
            )}
          </div>
        </div>
      </Section>

      {error && <div className='message-error'>{error}</div>}
      {successMessage && <div className='message-success'>{successMessage}</div>}
    </>
  );
};

export default SigningTab;
