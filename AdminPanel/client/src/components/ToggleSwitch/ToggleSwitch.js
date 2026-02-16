import styles from './ToggleSwitch.module.scss';

function ToggleSwitch({label, checked, onChange, disabled, ...props}) {
  const switchClass = [styles.switch, checked ? styles['switch--on'] : styles['switch--off'], disabled ? styles['switch--disabled'] : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.toggleGroup}>
      <span className={styles.label}>{label}</span>
      <div className={switchClass} onClick={() => !disabled && onChange(!checked)} {...props}>
        <div className={styles.circle}></div>
      </div>
    </div>
  );
}

export default ToggleSwitch;
