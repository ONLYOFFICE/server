import {useEffect} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {
  selectConfig,
  selectConfigLoading,
  selectConfigError,
  selectSchema,
  selectSchemaLoading,
  selectSchemaError,
  fetchConfig,
  fetchSchema
} from '../../store/slices/configSlice';
import Button from '../LoginButton';

const ConfigLoader = ({children}) => {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const configLoading = useSelector(selectConfigLoading);
  const configError = useSelector(selectConfigError);
  const schema = useSelector(selectSchema);
  const schemaLoading = useSelector(selectSchemaLoading);
  const schemaError = useSelector(selectSchemaError);

  const loading = configLoading || schemaLoading;
  const error = configError || schemaError;

  useEffect(() => {
    // Fetch config if not loaded
    if (!config && !configLoading && !configError) {
      dispatch(fetchConfig());
    }

    // Fetch schema if not loaded (only once per session)
    if (!schema && !schemaLoading && !schemaError) {
      dispatch(fetchSchema());
    }
  }, [config, configLoading, configError, schema, schemaLoading, schemaError, dispatch]);

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
        <svg width='50' height='50' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg' style={{animation: 'spin 1s linear infinite'}}>
          <path
            d='M9.06812 15.75C5.29857 15.75 2.25568 12.735 2.25568 9C2.25568 5.265 5.29857 2.25 9.06812 2.25C10.8812 2.25 12.5247 2.97759 13.7397 4.12194C13.8255 4.20274 13.9152 4.2797 14.0198 4.33409C14.3161 4.48823 14.9843 4.74308 15.487 4.245C15.9865 3.75001 15.7356 3.09308 15.5798 2.79677C15.5233 2.6894 15.4438 2.59682 15.3556 2.51353C13.7181 0.967092 11.5151 0 9.06812 0C4.05719 0 0 4.035 0 9C0 13.965 4.05719 18 9.06812 18C13.0816 18 16.4798 15.4184 17.6694 11.8342C17.8962 11.1509 17.3444 10.5 16.6244 10.5C16.0825 10.5 15.6221 10.8784 15.4283 11.3844C14.4527 13.9315 11.9806 15.75 9.06812 15.75Z'
            fill='#333'
          />
        </svg>
        <p>Loading configuration...</p>
      </div>
    );
  }

  if (error) {
    const errorMessage = typeof error === 'string' ? error : error?.message || 'Unknown error';
    const isUnauthorized = error === 'UNAUTHORIZED' || error?.message === 'UNAUTHORIZED';

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '2px'
        }}
      >
        {isUnauthorized ? (
          <>
            <p style={{color: '#d32f2f', fontSize: '18px', fontWeight: '500', margin: '0 0 8px 0'}}>Session expired</p>
            <p style={{color: '#666', fontSize: '14px', margin: '0 0 16px 0'}}>Please log in again to continue</p>
            <Button onClick={() => window.location.reload()}>Login</Button>
          </>
        ) : (
          <>
            <p style={{color: 'red'}}>Error loading configuration: {errorMessage}</p>
            <Button onClick={() => window.location.reload()}>Login</Button>
          </>
        )}
      </div>
    );
  }

  if (!config || !schema) {
    return null;
  }

  return children;
};

export default ConfigLoader;
