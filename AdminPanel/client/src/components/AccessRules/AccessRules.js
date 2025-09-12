import {useState} from 'react';
import Select from '../Select/Select';
import Input from '../Input/Input';
import styles from './AccessRules.module.scss';

function AccessRules({rules = [], onChange}) {
  const [newRule, setNewRule] = useState({type: 'Allow', value: ''});

  const handleAddRule = () => {
    if (newRule.value.trim()) {
      const updatedRules = [...rules, {...newRule, value: newRule.value.trim()}];
      onChange(updatedRules);
      setNewRule({type: 'Allow', value: ''});
    }
  };

  const handleRemoveRule = index => {
    const updatedRules = rules.filter((_, i) => i !== index);
    onChange(updatedRules);
  };

  const handleKeyPress = e => {
    if (e.key === 'Enter') {
      handleAddRule();
    }
  };

  return (
    <div className={styles.accessRules}>
      <h3 className={styles.title}>Access Rules</h3>
      <p className={styles.description}>Configure nginx-style allow/deny rules for granular access control</p>

      <div className={styles.addRule}>
        <Select
          value={newRule.type}
          onChange={value => setNewRule({...newRule, type: value})}
          options={[
            {value: 'Allow', label: 'Allow'},
            {value: 'Deny', label: 'Deny'}
          ]}
        />
        <div className={styles.inputWrapper}>
          <Input
            placeholder='Enter value'
            value={newRule.value}
            onChange={value => setNewRule({...newRule, value})}
            onKeyPress={handleKeyPress}
            width='calc(100% - 32px)'
          />
        </div>
        <button className={styles.addButton} onClick={handleAddRule} disabled={!newRule.value.trim()}>
          Add Rule
        </button>
      </div>

      <div className={styles.rulesList}>
        {rules.map((rule, index) => (
          <div key={index} className={styles.rule}>
            <span className={`${styles.ruleType} ${styles[`ruleType--${rule.type.toLowerCase()}`]}`}>{rule.type}</span>
            <span className={styles.ruleValue}>{rule.value}</span>
            <button className={styles.removeButton} onClick={() => handleRemoveRule(index)}>
              Remove
            </button>
          </div>
        ))}
        {rules.length === 0 && <div className={styles.emptyState}>No access rules configured</div>}
      </div>
    </div>
  );
}

export default AccessRules;
