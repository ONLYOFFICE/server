const BACKEND_URL = process.env.REACT_APP_BACKEND_URL ?? '';
const DOCSERVICE_URL = process.env.REACT_APP_DOCSERVICE_URL;
const API_BASE_PATH = '/api/v1/admin';

export const fetchStatistics = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/stat`);
  if (!response.ok) {
    throw new Error('Failed to fetch statistics');
  }
  return response.json();
};

export const fetchConfiguration = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/config`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error('Failed to fetch configuration');
  }
  return response.json();
};

export const fetchConfigurationSchema = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/config/schema`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error('Failed to fetch configuration schema');
  }
  return response.json();
};

export const updateConfiguration = async configData => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/config`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify(configData)
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      throw errorData;
    } else {
      const errorText = await response.text();
      throw new Error(errorText);
    }
  }

  // Return the new config from the server
  return response.json();
};

export const fetchCurrentUser = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/me`, {
    method: 'GET',
    credentials: 'include' // Include cookies in the request
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    throw new Error('Failed to fetch current user');
  }

  return response.json();
};

export const checkSetupRequired = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/setup/required`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Failed to check setup status');
  }

  return response.json();
};

export const setupAdminPassword = async ({bootstrapToken, password}) => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({bootstrapToken, password})
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Setup failed');
  }

  return response.json();
};

export const login = async password => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({password})
  });

  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 403 && errorData.setupRequired) {
      throw new Error('SETUP_REQUIRED');
    }
    if (response.status === 401) {
      throw new Error('Invalid password');
    }
    throw new Error('Login failed');
  }

  return response.json();
};

export const changePassword = async ({currentPassword, newPassword}) => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({currentPassword, newPassword})
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Password change failed');
  }

  return response.json();
};

export const logout = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Logout failed');
  }

  return response.json();
};

export const rotateWopiKeys = async () => {
  const response = await fetch(`${BACKEND_URL}${API_BASE_PATH}/wopi/rotate-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to rotate WOPI keys');
  }

  return response.json();
};

export const checkHealth = async () => {
  // In development, use proxy path to avoid CORS issues
  const url = process.env.NODE_ENV === 'development' 
    ? '/healthcheck-api' 
    : `/healthcheck`;
    
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('DocService is not responding properly');
    }

    return response.json();
  } catch (error) {
    throw error;
  }
};
