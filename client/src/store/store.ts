import { create } from 'zustand';
import type { UserInfo, WalletState, TrainingState } from '../types';
import { AuthAPI, WalletAPI } from '../lib/api';
import { wallet } from '../lib/wallet';
import { trainer } from '../lib/trainer';

interface AppState {
  user: UserInfo | null;
  wallet: WalletState | null;
  training: TrainingState | null;
  loading: boolean;
  toast: { msg: string; type: string } | null;

  init: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => void;
  syncWallet: () => Promise<void>;
  setTraining: (s: TrainingState | null) => void;
  showToast: (msg: string, type?: string) => void;
  finishTraining: (stats: any, state: TrainingState) => Promise<'bankrupt' | 'fortune' | null>;
}

// 同步预取登录态：直接访问 /profile 等受保护路由时，
// 避免首帧 user 为 null 触发「/profile → /login → /train」的错误跳转链路。
// init() 仍会在后台用 /auth/me 校验 token，失效则自动登出。
const bootUser = AuthAPI.isLoggedIn() ? AuthAPI.getUser() : null;
const bootWallet = AuthAPI.isLoggedIn() ? WalletAPI.getWalletCache() : null;
// 同时把缓存的钱包同步进 wallet 单例，避免 TrainPage 启动新局时读到默认 10w
if (bootWallet) wallet.load(bootWallet);

export const useStore = create<AppState>((set, get) => ({
  user: bootUser,
  wallet: bootWallet,
  training: null,
  loading: false,
  toast: null,

  init: async () => {
    if (AuthAPI.isLoggedIn()) {
      try {
        const user = await AuthAPI.me();
        set({ user });
        const ws = await WalletAPI.get();
        wallet.load(ws);
        set({ wallet: ws });
      } catch {
        AuthAPI.logout();
      }
    }
  },

  login: async (username, password) => {
    const user = await AuthAPI.login(username, password);
    set({ user });
    const ws = await WalletAPI.get();
    wallet.load(ws);
    set({ wallet: ws });
  },

  register: async (username, password) => {
    const user = await AuthAPI.register(username, password);
    set({ user });
    const ws = await WalletAPI.get();
    wallet.load(ws);
    set({ wallet: ws });
  },

  logout: () => {
    AuthAPI.logout();
    set({ user: null, wallet: null, training: null });
  },

  syncWallet: async () => {
    const ws = await WalletAPI.get();
    wallet.load(ws);
    set({ wallet: ws });
  },

  setTraining: (s) => set({ training: s }),

  showToast: (msg, type = 'info') => {
    set({ toast: { msg, type } });
    setTimeout(() => set({ toast: null }), 2500);
  },

  finishTraining: async (stats, state) => {
    // Save session to server
    await WalletAPI.saveSession({
      stock_code: state.code,
      stock_name: state.symbol,
      period: state.period,
      total_pnl: stats.totalPnl,
      total_pnl_pct: stats.totalPnlPct,
      stock_return_pct: stats.stockReturnPct,
      beat_market: stats.beatMarket,
      total_trades: stats.totalTrades,
      win_rate: stats.winRate,
      is_real: state.isReal,
      stats_json: JSON.stringify(stats),
    });

    // Settle wallet
    const event = wallet.settle(stats.finalEquity);
    await WalletAPI.update(wallet.toJSON());
    const ws = await WalletAPI.get();
    wallet.load(ws);
    set({ wallet: ws });
    return event;
  },
}));
