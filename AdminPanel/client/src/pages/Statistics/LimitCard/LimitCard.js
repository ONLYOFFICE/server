import CardWrapper from '../CardWrapper/CardWrapper';
import ProgressBar from '../ProgressBar/ProgressBar';
import MetricRow from '../MetricRow/MetricRow';

/**
 * Helper function to get usage color based on percentage
 */
const getUsageColor = percent => {
  if (percent >= 90) return '#CB0000'; // Critical - Red
  if (percent >= 70) return '#FF6F3D'; // Warning - Orange
  return '#007B14'; // Normal - Green
};

/**
 * LimitCard component for displaying statistics with progress bar and metrics
 * Used for Editors or Live Viewer to show active, limit, and remaining values
 * @param {Object} props
 * @param {number} props.active - Active count (connections or users)
 * @param {number} props.limit - Maximum limit
 * @param {number} props.remaining - Remaining count
 * @param {string} props.type - 'Editor' or 'Viewer'
 */
export default function LimitCard({active, limit, remaining, type}) {
  const percent = limit > 0 ? (active / limit) * 100 : 0;
  const color = getUsageColor(percent);
  const remainingColor = getUsageColor(percent); // Use same color logic for remaining

  const title = type === 'Editor' ? 'Editors' : 'Live Viewer';
  const description = type === 'Editor' ? 'Active editing sessions and availability' : 'Active read-only sessions and availability';
  const activeDescription = type === 'Editor' ? 'Users currently editing documents' : 'Users currently viewing documents';
  const remainingDescription = type === 'Editor' ? 'Editor sessions before limit' : 'Viewer sessions before limit';

  return (
    <CardWrapper title={title} description={description} additionalClass='limit-card'>
      <ProgressBar current={active} limit={limit} percent={percent} color={color} label={type} />
      <MetricRow count={active} description={activeDescription} label='Sessions' title='Active' />
      <MetricRow count={remaining} description={remainingDescription} label='Available' title='Remaining' color={remainingColor} />
    </CardWrapper>
  );
}
