/** API 客户端 — 与后端通信 */
import axios from 'axios';
import type { StockData, WalletState, SessionRecord, Drawing, UserInfo, UserStats } from '../types';

const api = axios.create({ baseURL: '/api' });

// 自动携带 Token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('kline_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 统一错误处理
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('kline_token');
      localStorage.removeItem('kline_user');
      if (location.pathname !== '/login') {
        location.href = '/login';
      }
    }
    throw err;
  }
);

export const AuthAPI = {
  register: async (username: string, password: string) => {
    const { data } = await api.post('/auth/register', { username, password });
    localStorage.setItem('kline_token', data.token);
    localStorage.setItem('kline_user', JSON.stringify(data.user));
    return data.user as UserInfo;
  },
  login: async (username: string, password: string) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('kline_token', data.token);
    localStorage.setItem('kline_user', JSON.stringify(data.user));
    return data.user as UserInfo;
  },
  me: async () => {
    const { data } = await api.get('/auth/me');
    return data.user as UserInfo;
  },
  logout: () => {
    localStorage.removeItem('kline_token');
    localStorage.removeItem('kline_user');
  },
  isLoggedIn: () => !!localStorage.getItem('kline_token'),
  getUser: (): UserInfo | null => {
    const raw = localStorage.getItem('kline_user');
    return raw ? JSON.parse(raw) : null;
  },
  changePassword: async (oldPassword: string, newPassword: string) => {
    const { data } = await api.put('/auth/password', { oldPassword, newPassword });
    return data as { ok: boolean };
  },
  getStats: async (): Promise<UserStats> => {
    const { data } = await api.get('/auth/stats');
    return data as UserStats;
  },
  deleteAccount: async () => {
    const { data } = await api.delete('/auth/account');
    return data as { ok: boolean };
  },
};

// 股票数据前端缓存 + 失败重试降级（按 code+周期 分别缓存，避免不同股票互相覆盖）
const STOCK_CACHE_KEY = 'kt_stock_cache';
const stockCache: Record<string, StockData> = {};
try {
  const cached = localStorage.getItem(STOCK_CACHE_KEY);
  if (cached) Object.assign(stockCache, JSON.parse(cached));
} catch { /* ignore */ }

async function fetchStock(url: string, cacheKey: string): Promise<StockData> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await api.get(url);
      stockCache[cacheKey] = data;
      try { localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(stockCache)); } catch { /* ignore */ }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  if (stockCache[cacheKey]) return { ...stockCache[cacheKey], fromCache: true };
  throw lastErr;
}

export const StockAPI = {
  random: (period = 'daily'): Promise<StockData> => fetchStock(`/stock/random?period=${period}`, `random_${period}`),
  // 取日线（用于推导「同一时间段」的训练窗口，按 code 单独缓存）
  byCodeDaily: (code: string): Promise<StockData> => fetchStock(`/stock/bycode?code=${encodeURIComponent(code)}&period=daily`, `bycode_${code}_daily`),
  byCode: (code: string, period = 'daily'): Promise<StockData> => fetchStock(`/stock/bycode?code=${encodeURIComponent(code)}&period=${period}`, `bycode_${code}_${period}`),
};

const WALLET_CACHE_KEY = 'kt_wallet_cache';

export const WalletAPI = {
  get: async (): Promise<WalletState> => {
    const { data } = await api.get('/wallet');
    try { localStorage.setItem(WALLET_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    return data;
  },
  getWalletCache: (): WalletState | null => {
    try {
      const raw = localStorage.getItem(WALLET_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  update: async (state: Partial<WalletState>) => {
    const { data } = await api.put('/wallet', state);
    return data;
  },
  history: async (): Promise<SessionRecord[]> => {
    const { data } = await api.get('/wallet/history');
    return data.sessions;
  },
  saveSession: async (session: any) => {
    const { data } = await api.post('/wallet', session);
    return data;
  },
};

export const DrawingsAPI = {
  get: async (stockCode: string, period: string): Promise<Drawing[]> => {
    const { data } = await api.get(`/drawings/${stockCode}/${period}`);
    return data.drawings;
  },
  save: async (stockCode: string, period: string, drawings: Drawing[]) => {
    const { data } = await api.put(`/drawings/${stockCode}/${period}`, { drawings });
    return data;
  },
  clear: async (stockCode: string, period: string) => {
    const { data } = await api.delete(`/drawings/${stockCode}/${period}`);
    return data;
  },
};
