import {useState} from 'react';
import {useDispatch} from 'react-redux';
import {resetConfig} from '../../store/slices/configSlice';
import Button from '../../components/Button/Button';
import Section from '../../components/Section/Section';
import ConfigViewer from '../../components/ConfigViewer/ConfigViewer';
import Tabs from '../../components/Tabs/Tabs';
import ShutdownTab from '../../components/ShutdownTab/ShutdownTab';
import HttpsTab from './HttpsTab/HttpsTab';
import FontsTab from './FontsTab/FontsTab';
import SigningTab from './SigningTab/SigningTab';
import './Settings.scss';

// Base tabs that are always shown
const baseTabs = [
  {key: 'configuration', label: 'Configuration'},
  {key: 'pdf-signing', label: 'PDF Signing'},
  {key: 'https', label: 'HTTPS / SSL'},
  {key: 'fonts', label: 'Fonts'},
  {key: 'shutdown', label: 'Shutdown'}
];

const Settings = () => {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState('configuration');

  const handleResetConfig = async () => {
    if (!window.confirm('Are you sure you want to reset the configuration? This action cannot be undone.')) {
      return;
    }
    await dispatch(resetConfig(['*'])).unwrap();
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
      case 'pdf-signing':
        return <SigningTab />;
      case 'https':
        return <HttpsTab />;
      case 'fonts':
        return <FontsTab />;
      case 'shutdown':
        return <ShutdownTab />;
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
        <Tabs tabs={baseTabs} activeTab={activeTab} onTabChange={handleTabChange}>
          {renderTabContent()}
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
