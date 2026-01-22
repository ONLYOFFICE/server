import {useState, useEffect, useRef, useCallback} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {resetConfiguration, uploadSigningCertificate, deleteSigningCertificate, getSigningCertificateStatus} from '../../api';
import {saveConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Section from '../../components/Section/Section';
import PasswordInput from '../../components/PasswordInput/PasswordInput';
import Note from '../../components/Note/Note';
import './Settings.scss';

const Settings = () => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const fileInputRef = useRef(null);

  // PDF Signing state
  const [certificateExists, setCertificateExists] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [signingPassphrase, setSigningPassphrase] = useState('');
  const [savedPassphrase, setSavedPassphrase] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Check certificate status on server
  const checkCertificateStatus = useCallback(async () => {
    try {
      const status = await getSigningCertificateStatus();
      setCertificateExists(status.exists);
    } catch (err) {
      console.error('Failed to check certificate status:', err);
      setCertificateExists(false);
    }
  }, []);

  // Load config data and check certificate status
  useEffect(() => {
    if (config) {
      const passphrase = getNestedValue(config, 'FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE') || '';
      setSigningPassphrase(passphrase);
      setSavedPassphrase(passphrase);
      checkCertificateStatus();
    }
  }, [config, checkCertificateStatus]);

  const showSuccess = message => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleResetConfig = async () => {
    if (!window.confirm('Are you sure you want to reset the configuration? This action cannot be undone.')) {
      throw new Error('Operation cancelled');
    }

    await resetConfiguration();
  };

  // Handle file selection - stores file in browser state
  const handleFileSelect = event => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.p12') && !fileName.endsWith('.pfx')) {
      setError('Invalid file format. Please select a .p12 or .pfx file.');
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
  };

  const handleSelectFileClick = () => {
    fileInputRef.current?.click();
  };

  // Save - uploads file (if selected) AND saves/removes passphrase
  const handleSave = async () => {
    try {
      setError(null);

      let fileUploaded = false;

      // If file is selected, upload it first
      if (selectedFile) {
        await uploadSigningCertificate(selectedFile);
        fileUploaded = true;
      }

      // Handle passphrase: empty means remove, non-empty means save
      const passphraseChanged = signingPassphrase !== savedPassphrase;
      if (signingPassphrase) {
        // Save passphrase to config
        const configUpdate = {
          'FileConverter.converter.spawnOptions': {
            env: {
              SIGNING_KEYSTORE_PASSPHRASE: signingPassphrase
            }
          }
        };
        const mergedConfig = mergeNestedObjects([configUpdate]);
        await dispatch(saveConfig(mergedConfig)).unwrap();
      } else if (passphraseChanged) {
        // Empty passphrase means remove the key from config (only if changed)
        await resetConfiguration(['FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE']);
      }

      if (fileUploaded) {
        setCertificateExists(true);
      }
      setSavedPassphrase(signingPassphrase);
      setSelectedFile(null);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Show appropriate success message
      let message;
      if (fileUploaded && passphraseChanged) {
        message = signingPassphrase ? 'Certificate uploaded and passphrase saved' : 'Certificate uploaded and passphrase cleared';
      } else if (fileUploaded) {
        message = 'Certificate uploaded successfully';
      } else if (passphraseChanged) {
        message = signingPassphrase ? 'Passphrase saved successfully' : 'Passphrase cleared successfully';
      } else {
        message = 'Settings saved';
      }
      showSuccess(message);
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  // Remove - deletes file AND resets passphrase in config
  const handleRemove = async () => {
    if (!certificateExists && !selectedFile) return;

    if (!window.confirm('Are you sure you want to remove the signing certificate? This will also clear the passphrase.')) {
      return;
    }

    try {
      setError(null);

      // Delete file from server if exists
      if (certificateExists) {
        await deleteSigningCertificate();
        setCertificateExists(false);
      }

      // Reset passphrase in config only if it was set
      if (savedPassphrase) {
        await resetConfiguration(['FileConverter.converter.spawnOptions.env.SIGNING_KEYSTORE_PASSPHRASE']);
      }

      setSelectedFile(null);
      setSigningPassphrase('');
      setSavedPassphrase('');

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      showSuccess('Certificate removed successfully');
    } catch (err) {
      setError(err.message || 'Failed to remove certificate');
    }
  };

  const handlePassphraseChange = value => {
    setSigningPassphrase(value);
  };

  const hasChanges = selectedFile || signingPassphrase !== savedPassphrase;
  const canRemove = certificateExists || selectedFile;

  return (
    <div className='settings-page'>
      <div className='page-header'>
        <h1>Settings</h1>
      </div>

      <div className='settings-content' title='Settings'>
        <Section
          title='Reset Configuration'
          description='This will reset all configuration settings to their default values. This action cannot be undone.'
        >
          <Button onClick={handleResetConfig}>Reset</Button>
        </Section>

        <Section title='PDF Digital Signature' description='Configure PKCS#12 (.p12/.pfx) certificate for digitally signing submitted PDF forms'>
          <Note type='note'>
            The signing certificate will be used to digitally sign PDF forms when they are submitted. Only submitted PDF forms will be signed, not
            regular PDF conversions.
          </Note>

          <div className='form-row'>
            <div className='certificate-status'>
              <span className='certificate-label'>Certificate Status:</span>
              {certificateExists ? (
                <span className='certificate-installed'>Certificate installed</span>
              ) : (
                <span className='certificate-not-installed'>No certificate</span>
              )}
            </div>
          </div>

          <div className='form-row'>
            <input ref={fileInputRef} type='file' accept='.p12,.pfx' onChange={handleFileSelect} style={{display: 'none'}} />
            <div className='file-input-row'>
              <Input
                label='Certificate File'
                value={selectedFile ? selectedFile.name : ''}
                onChange={() => {}}
                placeholder='No file selected'
                readOnly
              />
              <Button onClick={handleSelectFileClick} disableResult>
                Browse
              </Button>
            </div>
          </div>

          <div className='form-row'>
            <PasswordInput
              label='Certificate Passphrase'
              value={signingPassphrase}
              onChange={handlePassphraseChange}
              placeholder='Leave empty if certificate is not encrypted'
              description='Passphrase to unlock the PKCS#12 certificate. Leave empty if the certificate is not password-protected.'
            />
          </div>

          <div className='form-row'>
            <div className='actions-section'>
              <Button onClick={handleSave} disabled={!hasChanges}>
                Save
              </Button>
              {canRemove && (
                <Button onClick={handleRemove} className='delete-button'>
                  Remove
                </Button>
              )}
            </div>
          </div>

          {error && <div className='message-error'>{error}</div>}
          {successMessage && <div className='message-success'>{successMessage}</div>}
        </Section>
      </div>
    </div>
  );
};

export default Settings;
