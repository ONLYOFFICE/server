import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchConfig, saveConfig, selectConfig, selectConfigLoading } from '../../store/slices/configSlice';
import { getNestedValue } from '../../utils/getNestedValue';
import { mergeNestedObjects } from '../../utils/mergeNestedObjects';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Tabs from '../../components/Tabs/Tabs';
import Input from '../../components/Input/Input';
import Checkbox from '../../components/Checkbox/Checkbox';
import SaveButton from '../../components/SaveButton/SaveButton';
import styles from './EmailConfig.module.scss';

const emailConfigTabs = [
  { key: 'smtp-server', label: 'SMTP Server' },
  { key: 'security', label: 'Security' },
  { key: 'defaults', label: 'Default Emails' }
];

function EmailConfig() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const loading = useSelector(selectConfigLoading);
  const { validateField, getFieldError } = useFieldValidation();
  
  const [activeTab, setActiveTab] = useState('smtp-server');
  
  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({
    smtpHost: '',
    smtpPort: '',
    smtpUsername: '',
    smtpPassword: '',
    disableFileAccess: false,
    disableUrlAccess: false,
    defaultFromEmail: '',
    defaultToEmail: ''
  });
  const [hasChanges, setHasChanges] = useState(false);
  // Configuration paths
  const CONFIG_PATHS = {
    smtpHost: 'email.smtpServerConfiguration.host',
    smtpPort: 'email.smtpServerConfiguration.port',
    smtpUsername: 'email.smtpServerConfiguration.auth.user',
    smtpPassword: 'email.smtpServerConfiguration.auth.pass',
    disableFileAccess: 'email.connectionConfiguration.disableFileAccess',
    disableUrlAccess: 'email.connectionConfiguration.disableUrlAccess',
    defaultFromEmail: 'email.contactDefaults.from',
    defaultToEmail: 'email.contactDefaults.to'
  };

  // Load config data when component mounts
  useEffect(() => {
    if (!config) {
      dispatch(fetchConfig());
    } else {
      const settings = {};
      Object.keys(CONFIG_PATHS).forEach(key => {
        const value = getNestedValue(config, CONFIG_PATHS[key], '');
        settings[key] = value;
      });
      setLocalSettings(settings);
      setHasChanges(false);
    }
  }, [dispatch, config]);

  // Handle field changes
  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate fields with schema validation
    if (CONFIG_PATHS[field]) {
      let validationValue = value;
      
      // Convert port to integer for validation
      if (field === 'smtpPort' && value !== '') {
        validationValue = parseInt(value);
        if (!isNaN(validationValue)) {
          validateField(CONFIG_PATHS[field], validationValue);
        }
      } else if (typeof value === 'string') {
        validateField(CONFIG_PATHS[field], value);
      } else if (typeof value === 'boolean') {
        validateField(CONFIG_PATHS[field], value);
      }
    }

    // Check if there are changes
    const originalValue = getNestedValue(config, CONFIG_PATHS[field], '');
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
      let value = localSettings[key];
      
      // Convert port to integer
      if (key === 'smtpPort') {
        value = value ? parseInt(value) : 587;
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
      case 'smtp-server':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Input
                label="SMTP Host:"
                value={localSettings.smtpHost}
                onChange={(value) => handleFieldChange('smtpHost', value)}
                placeholder="localhost"
                description="SMTP server hostname or IP address"
                error={getFieldError(CONFIG_PATHS.smtpHost)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label="SMTP Port:"
                type="number"
                value={localSettings.smtpPort}
                onChange={(value) => handleFieldChange('smtpPort', value)}
                placeholder="587"
                description="SMTP server port number (typically 587 for TLS, 465 for SSL, 25 for unencrypted)"
                min="1"
                max="65535"
                error={getFieldError(CONFIG_PATHS.smtpPort)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label="SMTP Username:"
                value={localSettings.smtpUsername}
                onChange={(value) => handleFieldChange('smtpUsername', value)}
                placeholder=""
                description="Username for SMTP authentication (leave empty if no authentication required)"
                error={getFieldError(CONFIG_PATHS.smtpUsername)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label="SMTP Password:"
                type="password"
                value={localSettings.smtpPassword}
                onChange={(value) => handleFieldChange('smtpPassword', value)}
                placeholder=""
                description="Password for SMTP authentication (leave empty if no authentication required)"
                error={getFieldError(CONFIG_PATHS.smtpPassword)}
              />
            </div>
          </div>
        );
      case 'security':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Checkbox
                label="Disable File Access:"
                checked={localSettings.disableFileAccess}
                onChange={(value) => handleFieldChange('disableFileAccess', value)}
                description="Prevent email connections from accessing local files"
                error={getFieldError(CONFIG_PATHS.disableFileAccess)}
              />
            </div>

            <div className={styles.formRow}>
              <Checkbox
                label="Disable URL Access:"
                checked={localSettings.disableUrlAccess}
                onChange={(value) => handleFieldChange('disableUrlAccess', value)}
                description="Prevent email connections from accessing external URLs"
                error={getFieldError(CONFIG_PATHS.disableUrlAccess)}
              />
            </div>
          </div>
        );
      case 'defaults':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Input
                label="Default From Email:"
                type="email"
                value={localSettings.defaultFromEmail}
                onChange={(value) => handleFieldChange('defaultFromEmail', value)}
                placeholder="from@example.com"
                description="Default sender email address for system notifications"
                error={getFieldError(CONFIG_PATHS.defaultFromEmail)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label="Default To Email:"
                type="email"
                value={localSettings.defaultToEmail}
                onChange={(value) => handleFieldChange('defaultToEmail', value)}
                placeholder="to@example.com"
                description="Default recipient email address for system notifications"
                error={getFieldError(CONFIG_PATHS.defaultToEmail)}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        Loading email configuration...
      </div>
    );
  }

  return (
    <div className={styles.emailConfig}>
      <PageHeader>Email Configuration</PageHeader>
      <PageDescription>
        Configure SMTP server settings, security options, and default email addresses
      </PageDescription>

      <Tabs 
        tabs={emailConfigTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {renderTabContent()}
      </Tabs>

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

export default EmailConfig;
