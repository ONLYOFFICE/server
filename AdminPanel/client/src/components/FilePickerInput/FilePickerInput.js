import {useRef} from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';
import styles from './FilePickerInput.module.scss';

/**
 * Unified file picker: readonly Input displaying the selected file name + Browse button.
 * Manages a hidden <input type="file"> internally.
 *
 * @param {Object} props
 * @param {string} [props.label] - Label for the input
 * @param {string} [props.accept] - Accepted file extensions, e.g. ".lic,.json"
 * @param {boolean} [props.multiple] - Allow selecting multiple files
 * @param {File|File[]|null} [props.value] - Currently selected file(s)
 * @param {function(File[])} props.onFileSelect - Callback receiving selected files
 * @param {boolean} [props.disabled] - Disable the Browse button
 * @param {string} [props.placeholder] - Placeholder for the input
 * @param {string} [props.className] - Additional class name for the outer container
 */
function FilePickerInput({label, accept, multiple, value, onFileSelect, disabled, placeholder = 'No file selected', className}) {
  const fileInputRef = useRef(null);

  const displayValue = (() => {
    if (!value) return '';
    if (Array.isArray(value)) {
      if (value.length === 0) return '';
      if (value.length === 1) return value[0].name;
      return `${value.length} file(s) selected`;
    }
    return value.name;
  })();

  const handleFileChange = event => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onFileSelect(files);
    }
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const rowClass = [styles.filePickerRow, className].filter(Boolean).join(' ');

  return (
    <>
      <input ref={fileInputRef} type='file' accept={accept} multiple={multiple} onChange={handleFileChange} style={{display: 'none'}} />
      <div className={rowClass}>
        <Input value={displayValue} onChange={() => {}} placeholder={placeholder} readOnly label={label} />
        <Button onClick={() => fileInputRef.current?.click()} disableResult disabled={disabled}>
          Browse
        </Button>
      </div>
    </>
  );
}

export default FilePickerInput;
