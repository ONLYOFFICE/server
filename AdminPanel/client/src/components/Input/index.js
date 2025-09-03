import styles from './styles.module.css';

export default function Input({
  label,
  description,
  value,
  onChange,
  placeholder = '',
  type = 'text',
  error = null,
  className = '',
  onKeyDown = null,
  min = null,
  max = null
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(type === 'number' ? e.target.valueAsNumber : e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`${styles.input} ${error ? styles.inputError : ''} ${className}`}
      min={min}
      max={max}
    />
  );
}
