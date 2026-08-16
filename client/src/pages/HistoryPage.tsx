import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WalletAPI } from '../lib/api';
import { useStore } from '../store/store';
import type { SessionRecord } from '../types';
import { fmtPct, fmtMoney } from '../lib/format';

export default function HistoryPage() {
  const { user, logout } = useStore();
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    WalletAPI.history().then(r => { setRecords(r); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
        <Link to="/train" className="font-bold text-slate-800">← K线练习助手</Link>
        <div className="flex-1" />
        <span className="text-sm text-slate-600">{user?.username}</span>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-red-500">退出</button>
      </header>
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">训练记录</h2>
        {loading ? (
          <div className="text-sm text-slate-400 text-center py-12">加载中...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">📋</div>
            <div className="text-sm">还没有训练记录，去开始第一局吧！</div>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map(r => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-800">{r.stock_name}</span>
                    <span className="text-xs text-slate-400">{r.stock_code}</span>
                    <span className="text-xs text-slate-400">{r.period === 'daily' ? '日线' : r.period === 'weekly' ? '周线' : '月线'}</span>
                    {r.is_real ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-500 rounded">真实</span> : <span className="text-xs px-1.5 py-0.5 bg-slate-50 text-slate-400 rounded">模拟</span>}
                  </div>
                  <div className="text-xs text-slate-400">{r.created_at}</div>
                </div>
                <div className="text-right">
                  <div className={`font-bold ${r.total_pnl >= 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtPct(r.total_pnl_pct)}</div>
                  <div className="text-xs text-slate-400">{r.total_trades} 笔 · 胜率 {r.win_rate.toFixed(0)}%</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm ${r.beat_market >= 0 ? 'text-red-500' : 'text-green-500'}`}>{r.beat_market >= 0 ? '跑赢' : '跑输'} {fmtPct(Math.abs(r.beat_market))}</div>
                  <div className="text-xs text-slate-400">股票 {fmtPct(r.stock_return_pct)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
