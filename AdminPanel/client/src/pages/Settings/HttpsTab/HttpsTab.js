import {useState, useEffect, useCallback} from 'react';
import Button from '../../../components/Button/Button';
import Input from '../../../components/Input/Input';
import Section from '../../../components/Section/Section';
import Note from '../../../components/Note/Note';
import {getLetsEncryptStatus, installLetsEncryptCertificate} from '../../../api';
import styles from './HttpsTab.module.scss';

const HttpsTab = () => {
  const [certInfo, setCertInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [domain, setDomain] = useState(window.location.hostname);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [success, setSuccess] = useState(null);

  // Current HTTPS status from browser
  const isHttps = window.location.protocol === 'https:';

  // Load certificate details from server
  const loadCertInfo = useCallback(async () => {
    try {
      const result = await getLetsEncryptStatus();
      setCertInfo(result.certificate || null);
    } catch (err) {
      console.error('Failed to load certificate info:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCertInfo();
  }, [loadCertInfo]);

  // Calculate certificate health
  const getCertHealth = () => {
    if (!certInfo?.expiresAt) return null;
    const daysLeft = Math.ceil((new Date(certInfo.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    const formatted = new Date(certInfo.expiresAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (daysLeft < 0) return {text: `${formatted} (expired)`, status: 'expired', daysLeft};
    if (daysLeft < 14) return {text: `${formatted} (${daysLeft} days left)`, status: 'critical', daysLeft};
    if (daysLeft < 30) return {text: `${formatted} (${daysLeft} days left)`, status: 'warning', daysLeft};
    return {text: formatted, status: 'healthy', daysLeft};
  };

  const handleInstall = async () => {
    // Basic validation - real validation happens server-side
    if (!email || !email.includes('@')) {
      setError('Please enter an email address');
      return;
    }
    if (!domain) {
      setError('Please enter a domain name');
      return;
    }

    // Confirmation
    const action = isHttps ? 'renew' : 'install';
    const message =
      action === 'renew'
        ? `Renew SSL certificate for ${domain}?\n\nThis will request a new certificate from Let's Encrypt.`
        : `Install SSL certificate for ${domain}?\n\nThis will:\n• Request a certificate from Let's Encrypt\n• Configure HTTPS on the server\n• Reload nginx configuration\n\nThe page will reload using HTTPS after completion.`;

    if (!window.confirm(message)) return;

    setInstalling(true);
    setError(null);
    setErrorDetails(null);
    setSuccess(null);

    try {
      const result = await installLetsEncryptCertificate({email, domain});
      if (result.success) {
        setSuccess('Certificate installed successfully! Reloading page...');
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setError(result.error || 'Installation failed');
        setErrorDetails(result.details || null);
      }
    } catch (err) {
      setError(err.message || 'Installation failed');
      setErrorDetails(null);
    } finally {
      setInstalling(false);
    }
  };

  const certHealth = getCertHealth();

  return (
    <Section title="HTTPS Certificate (Let's Encrypt)" description="Install a free SSL/TLS certificate from Let's Encrypt to enable HTTPS">
      {/* Information Note */}
      <Note type='note'>
        Let's Encrypt provides free, automated SSL certificates. Before installing, ensure:
        <ul>
          <li>Server is accessible from the internet on port 80</li>
          <li>Domain DNS points to this server's IP address</li>
          <li>No firewall blocking incoming connections on port 80</li>
        </ul>
      </Note>

      {/* Current Status */}
      <div className={styles.statusSection}>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>HTTPS Status:</span>
          {isHttps ? <span className={styles.statusEnabled}>Enabled</span> : <span className={styles.statusDisabled}>Not configured</span>}
        </div>

        {/* Certificate Details */}
        {loading ? (
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Certificate:</span>
            <span className={styles.statusLoading}>Loading...</span>
          </div>
        ) : certInfo ? (
          <>
            {certInfo.domain && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Domain:</span>
                <span className={styles.statusValue}>{certInfo.domain}</span>
              </div>
            )}
            {certHealth && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Expires:</span>
                <span className={`${styles.statusValue} ${styles[certHealth.status]}`}>{certHealth.text}</span>
              </div>
            )}
            {certInfo.issuer && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Issuer:</span>
                <span className={styles.statusValue}>{certInfo.issuer}</span>
              </div>
            )}
          </>
        ) : !isHttps ? (
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Certificate:</span>
            <span className={styles.statusDisabled}>No certificate installed</span>
          </div>
        ) : null}
      </div>

      {/* Expiry Warning */}
      {certHealth && (certHealth.status === 'expired' || certHealth.status === 'critical') && (
        <Note type='warning'>
          {certHealth.status === 'expired'
            ? 'Your certificate has expired. Please renew immediately to restore HTTPS.'
            : `Your certificate expires in ${certHealth.daysLeft} days. Renew soon to avoid service interruption.`}
        </Note>
      )}

      {/* Installation Form */}
      <div className={styles.formSection}>
        <Input
          label='Domain'
          value={domain}
          onChange={setDomain}
          placeholder='docs.example.com'
          description='Domain name for the SSL certificate. Must resolve to this server.'
          disabled={installing}
        />

        <Input
          label='Email'
          value={email}
          onChange={setEmail}
          placeholder='admin@example.com'
          description="Contact email for Let's Encrypt notifications about certificate expiry."
          disabled={installing}
        />

        <div className={styles.actions}>
          <Button onClick={handleInstall} disabled={installing || !email || !domain}>
            {installing ? 'Installing... Please wait' : isHttps ? 'Renew Certificate' : 'Install Certificate'}
          </Button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className={styles.messageError}>
          <div>{error}</div>
          {errorDetails && (
            <details className={styles.errorDetails}>
              <summary>Technical details</summary>
              <pre>{errorDetails}</pre>
            </details>
          )}
        </div>
      )}
      {success && <div className={styles.messageSuccess}>{success}</div>}
    </Section>
  );
};

export default HttpsTab;
