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
import Tabs from '../../../components/Tabs/Tabs';
import styles from './SigningTab.module.scss';

const CLOUD_PREFIX = 'FileConverter.converter.signing';
const META_PREFIX = `${CLOUD_PREFIX}.meta`;

const SIGNING_TABS = [
  {key: 'awsKms', label: 'AWS KMS'},
  {key: 'csc', label: 'CSC'},
  {key: 'local', label: 'Local'}
];

/** @param {string} prefix @param {Object} config @param {string} key @returns {string} */
const cfgVal = (prefix, config, key) => getNestedValue(config, `${prefix}.${key}`) || '';

const emptyAws = {endpoint: '', keyId: '', accessKeyId: '', secretAccessKey: ''};
const emptyCsc = {baseUrl: '', tokenUrl: '', credentialId: '', clientId: '', clientSecret: '', pin: ''};

const SigningTab = () => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const fileInputRef = useRef(null);

  // Signing mode tab
  const [signingMode, setSigningMode] = useState('awsKms');

  // Signature metadata
  const [meta, setMeta] = useState({reason: '', name: '', location: '', contactInfo: ''});
  const [savedMeta, setSavedMeta] = useState({reason: '', name: '', location: '', contactInfo: ''});

  // Certificate state (unified — P12 or PEM chain at signingKeyStorePath)
  const [certExists, setCertExists] = useState(false);
  const [certType, setCertType] = useState(null); // 'p12' | 'pem' | null
  const [certCount, setCertCount] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [savedPassphrase, setSavedPassphrase] = useState('');

  // Provider state
  const [aws, setAws] = useState({...emptyAws});
  const [csc, setCsc] = useState({...emptyCsc});

  // Saved key fields (to detect active provider)
  const [savedAwsKeyId, setSavedAwsKeyId] = useState('');
  const [savedCscBaseUrl, setSavedCscBaseUrl] = useState('');

  // UI
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const showSuccess = msg => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const activeProvider = savedAwsKeyId ? 'AWS KMS' : savedCscBaseUrl ? 'CSC' : null;
  const isCloudMode = signingMode !== 'local';

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

    // AWS KMS
    const a = {
      endpoint: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'endpoint'),
      keyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'keyId'),
      accessKeyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'accessKeyId'),
      secretAccessKey: cfgVal(`${CLOUD_PREFIX}.awsKms`, config, 'secretAccessKey')
    };
    setAws(a);
    setSavedAwsKeyId(a.keyId);

    // CSC
    const c = {
      baseUrl: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'baseUrl'),
      tokenUrl: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'tokenUrl'),
      credentialId: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'credentialId'),
      clientId: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'clientId'),
      clientSecret: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'clientSecret'),
      pin: cfgVal(`${CLOUD_PREFIX}.csc`, config, 'pin')
    };
    setCsc(c);
    setSavedCscBaseUrl(c.baseUrl);

    // Auto-select active tab
    if (a.keyId) setSigningMode('awsKms');
    else if (c.baseUrl) setSigningMode('csc');

    // Metadata
    const m = {
      reason: cfgVal(META_PREFIX, config, 'reason'),
      name: cfgVal(META_PREFIX, config, 'name'),
      location: cfgVal(META_PREFIX, config, 'location'),
      contactInfo: cfgVal(META_PREFIX, config, 'contactInfo')
    };
    setMeta(m);
    setSavedMeta(m);
  }, [config]);

  // ─── Metadata save ─────────────────────────────────────────────────────────

  const metaChanged =
    meta.reason !== savedMeta.reason ||
    meta.name !== savedMeta.name ||
    meta.location !== savedMeta.location ||
    meta.contactInfo !== savedMeta.contactInfo;

  const handleMetaSave = async () => {
    try {
      setError(null);
      await dispatch(
        saveConfig(
          mergeNestedObjects([
            {
              [`${META_PREFIX}.reason`]: meta.reason,
              [`${META_PREFIX}.name`]: meta.name,
              [`${META_PREFIX}.location`]: meta.location,
              [`${META_PREFIX}.contactInfo`]: meta.contactInfo
            }
          ])
        )
      ).unwrap();
      setSavedMeta({...meta});
      showSuccess('Signature metadata saved');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  // ─── Unified save ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      setError(null);

      if (signingMode === 'awsKms' && aws.keyId) {
        await dispatch(saveConfig(mergeNestedObjects([{[`${CLOUD_PREFIX}.awsKms`]: aws}]))).unwrap();
        setSavedAwsKeyId(aws.keyId);
        if (savedCscBaseUrl) {
          await dispatch(resetConfig([`${CLOUD_PREFIX}.csc`])).unwrap();
          setCsc({...emptyCsc});
          setSavedCscBaseUrl('');
        }
      } else if (signingMode === 'csc' && csc.baseUrl) {
        await dispatch(saveConfig(mergeNestedObjects([{[`${CLOUD_PREFIX}.csc`]: csc}]))).unwrap();
        setSavedCscBaseUrl(csc.baseUrl);
        if (savedAwsKeyId) {
          await dispatch(resetConfig([`${CLOUD_PREFIX}.awsKms`])).unwrap();
          setAws({...emptyAws});
          setSavedAwsKeyId('');
        }
      }

      if (selectedFile) {
        const result = await uploadSigningCertificate(selectedFile, passphrase);
        setCertType(result?.type || null);
        setCertCount(result?.certCount || null);
        setCertExists(true);
      }

      if (signingMode === 'local') {
        const ppChanged = passphrase !== savedPassphrase;
        if (passphrase) {
          await dispatch(
            saveConfig(mergeNestedObjects([{'FileConverter.converter.spawnOptions': {env: {SIGNING_KEYSTORE_PASSPHRASE: passphrase}}}]))
          ).unwrap();
        } else if (ppChanged) {
          await dispatch(resetConfig(['FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE'])).unwrap();
        }
        setSavedPassphrase(passphrase);
      }

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSuccess('Settings saved');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Remove certificate, clear passphrase and cloud signing settings?')) return;
    try {
      setError(null);
      if (certExists) await deleteSigningCertificate();
      const keysToReset = [];
      if (savedPassphrase) keysToReset.push('FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE');
      if (savedAwsKeyId) keysToReset.push(`${CLOUD_PREFIX}.awsKms`);
      if (savedCscBaseUrl) keysToReset.push(`${CLOUD_PREFIX}.csc`);
      if (keysToReset.length) await dispatch(resetConfig(keysToReset)).unwrap();
      setCertExists(false);
      setCertType(null);
      setCertCount(null);
      setSelectedFile(null);
      setPassphrase('');
      setSavedPassphrase('');
      setAws({...emptyAws});
      setCsc({...emptyCsc});
      setSavedAwsKeyId('');
      setSavedCscBaseUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSuccess('Signing settings cleared');
    } catch (err) {
      setError(err.message || 'Failed to clear');
    }
  };

  // ─── Certificate Handlers ─────────────────────────────────────────────────

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

  // ─── Render helpers ───────────────────────────────────────────────────────

  const awsField = field => ({value: aws[field], onChange: v => setAws(prev => ({...prev, [field]: v}))});
  const cscField = field => ({value: csc[field], onChange: v => setCsc(prev => ({...prev, [field]: v}))});
  const metaField = field => ({value: meta[field], onChange: v => setMeta(prev => ({...prev, [field]: v}))});

  const certStatusLabel = () => {
    if (!certExists) return 'No certificate';
    if (certType === 'pem') return `PEM chain (${certCount || '?'} cert${certCount !== 1 ? 's' : ''})`;
    if (certType === 'p12') return 'P12/PFX (local signing)';
    return 'Installed';
  };

  const saveDisabled = (() => {
    if (selectedFile) return false;
    switch (signingMode) {
      case 'awsKms':
        return !aws.keyId;
      case 'csc':
        return !csc.baseUrl;
      case 'local':
        return passphrase === savedPassphrase;
      default:
        return true;
    }
  })();

  const hasAnySaved = certExists || !!savedAwsKeyId || !!savedCscBaseUrl;

  return (
    <>
      {/* ── PDF Signing ────────────────────────────────────────────── */}
      <Section title='PDF Signing'>
        <div className='form-row'>
          <div className='certificate-status'>
            <span className='certificate-label'>Signing Method:</span>
            <span className={activeProvider ? 'certificate-installed' : 'certificate-not-installed'}>{activeProvider || 'Local'}</span>
          </div>
          <div className='certificate-status'>
            <span className='certificate-label'>Certificate Status:</span>
            {certExists ? (
              <span className='certificate-installed'>{certStatusLabel()}</span>
            ) : (
              <span className='certificate-not-installed'>No certificate</span>
            )}
          </div>
        </div>

        <Tabs tabs={SIGNING_TABS} activeTab={signingMode} onTabChange={setSigningMode}>
          {signingMode === 'awsKms' && (
            <>
              <Input label='Key ID' {...awsField('keyId')} placeholder='arn:aws:kms:...' description='Asymmetric RSA key ARN or ID.' />
              <Input
                label='Access Key ID'
                {...awsField('accessKeyId')}
                placeholder='Default credential chain'
                description='Optional. Not required when running on AWS with IAM role.'
              />
              <PasswordInput
                label='Secret Access Key'
                {...awsField('secretAccessKey')}
                placeholder='Default credential chain'
                description='Optional. Uses the default credential chain when empty.'
              />
              <div className={styles.fieldWithSpacing}>
                <Input
                  label='Endpoint'
                  {...awsField('endpoint')}
                  placeholder='https://kms.eu-west-1.amazonaws.com'
                  description='Optional. KMS-compatible endpoint URL. Empty = default AWS.'
                />
              </div>
            </>
          )}
          {signingMode === 'csc' && (
            <>
              <Input
                label='Base URL'
                {...cscField('baseUrl')}
                placeholder='https://csc.example.com/csc/v2'
                description='CSC API base URL (ETSI TS 119 432).'
              />
              <Input
                label='Token URL'
                {...cscField('tokenUrl')}
                placeholder='https://csc.example.com/oauth2/token'
                description='OAuth2 token endpoint.'
              />
              <Input
                label='Credential ID'
                {...cscField('credentialId')}
                placeholder='credential-id'
                description='Signing credential ID at the CSC provider.'
              />
              <Input label='Client ID' {...cscField('clientId')} placeholder='client-id' description='OAuth2 client ID.' />
              <PasswordInput label='Client Secret' {...cscField('clientSecret')} placeholder='client-secret' description='OAuth2 client secret.' />
              <div className={styles.fieldWithSpacing}>
                <PasswordInput
                  label='PIN'
                  {...cscField('pin')}
                  placeholder='Optional'
                  description='Optional. User PIN for credential authorization.'
                />
              </div>
            </>
          )}
          {signingMode === 'local' && (
            <Note type='note'>
              Local signing uses a PKCS#12 (.p12/.pfx) certificate for PDF form signing via x2t. Upload a P12 certificate below and set a passphrase
              if needed.
            </Note>
          )}
        </Tabs>

        {/* ── Certificate upload ──────────────────────────────────── */}
        {isCloudMode && <Note type='note'>Upload a PEM file with the certificate chain (leaf + intermediates concatenated).</Note>}

        <input ref={fileInputRef} type='file' accept='.p12,.pfx,.pem,.crt,.cer' onChange={handleFileSelect} style={{display: 'none'}} />
        <div className={styles.fileInputRow}>
          <Input label='Certificate File' value={selectedFile ? selectedFile.name : ''} onChange={() => {}} placeholder='No file selected' readOnly />
          <Button onClick={() => fileInputRef.current?.click()} disableResult>
            Browse
          </Button>
        </div>

        {signingMode === 'local' && (
          <div className='form-row'>
            <PasswordInput label='Passphrase' value={passphrase} onChange={setPassphrase} placeholder='Leave empty if not encrypted' />
          </div>
        )}

        <div className='form-row'>
          <div className='actions-section'>
            <Button onClick={handleSave} disabled={saveDisabled}>
              Save
            </Button>
            {hasAnySaved && (
              <Button onClick={handleReset} className='delete-button'>
                Reset
              </Button>
            )}
          </div>
        </div>
      </Section>

      <hr className={styles.sectionDivider} />

      {/* ── Signature Metadata ─────────────────────────────────────── */}
      <Section title='Signature Metadata' description='Fields embedded in the PDF digital signature.'>
        <Input label='Reason' {...metaField('reason')} placeholder='e.g. Signed after form completion' />
        <Input label='Name' {...metaField('name')} placeholder='e.g. Document Signing Service' />
        <Input label='Location' {...metaField('location')} placeholder='e.g. Online' />
        <div className={styles.fieldWithSpacing}>
          <Input label='Contact Info' {...metaField('contactInfo')} placeholder='e.g. https://example.com' />
        </div>
        <div className='form-row'>
          <div className='actions-section'>
            <Button onClick={handleMetaSave} disabled={!metaChanged}>
              Save
            </Button>
          </div>
        </div>
      </Section>

      {error && <div className='message-error'>{error}</div>}
      {successMessage && <div className='message-success'>{successMessage}</div>}
    </>
  );
};

export default SigningTab;
