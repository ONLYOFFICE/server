import {useState} from 'react';
import {resetConfiguration} from '../../api';
import Button from '../../components/Button/Button';
import Section from '../../components/Section/Section';
import ConfigViewer from '../../components/ConfigViewer/ConfigViewer';
import Tabs from '../../components/Tabs/Tabs';
import './Settings.scss';

const settingsTabs = [
  {key: 'configuration', label: 'Configuration'},
  {key: 'server-reload', label: 'Server Reload'}
];

const Settings = () => {
  const [activeTab, setActiveTab] = useState('configuration');

  const handleResetConfig = async () => {
    if (!window.confirm('Are you sure you want to reset the configuration? This action cannot be undone.')) {
      throw new Error('Operation cancelled');
    }

    await resetConfiguration();
  };

  const handleTabChange = newTab => {
    setActiveTab(newTab);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'configuration':
        return (
          <>
            <Section title='Server Configuration' description='Full server configuration for monitoring purposes.'>
              <ConfigViewer />
            </Section>

            <Section
              title='Reset Configuration'
              description='This will reset all configuration settings to their default values. This action cannot be undone.'
            >
              <Button onClick={handleResetConfig}>Reset</Button>
            </Section>
          </>
        );
      case 'server-reload':
        return null;
      default:
        return null;
    }
  };

  return (
    <div className='settings-page'>
      <div className='page-header'>
        <h1>Settings</h1>
      </div>

      <div className='settings-content' title='Settings'>
        <Tabs tabs={settingsTabs} activeTab={activeTab} onTabChange={handleTabChange}>
          {renderTabContent()}
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
