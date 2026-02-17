import {useState, useEffect, useRef, useCallback} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {useQuery} from '@tanstack/react-query';
import {
  uploadSigningCertificate,
  deleteSigningCertificate,
  getSigningCertificateStatus,
  validateSigningConfig,
  fetchConfiguration
} from '../../../api';
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
const emptyCsc = {
  baseUrl: '',
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
  grantType: '',
  clientAuth: '',
  tokenBodyFormat: '',
  username: '',
  password: '',
  credentialId: '',
  clientData: '',
  scope: '',
  audience: ''
};

const SigningTab = () => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const fileInputRef = useRef(null);

  // Fetch full config with secrets (not redacted)
  const {data: fullConfig} = useQuery({
    queryKey: ['config', 'full'],
    queryFn: () => fetchConfiguration(true),
    staleTime: 30000
  });

  // Use full config for loading secrets, fallback to regular config
  const configWithSecrets = fullConfig || config;

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

  // UI — separate feedback for each section
  const [signingError, setSigningError] = useState(null);
  const [signingSuccess, setSigningSuccess] = useState(null);
  const [validating, setValidating] = useState(false);
  const [metaError, setMetaError] = useState(null);
  const [metaSuccess, setMetaSuccess] = useState(null);

  const showSigningSuccess = msg => {
    setSigningSuccess(msg);
    setTimeout(() => setSigningSuccess(null), 3000);
  };
  const showMetaSuccess = msg => {
    setMetaSuccess(msg);
    setTimeout(() => setMetaSuccess(null), 3000);
  };

  const activeProvider = savedAwsKeyId ? 'AWS KMS' : savedCscBaseUrl ? 'CSC' : null;
  const isCloudMode = signingMode !== 'local';

  // Reset other providers when switching tabs
  const handleTabChange = newMode => {
    setSigningMode(newMode);
    setSigningError(null);
    setSigningSuccess(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (newMode === 'awsKms') {
      setCsc({...emptyCsc});
      setPassphrase('');
    } else if (newMode === 'csc') {
      setAws({...emptyAws});
      setPassphrase('');
    } else if (newMode === 'local') {
      setAws({...emptyAws});
      setCsc({...emptyCsc});
    }
  };

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
    if (!fullConfig) return;
    const pp = getNestedValue(configWithSecrets, 'FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE') || '';
    setPassphrase(pp);
    setSavedPassphrase(pp);

    // AWS KMS
    const a = {
      endpoint: cfgVal(`${CLOUD_PREFIX}.awsKms`, configWithSecrets, 'endpoint'),
      keyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, configWithSecrets, 'keyId'),
      accessKeyId: cfgVal(`${CLOUD_PREFIX}.awsKms`, configWithSecrets, 'accessKeyId'),
      secretAccessKey: cfgVal(`${CLOUD_PREFIX}.awsKms`, configWithSecrets, 'secretAccessKey')
    };
    setAws(a);
    setSavedAwsKeyId(a.keyId);

    // CSC
    const c = {
      baseUrl: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'baseUrl'),
      tokenUrl: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'tokenUrl'),
      clientId: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'clientId'),
      clientSecret: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'clientSecret'),
      grantType: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'grantType'),
      clientAuth: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'clientAuth'),
      tokenBodyFormat: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'tokenBodyFormat'),
      username: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'username'),
      password: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'password'),
      credentialId: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'credentialId'),
      clientData: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'clientData'),
      scope: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'scope'),
      audience: cfgVal(`${CLOUD_PREFIX}.csc`, configWithSecrets, 'audience')
    };
    setCsc(c);
    setSavedCscBaseUrl(c.baseUrl);

    // Auto-select active tab
    if (a.keyId) setSigningMode('awsKms');
    else if (c.baseUrl) setSigningMode('csc');
  }, [configWithSecrets]);

  // Load metadata (non-sensitive, use regular config)
  useEffect(() => {
    if (!config) return;
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
      setMetaError(null);
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
      showMetaSuccess('Signature metadata saved');
    } catch (err) {
      setMetaError(err.message || 'Failed to save');
      throw err;
    }
  };

  // ─── Unified save ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      setSigningError(null);

      const keysToReset = [];

      if (signingMode === 'awsKms') {
        if (aws.keyId) {
          await dispatch(saveConfig(mergeNestedObjects([{[`${CLOUD_PREFIX}.awsKms`]: aws}]))).unwrap();
          setSavedAwsKeyId(aws.keyId);
        }
        if (savedCscBaseUrl) keysToReset.push(`${CLOUD_PREFIX}.csc`);
        setCsc({...emptyCsc});
        setSavedCscBaseUrl('');
        if (savedPassphrase) keysToReset.push('FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE');
        setPassphrase('');
        setSavedPassphrase('');
      } else if (signingMode === 'csc') {
        // Validate required fields
        if (!csc.baseUrl || !csc.tokenUrl || !csc.clientId || !csc.clientSecret) {
          setSigningError('Base URL, Token URL, Client ID, and Client Secret are required for CSC signing');
          return;
        }

        // Pre-save validation (OAuth token endpoint check)
        setValidating(true);
        try {
          const result = await validateSigningConfig('csc', csc);
          if (!result.valid) {
            setSigningError(`Validation failed: ${result.error}`);
            return;
          }
        } catch (err) {
          setSigningError(`Validation error: ${err.message}`);
          return;
        } finally {
          setValidating(false);
        }

        await dispatch(saveConfig(mergeNestedObjects([{[`${CLOUD_PREFIX}.csc`]: csc}]))).unwrap();
        setSavedCscBaseUrl(csc.baseUrl);
        if (savedAwsKeyId) keysToReset.push(`${CLOUD_PREFIX}.awsKms`);
        setAws({...emptyAws});
        setSavedAwsKeyId('');
        if (savedPassphrase) keysToReset.push('FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE');
        setPassphrase('');
        setSavedPassphrase('');
      } else if (signingMode === 'local') {
        const ppChanged = passphrase !== savedPassphrase;
        if (passphrase) {
          await dispatch(
            saveConfig(mergeNestedObjects([{'FileConverter.converter.spawnOptions': {env: {SIGNING_KEYSTORE_PASSPHRASE: passphrase}}}]))
          ).unwrap();
        } else if (ppChanged) {
          keysToReset.push('FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE');
        }
        setSavedPassphrase(passphrase);
        if (savedAwsKeyId) keysToReset.push(`${CLOUD_PREFIX}.awsKms`);
        setAws({...emptyAws});
        setSavedAwsKeyId('');
        if (savedCscBaseUrl) keysToReset.push(`${CLOUD_PREFIX}.csc`);
        setCsc({...emptyCsc});
        setSavedCscBaseUrl('');
      }

      if (keysToReset.length) await dispatch(resetConfig(keysToReset)).unwrap();

      if (selectedFile) {
        const result = await uploadSigningCertificate(selectedFile, passphrase);
        setCertType(result?.type || null);
        setCertCount(result?.certCount || null);
        setCertExists(true);
      }

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showSigningSuccess('Settings saved');
    } catch (err) {
      setSigningError(err.message || 'Failed to save');
      throw err;
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Remove certificate, clear passphrase and cloud signing settings?')) return;
    try {
      setSigningError(null);
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
      showSigningSuccess('Signing settings cleared');
    } catch (err) {
      setSigningError(err.message || 'Failed to clear');
      throw err;
    }
  };

  // ─── Certificate Handlers ─────────────────────────────────────────────────

  const handleFileSelect = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(p12|pfx|pem|crt|cer)$/i.test(file.name)) {
      setSigningError('Accepted: .p12, .pfx, .pem, .crt, .cer');
      setSelectedFile(null);
      return;
    }
    setSigningError(null);
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

        <Tabs tabs={SIGNING_TABS} activeTab={signingMode} onTabChange={handleTabChange}>
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
                label='Base URL *'
                {...cscField('baseUrl')}
                placeholder='https://csc.example.com/csc/v2'
                description='Required. CSC API base URL (ETSI TS 119 432).'
              />
              <Input
                label='Token URL *'
                {...cscField('tokenUrl')}
                placeholder='https://csc.example.com/oauth2/token'
                description='Required. OAuth2 token endpoint.'
              />
              <Input label='Client ID *' {...cscField('clientId')} placeholder='client-id' description='Required. OAuth2 client ID.' />
              <PasswordInput
                label='Client Secret *'
                {...cscField('clientSecret')}
                placeholder='client-secret'
                description='Required. OAuth2 client secret.'
              />
              <Input
                label='Credential ID'
                {...cscField('credentialId')}
                placeholder='credential-uuid-1234'
                description='Optional. Auto-discovered via credentials/list when empty.'
              />
              <Input
                label='Grant Type'
                {...cscField('grantType')}
                placeholder='client_credentials'
                description="Optional. Empty = auto-detect; or 'password', 'client_credentials'."
              />
              <Input
                label='Username'
                {...cscField('username')}
                placeholder='user@example.com'
                description='Optional. Username for password grant type.'
              />
              <PasswordInput
                label='Password'
                {...cscField('password')}
                placeholder='••••••••'
                description='Optional. Password for password grant type.'
              />
              <Input label='Scope' {...cscField('scope')} placeholder='service' description='Optional. OAuth2 scope.' />
              <Input
                label='Client Auth'
                {...cscField('clientAuth')}
                placeholder='body'
                description="Optional. Empty = body; or 'basic', 'body', 'both'."
              />
              <Input
                label='Token Body Format'
                {...cscField('tokenBodyFormat')}
                placeholder='form'
                description="Optional. Empty = form (RFC 6749); or 'form', 'json'."
              />
              <Input
                label='Client Data'
                {...cscField('clientData')}
                placeholder='{"type":"eSeal"}'
                description='Optional. Provider-specific clientData for credentials/list.'
              />
              <div className={styles.fieldWithSpacing}>
                <Input
                  label='Audience'
                  {...cscField('audience')}
                  placeholder='https://api.example.com'
                  description='Optional. OAuth2 audience parameter.'
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
            <Button onClick={handleSave} disabled={saveDisabled || validating}>
              {validating ? 'Validating...' : 'Save'}
            </Button>
            {hasAnySaved && (
              <Button onClick={handleReset} className='delete-button'>
                Reset
              </Button>
            )}
          </div>
        </div>

        {signingError && <div className='message-error'>{signingError}</div>}
        {signingSuccess && <div className='message-success'>{signingSuccess}</div>}
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

        {metaError && <div className='message-error'>{metaError}</div>}
        {metaSuccess && <div className='message-success'>{metaSuccess}</div>}
      </Section>
    </>
  );
};

export default SigningTab;
