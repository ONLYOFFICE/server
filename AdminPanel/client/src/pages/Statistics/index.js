import {useEffect, useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import Tabs from '../../components/Tabs/Tabs';
import Note from '../../components/Note/Note';
import styles from './styles.module.css';
import ComboBox from '../../components/ComboBox/ComboBox';
import {fetchTenants, fetchStatistics, convertHtmlToPdf} from '../../api';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import Button from '../../components/Button/Button';
import {generateStatisticsHtml} from './generateStatisticsHtml';
import StatisticsContent from './StatisticsContent/StatisticsContent';

const statisticsTabs = [
  {key: 'all', label: 'ALL'},
  {key: 'edit', label: 'EDITORS'},
  {key: 'view', label: 'LIVE VIEWER'}
];

// ModeSwitcher moved to ./ModeSwitcher (kept behavior, simplified markup/styles)

/**
 * Statistics component - renders Document Server statistics
 * Mirrors branding/info/index.html rendering logic with mode toggling
 */
export default function Statistics() {
  const [selectedTenant, setSelectedTenant] = useState('');

  const {
    data: tenantsData,
    isLoading: tenantsLoading,
    error: tenantsError
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants
  });

  useEffect(() => {
    if (tenantsData?.baseTenant && !selectedTenant) {
      setSelectedTenant(tenantsData.baseTenant);
    }
  }, [tenantsData, selectedTenant]);

  const {data, isLoading, error} = useQuery({
    queryKey: ['statistics', selectedTenant],
    queryFn: () => fetchStatistics(selectedTenant),
    enabled: !!selectedTenant,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true
  });

  const [mode, setMode] = useState(() => {
    try {
      const saved = window.localStorage?.getItem('server-info-display-mode');
      return saved || 'all';
    } catch {
      return 'all';
    }
  });

  useEffect(() => {
    try {
      window.localStorage?.setItem('server-info-display-mode', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // Check if open source to conditionally render content
  const licenseInfo = useMemo(() => data?.licenseInfo ?? {}, [data?.licenseInfo]);
  const isOpenSource = licenseInfo.packageType === 0;
  const isUsersModel = licenseInfo.usersCount > 0;
  /**
   * Handle PDF download
   */
  const handleDownloadPdf = async () => {
    try {
      if (!data) return;
      const htmlContent = generateStatisticsHtml(data, mode);
      const pdfBlob = await convertHtmlToPdf(htmlContent);

      // Create download link
      const url = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'statistics.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      alert('Failed to download PDF: ' + error.message);
    }
  };

  // Use React components for browser display instead of HTML string
  // generateStatisticsHtml is now only used for PDF generation

  // Show loading/error states
  if (error) {
    return <div style={{color: 'red'}}>Error: {error.message}</div>;
  }
  if (tenantsError) {
    return <div style={{color: 'red'}}>Error: {tenantsError.message}</div>;
  }
  if (isLoading || !data || !tenantsData || tenantsLoading) {
    return <div>Please, wait...</div>;
  }

  // Return the statistics page content
  return (
    <>
      <PageHeader>Statistics</PageHeader>
      <PageDescription>Real-time connection and session metrics</PageDescription>
      {isOpenSource && (
        <Note type='note'>Connection and unique user statistics are only available in the Enterprise Edition or the Developer Edition.</Note>
      )}
      {tenantsData && !isOpenSource && (
        <>
          {tenantsData.tenants.length > 0 && (
            <div className={styles.tenantGroup}>
              <label htmlFor='tenant-combobox' className={styles.tenantLabel}>
                Tenant:
              </label>
              <ComboBox
                id='tenant-combobox'
                className={styles.tenantSelect}
                value={selectedTenant}
                onChange={setSelectedTenant}
                options={[tenantsData.baseTenant, ...tenantsData.tenants.filter(t => t !== tenantsData.baseTenant)].map(t => ({
                  value: t,
                  label: t
                }))}
                placeholder='Select tenant'
              />
            </div>
          )}
          <Tabs tabs={statisticsTabs} activeTab={mode} onTabChange={setMode} />
          <h2 className={styles.title}>{isUsersModel ? 'User activity' : 'Current connections'}</h2>
          <p className={styles.description}>
            {isUsersModel
              ? 'User activity breakdown by type and remaining capacity before limit.'
              : 'Real-time active sessions and remaining capacity before limit.'}
          </p>
          <StatisticsContent data={data} mode={mode} />
          <Button onClick={handleDownloadPdf} disableResult={true} className={styles.buttonNoWidth}>
            Download Report
          </Button>
        </>
      )}
    </>
  );
}
