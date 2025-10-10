import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig, rotateWopiKeysAction} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import {maskKey} from '../../utils/maskKey';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import ToggleSwitch from '../../components/ToggleSwitch/ToggleSwitch';
import Input from '../../components/Input/Input';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import Note from '../../components/Note/Note';
import styles from './WOPISettings.module.scss';

function WOPISettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, hasValidationErrors} = useFieldValidation();

  // Local state for WOPI settings
  const [localWopiEnabled, setLocalWopiEnabled] = useState(false);
  const [localRotateKeys, setLocalRotateKeys] = useState(false);
  const [localRefreshLockInterval, setLocalRefreshLockInterval] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Get the actual config values
  const configWopiEnabled = getNestedValue(config, 'wopi.enable', false);
  const wopiPublicKey = getNestedValue(config, 'wopi.publicKey', '');
  const configRefreshLockInterval = getNestedValue(config, 'wopi.refreshLockInterval', '10m');

  const resetToGlobalConfig = () => {
    if (config) {
      setLocalWopiEnabled(configWopiEnabled);
      setLocalRotateKeys(false);
      setLocalRefreshLockInterval(configRefreshLockInterval);
      setHasChanges(false);
      validateField('wopi.enable', configWopiEnabled);
      validateField('wopi.refreshLockInterval', configRefreshLockInterval);
    }
  };

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  const handleWopiEnabledChange = enabled => {
    setLocalWopiEnabled(enabled);
    // If WOPI is disabled, uncheck rotate keys
    if (!enabled) {
      setLocalRotateKeys(false);
    }
    setHasChanges(enabled !== configWopiEnabled || localRotateKeys || localRefreshLockInterval !== configRefreshLockInterval);

    // Validate the boolean field
    validateField('wopi.enable', enabled);
  };

  const handleRotateKeysChange = checked => {
    setLocalRotateKeys(checked);
    setHasChanges(localWopiEnabled !== configWopiEnabled || checked || localRefreshLockInterval !== configRefreshLockInterval);
  };

  const handleRefreshLockIntervalChange = value => {
    setLocalRefreshLockInterval(value);
    setHasChanges(localWopiEnabled !== configWopiEnabled || localRotateKeys || value !== configRefreshLockInterval);
    validateField('wopi.refreshLockInterval', value);
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    try {
      const enableChanged = localWopiEnabled !== configWopiEnabled;
      const rotateRequested = localRotateKeys;
      const refreshLockIntervalChanged = localRefreshLockInterval !== configRefreshLockInterval;

      // Build config update object
      const configUpdates = {};
      if (enableChanged) {
        configUpdates['wopi.enable'] = localWopiEnabled;
      }
      if (refreshLockIntervalChanged) {
        configUpdates['wopi.refreshLockInterval'] = localRefreshLockInterval;
      }

      // If only rotate requested, just rotate keys
      if (!enableChanged && !refreshLockIntervalChanged && rotateRequested) {
        await dispatch(rotateWopiKeysAction()).unwrap();
      }
      // If config changes (enable or refreshLockInterval) but no rotate
      else if ((enableChanged || refreshLockIntervalChanged) && !rotateRequested) {
        const updatedConfig = mergeNestedObjects([configUpdates]);
        await dispatch(saveConfig(updatedConfig)).unwrap();
      }
      // If both config changes and rotate requested, make two requests
      else if ((enableChanged || refreshLockIntervalChanged) && rotateRequested) {
        // First update the config settings
        const updatedConfig = mergeNestedObjects([configUpdates]);
        await dispatch(saveConfig(updatedConfig)).unwrap();
        // Then rotate keys
        await dispatch(rotateWopiKeysAction()).unwrap();
      }

      setHasChanges(false);
      setLocalRotateKeys(false);
    } catch (error) {
      console.error('Failed to save WOPI settings:', error);
      // Revert local state on error
      setLocalWopiEnabled(configWopiEnabled);
      setLocalRotateKeys(false);
      setLocalRefreshLockInterval(configRefreshLockInterval);
      setHasChanges(false);
    }
  };

  return (
    <div className={`${styles.wopiSettings} ${styles.pageWithFixedSave}`}>
      <PageHeader>WOPI Settings</PageHeader>
      <PageDescription>Configure WOPI (Web Application Open Platform Interface) support for document editing</PageDescription>

      <div className={styles.settingsSection}>
        <ToggleSwitch label='WOPI' checked={localWopiEnabled} onChange={handleWopiEnabledChange} />
      </div>

      {localWopiEnabled && (
        <>
          <div className={styles.settingsSection}>
            <div className={styles.sectionTitle}>Lock Settings</div>
            <div className={styles.sectionDescription}>Configure document lock refresh interval for WOPI sessions.</div>
            <div className={styles.formRow}>
              <Input
                label='Refresh Lock Interval'
                value={localRefreshLockInterval}
                onChange={handleRefreshLockIntervalChange}
                placeholder='10m'
                width='200px'
                description="Time interval for refreshing document locks (e.g., '10m', '1h', '30s')"
              />
            </div>
          </div>

          <div className={styles.settingsSection}>
            <div className={styles.sectionTitle}>Key Management</div>
            <div className={styles.sectionDescription}>
              Rotate WOPI encryption keys. Current keys will be moved to "Old" and new keys will be generated.
            </div>
            <div className={styles.noteWrapper}>
              <Note type='warning'>Do not rotate keys more than once per 24 hours; storage may not refresh in time and authentication can fail.</Note>
            </div>
            <div className={styles.formRow}>
              <Input
                label='Current Public Key'
                value={maskKey(wopiPublicKey)}
                disabled
                placeholder='No key generated'
                width='400px'
                style={{fontFamily: 'Courier New, monospace'}}
              />
            </div>
            <div className={styles.formRow}>
              <Checkbox
                label='Rotate Keys'
                checked={localRotateKeys}
                onChange={handleRotateKeysChange}
                disabled={!localWopiEnabled}
                description="Generate new encryption keys. Current keys will be moved to 'Old'."
              />
            </div>
          </div>
        </>
      )}

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default WOPISettings;
