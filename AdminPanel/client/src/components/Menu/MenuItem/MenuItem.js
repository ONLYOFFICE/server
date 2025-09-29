import styles from './MenuItem.module.scss';

function MenuItem({label, isActive, onClick, icon}) {
  return (
    <div className={`${styles.menuItem} ${isActive ? styles['menuItem--active'] : ''}`} onClick={onClick}>
      {icon ? <img src={icon} alt='' className={styles['menuItem__icon']} /> : <div className={styles['menuItem__icon']} />}
      <span className={styles['menuItem__label']}>{label}</span>
    </div>
  );
}

export default MenuItem;
