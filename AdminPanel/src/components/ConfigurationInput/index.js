import React from 'react';
import Input from '../Input';
import styles from './styles.module.css';

export default function ConfigurationInput({ 
  label, 
  value, 
  onChange, 
  placeholder = '',
  type = 'text',
  error = null,
  min = null,
  max = null,
  options = [],
  description = null
}) {
  const renderInput = () => {
    if (type === 'select') {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <Input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        error={error}
        min={min}
        max={max}
      />
    );
  };

  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.inputContainer}>
        {renderInput()}
        {description && (
          <div className={styles.description}>
            {description}
          </div>
        )}
        {error && (
          <div className={styles.errorMessage}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
} 