import styles from './PageDescription.module.scss';

function PageDescription({children}) {
  return <p className={styles.pageDescription}>{children}</p>;
}

export default PageDescription;
