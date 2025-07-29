import React, { useState, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { loginUser } from '../../store/slices/userSlice';
import Input from '../../components/Input';
import Button from '../../components/Button';
import styles from './styles.module.css';

export default function Login() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const dispatch = useDispatch();
  const buttonRef = useRef();

  const handleSubmit = async () => {
    setError('');

    try {
      await dispatch(loginUser(secret)).unwrap();
    } catch (error) {
      setError(error || 'Invalid credentials. Please try again.');
      throw error; // Re-throw to trigger error state in Button component
    }
  };

  const handleKeyDown = (e) => {
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
        <p className={styles.description}>
          The session is valid for 60 minutes.
        </p>
        
        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <Input
              label="Secret Key"
              type="password"
              value={secret}
              onChange={setSecret}
              placeholder="Enter your secret key"
              error={error}
              onKeyDown={handleKeyDown}
            />
          </div>

          <Button
            ref={buttonRef}
            onClick={handleSubmit}
            errorText="FAILED"
          >
            LOGIN
          </Button>
        </div>
      </div>
    </div>
  );
} 