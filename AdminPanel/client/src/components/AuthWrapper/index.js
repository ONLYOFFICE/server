import {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {fetchUser, selectUser, selectUserLoading, selectIsAuthenticated} from '../../store/slices/userSlice';
import Spinner from '../../assets/Spinner.svg';
import Login from '../../pages/Login';

export default function AuthWrapper({children}) {
  const dispatch = useDispatch();
  const user = useSelector(selectUser);
  const loading = useSelector(selectUserLoading);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    dispatch(fetchUser()).finally(() => {
      setHasInitialized(true);
    });
  }, [dispatch]);

  // Show loading spinner only for initial auth check, not for login operations
  if ((loading || !hasInitialized) && !isAuthenticated) {
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
            filter: 'invert(1) brightness(0.5)', // Makes white SVG dark gray
            animation: 'spin 1s linear infinite' // Rotates continuously
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

  if (!isAuthenticated || !user) {
    return <Login />;
  }

  // Show the main app content if user is authenticated
  return children;
}
