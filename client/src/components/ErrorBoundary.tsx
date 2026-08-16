import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 text-center">
            <div className="text-3xl mb-2">⚠️</div>
            <h2 className="font-bold text-slate-800 mb-2">页面出错了</h2>
            <p className="text-sm text-slate-500 mb-4 break-words">{this.state.error.message || '发生未知错误'}</p>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition"
            >刷新页面</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
