import {useState, useRef, useCallback} from 'react';

function filterByAccept(files, accept) {
  if (!accept) return files;
  const extensions = accept.split(',').map(ext => ext.trim().toLowerCase());
  return files.filter(file => extensions.some(ext => file.name.toLowerCase().endsWith(ext)));
}

/**
 * Hook for drag-and-drop file handling.
 * Returns props to spread on any container element to make it a drop zone.
 * Uses a dragCounter ref to prevent false dragLeave events from child elements.
 *
 * @param {Object} options
 * @param {function(File[])} options.onDrop - Callback receiving accepted files
 * @param {string} [options.accept] - Comma-separated extensions, e.g. ".lic,.json"
 * @param {boolean} [options.multiple=false] - Allow multiple files
 * @param {boolean} [options.disabled=false] - Ignore drops (visual feedback still works)
 * @returns {{ isDragActive: boolean, dropZoneProps: Object }}
 */
function useFileDrop({onDrop, accept, multiple = false, disabled = false}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounter = useRef(0);

  // Store latest values in refs so handlers have stable identity
  const onDropRef = useRef(onDrop);
  const acceptRef = useRef(accept);
  const multipleRef = useRef(multiple);
  const disabledRef = useRef(disabled);
  onDropRef.current = onDrop;
  acceptRef.current = accept;
  multipleRef.current = multiple;
  disabledRef.current = disabled;

  const handleDragEnter = useCallback(e => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback(e => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback(e => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragActive(false);
    if (disabledRef.current) return;

    const rawFiles = Array.from(e.dataTransfer?.files || []);
    let filtered = filterByAccept(rawFiles, acceptRef.current);
    if (!multipleRef.current) {
      filtered = filtered.slice(0, 1);
    }
    if (filtered.length > 0) {
      onDropRef.current(filtered);
    }
  }, []);

  const dropZoneProps = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop
  };

  return {isDragActive, dropZoneProps};
}

export default useFileDrop;
