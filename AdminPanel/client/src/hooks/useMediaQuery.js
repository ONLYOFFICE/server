import {useState, useEffect} from 'react';

/**
 * Hook to track media query match status
 * @param {string} query - CSS media query string
 * @returns {boolean} - true if media query matches
 */
const useMediaQuery = query => {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const media = window.matchMedia(query);

    // Set initial value in case it changed
    setMatches(media.matches);

    // Create listener function
    const listener = event => {
      setMatches(event.matches);
    };

    // Use modern addEventListener API
    media.addEventListener('change', listener);

    // Cleanup
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
};

export default useMediaQuery;
