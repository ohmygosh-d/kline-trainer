import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/store';
import { ErrorBoundary } from './components/ErrorBoundary';
import AuthPage from './pages/AuthPage';
import TrainPage from './pages/TrainPage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  const init = useStore(s => s.init);
  const user = useStore(s => s.user);
  const showToast = useStore(s => s.showToast);

  useEffect(() => { init(); }, []);

  // 全局异常捕获
  useEffect(() => {
    let notified = false;
    const notify = (msg: string) => {
      if (notified) return;
      notified = true;
      showToast(msg, 'error');
      setTimeout(() => { notified = false; }, 5000);
    };
    const onErr = (e: ErrorEvent) => { console.error('[window error]', e.error || e.message); notify('页面发生错误，已记录'); };
    const onReject = (e: PromiseRejectionEvent) => { console.error('[unhandledrejection]', e.reason); };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onReject);
    };
  }, [showToast]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/train" /> : <AuthPage />} />
          <Route path="/train" element={user ? <TrainPage /> : <Navigate to="/login" />} />
          <Route path="/history" element={user ? <HistoryPage /> : <Navigate to="/login" />} />
          <Route path="/profile" element={user ? <ProfilePage /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to={user ? "/train" : "/login"} />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
