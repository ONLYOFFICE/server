import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {selectSchema, selectSchemaLoading, selectSchemaError, fetchSchema} from '../store/slices/configSlice';
import {selectIsAuthenticated} from '../store/slices/userSlice';

/**
 * Hook to load schema for authenticated users
 * Fetches schema immediately when the hook is first used
 */
export const useSchemaLoader = () => {
  const dispatch = useDispatch();
  const schema = useSelector(selectSchema);
  const schemaLoading = useSelector(selectSchemaLoading);
  const schemaError = useSelector(selectSchemaError);
  const isAuthenticated = useSelector(selectIsAuthenticated);

  useEffect(() => {
    // Load schema only for authenticated users
    if (isAuthenticated && !schema && !schemaLoading && !schemaError) {
      dispatch(fetchSchema());
    }
  }, [isAuthenticated, schema, schemaLoading, schemaError, dispatch]);

  return {
    schema,
    schemaLoading,
    schemaError
  };
};
