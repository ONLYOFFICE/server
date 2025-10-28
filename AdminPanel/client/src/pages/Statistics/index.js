import {useEffect, useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import TopBlock from './TopBlock/index';
import InfoTable from './InfoTable/index';
import ModeSwitcher from './ModeSwitcher';
import MonthlyStatistics from './MonthlyStatistics';
import styles from './styles.module.css';
import {fetchStatistics, fetchConfiguration} from '../../api';

// Constants
const CRITICAL_COLOR = '#ff0000';
const CRITICAL_THRESHOLD = 0.1;
const TIME_PERIODS = ['hour', 'day', 'week', 'month'];
const TIME_PERIOD_LABELS = ['Last Hour', '24 Hours', 'Week', 'Month'];
const SECONDS_PER_DAY = 86400;

/**
 * Calculate critical status for remaining values
 * @param {number} remaining - Remaining count
 * @param {number} limit - Total limit
 * @returns {string} 'normal' | 'critical'
 */
const getCriticalStatus = (remaining, limit) => (remaining > limit * CRITICAL_THRESHOLD ? 'normal' : 'critical');

// ModeSwitcher moved to ./ModeSwitcher (kept behavior, simplified markup/styles)

/**
 * Statistics component - renders Document Server statistics
 * Mirrors branding/info/index.html rendering logic with mode toggling
 */
export default function Statistics() {
  const {data, isLoading, error} = useQuery({
    queryKey: ['statistics'],
    queryFn: fetchStatistics
  });

  // Fetch configuration to display DB info
  const {data: configData} = useQuery({
    queryKey: ['configuration'],
    queryFn: fetchConfiguration
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

  // Safe defaults to maintain hook order consistency (memoized to avoid dependency changes)
  const licenseInfo = useMemo(() => data?.licenseInfo ?? {}, [data?.licenseInfo]);
  const quota = useMemo(() => data?.quota ?? {}, [data?.quota]);
  const connectionsStat = useMemo(() => data?.connectionsStat ?? {}, [data?.connectionsStat]);
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
        {startDateStr && <div style={isStartCritical ? {color: CRITICAL_COLOR} : undefined}>Start date: {startDateStr}</div>}
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

  // Current activity/usage table
  const currentTable = useMemo(() => {
    if (isUsersModel) {
      // Users model
      const days = parseInt(licenseInfo.usersExpire / SECONDS_PER_DAY, 10) || 1;
      const qEditUnique = quota?.edit?.usersCount?.unique || 0;
      const qEditAnon = quota?.edit?.usersCount?.anonymous || 0;
      const qViewUnique = quota?.view?.usersCount?.unique || 0;
      const qViewAnon = quota?.view?.usersCount?.anonymous || 0;

      const remainingEdit = limitEdit - qEditUnique;
      const remainingView = limitView - qViewUnique;

      const editor = [
        [qEditUnique, ''],
        [qEditUnique - qEditAnon, ''],
        [qEditAnon, ''],
        [remainingEdit, getCriticalStatus(remainingEdit, limitEdit)]
      ];
      const viewer = [
        [qViewUnique, ''],
        [qViewUnique - qViewAnon, ''],
        [qViewAnon, ''],
        [remainingView, getCriticalStatus(remainingView, limitView)]
      ];
      const desc = ['Active', 'Internal', 'External', 'Remaining'];
      return (
        <InfoTable
          mode={mode}
          caption={`User activity in the last ${days} ${days > 1 ? 'days' : 'day'}`}
          editor={editor}
          viewer={viewer}
          desc={desc}
        />
      );
    }

    // Connections model
    const activeEdit = quota?.edit?.connectionsCount || 0;
    const activeView = quota?.view?.connectionsCount || 0;
    const remainingEdit = limitEdit - activeEdit;
    const remainingView = limitView - activeView;
    const editor = [
      [activeEdit, ''],
      [remainingEdit, getCriticalStatus(remainingEdit, limitEdit)]
    ];
    const viewer = [
      [activeView, ''],
      [remainingView, getCriticalStatus(remainingView, limitView)]
    ];
    const desc = ['Active', 'Remaining'];
    return <InfoTable mode={mode} caption='Current connections' editor={editor} viewer={viewer} desc={desc} />;
  }, [isUsersModel, licenseInfo, quota, limitEdit, limitView, mode]);

  // Peaks and Averages (only for connections model)
  const peaksAverage = useMemo(() => {
    if (isUsersModel) return null;

    const editorPeaks = [];
    const viewerPeaks = [];
    const editorAvr = [];
    const viewerAvr = [];

    TIME_PERIODS.forEach((k, index) => {
      const item = connectionsStat?.[k];
      if (item?.edit) {
        let value = item.edit.max || 0;
        editorPeaks[index] = [value, value >= limitEdit ? 'critical' : ''];
        value = item.edit.avr || 0;
        editorAvr[index] = [value, value >= limitEdit ? 'critical' : ''];
      }
      if (item?.liveview) {
        let value = item.liveview.max || 0;
        viewerPeaks[index] = [value, value >= limitView ? 'critical' : ''];
        value = item.liveview.avr || 0;
        viewerAvr[index] = [value, value >= limitView ? 'critical' : ''];
      }
    });
    return (
      <>
        <InfoTable mode={mode} caption='Peaks' editor={editorPeaks} viewer={viewerPeaks} desc={TIME_PERIOD_LABELS} />
        <InfoTable mode={mode} caption='Average' editor={editorAvr} viewer={viewerAvr} desc={TIME_PERIOD_LABELS} />
      </>
    );
  }, [isUsersModel, connectionsStat, limitEdit, limitView, mode]);
  // MonthlyStatistics moved to ./MonthlyStatistics for clarity and to keep this file concise

  // After hooks and memos: show loading/error states
  if (error) {
    return <div style={{color: 'red'}}>Error: {error.message}</div>;
  }
  if (isLoading || !data) {
    return <div>Please, wait...</div>;
  }

  return (
    <div>
      <div className={styles.topRow}>
        {buildBlock}
        {licenseBlock}
        {limitsBlock}
      </div>

      {renderDatabaseBlock(configData?.services?.CoAuthoring?.sql)}

      {!isOpenSource && (
        <>
          <ModeSwitcher mode={mode} setMode={setMode} />

          {currentTable}
          {peaksAverage}
          {isUsersModel && <MonthlyStatistics byMonth={quota?.byMonth} mode={mode} />}
        </>
      )}
    </div>
  );
}
