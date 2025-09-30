import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Select from '../../components/Select/Select';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './LoggerConfig.module.scss';

const LOG_LEVELS = [
  {value: 'ALL', label: 'ALL - All log messages'},
  {value: 'TRACE', label: 'TRACE - Trace level messages'},
  {value: 'DEBUG', label: 'DEBUG - Debug level messages'},
  {value: 'INFO', label: 'INFO - Information level messages'},
  {value: 'WARN', label: 'WARN - Warning level messages'},
  {value: 'ERROR', label: 'ERROR - Error level messages'},
  {value: 'FATAL', label: 'FATAL - Fatal level messages'},
  {value: 'OFF', label: 'OFF - No log messages'}
];

function LoggerConfig() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({
    logLevel: 'INFO'
  });
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Configuration paths
  const CONFIG_PATHS = {
    logLevel: 'log.options.categories.default.level'
  };

  // Reset state and errors to global config
  const resetToGlobalConfig = () => {
    if (config) {
      const settings = {
        logLevel: getNestedValue(config, CONFIG_PATHS.logLevel, 'INFO')
      };
      setLocalSettings(settings);
      setHasChanges(false);
      // Clear validation errors for all fields
      Object.values(CONFIG_PATHS).forEach(path => {
        clearFieldError(path);
      });
    }
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
    if (CONFIG_PATHS[field]) {
      validateField(CONFIG_PATHS[field], value);
    }

    // Check if there are changes
    const hasFieldChanges = Object.keys(CONFIG_PATHS).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      const originalFieldValue = getNestedValue(config, CONFIG_PATHS[key], 'INFO');

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
    <div className={`${styles.loggerConfig} ${styles.pageWithFixedSave}`}>
      <PageHeader>Logger Configuration</PageHeader>
      <PageDescription>Configure the logging level for the application</PageDescription>

      <div className={styles.configSection}>
        <div className={styles.formRow}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Log Level:</label>
            <Select
              value={localSettings.logLevel}
              onChange={value => handleFieldChange('logLevel', value)}
              options={LOG_LEVELS}
              placeholder='Select log level'
            />
            <div className={styles.description}>Select the minimum log level to capture. Messages below this level will be filtered out.</div>
            {getFieldError(CONFIG_PATHS.logLevel) && <div className={styles.error}>{getFieldError(CONFIG_PATHS.logLevel)}</div>}
          </div>
        </div>
      </div>

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default LoggerConfig;
