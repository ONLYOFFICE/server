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
import SaveButton from '../../components/SaveButton/SaveButton';
import Tabs from '../../components/Tabs/Tabs';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './WOPISettings.module.scss';

function WOPISettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, hasValidationErrors} = useFieldValidation();

  // Local state for WOPI enable setting
  const [localWopiEnabled, setLocalWopiEnabled] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const hasInitialized = useRef(false);

  // Get the actual config values
  const configWopiEnabled = getNestedValue(config, 'wopi.enable', false);
  const wopiPublicKey = getNestedValue(config, 'wopi.publicKey', '');

  // Tabs configuration
  const tabs = [
    { key: 'settings', label: 'Settings' },
    { key: 'keys', label: 'Key Management' }
  ];

  const resetToGlobalConfig = () => {
    if (config) {
      setLocalWopiEnabled(configWopiEnabled);
      setHasChanges(false);
      validateField('wopi.enable', configWopiEnabled);
    }
  };

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    resetToGlobalConfig();
  };

  const handleWopiEnabledChange = enabled => {
    setLocalWopiEnabled(enabled);
    setHasChanges(enabled !== configWopiEnabled);

    // Validate the boolean field
    validateField('wopi.enable', enabled);
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    try {
      const updatedConfig = mergeNestedObjects([{'wopi.enable': localWopiEnabled}]);
      await dispatch(saveConfig(updatedConfig)).unwrap();
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save WOPI settings:', error);
      // Revert local state on error
      setLocalWopiEnabled(configWopiEnabled);
      setHasChanges(false);
    }
  };

  const handleRotateKeys = async () => {
    await dispatch(rotateWopiKeysAction()).unwrap();
  };


  const renderSettingsTab = () => (
    <div className={styles.settingsSection}>
      <ToggleSwitch label='WOPI' checked={localWopiEnabled} onChange={handleWopiEnabledChange} />
    </div>
  );

  const renderKeysTab = () => (
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
        <SaveButton
          onClick={handleRotateKeys}
        >
          Rotate Keys
        </SaveButton>
      </div>
    </div>
  );

  return (
    <div className={`${styles.wopiSettings} ${activeTab === 'settings' ? styles.pageWithFixedSave : ''}`}>
      <PageHeader>WOPI Settings</PageHeader>
      <PageDescription>Configure WOPI (Web Application Open Platform Interface) support for document editing</PageDescription>

      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      >
        {activeTab === 'settings' && renderSettingsTab()}
        {activeTab === 'keys' && renderKeysTab()}
      </Tabs>

      {activeTab === 'settings' && (
        <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
          Save Changes
        </FixedSaveButton>
      )}
    </div>
  );
}

export default WOPISettings;
