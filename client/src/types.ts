/** K线数据条 */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 股票数据 */
export interface StockData {
  code: string;
  name: string;
  bars: Bar[];
  isReal: boolean;
  fromCache?: boolean;
}

/** 训练状态 */
export interface TrainingState {
  bars: Bar[];
  trainStart: number;
  trainEnd: number;
  visibleCount: number;
  position: Position | null;
  trades: Trade[];
  finished: boolean;
  code: string;
  symbol: string;
  period: string;
  isReal: boolean;
  dailyProgress: number;
  dailyTotal: number;
  startDate: string;
  trainStartDate: string;
  trainEndDate: string;
  pnl: number;
  equity: number;
  _autoSold?: boolean;
}

/** 持仓 */
export interface Position {
  entryPrice: number;
  entryIndex: number;
  entryDate: string;
  qty: number;
  shares: number;
  capital: number;
  type: 'full' | 'half';
}

/** 交易记录 */
export interface Trade {
  action: 'buy' | 'sell';
  price: number;
  qty: number;
  index: number;
  date: string;
  pnl?: number;
  pnlPct?: number;
  type?: string;
}

/** 钱包状态 */
export interface WalletState {
  balance: number;
  bankrupt_count: number;
  fortune_count: number;
  total_sessions: number;
}

/** 训练统计 */
export interface TrainingStats {
  totalPnl: number;
  totalPnlPct: number;
  stockReturnPct: number;
  beatMarket: number;
  totalTrades: number;
  winRate: number;
  pnlRatio: number;
  finalEquity: number;
  equityCurve: { index: number; equity: number }[];
}

/** 划线对象 */
export interface Drawing {
  tool: string;
  p1: { bi: number; price: number };
  p2: { bi: number; price: number };
  color?: string;
}

/** 用户信息 */
export interface UserInfo {
  id: number;
  username: string;
}

/** 训练历史记录 */
export interface SessionRecord {
  id: number;
  stock_code: string;
  stock_name: string;
  period: string;
  total_pnl: number;
  total_pnl_pct: number;
  stock_return_pct: number;
  beat_market: number;
  total_trades: number;
  win_rate: number;
  is_real: number;
  created_at: string;
}

/** 用户统计总览 */
export interface UserStats {
  total_sessions: number;
  avg_pnl_pct: number;
  win_sessions: number;
  win_rate: number;
  total_pnl: number;
  bankrupt: number;
  fortune: number;
  best: { code: string; name: string; pct: number } | null;
  worst: { code: string; name: string; pct: number } | null;
  real_count: number;
}
