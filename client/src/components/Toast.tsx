import { useStore } from '../store/store';

export function Toast() {
  const toast = useStore(s => s.toast);
  if (!toast) return null;
  const bgColor = toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-slate-700';
  return (
    <div
      className={`fixed top-16 left-1/2 -translate-x-1/2 ${bgColor} text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 animate-fadeIn`}
      style={{ animation: 'toastIn 0.2s ease' }}
    >
      {toast.msg}
    </div>
  );
}
