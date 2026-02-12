let on401 = () => {};

export const setOn401 = cb => {
  on401 = cb;
};

const isNetworkError = error => {
  if (!error) return false;
  if (error instanceof TypeError && error.message.includes('Failed to fetch')) return true;
  if (error.message?.toLowerCase().includes('network')) return true;
  if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) return true;
  return false;
};

export const safeFetch = async (url, options = {}) => {
  const {_skip401Handler, ...fetchOptions} = options;
  try {
    const response = await fetch(url, fetchOptions);
    if (response.status === 401 && !_skip401Handler) {
      on401();
      throw new Error('UNAUTHORIZED');
    }
    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      throw new Error('SERVER_UNAVAILABLE');
    }
    throw error;
  }
};
