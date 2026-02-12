import {useMemo, useState, useEffect} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {selectConfig, selectConfigLoading, selectConfigError} from '../../store/slices/configSlice';
import {setGlobalError} from '../../store/slices/globalErrorSlice';
import {fetchConfiguration} from '../../api';
import {copyToClipboard} from '../../utils/copyToClipboard';
import Button from '../Button/Button';
import ToggleSwitch from '../ToggleSwitch/ToggleSwitch';
import styles from './ConfigViewer.module.scss';

const ConfigViewer = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const config = useSelector(selectConfig);
  const isLoading = useSelector(selectConfigLoading);
  const error = useSelector(selectConfigError);

  const [hideSensitiveValues, setHideSensitiveValues] = useState(true);

  const {
    data: fullConfig,
    isFetching: fullConfigLoading,
    error: fullConfigQueryError
  } = useQuery({
    queryKey: ['config', 'full'],
    queryFn: () => fetchConfiguration(true),
    enabled: !hideSensitiveValues
  });

  useEffect(() => {
    if (config) {
      setHideSensitiveValues(true);
      queryClient.invalidateQueries({queryKey: ['config', 'full']});
    }
  }, [config, queryClient]);

  useEffect(() => {
    if (fullConfigQueryError && fullConfigQueryError?.message !== 'UNAUTHORIZED') {
      dispatch(setGlobalError('UNKNOWN'));
    }
  }, [fullConfigQueryError, dispatch]);

  const handleHideSensitiveChange = checked => {
    setHideSensitiveValues(checked);
  };

  const displayedConfig = hideSensitiveValues ? config : fullConfig;
  const jsonString = useMemo(() => {
    return displayedConfig ? JSON.stringify(displayedConfig, null, 2) : '';
  }, [displayedConfig]);

  const handleCopy = () => copyToClipboard(jsonString);

  if (isLoading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (error || !config) {
    return (
      <div className={styles.error}>
        <p>Error loading configuration: {typeof error === 'string' ? error : error?.message || 'Unknown error'}</p>
      </div>
    );
  }

  const isContentLoading = !hideSensitiveValues && fullConfigLoading && !fullConfig;

  return (
    <div className={styles.configViewer}>
      <div className={styles.toolbar}>
        <div className={fullConfigLoading ? styles.toggleDisabled : undefined}>
          <ToggleSwitch
            label={
              <>
                Hide sensitive values
                <br />
                (shown as redacted)
              </>
            }
            checked={hideSensitiveValues}
            onChange={handleHideSensitiveChange}
          />
        </div>
        <Button onClick={handleCopy} disabled={!jsonString}>
          Copy JSON
        </Button>
      </div>
      <div className={styles.configContent}>
        {isContentLoading ? <div className={styles.loading}>Loading configuration...</div> : <pre className={styles.jsonPre}>{jsonString}</pre>}
      </div>
    </div>
  );
};

export default ConfigViewer;
