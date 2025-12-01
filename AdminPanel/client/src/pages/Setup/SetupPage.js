import {useState, useRef} from 'react';
import {useDispatch} from 'react-redux';
import {setupAdminPassword} from '../../api';
import {fetchUser} from '../../store/slices/userSlice';
import Input from '../../components/Input/Input';
import Button from '../../components/Button/Button';
import PasswordInput from '../../components/PasswordInput/PasswordInput';
import PasswordInputWithRequirements from '../../components/PasswordInputWithRequirements/PasswordInputWithRequirements';
import {usePasswordValidation} from '../../utils/passwordValidation';
import styles from './styles.module.css';

export default function Setup() {
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const dispatch = useDispatch();
  const buttonRef = useRef();

  const {isValid: passwordIsValid, isLoading} = usePasswordValidation(password);

  // Check if form can be submitted
  const canSubmit = () => {
    if (!bootstrapToken.trim() || !password || !confirmPassword || isLoading) {
      return false;
    }

    // Check if password meets all requirements using hook
    if (!passwordIsValid) {
      return false;
    }

    if (password !== confirmPassword) {
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    setErrors({});
    try {
      await setupAdminPassword({bootstrapToken, password});
      // Wait for cookie to be set and verify authentication works
      await dispatch(fetchUser()).unwrap();
      // AuthWrapper will automatically redirect based on isAuthenticated
    } catch (error) {
      // Server error
      setErrors({
        general: error.message || 'Setup failed. Invalid token or server error.'
      });
      throw error;
    }
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') {
      if (buttonRef.current) {
        buttonRef.current.click();
      }
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>ONLYOFFICE Admin Panel</h1>
        <p className={styles.subtitle}>Initial Setup</p>
        <p className={styles.description}>Enter the bootstrap token from server logs and create your admin password.</p>

        {errors.general && <div className={styles.errorMessage}>{errors.general}</div>}

        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <Input
              type='text'
              value={bootstrapToken}
              onChange={setBootstrapToken}
              placeholder='Enter bootstrap token'
              error={errors.bootstrapToken}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className={styles.inputGroup}>
            <PasswordInputWithRequirements
              type='password'
              value={password}
              onChange={setPassword}
              placeholder='Enter your password'
              error={errors.password}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className={styles.inputGroup}>
            <PasswordInput
              type='password'
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder='Confirm your password'
              error={errors.confirmPassword}
              onKeyDown={handleKeyDown}
              isValid={true}
            />
            <div className={styles.passwordMismatch}>
              {password && confirmPassword && password !== confirmPassword && passwordIsValid && "Passwords don't match"}
            </div>
          </div>

          <Button ref={buttonRef} onClick={handleSubmit} errorText='FAILED' disabled={!canSubmit()}>
            SETUP
          </Button>
        </div>
      </div>
    </div>
  );
}
