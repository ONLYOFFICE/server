import styles from './Note.module.scss';

/**
 * Note component for displaying different types of messages
 * @param {Object} props - Component properties
 * @param {('note'|'warning'|'tip'|'important'|'success')} props.type - Type of note to display
 * @param {string} [props.title] - Optional custom title to override default type title
 * @param {React.ReactNode} props.children - Content to display in the note
 * @returns {JSX.Element} Note component
 */
function Note({type = 'note', title, children}) {
  const typeConfig = {
    note: {
      title: 'Note',
      className: styles.note,
      icon: (
        <svg className={styles.icon} width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <circle cx='8' cy='8' r='7.25' stroke='#FF6F3D' strokeWidth='1.5' />
          <path
            d='M8.25 6.5C8.66421 6.5 9 6.83579 9 7.25V11H9.75C10.1642 11 10.5 11.3358 10.5 11.75C10.5 12.1642 10.1642 12.5 9.75 12.5H8.25C7.83579 12.5 7.5 12.1642 7.5 11.75V8H6.75C6.33579 8 6 7.66421 6 7.25C6 6.83579 6.33579 6.5 6.75 6.5H8.25ZM8 3.5C8.55228 3.5 9 3.94772 9 4.5C9 5.05228 8.55228 5.5 8 5.5C7.44772 5.5 7 5.05228 7 4.5C7 3.94772 7.44772 3.5 8 3.5Z'
            fill='#FF6F3D'
          />
        </svg>
      )
    },
    warning: {
      title: 'Warning',
      className: styles.warning,
      icon: (
        <svg className={styles.icon} width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <path
            d='M5.876 2.733C6.8932 0.756 9.6068 0.756 10.624 2.733L14.9258 11.095C15.857 12.905 14.6646 15.25 12.5508 15.25H3.9482C1.8348 15.25 0.6431 12.905 1.5742 11.095L5.876 2.733Z'
            stroke='#CB0000'
            strokeWidth='1.5'
          />
          <path
            d='M8.25 7.5C8.66421 7.5 9 7.83579 9 8.25V12H9.75C10.1642 12 10.5 12.3358 10.5 12.75C10.5 13.1642 10.1642 13.5 9.75 13.5H8.25C7.83579 13.5 7.5 13.1642 7.5 12.75V9H6.75C6.33579 9 6 8.66421 6 8.25C6 7.83579 6.33579 7.5 6.75 7.5H8.25ZM8 4.5C8.55228 4.5 9 4.94772 9 5.5C9 6.05228 8.55228 6.5 8 6.5C7.44772 6.5 7 6.05228 7 5.5C7 4.94772 7.44772 4.5 8 4.5Z'
            fill='#CB0000'
          />
        </svg>
      )
    },
    tip: {
      title: 'Tip',
      className: styles.tip,
      icon: (
        <svg className={styles.icon} width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <circle cx='8' cy='8' r='7.25' stroke='#007B14' strokeWidth='1.5' />
          <path d='M4.66667 8L6.66667 10L11.3333 5.33333' stroke='#007B14' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      )
    },
    important: {
      title: 'Important',
      className: styles.important,
      icon: (
        <svg className={styles.icon} width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <rect x='1.25' y='1.25' width='13.5' height='13.5' rx='1.75' stroke='#262BA5' strokeWidth='1.5' />
          <path
            d='M8.25 7.5C8.66421 7.5 9 7.83579 9 8.25V12H9.75C10.1642 12 10.5 12.3358 10.5 12.75C10.5 13.1642 10.1642 13.5 9.75 13.5H8.25C7.83579 13.5 7.5 13.1642 7.5 12.75V9H6.75C6.33579 9 6 8.66421 6 8.25C6 7.83579 6.33579 7.5 6.75 7.5H8.25ZM8 4.5C8.55228 4.5 9 4.94772 9 5.5C9 6.05228 8.55228 6.5 8 6.5C7.44772 6.5 7 6.05228 7 5.5C7 4.94772 7.44772 4.5 8 4.5Z'
            fill='#262BA5'
          />
        </svg>
      )
    },
    success: {
      title: 'Success',
      className: styles.success,
      icon: (
        <svg className={styles.icon} width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <circle cx='8' cy='8' r='7.25' stroke='#007B14' strokeWidth='1.5' />
          <path d='M4.66667 8L6.66667 10L11.3333 5.33333' stroke='#007B14' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      )
    }
  };

  const config = typeConfig[type] || typeConfig.note;
  const displayTitle = title || config.title;

  return (
    <div className={`${styles.noteContainer} ${config.className}`}>
      <div className={styles.header}>
        {config.icon}
        <span className={styles.title}>{displayTitle}</span>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export default Note;
