import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import {
  fetchConfiguration,
  fetchConfigurationSchema,
  fetchBaseConfiguration,
  updateConfiguration,
  rotateWopiKeys,
  resetConfiguration
} from '../../api';

export const fetchConfig = createAsyncThunk('config/fetchConfig', async (_, {rejectWithValue}) => {
  try {
    const config = await fetchConfiguration();
    return {config};
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const fetchSchema = createAsyncThunk('config/fetchSchema', async (_, {rejectWithValue}) => {
  try {
    const schema = await fetchConfigurationSchema();
    return {schema};
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const fetchBaseConfig = createAsyncThunk('config/fetchBaseConfig', async (_, {rejectWithValue}) => {
  try {
    const baseConfig = await fetchBaseConfiguration();
    return {baseConfig};
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const saveConfig = createAsyncThunk('config/saveConfig', async (configData, {rejectWithValue}) => {
  try {
    const newConfig = await updateConfiguration(configData);
    return newConfig;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const rotateWopiKeysAction = createAsyncThunk('config/rotateWopiKeys', async (_, {rejectWithValue}) => {
  try {
    const newConfig = await rotateWopiKeys();
    return newConfig;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const resetConfig = createAsyncThunk('config/resetConfig', async (paths, {rejectWithValue}) => {
  try {
    const newConfig = await resetConfiguration(paths);
    return newConfig;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

const initialState = {
  config: null,
  baseConfig: null,
  schema: null, // Full schema for admin panel
  passwordSchema: null, // Minimal schema for Setup page password validation
  loading: false,
  schemaLoading: false,
  baseConfigLoading: false,
  saving: false,
  error: null,
  schemaError: null,
  baseConfigError: null
};

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    updateLocalConfig: (state, action) => {
      // Merge updates into local config without saving
      if (state.config) {
        state.config = {...state.config, ...action.payload};
      }
    },
    clearConfig: state => {
      state.config = null;
      state.loading = false;
      state.error = null;
    },
    clearError: state => {
      state.error = null;
    },
    setPasswordSchema: (state, action) => {
      state.passwordSchema = action.payload;
    }
  },
  extraReducers: builder => {
    builder
      // Fetch config cases
      .addCase(fetchConfig.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchConfig.fulfilled, (state, action) => {
        state.loading = false;
        state.config = action.payload.config;
        state.error = null;
      })
      .addCase(fetchConfig.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch schema cases
      .addCase(fetchSchema.pending, state => {
        state.schemaLoading = true;
        state.schemaError = null;
      })
      .addCase(fetchSchema.fulfilled, (state, action) => {
        state.schemaLoading = false;
        state.schema = action.payload.schema;
        state.schemaError = null;
      })
      .addCase(fetchSchema.rejected, (state, action) => {
        state.schemaLoading = false;
        state.schemaError = action.payload;
      })
      .addCase(fetchBaseConfig.pending, state => {
        state.baseConfigLoading = true;
        state.baseConfigError = null;
      })
      .addCase(fetchBaseConfig.fulfilled, (state, action) => {
        state.baseConfigLoading = false;
        state.baseConfig = action.payload.baseConfig;
        state.baseConfigError = null;
      })
      .addCase(fetchBaseConfig.rejected, (state, action) => {
        state.baseConfigLoading = false;
        state.baseConfigError = action.payload;
      })
      // Save config cases
      .addCase(saveConfig.pending, state => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveConfig.fulfilled, (state, action) => {
        state.saving = false;
        // Update the global config with the complete new config from server
        state.config = action.payload;
        state.error = null;
      })
      .addCase(saveConfig.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      })
      .addCase(rotateWopiKeysAction.pending, state => {
        state.saving = true;
        state.error = null;
      })
      .addCase(rotateWopiKeysAction.fulfilled, (state, action) => {
        state.saving = false;
        state.config = action.payload;
        state.error = null;
      })
      .addCase(rotateWopiKeysAction.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      })
      .addCase(resetConfig.pending, state => {
        state.saving = true;
        state.error = null;
      })
      .addCase(resetConfig.fulfilled, (state, action) => {
        state.saving = false;
        state.config = action.payload;
        state.error = null;
      })
      .addCase(resetConfig.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      });
  }
});

export const {updateLocalConfig, clearConfig, clearError, setPasswordSchema} = configSlice.actions;

// Selectors
export const selectConfig = state => state.config.config;
export const selectBaseConfig = state => state.config.baseConfig;
export const selectSchema = state => state.config.schema;
export const selectPasswordSchema = state => state.config.passwordSchema;
export const selectConfigLoading = state => state.config.loading;
export const selectSchemaLoading = state => state.config.schemaLoading;
export const selectBaseConfigLoading = state => state.config.baseConfigLoading;
export const selectConfigSaving = state => state.config.saving;
export const selectConfigError = state => state.config.error;
export const selectSchemaError = state => state.config.schemaError;
export const selectBaseConfigError = state => state.config.baseConfigError;

export default configSlice.reducer;
