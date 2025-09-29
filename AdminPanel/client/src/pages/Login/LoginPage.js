import {useState, useRef} from 'react';
import {useDispatch} from 'react-redux';
import {loginUser} from '../../store/slices/userSlice';
import Input from '../../components/LoginInput';
import Button from '../../components/LoginButton';
import styles from './styles.module.css';

export default function Login() {
  const [tenantName, setTenantName] = useState('localhost');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const dispatch = useDispatch();
  const buttonRef = useRef();

  const handleSubmit = async () => {
    setError('');

    try {
      await dispatch(loginUser({tenantName, secret})).unwrap();
    } catch (error) {
      setError(error || 'Invalid credentials. Please try again.');
      throw error; // Re-throw to trigger error state in Button component
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
        <p className={styles.subtitle}>Enter your secret key to access the admin panel</p>
        <p className={styles.description}>The session is valid for 60 minutes.</p>

        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <Input
              type='text'
              value={tenantName}
              onChange={setTenantName}
              placeholder='Enter your tenant name'
              description='The name of your tenant organization'
              error={error}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className={styles.inputGroup}>
            <Input
              type='password'
              value={secret}
              onChange={setSecret}
              placeholder='Enter your secret key'
              description='The secret key associated with your tenant'
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
