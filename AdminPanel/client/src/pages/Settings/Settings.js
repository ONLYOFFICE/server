import {resetConfiguration} from '../../api';
import SaveButton from '../../components/SaveButton/SaveButton';
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

      <div className='settings-content'>
        <div className='settings-section'>
          <div className='settings-item'>
            <div className='settings-info'>
              <h3>Reset Configuration</h3>
              <p>This will reset all configuration settings to their default values. This action cannot be undone.</p>
            </div>
            <div className='settings-actions'>
              <SaveButton onClick={handleResetConfig}>Reset</SaveButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
