import Button from '../Button/Button';
import styles from './FixedSaveButton.module.scss';

function FixedSaveButton({onClick, disabled, children = 'Save Changes', disableResult = false}) {
  return (
    <div className={styles.fixedSaveContainer}>
      <div className={styles.saveButtonWrapper}>
        <Button onClick={onClick} disabled={disabled} disableResult={disableResult}>
          {children}
        </Button>
      </div>
    </div>
  );
}

export default FixedSaveButton;
