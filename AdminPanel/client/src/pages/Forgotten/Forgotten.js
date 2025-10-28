import {useState, useEffect} from 'react';
import {getForgottenList, getForgotten} from '../../api';
import DownloadIcon from '../../assets/Download.svg';
import styles from './Forgotten.module.scss';

const Forgotten = () => {
  const [forgottenFiles, setForgottenFiles] = useState([]);
  const [error, setError] = useState(null);
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());

  const loadForgottenFiles = async () => {
    try {
      setError(null);
      const files = await getForgottenList();
      setForgottenFiles(files);
    } catch (err) {
      console.error('Error loading forgotten files:', err);
      setError(`Failed to load forgotten files: ${err.message}`);
    }
  };

  useEffect(() => {
    loadForgottenFiles();
  }, []);

  const handleDownload = async file => {
    try {
      console.log('Downloading file:', file.name);

      setDownloadingFiles(prev => new Set(prev).add(file.key));

      const result = await getForgotten(file.key);

      if (result.url) {
        const link = document.createElement('a');
        link.href = result.url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (result.error) {
        console.error('Backend error for file:', file.name, 'Error code:', result.error);
        setError(`Failed to download ${file.name}: Backend error ${result.error}`);
      } else {
        console.error('No download URL received for file:', file.name);
        setError(`Failed to get download URL for ${file.name}`);
      }
    } catch (err) {
      console.error('Error downloading file:', err);
      setError(`Failed to download ${file.name}: ${err.message}`);
    } finally {
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.key);
        return newSet;
      });
    }
  };

  if (error) {
    return (
      <div className={styles.forgottenPage}>
        <div className={styles.pageHeader}>
          <h1>Forgotten Files</h1>
        </div>
        Failed to load forgotten files
      </div>
    );
  }

  return (
    <div className={styles.forgottenPage}>
      <div className={styles.pageHeader}>
        <h1>Forgotten Files</h1>
      </div>

      <div className={styles.forgottenContent}>
        {forgottenFiles.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No forgotten files found.</p>
          </div>
        ) : (
          <div className={styles.filesList}>
            {forgottenFiles.map((file, index) => (
              <div key={index} className={styles.fileRow}>
                <span className={styles.fileName} title={file.name}>
                  {file.name}
                </span>
                <button
                  className={styles.downloadBtn}
                  onClick={() => handleDownload(file)}
                  disabled={downloadingFiles.has(file.key)}
                  title='Download file'
                >
                  <img
                    src={DownloadIcon}
                    alt='Download'
                    className={styles.downloadIcon}
                    style={{opacity: downloadingFiles.has(file.key) ? 0.5 : 1}}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Forgotten;
