import SaveButton from '../SaveButton/SaveButton';
import styles from '../FixedSaveButton/FixedSaveButton.module.scss';

/**
 * Fixed button group component
 * Renders multiple buttons in a fixed container
 * @param {Object} props - Component props
 * @param {Array} props.buttons - Array of button configurations [{text, primary, onClick}]
 * @returns {JSX.Element}
 */
function FixedSaveButtonGroup({buttons = []}) {
  if (!buttons || buttons.length === 0) return null;

  return (
    <div className={styles.fixedSaveContainer}>
      <div
        className={styles.saveButtonWrapper}
        style={{
          display: 'flex',
          gap: '8px'
        }}
      >
        {buttons.map((button, index) => (
          <SaveButton key={index} onClick={button.onClick} disabled={button.disabled || false} disableResult={true}>
            {button.text}
          </SaveButton>
        ))}
      </div>
    </div>
  );
}

export default FixedSaveButtonGroup;
