/** API 客户端 — 与后端通信 */
import axios from 'axios';
import type { StockData, WalletState, SessionRecord, Drawing, UserInfo } from '../types';

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
};

export const StockAPI = {
  random: async (): Promise<StockData> => {
    const { data } = await api.get('/stock/random');
    return data;
  },
};

export const WalletAPI = {
  get: async (): Promise<WalletState> => {
    const { data } = await api.get('/wallet');
    return data;
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
