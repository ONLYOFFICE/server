import React, {useState, useEffect} from 'react';
import {getForgottenList, getForgotten} from '../../api';

const Forgotten = () => {
  const [forgottenFiles, setForgottenFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());

  const loadForgottenFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const files = await getForgottenList();
      setForgottenFiles(files);
    } catch (err) {
      console.error('Error loading forgotten files:', err);
      setError(`Failed to load forgotten files: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForgottenFiles();
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleDownload = async (file) => {
    try {
      console.log('Downloading file:', file.name);
      
      // Add file to downloading set
      setDownloadingFiles(prev => new Set(prev).add(file.key));
      
      const result = await getForgotten(file.key);
      
      if (result.url) {
        // Create a temporary link element and trigger download
        const link = document.createElement('a');
        link.href = result.url;
        // Use "output" as the filename with the proper extension
        const fileExtension = file.name.split('.').pop() || 'docx';
        link.download = 'output.docx';
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
      // Remove file from downloading set
      setDownloadingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.key);
        return newSet;
      });
    }
  };

  if (loading) {
    return (
      <div className="forgotten-page">
        <div className="page-header">
          <h1>Forgotten Files</h1>
        </div>
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading forgotten files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="forgotten-page">
        <div className="page-header">
          <h1>Forgotten Files</h1>
        </div>
        <div className="error">
          <p>{error}</p>
          <button onClick={loadForgottenFiles} className="retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="forgotten-page">
      <div className="page-header">
        <h1>Forgotten Files</h1>
        <button onClick={loadForgottenFiles} className="refresh-btn">
          Refresh
        </button>
      </div>

      <div className="forgotten-content">
        {forgottenFiles.length === 0 ? (
          <div className="empty-state">
            <p>No forgotten files found.</p>
          </div>
        ) : (
          <div className="files-list">
            <div className="files-header">
              <span>File Name</span>
              <span>Size</span>
              <span>Modified</span>
              <span>Actions</span>
            </div>
            {forgottenFiles.map((file, index) => (
              <div key={index} className="file-item">
                <span className="file-name" title={file.name}>
                  {file.name}
                </span>
                <span className="file-size">
                  {file.size ? formatFileSize(file.size) : '-'}
                </span>
                <span className="file-date">
                  {file.modified ? formatDate(file.modified) : '-'}
                </span>
                <div className="file-actions">
                  <button 
                    className="download-btn"
                    onClick={() => handleDownload(file)}
                    disabled={downloadingFiles.has(file.key)}
                    title="Download file"
                  >
                    {downloadingFiles.has(file.key) ? 'Downloading...' : 'Download'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Forgotten;
