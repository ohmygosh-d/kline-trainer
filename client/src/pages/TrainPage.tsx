import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { StockAPI, WalletAPI, DrawingsAPI } from '../lib/api';
import { trainer } from '../lib/trainer';
import { wallet } from '../lib/wallet';
import { chart } from '../lib/chart';
import { ChartPanel } from '../components/ChartPanel';
import { TradePanel } from '../components/TradePanel';
import { IndicatorSettings } from '../components/IndicatorSettings';
import { WalletBar } from '../components/WalletBar';
import { ResultModal } from '../components/ResultModal';
import { EventModal } from '../components/EventModal';
import { ReviewBar } from '../components/ReviewBar';
import { Toast } from '../components/Toast';
import type { TrainingState, Drawing, StockData } from '../types';
import { computeWindowDates } from '../lib/window';
import { fmtPrice, fmtPct, fmtVol } from '../lib/format';

/** 双盲模式下隐藏真实股票信息 */
const BLIND_SYMBOL = 'xxxx';
const BLIND_CODE = 'xxxx-xx';

/** 以日线全量历史推导「同一时间段」的训练窗口（日/周/月三档共用） */
function windowFromDaily(daily: StockData | null, fallback: StockData): { start: string; end: string } {
  if (daily && daily.bars && daily.bars.length >= 200) return computeWindowDates(daily.bars);
  return computeWindowDates(fallback.bars);
}

/** 顶部状态栏单个指标 */
function Stat({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-w-[64px] px-2 border-r border-slate-100 last:border-r-0">
      <span className={`text-sm font-semibold font-mono ${valueClass}`}>{value}</span>
      <span className="text-[10px] text-slate-400 mt-0.5">{label}</span>
    </div>
  );
}

export default function TrainPage() {
  const { user, wallet: ws, training, setTraining, showToast, finishTraining, syncWallet, logout } = useStore();
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [event, setEvent] = useState<{ type: string; stats: any; state: TrainingState } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const INIT_PERIOD = (() => {
    const p = new URLSearchParams(location.search).get('period');
    return p === 'weekly' || p === 'monthly' ? p : 'daily';
  })();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>(INIT_PERIOD);

  // 自动播放
  useEffect(() => {
    if (!playing || !training || finished) {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
      return;
    }
    const ms = speed <= 0.5 ? 1000 : speed === 1 ? 500 : speed === 2 ? 250 : speed === 3 ? 150 : 100;
    playRef.current = setInterval(() => {
      const s = trainer.next();
      if (s) {
        chart.setProgress(s.visibleCount);
        chart.setTradeMarkers(s.trades, s.position);
        setTraining(s);
      }
    }, ms);
    return () => {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
    };
  }, [playing, training, finished, speed, setTraining]);

  const togglePlay = () => setPlaying(p => !p);

  // 开局：p=周期；code=指定股票（同股票换周期）。无 code 时为「新一局」（随机选股，仅训练结束后触发）
  const startNew = useCallback(async (p: 'daily' | 'weekly' | 'monthly', code?: string) => {
    setLoading(true);
    setShowResult(false);
    setShowEvent(false);
    setReviewMode(false);
    setReplayIdx(null);
    setFinished(false);
    setPlaying(false);
    chart.setReviewMode(false);
    startTimeRef.current = Date.now();
    try {
      if (code) {
        const data = await StockAPI.byCode(code, p);
        if ((data as any).fromCache) showToast('网络异常，已使用本地缓存行情（非最新）', 'error');
        const s = trainer.applyPeriod(data.bars, p);
        if (!s) showToast('周期切换失败，已停留在原行情，可稍后重试', 'error');
        else {
          setPeriod(p);
          setTraining(s);
          showToast(`切换至${p === 'weekly' ? '周线' : p === 'monthly' ? '月线' : '日线'}（同一时间段）`, 'success');
        }
      } else {
        const data = await StockAPI.random(p);
        if ((data as any).fromCache) showToast('网络异常，已使用本地缓存行情（非最新）', 'error');
        let daily: StockData | null = null;
        try { daily = await StockAPI.byCodeDaily(data.code); } catch { /* 用展示周期兜底 */ }
        const windowDates = windowFromDaily(daily, data);
        const capital = useStore.getState().wallet?.balance ?? wallet.balance;
        const s = trainer.startWithMarket(
          { bars: data.bars, code: data.code, symbol: data.name, startDate: data.bars[0]?.date || '', endDate: data.bars[data.bars.length - 1]?.date, isReal: data.isReal },
          { capital, period: p },
          windowDates
        );
        setPeriod(p);
        setTraining(s);
        showToast('双盲训练开始 · 隐藏股票名称与日期', 'success');
      }
    } catch (e: any) {
      if (code) showToast('该股票此周期数据获取失败，已停留在原行情，可稍后重试', 'error');
      else showToast(e?.response?.data?.error || '数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [period, setTraining, showToast]);

  const newSession = useCallback(() => { startNew(period); }, [period, startNew]);

  const switchPeriod = (p: 'daily' | 'weekly' | 'monthly') => {
    if (!training || finished) return;
    if (p === training.period) return;
    startNew(p, training.code);
  };

  // Chart drawing persistence callbacks
  useEffect(() => {
    chart.onSaveDrawings = async (key, drawings) => {
      try { await DrawingsAPI.save(key.split('_')[0], key.split('_')[1], drawings); } catch {}
    };
    chart.onLoadDrawings = (key) => {
      const local = localStorage.getItem(`kt_draw_${key}`);
      return local ? JSON.parse(local) : [];
    };
  }, []);

  // Init chart when ref ready
  useEffect(() => {
    if (chartRef.current) {
      chart.init(chartRef.current);
      chart.setupCanvas();
    }
  }, []);

  // Update chart whenever training data changes
  useEffect(() => {
    if (!training || !chartRef.current) return;
    chart.init(chartRef.current);
    chart.setData(training.bars, training.trainStart, training.trainEnd, training.period);
    chart.setDrawingContext(`${training.code}_${training.period}`);
    chart.setActiveTool('cursor');
    chart.setProgress(training.visibleCount);
    chart.setTradeMarkers(training.trades || [], training.position);
  }, [training]);

  // Load first training session
  useEffect(() => {
    newSession();
    const onResize = () => chart.setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.altKey && e.key === 'Enter') { e.preventDefault(); doFinish(); return; }
      if (finished) return;
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); doBuy(2); }
      else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); doSell(2); }
      else if (e.key === ' ' || e.key === 'h' || e.key === 'H') { e.preventDefault(); doNext(); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Escape') {
        if (chart.getActiveTool() !== 'cursor') chart.setActiveTool('cursor');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [training, finished]);

  const doBuy = (type: 1 | 2) => {
    if (!training || finished) return;
    const balance = wallet.balance;
    const price = training.bars[training.visibleCount - 1]?.close || 0;
    const qty = type === 1 ? Math.floor(balance * 0.5 / price / 100) * 100 : Math.floor(balance / price / 100) * 100;
    if (qty <= 0) { showToast('资金不足', 'error'); return; }
    const s = trainer.buy(qty);
    if (s) {
      chart.flashTrade(training.visibleCount - 1, 'buy', price, qty);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doSell = (type: 1 | 2) => {
    if (!training || !training.position || finished) return;
    const qty = type === 1 ? Math.floor(training.position.shares / 2 / 100) * 100 : training.position.shares;
    if (qty <= 0) { showToast('持仓不足', 'error'); return; }
    const price = training.bars[training.visibleCount - 1]?.close || 0;
    const s = trainer.sell(qty);
    if (s) {
      chart.flashTrade(training.visibleCount - 1, 'sell', price, qty);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doNext = () => {
    if (!training || finished) return;
    const s = trainer.next();
    if (s) {
      chart.setProgress(s.visibleCount);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doFinish = () => {
    if (!training || finished) return;
    trainer.finish();
  };

  // On finish callback
  useEffect(() => {
    trainer.onFinish(async (s) => {
      setFinished(true);
      setPlaying(false);
      const stats = trainer.getStats();
      if (!stats) return;
      const event = await finishTraining(stats, s);
      chart.setTradeMarkers(s.trades, null);
      setTraining(s);
      if (event === 'bankrupt' || event === 'fortune') {
        setEvent({ type: event, stats, state: s });
        setShowEvent(true);
      } else {
        setShowResult(true);
      }
    });
  }, []);

  const enterReview = () => {
    if (!training) return;
    setShowResult(false);
    setShowEvent(false);
    setReviewMode(true);
    setReplayIdx(null);
    setPlaying(false);
    chart.setReviewMode(true);
    chart.setTradeMarkers(training.trades || [], null);
    const tail = Math.max(0, training.bars.length - training.trainEnd);
    const today = training.bars[training.bars.length - 1]?.date || '';
    showToast(`已加载训练结束后的最新走势（${tail} 根K线，至 ${today}）`, 'success');
  };

  const startReplay = () => {
    if (!training) return;
    setReplayIdx(training.trainStart);
    chart.setProgress(training.trainStart);
    chart.setTradeMarkers(training.trades.filter(t => t.index <= training!.trainStart), null);
  };

  const stepReplay = (delta: number) => {
    if (!training) return;
    setReplayIdx(prev => {
      const base = prev ?? training.trainEnd;
      const ni = Math.max(training.trainStart, Math.min(training.trainEnd, base + delta));
      chart.setProgress(ni);
      chart.setTradeMarkers(training.trades.filter(t => t.index <= ni), null);
      return ni;
    });
  };

  if (loading && !training) {
    return (
      <div className="h-screen flex flex-col bg-slate-50">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
          <div className="font-bold text-slate-800">📈 K线练习助手</div>
          <div className="flex-1" />
          <div className="w-16 h-4 bg-slate-100 rounded animate-pulse" />
        </header>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col p-2">
            <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-hidden relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-3" />
                  <div className="text-sm text-slate-400">正在随机选取双盲训练股票...</div>
                </div>
              </div>
            </div>
          </div>
          <aside className="w-72 bg-white border-l border-slate-200 p-3 space-y-3">
            <div className="h-16 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-20 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-12 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          </aside>
        </div>
      </div>
    );
  }

  const bar = training?.bars[training.visibleCount - 1];
  const prevBar = training && training.visibleCount > 1 ? training.bars[training.visibleCount - 2] : null;
  const price = bar?.close ?? 0;
  const prevClose = prevBar?.close ?? price;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  const trendClass = change > 0 ? 'text-red-500' : change < 0 ? 'text-green-500' : 'text-slate-500';

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 flex items-center px-4 gap-3 h-12 shrink-0">
        <div className="font-bold text-slate-800">📈 K线练习助手</div>
        <WalletBar />
        <div className="flex-1" />
        <Link to="/history" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">训练记录</Link>
        <Link to="/profile" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">用户中心</Link>
        <div className="hidden sm:block text-sm text-slate-300">|</div>
        <span className="text-sm text-slate-600">{user?.username}</span>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-red-500">退出</button>
      </header>

      {/* Status bar */}
      {training && bar && (
        <div className="bg-white border-b border-slate-200 px-3 h-14 shrink-0 flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-100 shrink-0">
            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs font-semibold">进行中</span>
            <span className="text-sm font-bold text-slate-700">{BLIND_SYMBOL}</span>
            <span className="text-xs text-slate-400">{BLIND_CODE}</span>
          </div>
          <Stat label="现价" value={fmtPrice(price)} valueClass={trendClass} />
          <Stat label="涨跌" value={`${change >= 0 ? '+' : ''}${fmtPrice(change)}`} valueClass={trendClass} />
          <Stat label="涨跌幅" value={fmtPct(changePct)} valueClass={trendClass} />
          <Stat label="开盘" value={fmtPrice(bar.open)} />
          <Stat label="最高" value={fmtPrice(bar.high)} />
          <Stat label="最低" value={fmtPrice(bar.low)} />
          <Stat label="量比" value="--" />
          <Stat label="换手" value="--" />
          <div className="flex flex-col items-center justify-center min-w-[80px] px-2">
            <span className="text-sm font-mono text-slate-700">xxxx-xx-xx</span>
            <span className="text-[10px] text-slate-400 mt-0.5">日期</span>
          </div>
          <div className="flex-1" />
          {/* 周期切换 */}
          <div className="flex items-center gap-1 shrink-0 pl-2">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => switchPeriod(p)}
                disabled={finished}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              >
                {p === 'daily' ? '日线' : p === 'weekly' ? '周线' : '月线'}
              </button>
            ))}
            <button
              onClick={() => setShowSettings(true)}
              title="K线设置"
              className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 hover:bg-slate-100 transition"
            >
              设置
            </button>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_340px] min-h-0 overflow-hidden">
        {/* Chart area */}
        <div className="flex flex-col p-2 min-h-0 overflow-hidden">
          {/* Chart canvas */}
          <ChartPanel ref={chartRef} />
        </div>
        {/* Trade panel */}
        <TradePanel
          training={training}
          finished={finished}
          onBuy={doBuy}
          onSell={doSell}
          onNext={doNext}
          onFinish={doFinish}
          onNewSession={newSession}
          speed={speed}
          setSpeed={setSpeed}
          playing={playing}
          togglePlay={togglePlay}
        />
      </div>
      {/* Review bar */}
      {reviewMode && training && (
        <ReviewBar
          training={training}
          replayIdx={replayIdx}
          onStep={stepReplay}
          onReplay={startReplay}
          onNextSession={newSession}
        />
      )}
      {/* Modals */}
      {showResult && training && (
        <ResultModal
          training={training}
          stats={trainer.getStats()!}
          walletBalance={wallet.balance}
          bankruptCount={wallet.bankruptCount}
          fortuneCount={wallet.fortuneCount}
          onReview={enterReview}
          onNext={newSession}
          onClose={() => setShowResult(false)}
        />
      )}
      {showEvent && event && (
        <EventModal
          type={event.type}
          stats={event.stats}
          walletBalance={wallet.balance}
          bankruptCount={wallet.bankruptCount}
          fortuneCount={wallet.fortuneCount}
          onReview={enterReview}
          onNext={newSession}
          onClose={() => setShowEvent(false)}
        />
      )}
      {showSettings && (
        <IndicatorSettings
          options={chart.getOptions()}
          onChange={opts => chart.setOptions(opts)}
          onClose={() => setShowSettings(false)}
        />
      )}
      <Toast />
    </div>
  );
}
