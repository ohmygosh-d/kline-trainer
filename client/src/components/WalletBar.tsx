import { useStore } from '../store/store';
import { wallet } from '../lib/wallet';
import { fmtMoneyFull } from '../lib/format';
import type { TrainingState } from '../types';

export function WalletBar() {
  const { wallet: ws } = useStore();
  if (!ws) return null;
  const status = wallet.getStatus();
  const statusText = status === 'active' ? '进行中' : status === 'bankrupt' ? '濒临破产' : '即将暴富';
  const statusColor = status === 'bankrupt' ? 'text-red-500' : status === 'fortune' ? 'text-amber-500' : 'text-slate-400';

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">资金</span>
        <span className="font-bold text-slate-800 tabular-nums">{fmtMoneyFull(wallet.balance)}</span>
        <span className={`text-xs ${statusColor}`}>· {statusText}</span>
      </div>
      <div className="text-slate-300">|</div>
      <div className="text-xs text-slate-400">破产 {wallet.bankruptCount} · 暴富 {wallet.fortuneCount} · 总训练 {wallet.totalSessions}</div>
    </div>
  );
}
