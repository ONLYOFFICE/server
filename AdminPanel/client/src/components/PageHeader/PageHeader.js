import styles from './PageHeader.module.scss';

function PageHeader({children}) {
  return <h1 className={styles.pageHeader}>{children}</h1>;
}

export default PageHeader;
