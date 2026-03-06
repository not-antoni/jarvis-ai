import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Logs from './pages/Logs';
import Overview from './pages/Overview';
import Providers from './pages/Providers';
import Settings from './pages/Settings';

function App() {
  return (
    <BrowserRouter basename="/dashboard">
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="providers" element={<Providers />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
