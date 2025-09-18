/**
 * Masks a key string to show only first 5 and last 10 characters
 * Format: ABCDE...FGHIJKLMNO
 * @param {string} key - The key string to mask
 * @returns {string} - The masked key string
 */
export const maskKey = key => {
  if (!key || typeof key !== 'string') {
    return '';
  }

  if (key.length <= 15) {
    return key;
  }

  const firstPart = key.substring(0, 5);
  const lastPart = key.substring(key.length - 10);

  return `${firstPart}...${lastPart}`;
};
