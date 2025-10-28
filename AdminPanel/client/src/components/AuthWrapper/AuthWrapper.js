import {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {fetchUser, selectUser, selectUserLoading, selectIsAuthenticated} from '../../store/slices/userSlice';
import {checkSetupRequired} from '../../api';
import Spinner from '../../assets/Spinner.svg';
import Login from '../../pages/Login/LoginPage';
import Setup from '../../pages/Setup/SetupPage';
import ServerUnavailable from '../ServerUnavailable/ServerUnavailable';

export default function AuthWrapper({children}) {
  const dispatch = useDispatch();
  const user = useSelector(selectUser);
  const loading = useSelector(selectUserLoading);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [serverUnavailable, setServerUnavailable] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const result = await checkSetupRequired();
        setSetupRequired(result.setupRequired);
      } catch (error) {
        if (error.message === 'SERVER_UNAVAILABLE') {
          setServerUnavailable(true);
        }
      } finally {
        setCheckingSetup(false);
      }
    };

    checkSetup();
  }, []);

  useEffect(() => {
    if (!checkingSetup && !setupRequired && !serverUnavailable) {
      dispatch(fetchUser()).finally(() => {
        setHasInitialized(true);
      });
    } else if (!checkingSetup && (setupRequired || serverUnavailable)) {
      setHasInitialized(true);
    }
  }, [dispatch, checkingSetup, setupRequired, serverUnavailable]);

  // Show server unavailable page if server is down
  if (serverUnavailable && !isAuthenticated) {
    return <ServerUnavailable />;
  }

  // Show loading spinner during initial checks
  if ((loading || !hasInitialized || checkingSetup) && !isAuthenticated && !serverUnavailable) {
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
