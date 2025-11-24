import {useState, useRef} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {saveConfig, selectConfig} from '../../store/slices/configSlice';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {useFieldValidation} from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Tabs from '../../components/Tabs/Tabs';
import AccessRules from '../../components/AccessRules/AccessRules';
import Section from '../../components/Section/Section';
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './SecuritySettings.module.scss';

const securityTabs = [
  {key: 'ip-rules', label: 'IP Rules'},
  {key: 'request-filtering', label: 'Request Filtering'}
];

const CONFIG_PATHS = {
  allowPrivateIPAddress: 'services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress',
  allowMetaIPAddress: 'services.CoAuthoring.request-filtering-agent.allowMetaIPAddress',
  useforrequest: 'services.CoAuthoring.ipfilter.useforrequest'
};

function SecuritySettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  const [activeTab, setActiveTab] = useState('ip-rules');
  const [localRules, setLocalRules] = useState([]);
  const [localSettings, setLocalSettings] = useState({
    allowPrivateIPAddress: false,
    allowMetaIPAddress: false,
    useforrequest: false
  });
  const [hasChanges, setHasChanges] = useState(false);

  const hasInitialized = useRef(false);

  const computeHasChanges = (nextSettings = localSettings, nextRules = localRules) => {
    if (!config) return false;

    const originalRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
    const normalizedOriginalRules = originalRules.map(rule => ({
      address: rule.address,
      allowed: !!rule.allowed
    }));
    const nextBackendRules = nextRules.map(rule => ({
      address: rule.value,
      allowed: rule.type === 'Allow'
    }));

    const rulesChanged = JSON.stringify(normalizedOriginalRules) !== JSON.stringify(nextBackendRules);
    const settingsChanged = Object.keys(CONFIG_PATHS).some(key => {
      const originalValue = getNestedValue(config, CONFIG_PATHS[key], false);
      return originalValue !== nextSettings[key];
    });

    return rulesChanged || settingsChanged;
  };

  const resetToGlobalConfig = () => {
    if (!config) return;

    const ipFilterRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
    const uiRules = ipFilterRules.map(rule => ({
      type: rule.allowed ? 'Allow' : 'Deny',
      value: rule.address
    }));
    setLocalRules(uiRules);

    const newSettings = {};
    Object.keys(CONFIG_PATHS).forEach(key => {
      newSettings[key] = getNestedValue(config, CONFIG_PATHS[key], false);
      clearFieldError(CONFIG_PATHS[key]);
    });
    setLocalSettings(newSettings);
    clearFieldError('services.CoAuthoring.ipfilter.rules');
    setHasChanges(false);
  };

  const handleTabChange = newTab => {
    setActiveTab(newTab);
    resetToGlobalConfig();
  };

  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  const handleRulesChange = newRules => {
    setLocalRules(newRules);
    setHasChanges(computeHasChanges(localSettings, newRules));

    if (newRules.length > 0) {
      const backendRules = newRules.map(rule => ({
        address: rule.value,
        allowed: rule.type === 'Allow'
      }));
      validateField('services.CoAuthoring.ipfilter.rules', backendRules);
    } else {
      clearFieldError('services.CoAuthoring.ipfilter.rules');
    }
  };

  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => {
      const updatedSettings = {
        ...prev,
        [field]: value
      };

      if (CONFIG_PATHS[field]) {
        validateField(CONFIG_PATHS[field], value);
      }

      setHasChanges(computeHasChanges(updatedSettings, localRules));
      return updatedSettings;
    });
  };

  const handleSave = async () => {
    if (!hasChanges || !config) return;

    const updates = [];

    const backendRules = localRules.map(rule => ({
      address: rule.value,
      allowed: rule.type === 'Allow'
    }));
    const originalRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);

    if (JSON.stringify(originalRules) !== JSON.stringify(backendRules)) {
      updates.push({
        'services.CoAuthoring.ipfilter.rules': backendRules
      });
    }

    const settingsChanged = Object.keys(CONFIG_PATHS).some(key => {
      const originalValue = getNestedValue(config, CONFIG_PATHS[key], false);
      return originalValue !== localSettings[key];
    });

    if (settingsChanged) {
      const settingsUpdate = {};
      Object.keys(CONFIG_PATHS).forEach(key => {
        settingsUpdate[CONFIG_PATHS[key]] = localSettings[key];
      });
      updates.push(settingsUpdate);
    }

    if (updates.length === 0) {
      setHasChanges(false);
      return;
    }

    const configUpdate = mergeNestedObjects(updates);
    await dispatch(saveConfig(configUpdate)).unwrap();
    setHasChanges(false);
  };

  const renderIpRulesTab = () => (
    <div>
      <AccessRules rules={localRules} onChange={handleRulesChange} />
      {getFieldError('services.CoAuthoring.ipfilter.rules') && (
        <div className={styles.error}>{getFieldError('services.CoAuthoring.ipfilter.rules')}</div>
      )}
    </div>
  );

  const renderRequestFilteringTab = () => (
    <Section title='Request Filtering' description='Control how requests are processed by specifying which address types can reach the server.'>
      <div className={styles.formRow}>
        <Checkbox
          label='Use IP filtering for requests'
          checked={localSettings.useforrequest}
          onChange={value => handleFieldChange('useforrequest', value)}
          description='Enable IP filtering for incoming requests. When disabled, rules are ignored.'
          error={getFieldError(CONFIG_PATHS.useforrequest)}
        />
      </div>
      <div className={styles.formRow}>
        <Checkbox
          label='Allow Private IP Addresses'
          checked={localSettings.allowPrivateIPAddress}
          onChange={value => handleFieldChange('allowPrivateIPAddress', value)}
          description='Allow requests from private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).'
          error={getFieldError(CONFIG_PATHS.allowPrivateIPAddress)}
        />
      </div>
      <div className={styles.formRow}>
        <Checkbox
          label='Allow Meta IP Addresses'
          checked={localSettings.allowMetaIPAddress}
          onChange={value => handleFieldChange('allowMetaIPAddress', value)}
          description='Allow requests from meta IP addresses (127.0.0.1, ::1, 0.0.0.0, etc.).'
          error={getFieldError(CONFIG_PATHS.allowMetaIPAddress)}
        />
      </div>
    </Section>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'ip-rules':
        return renderIpRulesTab();
      case 'request-filtering':
        return renderRequestFilteringTab();
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.securitySettings} ${styles.pageWithFixedSave}`}>
      <PageHeader>IP Filtering</PageHeader>
      <PageDescription>Configure IP filtering rules and request behavior to protect your deployment.</PageDescription>

      <Tabs tabs={securityTabs} activeTab={activeTab} onTabChange={handleTabChange}>
        {renderTabContent()}
      </Tabs>

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default SecuritySettings;
