import {useState} from 'react';
import PasswordInput from '../PasswordInput/PasswordInput';
import PasswordRequirements from '../PasswordRequirements/PasswordRequirements';
import {usePasswordValidation} from '../../utils/passwordValidation';

/**
 * Password input component with requirements display on focus
 * Matches DocSpace PasswordInput standard behavior
 */
function PasswordInputWithRequirements({label, value, onChange, placeholder, description, error, ...props}) {
  const [isFocused, setIsFocused] = useState(false);
  const {isValid} = usePasswordValidation(value);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  return (
    <div>
      <div style={{position: 'relative'}}>
        <PasswordInput
          label={label}
          type='password'
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          description={description}
          error={error}
          isValid={isValid}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        <PasswordRequirements password={value} isVisible={isFocused} />
      </div>
    </div>
  );
}

export default PasswordInputWithRequirements;
