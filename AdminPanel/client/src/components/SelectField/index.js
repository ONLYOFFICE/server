import styles from './styles.module.css';

export default function SelectField({
  label,
  value,
  onChange,
  options = [],
  error = null,
  description = null
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.inputContainer}>
        <select 
          value={value} 
          onChange={e => onChange(e.target.value)} 
          className={`${styles.select} ${error ? styles.inputError : ''}`}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* {error && <div className={styles.errorMessage}>{error}</div>} */}
      </div>
    </div>
  );
}
