import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { StockAPI, WalletAPI, DrawingsAPI } from '../lib/api';
import { trainer } from '../lib/trainer';
import { wallet } from '../lib/wallet';
import { chart } from '../lib/chart';
import { ChartPanel } from '../components/ChartPanel';
import { TradePanel } from '../components/TradePanel';
import { DrawToolbar } from '../components/DrawToolbar';
import { WalletBar } from '../components/WalletBar';
import { ResultModal } from '../components/ResultModal';
import { EventModal } from '../components/EventModal';
import { ReviewBar } from '../components/ReviewBar';
import { Toast } from '../components/Toast';
import type { TrainingState, Drawing } from '../types';

export default function TrainPage() {
  const { user, wallet: ws, training, setTraining, showToast, finishTraining, syncWallet, logout } = useStore();
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [event, setEvent] = useState<{ type: string; stats: any; state: TrainingState } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [indicators, setIndicators] = useState({ ma: true, vol: true, macd: false, kdj: false, rsi: false, boll: false });
  const [finished, setFinished] = useState(false);

  const newSession = useCallback(async () => {
    setLoading(true);
    setShowResult(false);
    setShowEvent(false);
    setReviewMode(false);
    setReplayIdx(null);
    setFinished(false);
    chart.setReviewMode(false);
    try {
      const data = await StockAPI.random();
      if ((data as any).fromCache) {
        showToast('网络异常，已使用本地缓存行情（非最新）', 'error');
      }
      const s = trainer.startWithMarket(
        { bars: data.bars, code: data.code, symbol: data.name, startDate: data.bars[0]?.date || '', endDate: data.bars[data.bars.length - 1]?.date, isReal: data.isReal },
        { capital: wallet.balance, totalBars: 150, period: 'daily' }
      );
      setTraining(s);
      showToast(`新训练开始 · ${s.symbol}（${s.code}）· ${s.isReal ? '真实A股' : '模拟数据'}`, 'success');
    } catch (e: any) {
      showToast(e.response?.data?.error || '数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [setTraining, showToast]);

  // Chart drawing persistence callbacks
  useEffect(() => {
    chart.onSaveDrawings = async (key, drawings) => {
      try { await DrawingsAPI.save(key.split('_')[0], key.split('_')[1], drawings); } catch {}
    };
    chart.onLoadDrawings = (key) => {
      // Synchronous fallback from localStorage
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
    chart.setData(training.bars, training.trainStart, training.trainEnd);
    chart.setDrawingContext(`${training.code}_daily`);
    chart.setActiveTool('cursor');
    chart.setProgress(training.visibleCount);
    chart.setTradeMarkers(training.trades || [], training.position);
  }, [training]);

  // Load first training session
  useEffect(() => {
    newSession();
    // Resize handler
    const onResize = () => chart.setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (finished) return;
      if (e.key === 'b' || e.key === 'B') { doBuy(1); e.preventDefault(); }
      else if (e.key === 'm' || e.key === 'M') { doSell(1); e.preventDefault(); }
      else if (e.key === ' ') { doNext(); e.preventDefault(); }
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
    chart.setReviewMode(true);
    chart.setProgress(training.trainEnd);
    chart.setTradeMarkers(training.trades || [], null);
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

  const toggleIndicator = (key: keyof typeof indicators) => {
    const next = { ...indicators, [key]: !indicators[key] };
    setIndicators(next);
    chart.toggleMA(next.ma);
    chart.toggleVol(next.vol);
    chart.toggleMACD(next.macd);
    chart.toggleKDJ(next.kdj);
    chart.toggleRSI(next.rsi);
    chart.toggleBOLL(next.boll);
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
                  <div className="text-sm text-slate-400">正在随机选取全市场股票...</div>
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

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 flex items-center flex-wrap px-4 gap-2 sm:gap-4 py-1.5 min-h-12">
        <div className="font-bold text-slate-800">📈 K线练习助手</div>
        <WalletBar />
        <div className="flex-1" />
        <Link to="/history" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">训练记录</Link>
        <Link to="/profile" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">用户中心</Link>
        <div className="hidden sm:block text-sm text-slate-400">|</div>
        <span className="text-sm text-slate-600">{user?.username}</span>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-red-500">退出</button>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Chart area */}
        <div className="flex-1 flex flex-col p-2 min-h-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-1 px-1">
            <DrawToolbar />
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <button onClick={() => chart.zoomBy(0.87)} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">−</button>
              <button onClick={() => chart.zoomBy(1.15)} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">+</button>
              <button onClick={() => chart.resetView()} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">⟲</button>
            </div>
            <div className="flex items-center gap-1 ml-2">
              {(['ma', 'vol', 'macd', 'kdj', 'rsi', 'boll'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => toggleIndicator(k)}
                  className={`px-2 py-1 rounded text-xs font-medium transition ${indicators[k] ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                >{k.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {/* Chart canvas */}
          <ChartPanel ref={chartRef} />
          {/* Stock info */}
          {training && (
            <div className="mt-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg flex items-center gap-4 text-sm">
              <span className="font-bold text-slate-800">{training.symbol}</span>
              <span className="text-slate-400">{training.code}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${training.isReal ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-slate-400'}`}>{training.isReal ? '真实A股' : '模拟'}</span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">进度 {training.dailyProgress} / {training.dailyTotal}</span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">{training.trainStartDate} ~ {training.trainEndDate}</span>
            </div>
          )}
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
      <Toast />
    </div>
  );
}
