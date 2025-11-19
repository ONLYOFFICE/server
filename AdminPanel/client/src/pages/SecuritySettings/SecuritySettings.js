import {useState, useRef, useEffect} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, resetConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Tabs from '../../components/Tabs/Tabs';
import AccessRules from '../../components/AccessRules/AccessRules';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButtonGroup from '../../components/FixedSaveButtonGroup/FixedSaveButtonGroup';
import styles from './SecuritySettings.module.scss';

const securityTabs = [
  {key: 'ip-filtering', label: 'IP Filtering'},
  {key: 'request-filtering', label: 'Request Filtering'}
];

function SecuritySettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  const [activeTab, setActiveTab] = useState('ip-filtering');
  const [localRules, setLocalRules] = useState([]);
  const [localSettings, setLocalSettings] = useState({
    useforrequest: false,
    allowPrivateIPAddress: false,
    allowMetaIPAddress: false
  });
  const [hasChanges, setHasChanges] = useState(false);

  const REQUEST_FILTERING_PATHS = {
    useforrequest: 'services.CoAuthoring.ipfilter.useforrequest',
    allowPrivateIPAddress: 'services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress',
    allowMetaIPAddress: 'services.CoAuthoring.request-filtering-agent.allowMetaIPAddress'
  };

  // Reset state and errors to global config
  const resetToGlobalConfig = source => {
    const src = source || config;
    if (src) {
      const ipFilterRules = getNestedValue(src, 'services.CoAuthoring.ipfilter.rules', []);
      const uiRules = ipFilterRules.map(rule => ({
        type: rule.allowed ? 'Allow' : 'Deny',
        value: rule.address
      }));
      setLocalRules(uiRules);
      clearFieldError('services.CoAuthoring.ipfilter.rules');

      const newSettings = {};
      Object.keys(REQUEST_FILTERING_PATHS).forEach(key => {
        const path = REQUEST_FILTERING_PATHS[key];
        newSettings[key] = getNestedValue(src, path, false);
        clearFieldError(path);
      });
      setLocalSettings(newSettings);

      setHasChanges(false);
    }
  };

  // Handle tab change and reset state
  const handleTabChange = newTab => {
    if (hasChanges) {
      resetToGlobalConfig();
    }
    setActiveTab(newTab);
  };

  const hasInitialized = useRef(false);

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
  // Handle rules changes
  const handleRulesChange = newRules => {
    setLocalRules(newRules);
    const originalRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
    const originalUIRules = originalRules.map(rule => ({
      type: rule.allowed ? 'Allow' : 'Deny',
      value: rule.address
    }));
    const hasRulesChanges = JSON.stringify(newRules) !== JSON.stringify(originalUIRules);

    const hasRequestFilteringChanges = Object.keys(REQUEST_FILTERING_PATHS).some(key => {
      const originalValue = getNestedValue(config, REQUEST_FILTERING_PATHS[key], false);
      return localSettings[key] !== originalValue;
    });

    setHasChanges(hasRulesChanges || hasRequestFilteringChanges);

    // Validate the rules array structure
    if (newRules.length > 0) {
      const backendRules = newRules.map(rule => ({
        address: rule.value,
        allowed: rule.type === 'Allow'
      }));
      validateField('services.CoAuthoring.ipfilter.rules', backendRules);
    }
  };

  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    if (REQUEST_FILTERING_PATHS[field]) {
      validateField(REQUEST_FILTERING_PATHS[field], value);
    }

    const hasRequestFilteringChanges = Object.keys(REQUEST_FILTERING_PATHS).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      const originalFieldValue = getNestedValue(config, REQUEST_FILTERING_PATHS[key], false);
      return currentValue !== originalFieldValue;
    });

    const originalRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
    const originalUIRules = originalRules.map(rule => ({
      type: rule.allowed ? 'Allow' : 'Deny',
      value: rule.address
    }));
    const hasRulesChanges = JSON.stringify(localRules) !== JSON.stringify(originalUIRules);

    setHasChanges(hasRequestFilteringChanges || hasRulesChanges);
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    const configUpdate = {};

    const originalRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
    const originalUIRules = originalRules.map(rule => ({
      type: rule.allowed ? 'Allow' : 'Deny',
      value: rule.address
    }));
    if (JSON.stringify(localRules) !== JSON.stringify(originalUIRules)) {
      const backendRules = localRules.map(rule => ({
        address: rule.value,
        allowed: rule.type === 'Allow'
      }));
      configUpdate['services.CoAuthoring.ipfilter.rules'] = backendRules;
    }

    Object.keys(REQUEST_FILTERING_PATHS).forEach(key => {
      const path = REQUEST_FILTERING_PATHS[key];
      const originalValue = getNestedValue(config, path, false);
      if (localSettings[key] !== originalValue) {
        configUpdate[path] = localSettings[key];
      }
    });

    if (Object.keys(configUpdate).length > 0) {
      const mergedConfig = mergeNestedObjects([configUpdate]);
      await dispatch(saveConfig(mergedConfig)).unwrap();
      setHasChanges(false);
    }
  };

  const handleReset = async () => {
    const tabName = activeTab === 'ip-filtering' ? 'IP filtering' : 'Request filtering';
    const confirmed = window.confirm(`Reset ${tabName} settings to defaults?`);
    if (!confirmed) return;
    try {
      // Only reset active tab settings
      let paths = [];
      if (activeTab === 'ip-filtering') {
        paths = ['services.CoAuthoring.ipfilter.rules'];
      } else if (activeTab === 'request-filtering') {
        paths = Object.values(REQUEST_FILTERING_PATHS);
      }
      if (paths.length > 0) {
        const merged = await dispatch(resetConfig(paths)).unwrap();
        resetToGlobalConfig(merged);
      }
      setHasChanges(false);
    } catch (e) {
      console.error('Failed to reset settings:', e);
      alert('Failed to reset settings. Please try again.');
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'ip-filtering':
        return (
          <div>
            <AccessRules rules={localRules} onChange={handleRulesChange} />
            {getFieldError('services.CoAuthoring.ipfilter.rules') && (
              <div className={styles.error}>{getFieldError('services.CoAuthoring.ipfilter.rules')}</div>
            )}
          </div>
        );
      case 'request-filtering':
        return (
          <div>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>IP Address Filtering</h2>
              <p className={styles.sectionDescription}>Control access based on IP address types to enhance security.</p>

              <div className={styles.formRow}>
                <Checkbox
                  label='Use IP filtering for requests'
                  checked={localSettings.useforrequest}
                  onChange={value => handleFieldChange('useforrequest', value)}
                  description='Enable IP filtering for incoming requests. When disabled, rules and allow lists are ignored.'
                  error={getFieldError(REQUEST_FILTERING_PATHS.useforrequest)}
                />
              </div>

              <div className={styles.formRow}>
                <Checkbox
                  label='Allow Private IP Addresses'
                  checked={localSettings.allowPrivateIPAddress}
                  onChange={value => handleFieldChange('allowPrivateIPAddress', value)}
                  description='Allow requests from private IP address ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Disable this to block requests from internal networks.'
                  error={getFieldError(REQUEST_FILTERING_PATHS.allowPrivateIPAddress)}
                />
              </div>

              <div className={styles.formRow}>
                <Checkbox
                  label='Allow Meta IP Addresses'
                  checked={localSettings.allowMetaIPAddress}
                  onChange={value => handleFieldChange('allowMetaIPAddress', value)}
                  description='Allow requests from meta IP addresses (127.0.0.1, ::1, 0.0.0.0, etc.). Disable this to block localhost and other special-use addresses.'
                  error={getFieldError(REQUEST_FILTERING_PATHS.allowMetaIPAddress)}
                />
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.securitySettings} ${styles.pageWithFixedSave}`}>
      <PageHeader>IP Filtering</PageHeader>
      <PageDescription>Configure IP filtering and request filtering settings to control access to the server</PageDescription>

      <Tabs tabs={securityTabs} activeTab={activeTab} onTabChange={handleTabChange}>
        {renderTabContent()}
      </Tabs>

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

export default SecuritySettings;
