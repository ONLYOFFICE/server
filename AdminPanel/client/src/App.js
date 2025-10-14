import {Provider} from 'react-redux';
import {Routes, Route, Navigate, BrowserRouter} from 'react-router-dom';
import './App.css';
import {store} from './store';
import AuthWrapper from './components/AuthWrapper/AuthWrapper';
import ConfigLoader from './components/ConfigLoader/ConfigLoader';
import Menu from './components/Menu/Menu';
import {menuItems} from './config/menuItems';

/**
 * Simple basename computation from URL path.
 * Basename is everything before the last path segment.
 * Examples:
 *  - '/statistics' -> basename ''
 *  - '/admin/' -> basename '/admin'
 *  - '/admin/statistics' -> basename '/admin'
 *  - '/admin/su/statistics' -> basename '/admin/su'
 * @returns {string} basename
 */
const getBasename = () => {
  const path = window.location.pathname || '/';
  if (path === '/') return '';
  // Treat '/prefix/' as a directory prefix
  if (path.endsWith('/')) return path.slice(0, -1);
  // Remove trailing slash (keep root '/') for consistent parsing
  const normalized = path;
  const lastSlash = normalized.lastIndexOf('/');
  // If no parent directory, there is no basename
  if (lastSlash <= 0) return '';
  return normalized.slice(0, lastSlash);
};

function App() {
  const basename = getBasename();
  return (
    <Provider store={store}>
      <BrowserRouter basename={basename}>
        <div className='app'>
          <AuthWrapper>
            <div className='appLayout'>
              <Menu />
              <div className='mainContent'>
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
      </BrowserRouter>
    </Provider>
  );
}

export default App;
