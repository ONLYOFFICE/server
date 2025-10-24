import {useState} from 'react';
import styles from './PasswordInput.module.scss';

function PasswordInput({label, value, onChange, placeholder = '', error = null, description = null, width, isValid = true, ...props}) {
  const [showPassword, setShowPassword] = useState(false);
  const inputStyle = width ? {width} : {};

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <div className={styles.inputGroup}>
      {label && <label className={styles.label}>{label}</label>}
      {description && <p className={styles.description}>{description}</p>}
      <div className={styles.inputContainer}>
        <input
          className={`${styles.input} ${error ? styles['input--error'] : ''} ${!isValid && value ? styles['input--invalid'] : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={inputStyle}
          {...props}
          type={showPassword ? 'text' : 'password'}
        />
        <button
          type='button'
          className={styles.toggleButton}
          onClick={togglePasswordVisibility}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? (
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={styles.eyeIcon}>
              <path
                d='M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
                fill='#666666'
              />
              <path d='M2 2l20 20' stroke='#666666' strokeWidth='2' strokeLinecap='round' />
            </svg>
          ) : (
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={styles.eyeIcon}>
              <path
                d='M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
                fill='#666666'
              />
            </svg>
          )}
        </button>
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

export default PasswordInput;
