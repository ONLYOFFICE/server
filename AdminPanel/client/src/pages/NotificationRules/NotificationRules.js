import {useState, useRef, useEffect, useCallback} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Input from '../../components/Input/Input';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './NotificationRules.module.scss';

function NotificationRules() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Configuration paths
  const CONFIG_PATHS = {
    licenseExpirationWarningEnable: 'notification.rules.licenseExpirationWarning.enable',
    licenseExpirationWarningRepeatInterval: 'notification.rules.licenseExpirationWarning.policies.repeatInterval',
    licenseExpirationErrorEnable: 'notification.rules.licenseExpirationError.enable',
    licenseExpirationErrorRepeatInterval: 'notification.rules.licenseExpirationError.policies.repeatInterval',
    licenseLimitEditEnable: 'notification.rules.licenseLimitEdit.enable',
    licenseLimitEditRepeatInterval: 'notification.rules.licenseLimitEdit.policies.repeatInterval',
    licenseLimitLiveViewerEnable: 'notification.rules.licenseLimitLiveViewer.enable',
    licenseLimitLiveViewerRepeatInterval: 'notification.rules.licenseLimitLiveViewer.policies.repeatInterval'
  };

  // Reset state and errors to global config
  const resetToGlobalConfig = useCallback(() => {
    if (config) {
      const settings = {};
      Object.keys(CONFIG_PATHS).forEach(key => {
        const value = getNestedValue(config, CONFIG_PATHS[key], '');
        settings[key] = value;
      });
      setLocalSettings(settings);
      setHasChanges(false);
      // Clear validation errors for all fields
      Object.values(CONFIG_PATHS).forEach(path => {
        clearFieldError(path);
      });
    }
  }, [config, clearFieldError]);

  // Initialize settings from config when component loads
  useEffect(() => {
    if (config && !hasInitialized.current) {
      resetToGlobalConfig();
      hasInitialized.current = true;
    }
  }, [config, resetToGlobalConfig]);

  // Handle field changes
  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate fields with schema validation
    if (CONFIG_PATHS[field]) {
      if (typeof value === 'string') {
        validateField(CONFIG_PATHS[field], value);
      } else if (typeof value === 'boolean') {
        validateField(CONFIG_PATHS[field], value);
      }
    }

    // Check if there are changes
    const hasFieldChanges = Object.keys(CONFIG_PATHS).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      const originalFieldValue = getNestedValue(config, CONFIG_PATHS[key], '');

      // Handle different data types properly
      if (typeof originalFieldValue === 'boolean') {
        return currentValue !== originalFieldValue;
      }
      return currentValue.toString() !== originalFieldValue.toString();
    });

    setHasChanges(hasFieldChanges);
  };

  // Handle save
  const handleSave = async () => {
    if (!hasChanges) return;

    // Create config update object
    const configUpdate = {};
    Object.keys(CONFIG_PATHS).forEach(key => {
      const path = CONFIG_PATHS[key];
      const value = localSettings[key];
      configUpdate[path] = value;
    });

    const mergedConfig = mergeNestedObjects([configUpdate]);
    await dispatch(saveConfig(mergedConfig)).unwrap();
    setHasChanges(false);
  };

  return (
    <div className={`${styles.notificationRules} ${styles.pageWithFixedSave}`}>
      <PageHeader>Notification Rules</PageHeader>
      <PageDescription>Configure email notification rules for license expiration and limit warnings</PageDescription>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>License Expiration Warning</div>
        <div className={styles.sectionDescription}>Configure email notifications when the license is about to expire</div>
        <div className={styles.formRow}>
          <Checkbox
            label='Enable'
            checked={localSettings.licenseExpirationWarningEnable || false}
            onChange={value => handleFieldChange('licenseExpirationWarningEnable', value)}
            error={getFieldError(CONFIG_PATHS.licenseExpirationWarningEnable)}
          />
        </div>
        <div className={styles.formRow}>
          <Input
            label='Repeat Interval:'
            value={localSettings.licenseExpirationWarningRepeatInterval || ''}
            onChange={value => handleFieldChange('licenseExpirationWarningRepeatInterval', value)}
            placeholder='1d'
            description='How often to repeat the warning (e.g., 1d, 1h, 30m)'
            error={getFieldError(CONFIG_PATHS.licenseExpirationWarningRepeatInterval)}
          />
        </div>
      </div>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>License Expiration Error</div>
        <div className={styles.sectionDescription}>Configure email notifications when the license has expired</div>
        <div className={styles.formRow}>
          <Checkbox
            label='Enable'
            checked={localSettings.licenseExpirationErrorEnable || false}
            onChange={value => handleFieldChange('licenseExpirationErrorEnable', value)}
            error={getFieldError(CONFIG_PATHS.licenseExpirationErrorEnable)}
          />
        </div>
        <div className={styles.formRow}>
          <Input
            label='Repeat Interval:'
            value={localSettings.licenseExpirationErrorRepeatInterval || ''}
            onChange={value => handleFieldChange('licenseExpirationErrorRepeatInterval', value)}
            placeholder='1d'
            description='How often to repeat the error notification (e.g., 1d, 1h, 30m)'
            error={getFieldError(CONFIG_PATHS.licenseExpirationErrorRepeatInterval)}
          />
        </div>
      </div>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>License Limit Edit</div>
        <div className={styles.sectionDescription}>Configure email notifications when the edit limit is reached</div>
        <div className={styles.formRow}>
          <Checkbox
            label='Enable'
            checked={localSettings.licenseLimitEditEnable || false}
            onChange={value => handleFieldChange('licenseLimitEditEnable', value)}
            error={getFieldError(CONFIG_PATHS.licenseLimitEditEnable)}
          />
        </div>
        <div className={styles.formRow}>
          <Input
            label='Repeat Interval:'
            value={localSettings.licenseLimitEditRepeatInterval || ''}
            onChange={value => handleFieldChange('licenseLimitEditRepeatInterval', value)}
            placeholder='1h'
            description='How often to repeat the limit warning (e.g., 1d, 1h, 30m)'
            error={getFieldError(CONFIG_PATHS.licenseLimitEditRepeatInterval)}
          />
        </div>
      </div>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>License Limit Live Viewer</div>
        <div className={styles.sectionDescription}>Configure email notifications when the live viewer limit is reached</div>
        <div className={styles.formRow}>
          <Checkbox
            label='Enable'
            checked={localSettings.licenseLimitLiveViewerEnable || false}
            onChange={value => handleFieldChange('licenseLimitLiveViewerEnable', value)}
            error={getFieldError(CONFIG_PATHS.licenseLimitLiveViewerEnable)}
          />
        </div>
        <div className={styles.formRow}>
          <Input
            label='Repeat Interval:'
            value={localSettings.licenseLimitLiveViewerRepeatInterval || ''}
            onChange={value => handleFieldChange('licenseLimitLiveViewerRepeatInterval', value)}
            placeholder='1h'
            description='How often to repeat the limit warning (e.g., 1d, 1h, 30m)'
            error={getFieldError(CONFIG_PATHS.licenseLimitLiveViewerRepeatInterval)}
          />
        </div>
      </div>

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default NotificationRules;
