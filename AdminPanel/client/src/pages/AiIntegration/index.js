import {useQuery} from '@tanstack/react-query';
import {useSelector} from 'react-redux';
import {selectConfig} from '../../store/slices/configSlice';
import PageHeader from '../../components/PageHeader/PageHeader';
import FixedSaveButtonGroup from '../../components/FixedSaveButtonGroup/FixedSaveButtonGroup';
import {fetchStatistics} from '../../api';
import useAiPlugin from './hooks/useAiPlugin';

/**
 * AiIntegration page.
 * Embeds the AI settings UI and brokers config get/save between the iframe and Redux/API.
 * @returns {JSX.Element}
 */
export default function AiIntegration() {
  const config = useSelector(selectConfig);

  // Fetch statistics data to get version information
  // Query depends on config availability since it's a synchronous operation
  const {data, isLoading, error} = useQuery({
    queryKey: ['statistics', config?.version], // Include config in query key
    queryFn: fetchStatistics,
    enabled: !!config // Only fetch when config is available
  });

  // Use custom hook for complete AI plugin functionality
  const {currentWindow, handleIframeLoad, internalProvidersLoaded} = useAiPlugin(data);

  // Constants
  const AI_IFRAME_SRC = `ai/index.html`;
  const AI_IFRAME_ID = 'ai-iframe';

  /** @type {import('react').CSSProperties} */
  const iframeStyle = {
    width: '100%',
    height: '100%',
    minHeight: '700px',
    border: 0,
    display: 'none'
  };

  /** @type {import('react').CSSProperties} */
  const pluginWindowStyle = {
    maxWidth: '400px',
    maxHeight: '500px',
    width: '100%',
    height: '100%',
    border: 0
  };

  // After hooks and memos: show loading/error states
  if (error) {
    return <div style={{color: 'red'}}>Error: {error.message}</div>;
  }
  if (isLoading || !data) {
    return <div>Please, wait...</div>;
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', position: 'relative'}}>
      <iframe id={AI_IFRAME_ID} title='AI Settings' src={AI_IFRAME_SRC} style={iframeStyle} onLoad={() => handleIframeLoad(AI_IFRAME_ID)} />
      {!internalProvidersLoaded && <div>Please, wait...</div>}
      {internalProvidersLoaded && currentWindow && (
        <div key={currentWindow.iframeId} style={{width: '100%', height: '100%'}}>
          <PageHeader>{currentWindow.description || ''} </PageHeader>
          <iframe id={currentWindow.iframeId} title={currentWindow.description || ''} src={currentWindow.url} style={pluginWindowStyle} />
          {currentWindow.buttons && currentWindow.buttons.length > 0 && <FixedSaveButtonGroup buttons={currentWindow.buttons} />}
        </div>
      )}
    </div>
  );
}
