const BACKEND_URL = process.env.REACT_APP_BACKEND_URL ?? '';
const API_BASE_PATH = '/api/v1/admin';

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

export const fetchStatistics = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/stat`);
  if (!response.ok) throw new Error('Failed to fetch statistics');
  return response.json();
};

export const fetchConfiguration = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/config`, {credentials: 'include'});
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error('Failed to fetch configuration');
  return response.json();
};

export const fetchConfigurationSchema = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/config/schema`, {credentials: 'include'});
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error('Failed to fetch configuration schema');
  return response.json();
};

export const updateConfiguration = async configData => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/config`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify(configData)
  });
  if (!response.ok) {
    let errorMessage = 'Configuration update failed';
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // JSON parsing failed, use default message
    }
    throw new Error(errorMessage);
  }
  return response.json();
};

export const fetchCurrentUser = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/me`, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to fetch current user');
  const data = await response.json();
  if (data && data.authorized === false) {
    throw new Error('Unauthorized');
  }
  return data;
};

export const checkSetupRequired = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/setup/required`, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to check setup status');
  return response.json();
};

export const setupAdminPassword = async ({bootstrapToken, password}) => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/setup`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({bootstrapToken, password})
  });
  if (!response.ok) {
    let errorMessage = 'Setup failed';
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // JSON parsing failed, use default message
    }
    throw new Error(errorMessage);
  }
  return response.json();
};

export const login = async password => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({password})
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Invalid password');
    if (response.status === 403) {
      try {
        const errorData = await response.json();
        if (errorData.setupRequired) throw new Error('SETUP_REQUIRED');
      } catch (error) {
        if (error.message === 'SETUP_REQUIRED') throw error;
        throw new Error('Login failed');
      }
    }
    throw new Error('Login failed');
  }
  return response.json();
};

export const changePassword = async ({currentPassword, newPassword}) => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/change-password`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({currentPassword, newPassword})
  });
  if (!response.ok) {
    let errorMessage = 'Password change failed';
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // JSON parsing failed, use default message
    }
    throw new Error(errorMessage);
  }
  return response.json();
};

export const logout = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/logout`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Logout failed');
  return response.json();
};

export const rotateWopiKeys = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/wopi/rotate-keys`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include'
  });
  if (!response.ok) {
    let errorMessage = 'Failed to rotate WOPI keys';
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // JSON parsing failed, use default message
    }
    throw new Error(errorMessage);
  }
  return response.json();
};

export const checkHealth = async () => {
  const url = process.env.NODE_ENV === 'development' ? '/healthcheck-api' : '../healthcheck';
  const response = await safeFetch(url);
  if (!response.ok) throw new Error('DocService health check failed');
  const result = await response.text();
  if (result !== 'true') throw new Error('DocService health check failed');
  return true;
};

export const resetConfiguration = async () => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/config/reset`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Failed to reset configuration');
  return response.json();
};

export const generateDocServerToken = async body => {
  const response = await safeFetch(`${BACKEND_URL}${API_BASE_PATH}/generate-docserver-token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error('Failed to generate Document Server token');
  }
  return response.json();
};

const callCommandService = async body => {
  const {token} = await generateDocServerToken(body);
  body.token = token;

  const url = process.env.REACT_APP_DOCSERVICE_URL ? `${process.env.REACT_APP_DOCSERVICE_URL}/command` : '../command';
  const response = await safeFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('File not found');
    throw new Error(`Failed to execute ${JSON.stringify(body)}`);
  }

  return response.json();
};

export const getForgottenList = async () => {
  const result = await callCommandService({c: 'getForgottenList'});
  const files = result.keys || [];
  return files.map(fileKey => {
    const fileName = fileKey.split('/').pop() || fileKey;
    return {
      key: fileKey,
      name: fileName,
      size: null,
      modified: null
    };
  });
};

export const getForgotten = async docId => {
  const result = await callCommandService({c: 'getForgotten', key: docId});
  return {
    docId,
    url: result.url,
    name: docId.split('/').pop() || docId
  };
};
