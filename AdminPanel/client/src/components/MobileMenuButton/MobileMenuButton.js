import styles from './MobileMenuButton.module.scss';

/**
 * Mobile hamburger menu button component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether menu is open
 * @param {Function} props.onClick - Click handler
 */
const MobileMenuButton = ({isOpen, onClick}) => {
  return (
    <button className={`${styles.hamburger} ${isOpen ? styles.active : ''}`} onClick={onClick} type='button' aria-label='Toggle mobile menu'>
      <span className={styles.line}></span>
      <span className={styles.line}></span>
      <span className={styles.line}></span>
    </button>
  );
};

export default MobileMenuButton;
