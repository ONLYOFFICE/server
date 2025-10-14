import {configureStore} from '@reduxjs/toolkit';
import userReducer from './slices/userSlice';
import configReducer from './slices/configSlice';

export const store = configureStore({
  reducer: {
    user: userReducer,
    config: configReducer
  }
});
