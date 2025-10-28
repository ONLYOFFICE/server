import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import {fetchCurrentUser} from '../../api';

export const fetchUser = createAsyncThunk('user/fetchUser', async (_, {rejectWithValue}) => {
  try {
    return await fetchCurrentUser();
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

const initialState = {
  user: null,
  loading: false,
  error: null,
  isAuthenticated: false
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    // Clear user data (logout)
    clearUser: state => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
    },
    // Clear error
    clearError: state => {
      state.error = null;
    }
  },
  extraReducers: builder => {
    builder
      // Fetch user cases
      .addCase(fetchUser.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.loading = false;
        state.user = {
          tenant: action.payload.tenant,
          isAdmin: action.payload.isAdmin
        };
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.isAuthenticated = false;
      });
  }
});

export const {clearUser, clearError} = userSlice.actions;

// Selectors
export const selectUser = state => state.user.user;
export const selectUserLoading = state => state.user.loading;
export const selectUserError = state => state.user.error;
export const selectIsAuthenticated = state => state.user.isAuthenticated;

export default userSlice.reducer;
