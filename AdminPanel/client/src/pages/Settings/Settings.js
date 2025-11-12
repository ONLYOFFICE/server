import {resetConfiguration} from '../../api';
import Button from '../../components/Button/Button';
import Section from '../../components/Section/Section';
import './Settings.scss';

const Settings = () => {
  const handleResetConfig = async () => {
    if (!window.confirm('Are you sure you want to reset the configuration? This action cannot be undone.')) {
      throw new Error('Operation cancelled');
    }

    await resetConfiguration();
  };

  return (
    <div className='settings-page'>
      <div className='page-header'>
        <h1>Settings</h1>
      </div>

      <div className='settings-content' title='Settings'>
        <Section
          title='Reset Configuration'
          description='This will reset all configuration settings to their default values. This action cannot be undone.'
        >
          <Button onClick={handleResetConfig}>Reset</Button>
        </Section>
      </div>
    </div>
  );
};

export default Settings;
