import styles from './styles.module.css';

export default function TopBlock({title, children}) {
  return (
    <div className={styles.block}>
      <div className={styles.title}>{title}</div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
