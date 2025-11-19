import {useState, useRef, useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {saveConfig, resetConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButtonGroup from '../../components/FixedSaveButtonGroup/FixedSaveButtonGroup';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import styles from './RequestFiltering.module.scss';

function RequestFiltering() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors} = useFieldValidation();

  const [localSettings, setLocalSettings] = useState({
    allowPrivateIPAddress: false,
    allowMetaIPAddress: false
  });
  const [hasChanges, setHasChanges] = useState(false);

  // Configuration paths
  const CONFIG_PATHS = {
    allowPrivateIPAddress: 'services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress',
    allowMetaIPAddress: 'services.CoAuthoring.request-filtering-agent.allowMetaIPAddress'
  };

  const hasInitialized = useRef(false);
  const resetToGlobalConfig = source => {
    const src = source || config;
    if (src) {
      const newSettings = {};
      Object.keys(CONFIG_PATHS).forEach(key => {
        const path = CONFIG_PATHS[key];
        newSettings[key] = getNestedValue(src, path, false);
      });
      setLocalSettings(newSettings);
    }
  };
  // Load initial values from config
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  // Sync from Redux when config changes (e.g., after reset), unless user has local edits
  useEffect(() => {
    if (config && !hasChanges) {
      resetToGlobalConfig();
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps
  // Handle field changes
  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate boolean fields
    if (CONFIG_PATHS[field]) {
      validateField(CONFIG_PATHS[field], value);
    }

    // Check if there are changes
    const hasFieldChanges = Object.keys(CONFIG_PATHS).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      const originalFieldValue = getNestedValue(config, CONFIG_PATHS[key], false);
      return currentValue !== originalFieldValue;
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
      configUpdate[path] = localSettings[key];
    });

    const mergedConfig = mergeNestedObjects([configUpdate]);
    await dispatch(saveConfig(mergedConfig)).unwrap();
    setHasChanges(false);
  };

  const handleReset = async () => {
    const confirmed = window.confirm('Reset request filtering settings to defaults?');
    if (!confirmed) return;
    try {
      const merged = await dispatch(resetConfig(Object.values(CONFIG_PATHS))).unwrap();
      resetToGlobalConfig(merged);
      setHasChanges(false);
    } catch (e) {
      console.error('Failed to reset request filtering:', e);
      alert('Failed to reset settings. Please try again.');
    }
  };

  return (
    <div className={`${styles.requestFiltering} ${styles.pageWithFixedSave}`}>
      <PageHeader>Request Filtering</PageHeader>
      <PageDescription>
        Configure request filtering settings to control which IP addresses are allowed to make requests to the server.
      </PageDescription>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>IP Address Filtering</h2>
        <p className={styles.sectionDescription}>Control access based on IP address types to enhance security.</p>

        <div className={styles.formRow}>
          <Checkbox
            label='Allow Private IP Addresses'
            checked={localSettings.allowPrivateIPAddress}
            onChange={value => handleFieldChange('allowPrivateIPAddress', value)}
            description='Allow requests from private IP address ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Disable this to block requests from internal networks.'
            error={getFieldError(CONFIG_PATHS.allowPrivateIPAddress)}
          />
        </div>

        <div className={styles.formRow}>
          <Checkbox
            label='Allow Meta IP Addresses'
            checked={localSettings.allowMetaIPAddress}
            onChange={value => handleFieldChange('allowMetaIPAddress', value)}
            description='Allow requests from meta IP addresses (127.0.0.1, ::1, 0.0.0.0, etc.). Disable this to block localhost and other special-use addresses.'
            error={getFieldError(CONFIG_PATHS.allowMetaIPAddress)}
          />
        </div>
      </div>

      <FixedSaveButtonGroup
        buttons={[
          {
            text: 'Save Changes',
            onClick: handleSave,
            disabled: !hasChanges || hasValidationErrors()
          },
          {
            text: 'Reset to Defaults',
            onClick: handleReset,
            disabled: false
          }
        ]}
      />
    </div>
  );
}

export default RequestFiltering;
