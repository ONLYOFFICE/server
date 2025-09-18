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
import styles from './WOPISettings.module.scss';

function WOPISettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, hasValidationErrors} = useFieldValidation();

  // Local state for WOPI settings
  const [localWopiEnabled, setLocalWopiEnabled] = useState(false);
  const [localRotateKeys, setLocalRotateKeys] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Get the actual config values
  const configWopiEnabled = getNestedValue(config, 'wopi.enable', false);
  const wopiPublicKey = getNestedValue(config, 'wopi.publicKey', '');

  const resetToGlobalConfig = () => {
    if (config) {
      setLocalWopiEnabled(configWopiEnabled);
      setLocalRotateKeys(false);
      setHasChanges(false);
      validateField('wopi.enable', configWopiEnabled);
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
    setHasChanges(enabled !== configWopiEnabled || localRotateKeys);

    // Validate the boolean field
    validateField('wopi.enable', enabled);
  };

  const handleRotateKeysChange = checked => {
    setLocalRotateKeys(checked);
    setHasChanges(localWopiEnabled !== configWopiEnabled || checked);
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    try {
      const enableChanged = localWopiEnabled !== configWopiEnabled;
      const rotateRequested = localRotateKeys;

      // If only enable changed, just update config
      if (enableChanged && !rotateRequested) {
        const updatedConfig = mergeNestedObjects([{'wopi.enable': localWopiEnabled}]);
        await dispatch(saveConfig(updatedConfig)).unwrap();
      }
      // If only rotate requested, just rotate keys
      else if (!enableChanged && rotateRequested) {
        await dispatch(rotateWopiKeysAction()).unwrap();
      }
      // If both changed, make two requests
      else if (enableChanged && rotateRequested) {
        // First update the enable setting
        const updatedConfig = mergeNestedObjects([{'wopi.enable': localWopiEnabled}]);
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
        <div className={styles.settingsSection}>
          <div className={styles.sectionTitle}>Key Management</div>
          <div className={styles.sectionDescription}>
            Rotate WOPI encryption keys. Current keys will be moved to "Old" and new keys will be generated.
          </div>
          <div className={styles.formRow}>
            <Input
              label="Current Public Key"
              value={maskKey(wopiPublicKey)}
              disabled
              placeholder="No key generated"
              width="400px"
              style={{fontFamily: 'Courier New, monospace'}}
            />
          </div>
          <div className={styles.formRow}>
            <Checkbox
              label="Rotate Keys"
              checked={localRotateKeys}
              onChange={handleRotateKeysChange}
              disabled={!localWopiEnabled}
              description="Generate new encryption keys. Current keys will be moved to 'Old'."
            />
          </div>
        </div>
      )}

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default WOPISettings;
