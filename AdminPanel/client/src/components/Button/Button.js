import React, {useState, useEffect, forwardRef} from 'react';
import styles from './Button.module.scss';
import Spinner from '../../assets/Spinner.svg';
import Success from '../../assets/Success.svg';

const Button = forwardRef(({onClick, children = 'Save Changes', disabled = false, disableResult = false, errorText = 'FAILED', className}, ref) => {
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
      console.error('Button action failed:', error);
      if (!disableResult) {
        setState('error');
      } else {
        setState('idle');
      }
    }
  };

  const getButtonClass = () => {
    let buttonClass = styles.button;

    if (disabled && state === 'idle') buttonClass += ` ${styles['button--disabled']}`;
    if (state === 'loading') buttonClass += ` ${styles['button--loading']}`;
    if (state === 'success') buttonClass += ` ${styles['button--success']}`;
    if (state === 'error') buttonClass += ` ${styles['button--error']}`;

    if (className) buttonClass += ` ${className}`;
    return buttonClass;
  };

  const getButtonContent = () => {
    switch (state) {
      case 'loading':
        return <img src={Spinner} alt='Loading' className={styles.icon} />;
      case 'success':
        return <img src={Success} alt='Success' className={styles.icon} />;
      case 'error':
        return errorText;
      default:
        return children;
    }
  };

  return (
    <button ref={ref} className={getButtonClass()} onClick={handleClick} disabled={disabled || state !== 'idle'}>
      {getButtonContent()}
    </button>
  );
});

Button.displayName = 'Button';

// Memoize the Button to prevent unnecessary rerenders when props haven't changed
export default React.memo(Button);
