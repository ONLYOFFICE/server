import SuccessGreenIcon from '../../assets/SuccessGreen.svg';
import FailRedIcon from '../../assets/FailRed.svg';
import styles from './PasswordRequirements.module.scss';
import {useSelector} from 'react-redux';
import {selectSchema, selectPasswordSchema} from '../../store/slices/configSlice';
import {useMemo} from 'react';
import {usePasswordValidation} from '../../utils/passwordValidation';

/**
 * Component that displays password requirements with progress bar
 * Matches DocSpace PasswordInput standard
 * @param {string} password - Password to validate
 * @param {boolean} isVisible - Whether to show the requirements (e.g., on focus)
 */
function PasswordRequirements({password, isVisible = false}) {
  const fullSchema = useSelector(selectSchema);
  const passwordSchema = useSelector(selectPasswordSchema);
  const {invalidRules, isValid} = usePasswordValidation(password);

  // Use fullSchema (admin panel) or passwordSchema (Setup page)
  const schema = fullSchema || passwordSchema;
  const passwordValidation = schema?.properties?.adminPanel?.properties?.passwordValidation;

  const requirements = useMemo(() => {
    if (!passwordValidation?.properties) {
      return [];
    }

    const rules = [
      {key: 'minLength', format: 'passlength'},
      {key: 'hasDigit', format: 'passdigit'},
      {key: 'hasUppercase', format: 'passupper'},
      {key: 'hasSpecialChar', format: 'passspecial'},
      {key: 'allowedCharactersOnly', format: 'passallowedchars'}
    ];

    const invalidRulesSet = new Set(invalidRules);

    return rules.map(rule => {
      const property = passwordValidation.properties[rule.key];
      const isValid = !invalidRulesSet.has(rule.key);

      return {
        text: property?.description,
        isValid
      };
    });
  }, [passwordValidation, invalidRules]);

  const validRequirements = requirements.filter(req => req.isValid).length;
  const totalRequirements = requirements.length;
  const progress = totalRequirements > 0 ? (validRequirements / totalRequirements) * 100 : 0;

  const shouldShow = isVisible;

  // Don't show if schema is not loaded yet
  if (!schema || !passwordValidation?.properties) {
    return null;
  }

  if (!shouldShow) {
    return null;
  }

  return (
    <div className={styles.requirementsContainer}>
      <div className={styles.progressBar}>
        <div className={`${styles.progressFill} ${isValid ? styles.progressComplete : ''}`} style={{width: `${progress}%`}} />
      </div>

      <div className={styles.requirementsTitle}>Password must:</div>
      <ul className={styles.requirementsList}>
        {requirements.map((requirement, index) => (
          <li key={index} className={`${styles.requirementItem} ${requirement.isValid ? styles.valid : styles.invalid}`}>
            <span className={styles.bullet}>
              {requirement.isValid ? <img src={SuccessGreenIcon} alt='Success' /> : <img src={FailRedIcon} alt='Fail' />}
            </span>
            <span className={styles.text}>{requirement.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PasswordRequirements;
