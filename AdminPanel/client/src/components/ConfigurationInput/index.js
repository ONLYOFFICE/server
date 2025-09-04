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
  description = null
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.inputContainer}>
        <Input 
          type={type} 
          value={value} 
          onChange={onChange} 
          placeholder={placeholder} 
          min={min} 
          max={max}
          error={error}
        />
        {/* {error && <div className={styles.errorMessage}>{error}</div>} */}
      </div>
    </div>
  );
}
