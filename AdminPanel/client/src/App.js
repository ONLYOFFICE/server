import {Provider} from 'react-redux';
import './App.css';
import {store} from './store';
import AuthWrapper from './components/AuthWrapper';
import Header from './components/Header';
import Home from './pages/Home';

function App() {
  return (
    <Provider store={store}>
      <div>
        <Header />
        <AuthWrapper>
          <div className='content'>
            <Home />
          </div>
        </AuthWrapper>
      </div>
    </Provider>
  );
}

export default App;
