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

export const getFontsStatus = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/fonts/status`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can manage fonts');
    throw new Error('Failed to check fonts status');
  }
  return response.json();
};

export const getFontsList = async (filter = '', source = 'all') => {
  const params = new URLSearchParams();
  if (filter) params.append('filter', filter);
  if (source && source !== 'all') params.append('source', source);

  const url = `${API_BASE_PATH}/fonts${params.toString() ? '?' + params.toString() : ''}`;
  const response = await safeFetch(url, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can manage fonts');
    throw new Error('Failed to get fonts list');
  }
  return response.json();
};

export const uploadFonts = async files => {
  const uploaded = [];
  const failed = [];

  // Upload files one by one (same pattern as signing-certificate)
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();

      const response = await safeFetch(`${API_BASE_PATH}/fonts/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name)
        },
        body: buffer
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) throw new Error('UNAUTHORIZED');
        if (response.status === 403) throw new Error('Only admin can upload fonts');
        failed.push({filename: file.name, error: data.message || data.error || 'Upload failed'});
      } else {
        uploaded.push(data);
      }
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') throw err;
      failed.push({filename: file.name, error: err.message});
    }
  }

  return {uploaded, failed};
};

export const deleteFont = async filename => {
  const response = await safeFetch(`${API_BASE_PATH}/fonts/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can delete fonts');
    if (response.status === 404) throw new Error('Font file not found');
    const data = await response.json();
    throw new Error(data.error || 'Failed to delete font');
  }
  return response.json();
};

export const applyFontsChanges = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/fonts/apply`, {
    method: 'POST',
    credentials: 'include'
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    if (response.status === 403) throw new Error('Only admin can apply font changes');
    if (response.status === 409) throw new Error(data.message || 'Generation already in progress');
    throw new Error(data.error || 'Failed to start font generation');
  }

  return data;
};

export const getFontsApplyStatus = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/fonts/apply/status`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    throw new Error('Failed to get generation status');
  }
  return response.json();
};
