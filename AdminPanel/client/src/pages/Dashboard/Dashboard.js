import {useEffect, useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import TopBlock from './TopBlock/index';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import {fetchStatistics, fetchConfiguration, fetchTenants} from '../../api';

const CRITICAL_COLOR = '#ff0000';

function Dashboard() {
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
    enabled: !!selectedTenant
  });

  // Fetch configuration to display DB info
  const {data: configData} = useQuery({
    queryKey: ['configuration'],
    queryFn: fetchConfiguration
  });

  // Safe defaults to maintain hook order consistency (memoized to avoid dependency changes)
  const licenseInfo = useMemo(() => data?.licenseInfo ?? {}, [data?.licenseInfo]);
  const serverInfo = useMemo(() => data?.serverInfo ?? {}, [data?.serverInfo]);

  // Derived values used across multiple components
  const isUsersModel = licenseInfo.usersCount > 0;
  const limitEdit = isUsersModel ? licenseInfo.usersCount : licenseInfo.connections;
  const limitView = isUsersModel ? licenseInfo.usersViewCount : licenseInfo.connectionsView;

  // Build block
  const buildDate = licenseInfo.buildDate ? new Date(licenseInfo.buildDate).toLocaleDateString() : '';
  const isOpenSource = licenseInfo.packageType === 0;
  const packageTypeLabel = isOpenSource ? 'Open source' : licenseInfo.packageType === 1 ? 'Enterprise Edition' : 'Developer Edition';
  const buildBlock = (
    <TopBlock title='Build'>
      <div>Type: {packageTypeLabel}</div>
      <div>
        Version: {serverInfo.buildVersion}.{serverInfo.buildNumber}
      </div>
      <div>Release date: {buildDate}</div>
    </TopBlock>
  );

  // License block (mirrors fillInfo license validity rendering)
  const licenseBlock = (() => {
    if (licenseInfo.endDate === null) {
      return (
        <TopBlock title='License'>
          <div>No license</div>
        </TopBlock>
      );
    }
    const isLimited = licenseInfo.mode & 1 || licenseInfo.mode & 4;
    const licEnd = new Date(licenseInfo.endDate);
    const srvDate = new Date(serverInfo.date);
    const licType = licenseInfo.type;
    const isInvalid = licType === 2 || licType === 1 || licType === 6 || licType === 11;
    const isUpdateUnavailable = !isLimited && srvDate > licEnd;
    const licValidText = isLimited ? 'Valid: ' : 'Updates available: ';
    const licValidColor = isInvalid || isUpdateUnavailable ? CRITICAL_COLOR : undefined;

    const startDateStr = licenseInfo.startDate ? new Date(licenseInfo.startDate).toLocaleDateString() : '';
    const isStartCritical = licType === 16 || (licenseInfo.startDate ? new Date(licenseInfo.startDate) > srvDate : false);
    const trialText = licenseInfo.mode & 1 ? 'Trial' : '';

    return (
      <TopBlock title='License'>
        {startDateStr && (
          <div>
            <span>Start date: </span>
            <span style={isStartCritical ? {color: CRITICAL_COLOR} : undefined}>{startDateStr}</span>
          </div>
        )}
        <div>
          <span>{licValidText}</span>
          <span style={licValidColor ? {color: licValidColor} : undefined}>{licEnd.toLocaleDateString()}</span>
        </div>
        {trialText && <div>{trialText}</div>}
      </TopBlock>
    );
  })();

  // Limits block
  const limitTitle = isUsersModel ? 'Users limit' : 'Connections limit';
  const limitsBlock = (
    <TopBlock title={limitTitle}>
      <div>Editors: {limitEdit}</div>
      <div>Live Viewer: {limitView}</div>
    </TopBlock>
  );

  /**
   * Render database info block
   * @param {object|null} sql - services.CoAuthoring.sql config
   * @returns {JSX.Element|null}
   */
  const renderDatabaseBlock = sql => {
    if (!sql) return null;
    return (
      <TopBlock title='Database'>
        <div>Type: {sql.type}</div>
        <div>Host: {sql.dbHost}</div>
        <div>Port: {sql.dbPort}</div>
        <div>Name: {sql.dbName}</div>
      </TopBlock>
    );
  };

  // Show loading/error states
  if (error) {
    return (
      <div>
        <PageHeader>Dashboard</PageHeader>
        <PageDescription>Overview of your DocServer Admin Panel</PageDescription>
        <div style={{color: 'red'}}>Error: {error.message}</div>
      </div>
    );
  }
  if (tenantsError) {
    return (
      <div>
        <PageHeader>Dashboard</PageHeader>
        <PageDescription>Overview of your DocServer Admin Panel</PageDescription>
        <div style={{color: 'red'}}>Error: {tenantsError.message}</div>
      </div>
    );
  }

  if (isLoading || !data || !tenantsData || tenantsLoading) {
    return (
      <div>
        <PageHeader>Dashboard</PageHeader>
        <PageDescription>Overview of your DocServer Admin Panel</PageDescription>
        <div>Please, wait...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader>Dashboard</PageHeader>
      <PageDescription>Overview of your DocServer Admin Panel</PageDescription>
      <div style={{display: 'flex', gap: '24px', marginBottom: '32px', flexWrap: 'wrap'}}>
        {buildBlock}
        {licenseBlock}
        {limitsBlock}
      </div>
      {renderDatabaseBlock(configData?.services?.CoAuthoring?.sql)}
    </div>
  );
}

export default Dashboard;
