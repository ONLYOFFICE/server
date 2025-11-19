import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

export default function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    const scroller = document.querySelector('.mainContent');
    if (scroller && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({top: 0, left: 0, behavior: 'auto'});
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

  return null;
}
