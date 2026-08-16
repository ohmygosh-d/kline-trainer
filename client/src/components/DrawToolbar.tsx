import { useState } from 'react';
import { chart } from '../lib/chart';

const TOOLS = [
  { id: 'cursor', label: '🖱', title: '光标（拖拽平移）' },
  { id: 'trend', label: '╱', title: '趋势线' },
  { id: 'h', label: '─', title: '水平线' },
  { id: 'ray', label: '→', title: '射线' },
  { id: 'channel', label: '∺', title: '平行通道' },
  { id: 'fib', label: 'Fib', title: '斐波那契' },
];

export function DrawToolbar() {
  const [active, setActive] = useState('cursor');

  const select = (tool: string) => {
    setActive(tool);
    chart.setActiveTool(tool);
  };

  const clearAll = () => {
    chart.clearDrawings();
    setActive('cursor');
    chart.setActiveTool('cursor');
  };

  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
      {TOOLS.map(t => (
        <button
          key={t.id}
          onClick={() => select(t.id)}
          title={t.title}
          className={`w-8 h-8 flex items-center justify-center rounded text-sm transition ${
            active === t.id
              ? 'bg-brand-500 text-white shadow'
              : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
          }`}
        >
          {t.label}
        </button>
      ))}
      <div className="w-px h-5 bg-slate-200 mx-1" />
      <button
        onClick={clearAll}
        title="清空划线"
        className="w-8 h-8 flex items-center justify-center rounded text-sm text-slate-400 hover:bg-red-50 hover:text-red-500 transition"
      >
        🗑
      </button>
    </div>
  );
}
