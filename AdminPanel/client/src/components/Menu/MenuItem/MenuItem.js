import AppMenuSprite from '../../../assets/AppMenuSprite.svg';
import styles from './MenuItem.module.scss';

const SPRITE_ICON_SIZE = 24;
const SPRITE_TOTAL_HEIGHT = 384;

function MenuItem({label, isActive, onClick, iconIndex}) {
  const renderIcon = () => {
    const yOffset = -iconIndex * SPRITE_ICON_SIZE;
    return (
      <div
        className={styles['menuItem__icon']}
        style={{
          backgroundImage: `url(${AppMenuSprite})`,
          backgroundPosition: `0 ${yOffset}px`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${SPRITE_ICON_SIZE}px ${SPRITE_TOTAL_HEIGHT}px`
        }}
      />
    );
  };

  return (
    <div className={`${styles.menuItem} ${isActive ? styles['menuItem--active'] : ''}`} onClick={onClick}>
      {renderIcon()}
      <span className={styles['menuItem__label']}>{label}</span>
    </div>
  );
}

export default MenuItem;
