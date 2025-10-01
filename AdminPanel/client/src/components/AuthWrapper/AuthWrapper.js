import {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useLocation, useNavigate} from 'react-router-dom';
import {fetchUser, selectUser, selectUserLoading, selectIsAuthenticated} from '../../store/slices/userSlice';
import {checkSetupRequired} from '../../api';
import Spinner from '../../assets/Spinner.svg';
import Login from '../../pages/Login/LoginPage';
import Setup from '../../pages/Setup/SetupPage';

export default function AuthWrapper({children}) {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const loading = useSelector(selectUserLoading);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Save intended URL for redirect after setup/login
  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/admin/setup' && location.pathname !== '/admin/login') {
      sessionStorage.setItem('redirectAfterAuth', location.pathname + location.search);
    }
  }, [location, isAuthenticated]);

  // Redirect after successful authentication
  useEffect(() => {
    if (isAuthenticated && user) {
      const redirectUrl = sessionStorage.getItem('redirectAfterAuth');
      if (redirectUrl) {
        sessionStorage.removeItem('redirectAfterAuth');
        navigate(redirectUrl, {replace: true});
      }
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const result = await checkSetupRequired();
        setSetupRequired(result.setupRequired);
      } catch (error) {
        console.error('Setup check error:', error);
      } finally {
        setCheckingSetup(false);
      }
    };

    checkSetup();
  }, []);

  useEffect(() => {
    if (!checkingSetup && !setupRequired) {
      dispatch(fetchUser()).finally(() => {
        setHasInitialized(true);
      });
    } else if (!checkingSetup && setupRequired) {
      setHasInitialized(true);
    }
  }, [dispatch, checkingSetup, setupRequired]);

  // Show loading spinner during initial checks
  if ((loading || !hasInitialized || checkingSetup) && !isAuthenticated) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          width: '100vw'
        }}
      >
        <img
          src={Spinner}
          alt='Loading'
          style={{
            width: '50px',
            height: '50px',
            filter: 'invert(1) brightness(0.5)',
            animation: 'spin 1s linear infinite'
          }}
        />
        <style>{`
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  // Show setup page if setup is required
  if (setupRequired && !isAuthenticated) {
    return <Setup />;
  }

  // Show login page if not authenticated
  if (!isAuthenticated || !user) {
    return <Login />;
  }

  // Show the main app content if user is authenticated
  return children;
}
