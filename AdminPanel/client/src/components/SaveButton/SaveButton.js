import React, {useState, useEffect} from 'react';
import styles from './SaveButton.module.scss';
import Spinner from '../../assets/Spinner.svg';
import Success from '../../assets/Success.svg';
import Fail from '../../assets/Fail.svg';

function SaveButton({onClick, children = 'Save Changes', disabled = false, disableResult = false}) {
  const [state, setState] = useState('idle'); // 'idle', 'loading', 'success', 'error'

  // Reset to idle after showing success/error for 3 seconds
  useEffect(() => {
    if (state === 'success' || state === 'error') {
      const timer = setTimeout(() => {
        setState('idle');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const handleClick = async () => {
    if (disabled || state !== 'idle') return;

    setState('loading');
    try {
      await onClick();
      if (!disableResult) {
        setState('success');
      } else {
        setState('idle');
      }
    } catch (error) {
      console.error('Save failed:', error);
      if (!disableResult) {
        setState('error');
      } else {
        setState('idle');
      }
    }
  };

  const getButtonClass = () => {
    let className = styles.saveButton;
    if (disabled && state === 'idle') className += ` ${styles['saveButton--disabled']}`;
    if (state === 'loading') className += ` ${styles['saveButton--loading']}`;
    if (state === 'success') className += ` ${styles['saveButton--success']}`;
    if (state === 'error') className += ` ${styles['saveButton--error']}`;
    return className;
  };

  const getButtonContent = () => {
    switch (state) {
      case 'loading':
        return <img src={Spinner} alt='Loading' className={styles.icon} />;
      case 'success':
        return <img src={Success} alt='Success' className={styles.icon} />;
      case 'error':
        return <img src={Fail} alt='Error' className={styles.icon} />;
      default:
        return children;
    }
  };

  return (
    <button className={getButtonClass()} onClick={handleClick} disabled={disabled || state !== 'idle'}>
      {getButtonContent()}
    </button>
  );
}

// Memoize the SaveButton to prevent unnecessary rerenders when props haven't changed
export default React.memo(SaveButton);
