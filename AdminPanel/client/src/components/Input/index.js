import React from 'react';
import styles from './styles.module.css';

export default function Input({ 
  value, 
  onChange, 
  placeholder = '',
  type = 'text',
  error = null,
  className = '',
  onKeyDown = null,
  min = null,
  max = null
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`${styles.input} ${error ? styles.inputError : ''} ${className}`}
      min={min}
      max={max}
    />
  );
} 