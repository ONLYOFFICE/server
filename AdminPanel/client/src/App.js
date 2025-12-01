import {Provider} from 'react-redux';
import {useState} from 'react';
import {Routes, Route, Navigate, BrowserRouter} from 'react-router-dom';
import './App.css';
import {store} from './store';
import AuthWrapper from './components/AuthWrapper/AuthWrapper';
import ConfigLoader from './components/ConfigLoader/ConfigLoader';
import {useSchemaLoader} from './hooks/useSchemaLoader';
import Menu from './components/Menu/Menu';
import MobileHeader from './components/MobileHeader/MobileHeader';
import ScrollToTop from './components/ScrollToTop/ScrollToTop';
import {menuItems} from './config/menuItems';
import {getBasename} from './utils/paths';

function AppContent() {
  useSchemaLoader();
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
            <ConfigLoader>
              <Routes>
                <Route path='/' element={<Navigate to='/statistics' replace />} />
                <Route path='/index.html' element={<Navigate to='/statistics' replace />} />
                {menuItems.map(item => (
                  <Route key={item.key} path={item.path} element={<item.component />} />
                ))}
              </Routes>
            </ConfigLoader>
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
