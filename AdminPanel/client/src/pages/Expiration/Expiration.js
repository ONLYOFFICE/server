import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Tabs from '../../components/Tabs/Tabs';
import Input from '../../components/Input/Input';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './Expiration.module.scss';

const expirationTabs = [
  {key: 'garbage-collection', label: 'Garbage Collection'},
  {key: 'session-management', label: 'Session Management'}
];

function Expiration() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  const [activeTab, setActiveTab] = useState('garbage-collection');

  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({
    filesCron: '',
    documentsCron: '',
    files: '',
    filesremovedatonce: '',
    sessionidle: '',
    sessionabsolute: ''
  });
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Configuration paths
  const CONFIG_PATHS = {
    filesCron: 'services.CoAuthoring.expire.filesCron',
    documentsCron: 'services.CoAuthoring.expire.documentsCron',
    files: 'services.CoAuthoring.expire.files',
    filesremovedatonce: 'services.CoAuthoring.expire.filesremovedatonce',
    sessionidle: 'services.CoAuthoring.expire.sessionidle',
    sessionabsolute: 'services.CoAuthoring.expire.sessionabsolute'
  };

  // Reset state and errors to global config
  const resetToGlobalConfig = () => {
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
  };

  // Handle tab change and reset state
  const handleTabChange = newTab => {
    setActiveTab(newTab);
    resetToGlobalConfig();
  };

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  // Handle field changes
  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate fields with schema validation
    if (value !== '' && CONFIG_PATHS[field]) {
      let validationValue = value;

      // Convert numeric fields to integers for validation
      if (field === 'files' || field === 'filesremovedatonce') {
        validationValue = parseInt(value);
        if (!isNaN(validationValue)) {
          validateField(CONFIG_PATHS[field], validationValue);
        }
      } else if (typeof value === 'string') {
        validateField(CONFIG_PATHS[field], value);
      }
    }

    // Check if there are changes
    const hasFieldChanges = Object.keys(CONFIG_PATHS).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      const originalFieldValue = getNestedValue(config, CONFIG_PATHS[key], '');
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
      let value = localSettings[key];

      // Convert numeric fields to integers
      if (key === 'files' || key === 'filesremovedatonce') {
        value = value ? parseInt(value) : 0;
      }

      configUpdate[path] = value;
    });

    const mergedConfig = mergeNestedObjects([configUpdate]);
    await dispatch(saveConfig(mergedConfig)).unwrap();
    setHasChanges(false);
  };

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'garbage-collection':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Input
                label='Cache Cleanup Cron Expression'
                value={localSettings.filesCron}
                onChange={value => handleFieldChange('filesCron', value)}
                placeholder='0 0 */2 * * *'
                description='Cron expression for cleaning up expired cached files and temporary data (6 fields: second minute hour day month day_of_week)'
                error={getFieldError(CONFIG_PATHS.filesCron)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='Auto-Save & Presence Cleanup Cron Expression'
                value={localSettings.documentsCron}
                onChange={value => handleFieldChange('documentsCron', value)}
                placeholder='0 0 */2 * * *'
                description='Cron expression for auto-saving documents with pending changes and cleaning up expired user presence data (6 fields: second minute hour day month day_of_week)'
                error={getFieldError(CONFIG_PATHS.documentsCron)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='Cache File Retention Time (seconds)'
                type='number'
                value={localSettings.files}
                onChange={value => handleFieldChange('files', value)}
                placeholder='3600'
                description='How long to keep cached files before marking them as expired and eligible for cleanup (default: 86400 = 24 hours)'
                min='0'
                error={getFieldError(CONFIG_PATHS.files)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='Files Removed At Once'
                type='number'
                value={localSettings.filesremovedatonce}
                onChange={value => handleFieldChange('filesremovedatonce', value)}
                placeholder='1000'
                description='Maximum number of files to remove in a single cleanup operation'
                min='0'
                error={getFieldError(CONFIG_PATHS.filesremovedatonce)}
              />
            </div>
          </div>
        );
      case 'session-management':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Input
                label='Session Idle Timeout'
                value={localSettings.sessionidle}
                onChange={value => handleFieldChange('sessionidle', value)}
                placeholder='1h'
                description="Time after which idle sessions expire (e.g., '30m', '1h', '2h')"
                error={getFieldError(CONFIG_PATHS.sessionidle)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='Session Absolute Timeout'
                value={localSettings.sessionabsolute}
                onChange={value => handleFieldChange('sessionabsolute', value)}
                placeholder='24h'
                description="Maximum session lifetime regardless of activity (e.g., '24h', '30d')"
                error={getFieldError(CONFIG_PATHS.sessionabsolute)}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.expiration} ${styles.pageWithFixedSave}`}>
      <PageHeader>Expiration Settings</PageHeader>
      <PageDescription>Configure file cleanup schedules, session timeouts, and garbage collection settings</PageDescription>

      <Tabs tabs={expirationTabs} activeTab={activeTab} onTabChange={handleTabChange}>
        {renderTabContent()}
      </Tabs>

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default Expiration;
