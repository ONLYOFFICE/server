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
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './SecuritySettings.module.scss';

const securityTabs = [{key: 'ip-filtering', label: 'IP Filtering'}];

function SecuritySettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  const [activeTab, setActiveTab] = useState('ip-filtering');
  const [localRules, setLocalRules] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset state and errors to global config
  const resetToGlobalConfig = () => {
    if (config) {
      const ipFilterRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
      const uiRules = ipFilterRules.map(rule => ({
        type: rule.allowed ? 'Allow' : 'Deny',
        value: rule.address
      }));
      setLocalRules(uiRules);
      setHasChanges(false);
      // Clear validation errors
      clearFieldError('services.CoAuthoring.ipfilter.rules');
    }
  };

  // Handle tab change and reset state
  const handleTabChange = newTab => {
    setActiveTab(newTab);
    resetToGlobalConfig();
  };

  const hasInitialized = useRef(false);

  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  // Handle rules changes
  const handleRulesChange = newRules => {
    setLocalRules(newRules);
    setHasChanges(true);

    // Validate the rules array structure
    if (newRules.length > 0) {
      const backendRules = newRules.map(rule => ({
        address: rule.value,
        allowed: rule.type === 'Allow'
      }));
      validateField('services.CoAuthoring.ipfilter.rules', backendRules);
    }
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    // Convert UI rules back to backend format
    const backendRules = localRules.map(rule => ({
      address: rule.value,
      allowed: rule.type === 'Allow'
    }));

    // Create config update object
    const configUpdate = mergeNestedObjects([
      {
        'services.CoAuthoring.ipfilter.rules': backendRules
      }
    ]);

    await dispatch(saveConfig(configUpdate)).unwrap();
    setHasChanges(false);
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
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.securitySettings} ${styles.pageWithFixedSave}`}>
      <PageHeader>Security Settings</PageHeader>
      <PageDescription>Configure IP filtering, authentication, and security policies</PageDescription>

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
