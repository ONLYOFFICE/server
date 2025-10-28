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
import Checkbox from '../../components/Checkbox/Checkbox';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './NotificationConfig.module.scss';

const emailConfigTabs = [
  {key: 'notifications', label: 'Notification Rules'},
  {key: 'smtp-server', label: 'SMTP Server'},
  {key: 'defaults', label: 'Default Emails'}
];

function EmailConfig() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const {validateField, getFieldError, hasValidationErrors, clearFieldError} = useFieldValidation();

  const [activeTab, setActiveTab] = useState('notifications');

  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({
    smtpHost: '',
    smtpPort: '',
    smtpUsername: '',
    smtpPassword: '',
    defaultFromEmail: '',
    defaultToEmail: '',
    licenseExpirationWarningEnable: false,
    licenseExpirationWarningRepeatInterval: '',
    licenseExpirationErrorEnable: false,
    licenseExpirationErrorRepeatInterval: '',
    licenseLimitEditEnable: false,
    licenseLimitEditRepeatInterval: '',
    licenseLimitLiveViewerEnable: false,
    licenseLimitLiveViewerRepeatInterval: ''
  });
  const [hasChanges, setHasChanges] = useState(false);
  const hasInitialized = useRef(false);

  // Configuration paths
  const CONFIG_PATHS = {
    smtpHost: 'email.smtpServerConfiguration.host',
    smtpPort: 'email.smtpServerConfiguration.port',
    smtpUsername: 'email.smtpServerConfiguration.auth.user',
    smtpPassword: 'email.smtpServerConfiguration.auth.pass',
    defaultFromEmail: 'email.contactDefaults.from',
    defaultToEmail: 'email.contactDefaults.to',
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

  // Initialize settings from config when component loads (only once)
  if (config && !hasInitialized.current) {
    resetToGlobalConfig();
    hasInitialized.current = true;
  }

  // Handle tab change and reset state
  const handleTabChange = newTab => {
    setActiveTab(newTab);
    resetToGlobalConfig();
  };

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
                label='SMTP Host:'
                value={localSettings.smtpHost}
                onChange={value => handleFieldChange('smtpHost', value)}
                placeholder='localhost'
                description='SMTP server hostname or IP address'
                error={getFieldError(CONFIG_PATHS.smtpHost)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='SMTP Port:'
                type='number'
                value={localSettings.smtpPort}
                onChange={value => handleFieldChange('smtpPort', value)}
                placeholder='587'
                description='SMTP server port number (typically 587 for TLS, 465 for SSL, 25 for unencrypted)'
                min='1'
                max='65535'
                error={getFieldError(CONFIG_PATHS.smtpPort)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='SMTP Username:'
                value={localSettings.smtpUsername}
                onChange={value => handleFieldChange('smtpUsername', value)}
                placeholder=''
                description='Username for SMTP authentication (leave empty if no authentication required)'
                error={getFieldError(CONFIG_PATHS.smtpUsername)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='SMTP Password:'
                type='password'
                value={localSettings.smtpPassword}
                onChange={value => handleFieldChange('smtpPassword', value)}
                placeholder=''
                description='Password for SMTP authentication (leave empty if no authentication required)'
                error={getFieldError(CONFIG_PATHS.smtpPassword)}
              />
            </div>
          </div>
        );
      case 'defaults':
        return (
          <div className={styles.tabPanel}>
            <div className={styles.formRow}>
              <Input
                label='Default From Email:'
                type='email'
                value={localSettings.defaultFromEmail}
                onChange={value => handleFieldChange('defaultFromEmail', value)}
                placeholder='from@example.com'
                description='Default sender email address for system notifications'
                error={getFieldError(CONFIG_PATHS.defaultFromEmail)}
              />
            </div>

            <div className={styles.formRow}>
              <Input
                label='Default To Email:'
                type='email'
                value={localSettings.defaultToEmail}
                onChange={value => handleFieldChange('defaultToEmail', value)}
                placeholder='to@example.com'
                description='Default recipient email address for system notifications'
                error={getFieldError(CONFIG_PATHS.defaultToEmail)}
              />
            </div>
          </div>
        );
      case 'notifications':
        return (
          <>
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
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.emailConfig} ${styles.pageWithFixedSave}`}>
      <PageHeader>Notifications</PageHeader>
      <PageDescription>Configure SMTP server settings, security options, default email addresses, and notification rules</PageDescription>

      <Tabs tabs={emailConfigTabs} activeTab={activeTab} onTabChange={handleTabChange}>
        {renderTabContent()}
      </Tabs>

      <FixedSaveButton onClick={handleSave} disabled={!hasChanges || hasValidationErrors()}>
        Save Changes
      </FixedSaveButton>
    </div>
  );
}

export default EmailConfig;
