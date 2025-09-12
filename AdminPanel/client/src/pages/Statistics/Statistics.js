import { useQuery } from '@tanstack/react-query';
import { fetchStatistics } from '../../api';
import StatisticsTopBlock from '../../components/StatisticsTopBlock/StatisticsTopBlock';
import StatisticsInfoTable from '../../components/StatisticsInfoTable/StatisticsInfoTable';
import styles from './Statistics.module.scss';

function Statistics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['statistics'],
    queryFn: fetchStatistics
  });

  if (isLoading) return <div>Loading statistics...</div>;
  if (error) return <div style={{color: 'red'}}>Error: {error.message}</div>;

  if (!data) return null;

  const { licenseInfo, quota, connectionsStat, serverInfo } = data;

  const buildDate = licenseInfo.buildDate ? new Date(licenseInfo.buildDate).toLocaleDateString() : '';
  
  const buildBlock = (
    <StatisticsTopBlock title="Build">
      <div>Type: {licenseInfo.packageType === 0 ? 'Open source' : licenseInfo.packageType === 1 ? 'Enterprise Edition' : 'Developer Edition'}</div>
      <div>
        Version: {serverInfo.buildVersion}.{serverInfo.buildNumber}
      </div>
      <div>Release date: {buildDate}</div>
    </StatisticsTopBlock>
  );

  const licenseBlock = (
    <StatisticsTopBlock title="License">
      {licenseInfo.startDate === null ? (
        'No license'
      ) : (
        <div>Start date: {licenseInfo.startDate ? new Date(licenseInfo.startDate).toLocaleDateString() : ''}</div>
      )}
    </StatisticsTopBlock>
  );

  const connectionsBlock = (
    <StatisticsTopBlock title="Connections limit">
      <div>Editors: {licenseInfo.connections}</div>
      <div>Live Viewer: {licenseInfo.connectionsView}</div>
    </StatisticsTopBlock>
  );

  const valueEdit = licenseInfo.connections - (quota.edit.connectionsCount || 0);
  const valueView = licenseInfo.connectionsView - (quota.view.connectionsCount || 0);
  const editor = [
    [quota.edit.connectionsCount || 0, ''],
    [valueEdit, valueEdit > licenseInfo.connections * 0.1 ? 'normal' : 'critical']
  ];
  const viewer = [
    [quota.view.connectionsCount || 0, ''],
    [valueView, valueView > licenseInfo.connectionsView * 0.1 ? 'normal' : 'critical']
  ];
  const desc = ['Active', 'Remaining'];

  const peaksDesc = ['Last Hour', '24 Hours', 'Week', 'Month'];
  const peaksEditor = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.edit?.max || 0]);
  const peaksViewer = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.liveview?.max || 0]);
  const avrEditor = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.edit?.avr || 0]);
  const avrViewer = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.liveview?.avr || 0]);

  return (
    <div>
      <div className={styles.topRow}>
        {buildBlock}
        {licenseBlock}
        {connectionsBlock}
      </div>
      <StatisticsInfoTable caption="Current connections" editor={editor} viewer={viewer} desc={desc} />
      <StatisticsInfoTable caption="Peaks" editor={peaksEditor} viewer={peaksViewer} desc={peaksDesc} />
      <StatisticsInfoTable caption="Average" editor={avrEditor} viewer={avrViewer} desc={peaksDesc} />
    </div>
  );
}

export default Statistics;
