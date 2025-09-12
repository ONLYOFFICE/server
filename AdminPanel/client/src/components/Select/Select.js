import {useState, useRef, useEffect} from 'react';
import styles from './Select.module.scss';

function Select({value, onChange, options = [], placeholder = '', disabled = false, ...props}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = event => {
      if (selectRef.current && !selectRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleOptionClick = optionValue => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const selectedOption = options.find(option => option.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  return (
    <div className={styles.selectWrapper} ref={selectRef} {...props}>
      <div className={`${styles.select} ${disabled ? styles['select--disabled'] : ''}`} onClick={handleToggle}>
        <span className={styles.selectedText}>{displayText}</span>
        <div className={`${styles.arrow} ${isOpen ? styles['arrow--open'] : ''}`}>
          <svg width='12' height='7' viewBox='0 0 12 7' fill='none' xmlns='http://www.w3.org/2000/svg'>
            <path d='M1 1L6 6L11 1' stroke='#808080' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className={styles.dropdown}>
          {options.map((option, index) => (
            <div
              key={index}
              className={`${styles.option} ${option.value === value ? styles['option--selected'] : ''}`}
              onClick={() => handleOptionClick(option.value)}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Select;
