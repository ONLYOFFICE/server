import {useEffect} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {
  selectConfig,
  selectConfigLoading,
  selectConfigError,
  selectSchema,
  selectSchemaLoading,
  selectSchemaError,
  selectBaseConfig,
  selectBaseConfigLoading,
  selectBaseConfigError,
  fetchConfig,
  fetchSchema,
  fetchBaseConfig
} from '../../store/slices/configSlice';
import {selectIsAuthenticated} from '../../store/slices/userSlice';
import {setGlobalError} from '../../store/slices/globalErrorSlice';
import Spinner from '../Spinner/Spinner';

const ConfigLoader = ({children}) => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const configLoading = useSelector(selectConfigLoading);
  const configError = useSelector(selectConfigError);
  const schema = useSelector(selectSchema);
  const schemaLoading = useSelector(selectSchemaLoading);
  const schemaError = useSelector(selectSchemaError);
  const baseConfig = useSelector(selectBaseConfig);
  const baseConfigLoading = useSelector(selectBaseConfigLoading);
  const baseConfigError = useSelector(selectBaseConfigError);
  const isAuthenticated = useSelector(selectIsAuthenticated);

  const loading = configLoading || schemaLoading || baseConfigLoading;
  const error = configError || schemaError || baseConfigError;

  // Split into separate effects to avoid unnecessary re-runs
  useEffect(() => {
    if (isAuthenticated && !config && !configLoading && !configError) {
      dispatch(fetchConfig());
    }
  }, [isAuthenticated, config, configLoading, configError, dispatch]);

  useEffect(() => {
    if (isAuthenticated && !schema && !schemaLoading && !schemaError) {
      dispatch(fetchSchema());
    }
  }, [isAuthenticated, schema, schemaLoading, schemaError, dispatch]);

  useEffect(() => {
    if (isAuthenticated && !baseConfig && !baseConfigLoading && !baseConfigError) {
      dispatch(fetchBaseConfig());
    }
  }, [isAuthenticated, baseConfig, baseConfigLoading, baseConfigError, dispatch]);

  useEffect(() => {
    if (error && error !== 'UNAUTHORIZED' && error?.message !== 'UNAUTHORIZED') {
      dispatch(setGlobalError('UNKNOWN'));
    }
  }, [error, dispatch]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <Spinner size={50} />
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return null;
  }

  if (!config || !schema || !baseConfig) {
    return null;
  }

  return children;
};

export default ConfigLoader;
