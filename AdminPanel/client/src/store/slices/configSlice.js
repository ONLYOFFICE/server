import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { fetchConfiguration, fetchConfigurationSchema, updateConfiguration } from '../../api';

export const fetchConfig = createAsyncThunk('config/fetchConfig', async (_, { rejectWithValue }) => {
  try {
    const [config, schema] = await Promise.all([fetchConfiguration(), fetchConfigurationSchema()]);
    return { config, schema };
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const saveConfig = createAsyncThunk('config/saveConfig', async (configData, { rejectWithValue }) => {
  try {
    await updateConfiguration(configData);
    return configData;
  } catch (error) {
    return rejectWithValue(error);
  }
});

const initialState = {
  config: null,
  schema: null,
  loading: false,
  saving: false,
  error: null
};

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    updateLocalConfig: (state, action) => {
      // Merge updates into local config without saving
      if (state.config) {
        state.config = { ...state.config, ...action.payload };
      }
    },
    clearError: (state) => {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch config cases
      .addCase(fetchConfig.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchConfig.fulfilled, (state, action) => {
        state.loading = false;
        state.config = action.payload.config;
        state.schema = action.payload.schema;
        state.error = null;
      })
      .addCase(fetchConfig.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Save config cases
      .addCase(saveConfig.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveConfig.fulfilled, (state, action) => {
        state.saving = false;
        // Update the global config with the saved changes
        if (state.config) {
          state.config = { ...state.config, ...action.payload };
        }
        state.error = null;
      })
      .addCase(saveConfig.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      });
  }
});

export const { updateLocalConfig, clearError } = configSlice.actions;

// Selectors
export const selectConfig = (state) => state.config.config;
export const selectSchema = (state) => state.config.schema;
export const selectConfigLoading = (state) => state.config.loading;
export const selectConfigSaving = (state) => state.config.saving;
export const selectConfigError = (state) => state.config.error;

export default configSlice.reducer;
