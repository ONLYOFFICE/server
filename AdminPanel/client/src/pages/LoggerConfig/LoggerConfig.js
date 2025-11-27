import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig, selectBaseConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Select from '../../components/Select/Select';
import FixedSaveButtonGroup from '../../components/FixedSaveButtonGroup/FixedSaveButtonGroup';
import Section from '../../components/Section/Section';
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
  const baseConfig = useSelector(selectBaseConfig);
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

  const computeHasChanges = (nextSettings = localSettings) => {
    if (!config) return false;
    return Object.keys(CONFIG_PATHS).some(key => {
      const currentValue = nextSettings[key];
      const originalValue = getNestedValue(config, CONFIG_PATHS[key]);
      return currentValue !== originalValue;
    });
  };

  // Reset state and errors to global config
  const resetToGlobalConfig = () => {
    if (config) {
      const settings = {
        logLevel: getNestedValue(config, CONFIG_PATHS.logLevel)
      };
      setLocalSettings(settings);
      setHasChanges(false);
      Object.values(CONFIG_PATHS).forEach(path => {
        clearFieldError(path);
      });
    }
  };

  const resetToBaseConfig = () => {
    const baseValue = getNestedValue(baseConfig, CONFIG_PATHS.logLevel);
    setLocalSettings({logLevel: baseValue});
    clearFieldError(CONFIG_PATHS.logLevel);
    setHasChanges(computeHasChanges({logLevel: baseValue}));
  };

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  // Handle field changes
  const handleFieldChange = (field, value) => {
    if (CONFIG_PATHS[field]) {
      validateField(CONFIG_PATHS[field], value);
    }

    setLocalSettings(prev => {
      const updatedSettings = {
        ...prev,
        [field]: value
      };
      setHasChanges(computeHasChanges(updatedSettings));
      return updatedSettings;
    });
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

      <Section title='Logger Settings'>
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
      </Section>

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

export default LoggerConfig;
