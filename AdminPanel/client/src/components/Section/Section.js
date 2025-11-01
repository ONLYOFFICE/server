import styles from './Section.module.scss';

function Section({title, description, children, className = ''}) {
  return (
    <div className={`${styles.section} ${className}`}>
      {(title || description) && (
        <div className={styles.header}>
          {title ? <div className={styles.title}>{title}</div> : null}
          {description ? <div className={styles.description}>{description}</div> : null}
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export default Section;
