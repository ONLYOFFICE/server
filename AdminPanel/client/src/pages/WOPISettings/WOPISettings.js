import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchConfig, saveConfig, selectConfig, selectConfigLoading, selectSchema } from '../../store/slices/configSlice';
import { getNestedValue } from '../../utils/getNestedValue';
import { mergeNestedObjects } from '../../utils/mergeNestedObjects';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import PageHeader from '../../components2/PageHeader/PageHeader';
import PageDescription from '../../components2/PageDescription/PageDescription';
import ToggleSwitch from '../../components2/ToggleSwitch/ToggleSwitch';
import SaveButton from '../../components2/SaveButton/SaveButton';
import styles from './WOPISettings.module.scss';

function WOPISettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const schema = useSelector(selectSchema);
  const loading = useSelector(selectConfigLoading);
  const { validateField, getFieldError } = useFieldValidation();

  // Local state for WOPI enable setting
  const [localWopiEnabled, setLocalWopiEnabled] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Get the actual config value
  const configWopiEnabled = getNestedValue(config, 'wopi.enable', false);

  // Initialize local state when config loads
  useEffect(() => {
    if (config) {
      setLocalWopiEnabled(configWopiEnabled);
      setHasChanges(false);
    }
  }, [config, configWopiEnabled]);

  useEffect(() => {
    if (!config || !schema) {
      dispatch(fetchConfig());
    }
  }, [dispatch, config, schema]);

  const handleWopiEnabledChange = (enabled) => {
    setLocalWopiEnabled(enabled);
    setHasChanges(enabled !== configWopiEnabled);
    
    // Validate the boolean field
    validateField('wopi.enable', enabled);
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    try {
      const updatedConfig = mergeNestedObjects([{ 'wopi.enable': localWopiEnabled }]);
      await dispatch(saveConfig(updatedConfig)).unwrap();
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save WOPI settings:', error);
      // Revert local state on error
      setLocalWopiEnabled(configWopiEnabled);
      setHasChanges(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        Loading WOPI settings...
      </div>
    );
  }

  return (
    <div className={styles.wopiSettings}>
      <PageHeader>WOPI Settings</PageHeader>
      <PageDescription>
        Configure WOPI (Web Application Open Platform Interface) support for document editing
      </PageDescription>

      <div className={styles.settingsSection}>
        <ToggleSwitch
          label="WOPI"
          checked={localWopiEnabled}
          onChange={handleWopiEnabledChange}
        />
      </div>

      <div className={styles.actions}>
        <SaveButton 
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save Changes
        </SaveButton>
      </div>
    </div>
  );
}

export default WOPISettings;
