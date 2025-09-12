import FileIcon from '../../../assets/File.svg';
import styles from './MenuItem.module.scss';

function MenuItem({label, isActive, onClick}) {
  return (
    <div className={`${styles.menuItem} ${isActive ? styles['menuItem--active'] : ''}`} onClick={onClick}>
      <img src={FileIcon} alt='' className={styles['menuItem__icon']} />
      <span className={styles['menuItem__label']}>{label}</span>
    </div>
  );
}

export default MenuItem;
