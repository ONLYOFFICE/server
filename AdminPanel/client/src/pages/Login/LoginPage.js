import {useState, useRef} from 'react';
import {useDispatch} from 'react-redux';
import {fetchUser} from '../../store/slices/userSlice';
import {login} from '../../api';
import Input from '../../components/LoginInput';
import Button from '../../components/LoginButton';
import styles from './styles.module.css';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const dispatch = useDispatch();
  const buttonRef = useRef();

  const handleSubmit = async () => {
    setError('');

    try {
      await login(password);
      // Wait for cookie to be set and verify authentication works
      await dispatch(fetchUser()).unwrap();
      // AuthWrapper will automatically redirect based on isAuthenticated
    } catch (error) {
      setError(error.message || 'Invalid password. Please try again.');
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
        <p className={styles.subtitle}>Enter your password to access the admin panel</p>
        <p className={styles.description}>The session is valid for 60 minutes.</p>

        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <Input
              type='password'
              value={password}
              onChange={setPassword}
              placeholder='Enter your password'
              description='Admin panel password'
              error={error}
              onKeyDown={handleKeyDown}
            />
          </div>

          <Button ref={buttonRef} onClick={handleSubmit} errorText='FAILED'>
            LOGIN
          </Button>
        </div>
      </div>
    </div>
  );
}
