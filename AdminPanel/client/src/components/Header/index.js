import {Link} from 'react-router-dom';
import {useSelector} from 'react-redux';
import {selectIsAuthenticated} from '../../store/slices/userSlice';
import {logout} from '../../api';
import Logo from '@assets/AppLogo.svg';
import styles from './styles.module.css';

function Header() {
  const isAuthenticated = useSelector(selectIsAuthenticated);

  const handleLogout = async () => {
    try {
      await logout();
      // Reload the page after successful logout
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
      // Still reload the page even if logout API fails
      window.location.reload();
    }
  };

  return (
    <div className={styles.header}>
      <div className={styles.headerContent}>
        <Link to='/'>
          <img src={Logo} alt='ONLYOFFICE' style={{cursor: 'pointer'}} />
        </Link>
        {isAuthenticated && (
          <button onClick={handleLogout} className={styles.logoutButton}>
            Logout
          </button>
        )}
      </div>
    </div>
  );
}

export default Header;
