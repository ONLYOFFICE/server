import styles from './StatisticsTopBlock.module.scss';

function StatisticsTopBlock({title, children}) {
  return (
    <div className={styles.block}>
      <div className={styles.title}>{title}</div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export default StatisticsTopBlock;
