/**
 * Get the base path for AdminPanel routes
 * Supports both regular /admin and vpath /vpath/admin routes
 * @returns {string} Base path (e.g., '/admin' or '/vpath/admin')
 */
export const getBasename = () => {
  const pathname = window.location.pathname;
  const adminMatch = pathname.match(/^(.*?\/admin)(?:\/|$)/);

  if (adminMatch) {
    return adminMatch[1]; // Returns /admin or /vpath/admin
  }

  return '';
};

/**
 * Backend URL for API calls
 */
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL ?? '';

/**
 * Get relative path to DocService resources from AdminPanel
 * @returns {string} Relative path prefix
 */
export const getDocServicePath = () => {
  return `${BACKEND_URL}${getBasename()}/..`;
};

/**
 * API base path including basename
 */
export const getApiBasePath = () => {
  return `${BACKEND_URL}${getBasename()}/api/v1`;
};
