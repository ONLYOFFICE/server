import styles from './MobileHeader.module.scss';

function MobileHeader({onMenuToggle, isOpen}) {
  return (
    <div className={`${styles.mobileHeader} ${isOpen ? styles['mobileHeader--open'] : ''}`}>
      <button className={styles.burger} onClick={onMenuToggle} aria-label='Menu' aria-expanded={isOpen}>
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div className={styles.title}>DocServer Admin Panel</div>
    </div>
  );
}

export default MobileHeader;
