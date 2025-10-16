import React, {useState} from 'react';
import {getPasswordRequirementsStatus} from '../../utils/passwordValidation';
import SuccessGreenIcon from '../../assets/SuccessGreen.svg';
import FailRedIcon from '../../assets/FailRed.svg';
import styles from './PasswordRequirements.module.scss';

/**
 * Component that displays password requirements with progress bar
 * Matches DocSpace PasswordInput standard
 * @param {string} password - Password to validate
 * @param {boolean} isVisible - Whether to show the requirements (e.g., on focus)
 * @param {Object} settings - Password settings (optional)
 */
function PasswordRequirements({password, isVisible = false, settings}) {
  const requirementsStatus = getPasswordRequirementsStatus(password || '', settings);
  const {requirements, progress, isValid} = requirementsStatus;

  const shouldShow = isVisible || (!isValid && password);

  if (!shouldShow) {
    return null;
  }

  return (
    <div className={styles.requirementsContainer}>
      <div className={styles.progressBar}>
        <div 
          className={`${styles.progressFill} ${isValid ? styles.progressComplete : ''}`}
          style={{width: `${progress}%`}}
        />
      </div>
      
      <div className={styles.requirementsTitle}>Password must contain:</div>
      <ul className={styles.requirementsList}>
        {requirements.map((requirement, index) => (
          <li 
            key={index} 
            className={`${styles.requirementItem} ${requirement.isValid ? styles.valid : styles.invalid}`}
          >
            <span className={styles.bullet}>
              {requirement.isValid ? (
                <img src={SuccessGreenIcon} alt="Success" />
              ) : (
                <img src={FailRedIcon} alt="Fail" />
              )}
            </span>
            <span className={styles.text}>{requirement.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PasswordRequirements;

