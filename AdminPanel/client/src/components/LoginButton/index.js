import {useState, forwardRef} from 'react';
import styles from './styles.module.css';
import Spinner from '../../assets/Spinner.svg';
import Success from '../../assets/Success.svg';

const Button = forwardRef(({onClick, disabled, children, className, errorText = 'FAILED'}, ref) => {
  const [state, setState] = useState('idle'); // 'idle', 'loading', 'success', 'error'
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClick = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    setState('loading');

    try {
      await onClick();
      setState('success');

      // Show success for 3 seconds
      setTimeout(() => {
        setState('idle');
        setIsProcessing(false);
      }, 1000);
    } catch (_error) {
      setState('error');

      // Show error for 3 seconds
      setTimeout(() => {
        setState('idle');
        setIsProcessing(false);
      }, 1000);
    }
  };

  const getButtonContent = () => {
    switch (state) {
      case 'loading':
        return (
          <>
            <img src={Spinner} alt='Loading' className={styles.icon} />
          </>
        );
      case 'success':
        return (
          <>
            <img src={Success} alt='Success' className={styles.icon} />
          </>
        );
      case 'error':
        return errorText;
      default:
        return children;
    }
  };

  const getButtonClassName = () => {
    const baseClass = styles.button;
    const stateClass = state !== 'idle' ? styles[state] : '';
    return `${baseClass} ${stateClass} ${className || ''}`.trim();
  };

  return (
    <button ref={ref} className={getButtonClassName()} onClick={handleClick} disabled={disabled || isProcessing}>
      {getButtonContent()}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
