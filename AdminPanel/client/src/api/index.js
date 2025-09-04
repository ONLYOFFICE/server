const BACKEND_URL = process.env.REACT_APP_BACKEND_URL ?? '';

export const fetchStatistics = async () => {
  const response = await fetch(`${BACKEND_URL}/info/info.json`);
  if (!response.ok) {
    throw new Error('Failed to fetch statistics');
  }
  return response.json();
};

export const fetchConfiguration = async () => {
  const response = await fetch(`${BACKEND_URL}/info/config`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Failed to fetch configuration');
  }
  return response.json();
};

export const fetchConfigurationSchema = async () => {
  const response = await fetch(`${BACKEND_URL}/info/config/schema`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Failed to fetch configuration schema');
  }
  return response.json();
};

export const updateConfiguration = async configData => {
  const response = await fetch(`${BACKEND_URL}/info/config`, {
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

  // Try to parse as JSON, fallback to text if it's not JSON
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  } else {
    return response.text();
  }
};

export const fetchCurrentUser = async () => {
  const response = await fetch(`${BACKEND_URL}/info/adminpanel/me`, {
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

export const login = async ({tenantName, secret}) => {
  const response = await fetch(`${BACKEND_URL}/info/adminpanel/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({tenantName, secret})
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid credentials');
    }
    throw new Error('Login failed');
  }

  return response.json();
};

export const logout = async () => {
  const response = await fetch(`${BACKEND_URL}/info/adminpanel/logout`, {
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
