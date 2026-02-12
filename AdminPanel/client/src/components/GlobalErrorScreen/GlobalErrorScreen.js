import {useDispatch, useSelector} from 'react-redux';
import {clearUser} from '../../store/slices/userSlice';
import {clearGlobalError, selectGlobalError} from '../../store/slices/globalErrorSlice';
import Button from '../Button/Button';

const wrapperStyle = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  flexDirection: 'column',
  gap: '8px',
  boxSizing: 'border-box'
};

export default function GlobalErrorScreen() {
  const dispatch = useDispatch();
  const errorType = useSelector(selectGlobalError);

  if (!errorType) return null;

  const handleLogin = () => {
    dispatch(clearGlobalError());
    dispatch(clearUser());
    window.location.reload();
  };

  const handleReload = () => {
    window.location.reload();
  };

  if (errorType === 'UNAUTHORIZED') {
    return (
      <div style={wrapperStyle}>
        <p style={{color: '#d32f2f', fontSize: '18px', fontWeight: '500', margin: 0}}>Session expired</p>
        <p style={{color: '#666', fontSize: '14px', margin: '0 0 16px 0'}}>Please log in again to continue</p>
        <Button onClick={handleLogin}>Login</Button>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <p style={{color: '#d32f2f', fontSize: '18px', fontWeight: '500', margin: 0}}>An unknown error occurred</p>
      <p style={{color: '#666', fontSize: '14px', margin: '0 0 16px 0'}}>Please reload the page</p>
      <Button onClick={handleReload}>Reload</Button>
    </div>
  );
}
