import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchConfig, saveConfig, selectConfig, selectConfigLoading } from '../../store/slices/configSlice';
import { getNestedValue } from '../../utils/getNestedValue';
import { mergeNestedObjects } from '../../utils/mergeNestedObjects';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Tabs from '../../components/Tabs/Tabs' ;
import AccessRules from '../../components/AccessRules/AccessRules';
import SaveButton from '../../components/SaveButton/SaveButton';
import styles from './SecuritySettings.module.scss';

const securityTabs = [
  { key: 'ip-filtering', label: 'IP Filtering' }
];

function SecuritySettings() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const loading = useSelector(selectConfigLoading);
  const { validateField, getFieldError, hasValidationErrors } = useFieldValidation();
  
  const [activeTab, setActiveTab] = useState('ip-filtering');
  const [localRules, setLocalRules] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!config) {
      dispatch(fetchConfig());
    } else {
      // Get IP filtering rules from actual config
      const ipFilterRules = getNestedValue(config, 'services.CoAuthoring.ipfilter.rules', []);
      
      // Convert from backend format to UI format
      const uiRules = ipFilterRules.map(rule => ({
        type: rule.allowed ? 'Allow' : 'Deny',
        value: rule.address
      }));
      
      setLocalRules(uiRules);
      setHasChanges(false);
    }
  }, [dispatch, config]);

  // Handle rules changes
  const handleRulesChange = (newRules) => {
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
    const configUpdate = mergeNestedObjects([{
      'services.CoAuthoring.ipfilter.rules': backendRules
    }]);
    
    await dispatch(saveConfig(configUpdate)).unwrap();
    setHasChanges(false);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'ip-filtering':
        return (
          <div>
            <AccessRules
              rules={localRules}
              onChange={handleRulesChange}
            />
            {getFieldError('services.CoAuthoring.ipfilter.rules') && (
              <div className={styles.error}>
                {getFieldError('services.CoAuthoring.ipfilter.rules')}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        Loading security settings...
      </div>
    );
  }

  return (
    <div className={styles.securitySettings}>
      <PageHeader>Security Settings</PageHeader>
      <PageDescription>
        Configure IP filtering, authentication, and security policies
      </PageDescription>

      <Tabs 
        tabs={securityTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {renderTabContent()}
      </Tabs>

      <div className={styles.actions}>
        <SaveButton 
          onClick={handleSave}
          disabled={!hasChanges || hasValidationErrors()}
        >
          Save Changes
        </SaveButton>
      </div>
    </div>
  );
}

export default SecuritySettings;
