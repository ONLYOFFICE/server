import {useState} from 'react';
import {changePassword} from '../../api';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Input from '../../components/Input/Input';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import PasswordInputWithRequirements from '../../components/PasswordInputWithRequirements/PasswordInputWithRequirements';
import {validatePasswordStrength} from '../../utils/passwordValidation';
import styles from './ChangePassword.module.scss';

function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Check if form can be submitted
  const canSubmit = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return false;
    }
    
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return false;
    }
    
    if (newPassword !== confirmPassword) {
      return false;
    }
    
    return true;
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    setPasswordSuccess(false);

    // Validation
    if (!currentPassword) {
      setPasswordError('Current password is required');
      throw new Error('Validation failed');
    }

    if (!newPassword) {
      setPasswordError('New password is required');
      throw new Error('Validation failed');
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      setPasswordError(passwordValidation.errorMessage);
      throw new Error('Validation failed');
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      throw new Error('Validation failed');
    }

    try {
      await changePassword({currentPassword, newPassword});
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error.message || 'Failed to change password');
      throw error;
    }
  };

  return (
    <div>
      <PageHeader>Change Password</PageHeader>
      <PageDescription>Update your admin panel password</PageDescription>

      <div className={styles.content}>
        <div className={styles.section}>
          {passwordSuccess && <div className={styles.successMessage}>Password changed successfully!</div>}

          {passwordError && <div className={styles.errorMessage}>{passwordError}</div>}

          <div className={styles.form}>
            <Input
              label='Current Password'
              type='password'
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder='Enter current password'
              description='Your current admin password'
            />

            <PasswordInputWithRequirements
              label='New Password'
              type='password'
              value={newPassword}
              onChange={setNewPassword}
              placeholder='Enter new password'
              description='Create a strong password'
            />

            <div className={styles.confirmPasswordGroup}>
              <Input
                label='Confirm New Password'
                type='password'
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder='Confirm new password'
                description='Re-enter your new password'
              />
              <div className={styles.passwordMismatch}>
                {newPassword && confirmPassword && newPassword !== confirmPassword && validatePasswordStrength(newPassword).isValid && (
                  'Passwords don\'t match'
                )}
              </div>
            </div>

            <FixedSaveButton onClick={handlePasswordChange} disabled={!canSubmit()} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChangePassword;
