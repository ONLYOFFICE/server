import {getApiBasePath} from '../utils/paths';

const API_BASE_PATH = getApiBasePath();

const isNetworkError = error => {
  if (!error) return false;
  if (error instanceof TypeError && error.message.includes('Failed to fetch')) return true;
  if (error.message?.toLowerCase().includes('network')) return true;
  if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) return true;
  return false;
};

const safeFetch = async (url, options = {}) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (isNetworkError(error)) {
      throw new Error('SERVER_UNAVAILABLE');
    }
    throw error;
  }
};

export const getLicenseInfo = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/license`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can view license');
    throw new Error('Failed to get license info');
  }
  return response.json();
};

export const validateLicense = async file => {
  const buffer = await file.arrayBuffer();

  const response = await safeFetch(`${API_BASE_PATH}/license/validate`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: buffer
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    throw new Error(data.error || 'Failed to validate license');
  }

  return data;
};

export const uploadLicense = async file => {
  const buffer = await file.arrayBuffer();

  const response = await safeFetch(`${API_BASE_PATH}/license`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: buffer
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can upload license');
    throw new Error(data.error || 'Failed to upload license');
  }

  return data;
};

export const revertLicense = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/license/revert`, {
    method: 'POST',
    credentials: 'include'
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 409) throw new Error(data.error || 'No backup available');
    throw new Error(data.error || 'Failed to revert license');
  }

  return data;
};
