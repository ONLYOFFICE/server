import {Provider} from 'react-redux';
import {useState} from 'react';
import {Routes, Route, Navigate, BrowserRouter, useLocation} from 'react-router-dom';
import './App.css';
import {store} from './store';
import AuthWrapper from './components/AuthWrapper/AuthWrapper';
import ConfigLoader from './components/ConfigLoader/ConfigLoader';
import Menu from './components/Menu/Menu';
import MobileHeader from './components/MobileHeader/MobileHeader';
import ScrollToTop from './components/ScrollToTop/ScrollToTop';
import {menuItems} from './config/menuItems';
import {getBasename} from './utils/paths';

/**
 * ConditionalConfigLoader wraps routes with ConfigLoader only if the route requires config.
 * This prevents unnecessary config loading delays for pages that don't need config data.
 *
 * Pages marked with requiresConfig: false will render immediately without waiting for config.
 * All other pages will wait for config to load before rendering.
 */
function ConditionalConfigLoader({children}) {
  const location = useLocation();

  const currentRoute = menuItems.find(item => location.pathname === item.path);

  if (!currentRoute || currentRoute.requiresConfig !== false) {
    return <ConfigLoader>{children}</ConfigLoader>;
  }

  return children;
}

function AppContent() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className='app'>
      <AuthWrapper>
        <MobileHeader isOpen={isMobileMenuOpen} onMenuToggle={() => setIsMobileMenuOpen(prev => !prev)} />
        <div className='appLayout'>
          <Menu isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
          {isMobileMenuOpen ? <div className='mobileMenuBackdrop' onClick={() => setIsMobileMenuOpen(false)} aria-hidden='true'></div> : null}
          <div className='mainContent'>
            <ScrollToTop />
            <ConditionalConfigLoader>
              <Routes>
                <Route path='/' element={<Navigate to='/dashboard' replace />} />
                <Route path='/index.html' element={<Navigate to='/dashboard' replace />} />
                {menuItems.map(item => (
                  <Route key={item.key} path={item.path} element={<item.component />} />
                ))}
              </Routes>
            </ConditionalConfigLoader>
          </div>
        </div>
      </AuthWrapper>
    </div>
  );
}

function App() {
  const basename = getBasename();
  return (
    <Provider store={store}>
      <BrowserRouter basename={basename}>
        <AppContent />
      </BrowserRouter>
    </Provider>
  );
}

export default App;
