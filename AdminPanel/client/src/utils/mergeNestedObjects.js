export function mergeNestedObjects(objects) {
  const result = {};

  for (const obj of objects) {
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        const keys = key.split('.');
        let current = result;

        for (let i = 0; i < keys.length; i++) {
          const part = keys[i];

          if (i === keys.length - 1) {
            current[part] = obj[key];
          } else {
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }
        }
      }
    }
  }

  return result;
}
