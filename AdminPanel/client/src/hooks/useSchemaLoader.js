import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {selectSchema, selectSchemaLoading, selectSchemaError, fetchSchema} from '../store/slices/configSlice';

/**
 * Hook to load schema on app startup
 * Fetches schema immediately when the hook is first used
 */
export const useSchemaLoader = () => {
  const dispatch = useDispatch();
  const schema = useSelector(selectSchema);
  const schemaLoading = useSelector(selectSchemaLoading);
  const schemaError = useSelector(selectSchemaError);

  useEffect(() => {
    // Fetch schema if not loaded (always fetch, no auth required)
    if (!schema && !schemaLoading && !schemaError) {
      dispatch(fetchSchema());
    }
  }, [schema, schemaLoading, schemaError, dispatch]);

  return {
    schema,
    schemaLoading,
    schemaError
  };
};
