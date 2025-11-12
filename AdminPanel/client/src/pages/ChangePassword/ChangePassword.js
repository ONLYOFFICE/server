import {useState} from 'react';
import {changePassword} from '../../api';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import PasswordInput from '../../components/PasswordInput/PasswordInput';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import PasswordInputWithRequirements from '../../components/PasswordInputWithRequirements/PasswordInputWithRequirements';
import {usePasswordValidation} from '../../utils/passwordValidation';
import Section from '../../components/Section/Section';
import styles from './ChangePassword.module.scss';

function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const {isValid: newPasswordIsValid, isLoading} = usePasswordValidation(newPassword);

  // Check if form can be submitted
  const canSubmit = () => {
    if (!currentPassword || !newPassword || !confirmPassword || isLoading) {
      return false;
    }

    if (!newPasswordIsValid) {
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
        <Section>
          {passwordSuccess && <div className={styles.successMessage}>Password changed successfully!</div>}

          {passwordError && <div className={styles.errorMessage}>{passwordError}</div>}

          <div className={styles.form}>
            <PasswordInput
              label='Current Password'
              type='password'
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder='Enter current password'
              description='Your current admin password'
              isValid={true}
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
              <PasswordInput
                label='Confirm New Password'
                type='password'
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder='Confirm new password'
                description='Re-enter your new password'
                isValid={true}
              />
              <div className={styles.passwordMismatch}>
                {newPassword && confirmPassword && newPassword !== confirmPassword && newPasswordIsValid && "Passwords don't match"}
              </div>
            </div>

            <FixedSaveButton onClick={handlePasswordChange} disabled={!canSubmit()} />
          </div>
        </Section>
      </div>
    </div>
  );
}

export default ChangePassword;
