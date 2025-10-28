export function getNestedValue(obj, path, defaultValue = '') {
  if (!obj || !path) return defaultValue;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return defaultValue;
    }
  }

  return current !== undefined ? current : defaultValue;
}
