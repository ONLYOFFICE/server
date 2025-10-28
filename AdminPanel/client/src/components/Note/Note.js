import styles from './Note.module.scss';

/**
 * Note component for displaying different types of messages
 * @param {Object} props - Component properties
 * @param {('note'|'warning'|'tip'|'important')} props.type - Type of note to display
 * @param {React.ReactNode} props.children - Content to display in the note
 * @returns {JSX.Element} Note component
 */
function Note({type = 'note', children}) {
  const typeConfig = {
    note: {
      title: 'Note',
      className: styles.note,
      icon: (
        <svg className={styles.icon} width='24' height='24' viewBox='0 0 24 24' fill='none'>
          <circle cx='12' cy='12' r='10' stroke='#FF6F3D' strokeWidth='2' />
          <path d='M12 7C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7Z' fill='#FF6F3D' />
          <path
            d='M12 10C12.5523 10 13 10.4477 13 11V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V11C11 10.4477 11.4477 10 12 10Z'
            fill='#FF6F3D'
          />
        </svg>
      )
    },
    warning: {
      title: 'Warning',
      className: styles.warning,
      icon: (
        <svg className={styles.icon} width='24' height='24' viewBox='0 0 24 24' fill='none'>
          <path
            d='M10.5 4C11.1667 3 12.8333 3 13.5 4L21 17C21.6667 18 21 19.5 19.6667 19.5H5.33333C4 19.5 3.33333 18 4 17L10.5 4Z'
            stroke='#CB0000'
            strokeWidth='2'
          />
          <path
            d='M12 8C12.5523 8 13 8.44772 13 9V13C13 13.5523 12.5523 14 12 14C11.4477 14 11 13.5523 11 13V9C11 8.44772 11.4477 8 12 8Z'
            fill='#CB0000'
          />
          <circle cx='12' cy='16.5' r='1' fill='#CB0000' />
        </svg>
      )
    },
    tip: {
      title: 'Tip',
      className: styles.tip,
      icon: (
        <svg className={styles.icon} width='24' height='24' viewBox='0 0 24 24' fill='none'>
          <circle cx='12' cy='12' r='10' stroke='#007B14' strokeWidth='2' />
          <path d='M12 7C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7Z' fill='#007B14' />
          <path
            d='M12 10C12.5523 10 13 10.4477 13 11V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V11C11 10.4477 11.4477 10 12 10Z'
            fill='#007B14'
          />
        </svg>
      )
    },
    important: {
      title: 'Important',
      className: styles.important,
      icon: (
        <svg className={styles.icon} width='24' height='24' viewBox='0 0 24 24' fill='none'>
          <rect x='2' y='2' width='20' height='20' rx='2' stroke='#262BA5' strokeWidth='2' />
          <path d='M12 7C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7Z' fill='#262BA5' />
          <path
            d='M12 10C12.5523 10 13 10.4477 13 11V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V11C11 10.4477 11.4477 10 12 10Z'
            fill='#262BA5'
          />
        </svg>
      )
    }
  };

  const config = typeConfig[type] || typeConfig.note;

  return (
    <div className={`${styles.noteContainer} ${config.className}`}>
      <div className={styles.header}>
        {config.icon}
        <span className={styles.title}>{config.title}</span>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export default Note;
