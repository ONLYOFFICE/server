import {useEffect, useMemo, useRef, useState} from 'react';
import styles from './ComboBox.module.scss';

function ComboBox({value, onChange, options = [], placeholder = '', disabled = false, className = '', ...props}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false); // User started editing after open

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = useMemo(() => options.find(o => o.value === value) || null, [options, value]);

  const filteredOptions = useMemo(() => {
    // Show all options until user starts searching
    if (!isSearching) return options;

    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => String(o.label).toLowerCase().includes(q));
  }, [options, query, isSearching]);

  useEffect(() => {
    const handleClickOutside = event => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
    setActiveIndex(-1);
    setIsSearching(false);
    // Show selected value, but don't filter yet
    setQuery(selectedOption ? String(selectedOption.label) : '');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select(); // Select text so user can immediately type to replace
    });
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setActiveIndex(-1);
    setIsSearching(false);
  };

  const handleSelect = option => {
    onChange(option.value);
    closeDropdown();
  };

  const handleKeyDown = e => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => {
        const next = prev + 1;
        return next >= filteredOptions.length ? 0 : next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => {
        const next = prev - 1;
        return next < 0 ? Math.max(filteredOptions.length - 1, 0) : next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
        handleSelect(filteredOptions[activeIndex]);
      } else if (filteredOptions.length === 1) {
        handleSelect(filteredOptions[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  };

  return (
    <div className={`${styles.comboWrapper} ${className || ''}`} ref={wrapperRef} {...props}>
      <div
        className={`${styles.control} ${disabled ? styles['control--disabled'] : ''}`}
        onClick={openDropdown}
        role='combobox'
        aria-expanded={isOpen}
        aria-haspopup='listbox'
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className={styles.input}
          type='text'
          placeholder={placeholder}
          value={isOpen ? query : selectedOption?.label || ''}
          onChange={e => {
            setIsSearching(true); // User started editing — enable filtering
            setQuery(e.target.value);
          }}
          onFocus={() => !isOpen && openDropdown()}
          readOnly={disabled}
        />
        <div className={`${styles.arrow} ${isOpen ? styles['arrow--open'] : ''}`} aria-hidden>
          <svg width='12' height='7' viewBox='0 0 12 7' fill='none' xmlns='http://www.w3.org/2000/svg'>
            <path d='M1 1L6 6L11 1' stroke='#808080' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className={styles.dropdown} role='listbox'>
          {filteredOptions.length === 0 && <div className={styles.empty}>No results</div>}
          {filteredOptions.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={`${option.value}-${index}`}
                className={`${styles.option} ${isSelected ? styles['option--selected'] : ''} ${isActive ? styles['option--active'] : ''}`}
                role='option'
                aria-selected={isSelected}
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ComboBox;
