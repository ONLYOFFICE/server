import {getApiBasePath, getDocServicePath} from '../utils/paths';

const API_BASE_PATH = getApiBasePath();
const DOCSERVICE_URL = getDocServicePath();

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

export const fetchStatistics = async tenant => {
  const url = tenant ? `${API_BASE_PATH}/stat?tenant=${encodeURIComponent(tenant)}` : `${API_BASE_PATH}/stat`;
  const response = await safeFetch(url, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to fetch statistics');
  return response.json();
};

export const fetchTenants = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/tenants`, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to fetch tenants');
  return response.json();
};

export const fetchConfiguration = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/config`, {credentials: 'include'});
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error('Failed to fetch configuration');
  return response.json();
};

export const fetchConfigurationSchema = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/config/schema`, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to fetch configuration schema');
  return response.json();
};

export const fetchBaseConfiguration = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/config/baseconfig`, {credentials: 'include'});
  if (response.status === 401) throw new Error('UNAUTHORIZED');
  if (!response.ok) throw new Error('Failed to fetch base configuration');
  return response.json();
};

export const updateConfiguration = async configData => {
  const response = await safeFetch(`${API_BASE_PATH}/config`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify(configData)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
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
  const response = await safeFetch(`${API_BASE_PATH}/me`, {credentials: 'include'});
  const data = await response.json();
  if (data && data.authorized === false) {
    throw new Error('UNAUTHORIZED');
  }
  return data;
};

export const checkSetupRequired = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/setup/required`, {credentials: 'include'});
  if (!response.ok) throw new Error('Failed to check setup status');
  return response.json();
};

export const setupAdminPassword = async ({bootstrapToken, password}) => {
  const response = await safeFetch(`${API_BASE_PATH}/setup`, {
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
  const response = await safeFetch(`${API_BASE_PATH}/login`, {
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
  const response = await safeFetch(`${API_BASE_PATH}/change-password`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({currentPassword, newPassword})
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
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
  const response = await safeFetch(`${API_BASE_PATH}/logout`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include'
  });
  if (!response.ok) throw new Error('Logout failed');
  return response.json();
};

export const rotateWopiKeys = async () => {
  const response = await safeFetch(`${API_BASE_PATH}/wopi/rotate-keys`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
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
  const response = await safeFetch(`${DOCSERVICE_URL}/healthcheck`);
  if (!response.ok) throw new Error('DocService health check failed');
  const result = await response.text();
  if (result !== 'true') throw new Error('DocService health check failed');
  return true;
};

export const getMaintenanceStatus = async () => {
  const response = await safeFetch(`${DOCSERVICE_URL}/internal/cluster/inactive`, {
    method: 'GET',
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Failed to get maintenance status');
  }
  return response.json();
};

export const enterMaintenanceMode = async () => {
  const response = await safeFetch(`${DOCSERVICE_URL}/internal/cluster/inactive`, {
    method: 'PUT',
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Failed to enter maintenance mode');
  }
  return response.json();
};

export const exitMaintenanceMode = async () => {
  const response = await safeFetch(`${DOCSERVICE_URL}/internal/cluster/inactive`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Failed to exit maintenance mode');
  }
  return response.json();
};

export const resetConfiguration = async (paths = ['*']) => {
  const pathsArray = Array.isArray(paths) ? paths : [paths];

  const response = await safeFetch(`${API_BASE_PATH}/config/reset`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'include',
    body: JSON.stringify({paths: pathsArray})
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('UNAUTHORIZED');
    throw new Error('Failed to reset configuration');
  }
  const result = await response.json();
  return result;
};

export const generateDocServerToken = async body => {
  const response = await safeFetch(`${API_BASE_PATH}/generate-docserver-token`, {
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

  const response = await safeFetch(`${DOCSERVICE_URL}/command`, {
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

/**
 * Convert HTML to PDF using the FileConverter service
 * @param {string} htmlContent - HTML content to convert
 * @returns {Promise<Blob>} PDF blob
 */
export const convertHtmlToPdf = async htmlContent => {
  // Create a Blob from HTML content
  const htmlBlob = new Blob([htmlContent], {type: 'text/html'});
  const htmlFile = new File([htmlBlob], 'statistics.html', {type: 'text/html'});

  // Create FormData
  const formData = new FormData();
  formData.append('file', htmlFile);
  formData.append('format', 'pdf');

  const response = await safeFetch(`${DOCSERVICE_URL}/lool/convert-to/pdf`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Failed to convert HTML to PDF');
  }

  return await response.blob();
};
