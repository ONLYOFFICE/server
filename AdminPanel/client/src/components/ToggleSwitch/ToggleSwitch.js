import styles from './ToggleSwitch.module.scss';

function ToggleSwitch({label, checked, onChange, ...props}) {
  return (
    <div className={styles.toggleGroup}>
      <span className={styles.label}>{label}</span>
      <div className={`${styles.switch} ${checked ? styles['switch--on'] : styles['switch--off']}`} onClick={() => onChange(!checked)} {...props}>
        <div className={styles.circle}></div>
      </div>
    </div>
  );
}

export default ToggleSwitch;
