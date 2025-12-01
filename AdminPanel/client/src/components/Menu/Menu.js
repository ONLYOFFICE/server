import {useDispatch} from 'react-redux';
import {useLocation, useNavigate} from 'react-router-dom';
import {clearConfig} from '../../store/slices/configSlice';
import {logout} from '../../api';
import MenuItem from './MenuItem/MenuItem';
import AppMenuLogo from '../../assets/AppMenuLogo.svg';
import {menuItems} from '../../config/menuItems';
import styles from './Menu.module.scss';

function Menu({isOpen, onClose}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

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
    if (onClose) {
      onClose();
    }
  };

  const isActiveItem = path => {
    return location.pathname.endsWith(path);
  };

  return (
    <div className={`${styles.menu} ${isOpen ? styles['menu--open'] : ''}`}>
      <button className={styles['menu__closeButton']} onClick={onClose} aria-label='Close menu' />
      <div className={styles['menu__header']}>
        <div className={styles['menu__logoContainer']}>
          <img src={AppMenuLogo} alt='ONLYOFFICE' className={styles['menu__logo']} />
        </div>
        <div className={styles['menu__title']}>DocServer Admin Panel</div>
        <div className={styles['menu__separator']}></div>
      </div>

      <div className={styles['menu__content']}>
        <div className={styles['menu__menuItems']}>
          {menuItems.map(item => (
            <MenuItem
              key={item.key}
              label={item.label}
              isActive={isActiveItem(item.path)}
              onClick={() => handleMenuItemClick(item)}
              iconIndex={item.iconIndex}
            />
          ))}
          <MenuItem
            label='Logout'
            isActive={false}
            onClick={async () => {
              if (onClose) {
                onClose();
              }
              await handleLogout();
            }}
            iconIndex={15}
          />
        </div>
      </div>
    </div>
  );
}

export default Menu;
