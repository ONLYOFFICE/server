import {Provider} from 'react-redux';
import {Routes, Route, Navigate, BrowserRouter} from 'react-router-dom';
import './App.css';
import {store} from './store';
import AuthWrapper from './components/AuthWrapper/AuthWrapper';
import ConfigLoader from './components/ConfigLoader/ConfigLoader';
import Menu from './components/Menu/Menu';
import {menuItems} from './config/menuItems';
import {getBasePath} from './utils/basePath';

function App() {
  const basePath = getBasePath();
  
  return (
    <Provider store={store}>
      <BrowserRouter basename={basePath}>
        <div className='app'>
          <AuthWrapper>
              <div className='appLayout'>
                <Menu />
                <div className='mainContent'>
                <ConfigLoader>
                  <Routes>
                    <Route path='/' element={<Navigate to='/statistics' replace />} />
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
