import {useDispatch} from 'react-redux';
import {useLocation, useNavigate} from 'react-router-dom';
import {useEffect} from 'react';
import {clearConfig} from '../../store/slices/configSlice';
import {logout} from '../../api';
import MenuItem from './MenuItem/MenuItem';
import AppMenuLogo from '../../assets/AppMenuLogo.svg';
import {menuItems} from '../../config/menuItems';
import useMediaQuery from '../../hooks/useMediaQuery';
import styles from './Menu.module.scss';
import FileIcon from '../../assets/File.svg';

function Menu({isMobileMenuOpen, setIsMobileMenuOpen}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const isMobile = useMediaQuery('(max-width: 768px)');

  // Close mobile menu when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      setIsMobileMenuOpen(false);
    }
  }, [isMobile, setIsMobileMenuOpen]);

  const handleLogout = async () => {
    try {
      await logout();
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
      window.location.reload();
    }
  };

  const handleMenuItemClick = item => {
    // Clear config to force reload when switching pages
    dispatch(clearConfig());
    navigate(item.path);

    // Close mobile menu after navigation
    if (isMobile) {
      setIsMobileMenuOpen(false);
    }
  };

  const isActiveItem = path => {
    return location.pathname.endsWith(path);
  };

  return (
    <>
      {/* Menu Overlay for Mobile */}
      {isMobile && isMobileMenuOpen && <div className={styles['menu__overlay']} onClick={() => setIsMobileMenuOpen(false)} />}

      {/* Main Menu */}
      <div className={`${styles.menu} ${isMobile && isMobileMenuOpen ? styles['menu--open'] : ''}`}>
        <div className={styles['menu__content']}>
          <div className={styles['menu__logoContainer']}>
            <img src={AppMenuLogo} alt='ONLYOFFICE' className={styles['menu__logo']} />
          </div>

          <div className={styles['menu__title']}>DocServer Admin Panel</div>

          <div className={styles['menu__separator']}></div>

          <div className={styles['menu__menuItems']}>
            {menuItems.map(item => (
              <MenuItem
                key={item.key}
                label={item.label}
                isActive={isActiveItem(item.path)}
                onClick={() => handleMenuItemClick(item)}
                icon={FileIcon}
              />
            ))}
            <MenuItem label='Logout' isActive={false} onClick={handleLogout} />
          </div>
        </div>
      </div>
    </>
  );
}

export default Menu;
