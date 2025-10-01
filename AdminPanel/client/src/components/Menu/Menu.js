import {useDispatch} from 'react-redux';
import {useLocation, useNavigate} from 'react-router-dom';
import {clearConfig} from '../../store/slices/configSlice';
import {logout} from '../../api';
import MenuItem from './MenuItem/MenuItem';
import AppMenuLogo from '../../assets/AppMenuLogo.svg';
import {menuItems} from '../../config/menuItems';
import styles from './Menu.module.scss';
import FileIcon from '../../assets/File.svg';

function Menu() {
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
  };

  const isActiveItem = path => {
    return location.pathname.endsWith(path);
  };

  return (
    <div className={styles.menu}>
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
  );
}

export default Menu;
