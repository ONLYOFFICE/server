import {Provider} from 'react-redux';
import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import {store} from './store';
import AuthWrapper from './components2/AuthWrapper/AuthWrapper';
import Menu from './components2/Menu/Menu';
import { menuItems } from './config/menuItems';

function App() {
  return (
    <Provider store={store}>
      <div className="app">
        <AuthWrapper>
          <div className="appLayout">
            <Menu />
            <div className="mainContent">
              <Routes>
                <Route path="/" element={<Navigate to="/statistics" replace />} />
                {menuItems.map((item) => (
                  <Route 
                    key={item.key} 
                    path={item.path} 
                    element={<item.component />} 
                  />
                ))}
              </Routes>
            </div>
          </div>
        </AuthWrapper>
      </div>
    </Provider>
  );
}

export default App;
