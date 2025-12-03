import styles from './StatisticsCard.module.css';

/**
 * StatisticsCard wrapper component
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {string} props.description - Card description
 * @param {React.ReactNode} props.children - Card content
 * @param {string} props.additionalClass - Additional CSS class
 */
export default function StatisticsCard({title, description, children, additionalClass = ''}) {
  const cardClass = additionalClass ? `${styles.card} ${styles[additionalClass]}` : styles.card;

  return (
    <div className={cardClass}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {children}
    </div>
  );
}
