import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig, selectBaseConfig, rotateWopiKeysAction} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import {maskKey} from '../../utils/maskKey';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import ToggleSwitch from '../../components/ToggleSwitch/ToggleSwitch';
import Input from '../../components/Input/Input';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButtonGroup from '../../components/FixedSaveButtonGroup/FixedSaveButtonGroup';
import Note from '../../components/Note/Note';
import Section from '../../components/Section/Section';
import styles from './WOPISettings.module.scss';

function WOPISettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const baseConfig = useSelector(selectBaseConfig);
  const {validateField, hasValidationErrors} = useFieldValidation();

  // Local state for WOPI settings
  const [localWopiEnabled, setLocalWopiEnabled] = useState(false);
  const [localRotateKeys, setLocalRotateKeys] = useState(false);
  const [localRefreshLockInterval, setLocalRefreshLockInterval] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Get the actual config values
  const configWopiEnabled = getNestedValue(config, 'wopi.enable');
  const wopiPublicKey = getNestedValue(config, 'wopi.publicKey');
  const configRefreshLockInterval = getNestedValue(config, 'wopi.refreshLockInterval');

  const computeHasChanges = ({wopiEnabled = localWopiEnabled, rotateKeys = localRotateKeys, refreshLockInterval = localRefreshLockInterval} = {}) => {
    const enableChanged = wopiEnabled !== configWopiEnabled;
    const refreshChanged = refreshLockInterval !== configRefreshLockInterval;
    const rotateChanged = !!rotateKeys;
    return enableChanged || refreshChanged || rotateChanged;
  };

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

  const resetToBaseConfig = () => {
    const baseEnabled = getNestedValue(baseConfig, 'wopi.enable');
    const baseRefreshInterval = getNestedValue(baseConfig, 'wopi.refreshLockInterval');

    setLocalWopiEnabled(baseEnabled);
    setLocalRotateKeys(false);
    setLocalRefreshLockInterval(baseRefreshInterval);
    setHasChanges(computeHasChanges({wopiEnabled: baseEnabled, rotateKeys: false, refreshLockInterval: baseRefreshInterval}));

    validateField('wopi.enable', baseEnabled);
    validateField('wopi.refreshLockInterval', baseRefreshInterval);
  };

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  const handleWopiEnabledChange = enabled => {
    const nextRotateKeys = enabled ? localRotateKeys : false;
    setLocalWopiEnabled(enabled);
    setLocalRotateKeys(nextRotateKeys);
    setHasChanges(computeHasChanges({wopiEnabled: enabled, rotateKeys: nextRotateKeys}));

    // Validate the boolean field
    validateField('wopi.enable', enabled);
  };

  const handleRotateKeysChange = checked => {
    setLocalRotateKeys(checked);
    setHasChanges(computeHasChanges({rotateKeys: checked}));
  };

  const handleRefreshLockIntervalChange = value => {
    setLocalRefreshLockInterval(value);
    setHasChanges(computeHasChanges({refreshLockInterval: value}));
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

      <Section>
        <ToggleSwitch label='WOPI' checked={localWopiEnabled} onChange={handleWopiEnabledChange} />
      </Section>

      {localWopiEnabled && (
        <>
          <Section title='Lock Settings' description='Configure document lock refresh interval for WOPI sessions.'>
            <div className={styles.formRow}>
              <Input
                label='Refresh Lock Interval'
                value={localRefreshLockInterval}
                onChange={handleRefreshLockIntervalChange}
                placeholder='10m'
                description="Time interval for refreshing document locks (e.g., '10m', '1h', '30s')"
              />
            </div>
          </Section>

          <Section
            title='Key Management'
            description='Rotate WOPI encryption keys. Current keys will be moved to "Old" and new keys will be generated.'
          >
            <div className={styles.noteWrapper}>
              <Note type='warning'>Do not rotate keys more than once per 24 hours; storage may not refresh in time and authentication can fail.</Note>
            </div>
            <div className={styles.formRow}>
              <Input
                label='Current Public Key'
                value={maskKey(wopiPublicKey)}
                disabled
                placeholder='No key generated'
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
          </Section>
        </>
      )}

      <FixedSaveButtonGroup
        buttons={[
          {
            text: 'Save Changes',
            onClick: handleSave,
            disabled: !hasChanges || hasValidationErrors()
          },
          {
            text: 'Reset',
            onClick: resetToBaseConfig
          }
        ]}
      />
    </div>
  );
}

export default WOPISettings;
