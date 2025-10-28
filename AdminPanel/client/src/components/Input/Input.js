import styles from './Input.module.scss';

function Input({label, value, onChange, type = 'text', placeholder = '', error = null, description = null, width, ...props}) {
  const inputStyle = width ? {width} : {};

  return (
    <div className={styles.inputGroup}>
      {label && <label className={styles.label}>{label}</label>}
      {description && <p className={styles.description}>{description}</p>}
      <input
        className={`${styles.input} ${error ? styles['input--error'] : ''}`}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={inputStyle}
        {...props}
      />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

export default Input;
