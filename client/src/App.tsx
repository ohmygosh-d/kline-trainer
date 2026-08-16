import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/store';
import AuthPage from './pages/AuthPage';
import TrainPage from './pages/TrainPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  const init = useStore(s => s.init);
  const user = useStore(s => s.user);

  useEffect(() => { init(); }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/train" /> : <AuthPage />} />
        <Route path="/train" element={user ? <TrainPage /> : <Navigate to="/login" />} />
        <Route path="/history" element={user ? <HistoryPage /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={user ? "/train" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
}
