/**
 * Utility functions for handling BASE_PATH environment variable
 */

// Get the base path from environment variable, with fallback to empty string
export const getBasePath = () => {
  return process.env.REACT_APP_BASE_PATH || '';
};

// Create a full path by combining base path with the given path
export const createPath = path => {
  const basePath = getBasePath();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${cleanPath}`;
};
