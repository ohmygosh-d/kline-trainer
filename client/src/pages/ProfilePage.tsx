import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { AuthAPI } from '../lib/api';
import { fmtMoneyFull, fmtPct, cls } from '../lib/format';

export default function ProfilePage() {
  const { user, wallet, logout, showToast } = useStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await AuthAPI.getStats();
        setStats(s);
      } catch {
        showToast('加载统计失败', 'error');
      } finally {
        setLoadingStats(false);
      }
    })();
  }, []);

  const submitPwd = async () => {
    if (!oldPwd || !newPwd) { showToast('请填写完整', 'error'); return; }
    if (newPwd.length < 6) { showToast('新密码至少 6 位', 'error'); return; }
    if (newPwd !== newPwd2) { showToast('两次输入不一致', 'error'); return; }
    setPwdBusy(true);
    try {
      await AuthAPI.changePassword(oldPwd, newPwd);
      showToast('密码修改成功', 'success');
      setOldPwd(''); setNewPwd(''); setNewPwd2('');
    } catch (e: any) {
      showToast(e.response?.data?.error || '修改失败', 'error');
    } finally {
      setPwdBusy(false);
    }
  };

  const doDelete = () => {
    if (!confirm('确定注销账号？所有训练记录、钱包、划线数据将永久删除，且无法恢复！')) return;
    if (!confirm('再次确认：注销后账号不可恢复。')) return;
    (async () => {
      try {
        await AuthAPI.deleteAccount();
        showToast('账号已注销', 'success');
        logout();
        navigate('/login');
      } catch (e: any) {
        showToast(e.response?.data?.error || '注销失败', 'error');
      }
    })();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
        <div className="font-bold text-slate-800">📈 K线练习助手</div>
        <div className="flex-1" />
        <Link to="/train" className="text-sm text-slate-500 hover:text-brand-500">训练</Link>
        <Link to="/history" className="text-sm text-slate-500 hover:text-brand-500">训练记录</Link>
        <span className="text-sm text-slate-400">|</span>
        <span className="text-sm text-slate-600">{user?.username}</span>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-red-500">退出</button>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* 账号信息 */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">账号信息</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Info label="用户名" val={user?.username || '—'} />
            <Info label="用户ID" val={String(user?.id ?? '—')} />
            <Info label="注册时间" val={(user as any)?.created_at?.slice(0, 10) || '—'} />
            <Info label="当前资金" val={wallet ? fmtMoneyFull(wallet.balance) : '—'} />
            <Info label="破产次数" val={String(wallet?.bankrupt_count ?? 0)} c="down" />
            <Info label="暴富次数" val={String(wallet?.fortune_count ?? 0)} c="up" />
          </div>
        </section>

        {/* 训练统计 */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">训练统计总览</h2>
          {loadingStats ? (
            <div className="text-sm text-slate-400">加载中...</div>
          ) : stats && stats.total_sessions > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="总场次" val={String(stats.total_sessions)} />
                <Stat label="胜率" val={`${stats.win_rate.toFixed(1)}%`} />
                <Stat label="平均盈亏" val={fmtPct(stats.avg_pnl_pct)} c={cls(stats.avg_pnl_pct)} />
                <Stat label="累计盈亏" val={fmtMoneyFull(stats.total_pnl)} c={cls(stats.total_pnl)} />
                <Stat label="真实行情" val={`${stats.real_count}/${stats.total_sessions}`} />
                <Stat label="破产" val={String(stats.bankrupt)} c="down" />
                <Stat label="暴富" val={String(stats.fortune)} c="up" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {stats.best && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">最佳一战</div>
                    <div className="font-semibold text-red-500">{stats.best.name}（{stats.best.code}） {fmtPct(stats.best.pct)}</div>
                  </div>
                )}
                {stats.worst && (
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">最差一战</div>
                    <div className="font-semibold text-green-500">{stats.worst.name}（{stats.worst.code}） {fmtPct(stats.worst.pct)}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">还没有训练记录，去训练页开始第一局吧！</div>
          )}
        </section>

        {/* 修改密码 */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">修改密码</h2>
          <div className="space-y-2 max-w-sm">
            <input type="password" placeholder="原密码" value={oldPwd} onChange={e => setOldPwd(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <input type="password" placeholder="新密码（至少6位）" value={newPwd} onChange={e => setNewPwd(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <input type="password" placeholder="确认新密码" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <button onClick={submitPwd} disabled={pwdBusy} className="w-full py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition">{pwdBusy ? '提交中...' : '修改密码'}</button>
          </div>
        </section>

        {/* 注销账号 */}
        <section className="bg-white rounded-xl border border-red-200 p-5">
          <h2 className="font-bold text-red-500 mb-2">危险区域</h2>
          <p className="text-xs text-slate-400 mb-3">注销后将永久删除你的账号、训练记录、钱包与划线数据，且无法恢复。</p>
          <button onClick={doDelete} className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition">注销账号</button>
        </section>
      </div>
    </div>
  );
}

function Info({ label, val, c }: { label: string; val: string; c?: string }) {
  const color = c === 'up' ? 'text-red-500' : c === 'down' ? 'text-green-500' : 'text-slate-800';
  return (
    <div>
      <div className="text-slate-400 text-xs mb-0.5">{label}</div>
      <div className={`font-semibold ${color}`}>{val}</div>
    </div>
  );
}

function Stat({ label, val, c }: { label: string; val: string; c?: string }) {
  const color = c === 'up' ? 'text-red-500' : c === 'down' ? 'text-green-500' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`font-bold text-lg ${color}`}>{val}</div>
    </div>
  );
}
