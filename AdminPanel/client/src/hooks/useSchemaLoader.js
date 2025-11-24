import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {
  selectSchema,
  selectSchemaLoading,
  selectSchemaError,
  selectBaseConfig,
  selectBaseConfigLoading,
  selectBaseConfigError,
  fetchSchema,
  fetchBaseConfig
} from '../store/slices/configSlice';
import {selectIsAuthenticated} from '../store/slices/userSlice';

/**
 * Hook to load schema and baseConfig for authenticated users
 * Fetches both immediately when the hook is first used
 */
export const useSchemaLoader = () => {
  const dispatch = useDispatch();
  const schema = useSelector(selectSchema);
  const schemaLoading = useSelector(selectSchemaLoading);
  const schemaError = useSelector(selectSchemaError);
  const baseConfig = useSelector(selectBaseConfig);
  const baseConfigLoading = useSelector(selectBaseConfigLoading);
  const baseConfigError = useSelector(selectBaseConfigError);
  const isAuthenticated = useSelector(selectIsAuthenticated);

  useEffect(() => {
    // Load schema and baseConfig only for authenticated users
    if (isAuthenticated && !schema && !schemaLoading && !schemaError) {
      dispatch(fetchSchema());
    }
    if (isAuthenticated && !baseConfig && !baseConfigLoading && !baseConfigError) {
      dispatch(fetchBaseConfig());
    }
  }, [isAuthenticated, schema, schemaLoading, schemaError, baseConfig, baseConfigLoading, baseConfigError, dispatch]);

  return {
    schema,
    schemaLoading,
    schemaError,
    baseConfig,
    baseConfigLoading,
    baseConfigError
  };
};
