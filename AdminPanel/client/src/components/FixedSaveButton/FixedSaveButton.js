import SaveButton from '../SaveButton/SaveButton';
import styles from './FixedSaveButton.module.scss';

function FixedSaveButton({onClick, disabled, children = 'Save Changes', disableResult = false}) {
  return (
    <div className={styles.fixedSaveContainer}>
      <div className={styles.saveButtonWrapper}>
        <SaveButton onClick={onClick} disabled={disabled} disableResult={disableResult}>
          {children}
        </SaveButton>
      </div>
    </div>
  );
}

export default FixedSaveButton;
