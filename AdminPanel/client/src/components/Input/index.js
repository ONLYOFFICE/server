import styles from './styles.module.css';

export default function Input({
  label,
  description,
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
    <div className={styles.inputContainer}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`${styles.input} ${error ? styles.inputError : ''} ${className}`}
        min={min}
        max={max}
      />
      {description && <p className={styles.description}>{description}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
