import {createSlice} from '@reduxjs/toolkit';

const initialState = {
  type: null // null | 'UNAUTHORIZED' | 'UNKNOWN'
};

const globalErrorSlice = createSlice({
  name: 'globalError',
  initialState,
  reducers: {
    setGlobalError: (state, action) => {
      state.type = action.payload;
    },
    clearGlobalError: state => {
      state.type = null;
    }
  }
});

export const {setGlobalError, clearGlobalError} = globalErrorSlice.actions;
export const selectGlobalError = state => state.globalError?.type ?? null;

export default globalErrorSlice.reducer;
