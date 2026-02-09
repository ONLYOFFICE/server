/**
 * Copies the given text to the clipboard.
 * Uses Clipboard API when available, falls back to DOM (execCommand).
 * @param {string} text - Text to copy.
 * @returns {Promise<void>}
 */
export const copyToClipboard = async text => {
  if (!text) return;
  const copyViaDOM = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
    if (!copied) throw new Error('Copy failed');
  };
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copyViaDOM();
    }
  } else {
    copyViaDOM();
  }
};
