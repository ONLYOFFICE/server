import MobileMenuButton from '../MobileMenuButton/MobileMenuButton';
import styles from './MobileHeader.module.scss';

/**
 * Mobile header component with hamburger menu
 * @param {Object} props - Component props
 * @param {boolean} props.isMenuOpen - Whether mobile menu is open
 * @param {Function} props.onMenuToggle - Menu toggle handler
 */
const MobileHeader = ({isMenuOpen, onMenuToggle}) => {
  return (
    <header className={styles.header}>
      <MobileMenuButton isOpen={isMenuOpen} onClick={onMenuToggle} />
      <h1 className={styles.title}>ONLYOFFICE Admin</h1>
    </header>
  );
};

export default MobileHeader;
