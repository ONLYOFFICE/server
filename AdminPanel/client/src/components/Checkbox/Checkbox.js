import styles from './Checkbox.module.scss';

function Checkbox({label, checked, onChange, description = null, error = null, ...props}) {
  return (
    <div className={styles.checkboxGroup}>
      <label className={styles.checkboxLabel}>
        <input className={styles.checkbox} type='checkbox' checked={checked} onChange={e => onChange(e.target.checked)} {...props} />
        <span className={`${styles.checkmark} ${error ? styles.checkmarkError : ''}`}></span>
        <div className={styles.labelContent}>
          <span className={styles.labelText}>{label}</span>
          {description && <p className={styles.description}>{description}</p>}
          {error && <span className={styles.error}>{error}</span>}
        </div>
      </label>
    </div>
  );
}

export default Checkbox;
