/**
 * db.ts — 纯 JSON 文件数据库（无需原生编译）
 * 简单可靠，适合本地单用户应用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'db');

// 确保目录存在
fs.mkdirSync(path.join(DATA_DIR, 'wallets'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'drawings'), { recursive: true });

function readJSON<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(filePath: string, data: any) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---- Users ----
export interface UserRecord {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

const usersFile = path.join(DATA_DIR, 'users.json');

export const db = {
  // Users
  getUserByName(username: string): UserRecord | null {
    const users = readJSON<UserRecord[]>(usersFile, []);
    return users.find(u => u.username === username) || null;
  },
  getUserById(id: number): UserRecord | null {
    const users = readJSON<UserRecord[]>(usersFile, []);
    return users.find(u => u.id === id) || null;
  },
  createUser(username: string, passwordHash: string): UserRecord {
    const users = readJSON<UserRecord[]>(usersFile, []);
    const id = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    const user: UserRecord = { id, username, password_hash: passwordHash, created_at: new Date().toISOString() };
    users.push(user);
    writeJSON(usersFile, users);
    return user;
  },

  // Wallet state
  getWallet(userId: number) {
    return readJSON(path.join(DATA_DIR, 'wallets', `${userId}.json`), {
      balance: 100000, bankrupt_count: 0, fortune_count: 0, total_sessions: 0,
    });
  },
  setWallet(userId: number, state: any) {
    writeJSON(path.join(DATA_DIR, 'wallets', `${userId}.json`), state);
  },

  // Training sessions
  getSessions(userId: number): any[] {
    return readJSON(path.join(DATA_DIR, 'sessions', `${userId}.json`), []);
  },
  addSession(userId: number, session: any) {
    const sessions = readJSON<any[]>(path.join(DATA_DIR, 'sessions', `${userId}.json`), []);
    const id = sessions.length > 0 ? Math.max(...sessions.map(s => s.id || 0)) + 1 : 1;
    session.id = id;
    session.created_at = new Date().toISOString();
    sessions.push(session);
    // Keep last 200
    if (sessions.length > 200) sessions.splice(0, sessions.length - 200);
    writeJSON(path.join(DATA_DIR, 'sessions', `${userId}.json`), sessions);
    return id;
  },

  // Drawings
  getDrawings(userId: number, stockCode: string, period: string): any[] {
    return readJSON(path.join(DATA_DIR, 'drawings', `${userId}_${stockCode}_${period}.json`), []);
  },
  setDrawings(userId: number, stockCode: string, period: string, drawings: any[]) {
    writeJSON(path.join(DATA_DIR, 'drawings', `${userId}_${stockCode}_${period}.json`), drawings);
  },
  clearDrawings(userId: number, stockCode: string, period: string) {
    const fp = path.join(DATA_DIR, 'drawings', `${userId}_${stockCode}_${period}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  },

  // 修改密码
  changePassword(userId: number, newHash: string): boolean {
    const users = readJSON<UserRecord[]>(usersFile, []);
    const u = users.find(u => u.id === userId);
    if (!u) return false;
    u.password_hash = newHash;
    writeJSON(usersFile, users);
    return true;
  },

  // 用户统计总览
  getUserStats(userId: number) {
    const sessions = this.getSessions(userId);
    const wallet = this.getWallet(userId);
    const total = sessions.length;
    if (total === 0) {
      return {
        total_sessions: 0, avg_pnl_pct: 0, win_sessions: 0, win_rate: 0,
        total_pnl: 0, bankrupt: wallet.bankrupt_count || 0, fortune: wallet.fortune_count || 0,
        best: null, worst: null, real_count: 0,
      };
    }
    const pnls = sessions.map(s => s.total_pnl_pct || 0);
    const totalPnl = sessions.reduce((s, x) => s + (x.total_pnl || 0), 0);
    const wins = sessions.filter(s => (s.total_pnl_pct || 0) > 0).length;
    const best = sessions.reduce((a, b) => (b.total_pnl_pct || 0) > (a.total_pnl_pct || 0) ? b : a);
    const worst = sessions.reduce((a, b) => (b.total_pnl_pct || 0) < (a.total_pnl_pct || 0) ? b : a);
    const real = sessions.filter(s => s.is_real).length;
    return {
      total_sessions: total,
      avg_pnl_pct: pnls.reduce((s, x) => s + x, 0) / total,
      win_sessions: wins,
      win_rate: (wins / total) * 100,
      total_pnl: totalPnl,
      bankrupt: wallet.bankrupt_count || 0,
      fortune: wallet.fortune_count || 0,
      best: { code: best.stock_code, name: best.stock_name, pct: best.total_pnl_pct },
      worst: { code: worst.stock_code, name: worst.stock_name, pct: worst.total_pnl_pct },
      real_count: real,
    };
  },

  // 注销账号：删除用户及其全部数据
  deleteUser(userId: number): void {
    const users = readJSON<UserRecord[]>(usersFile, []);
    const idx = users.findIndex(u => u.id === userId);
    if (idx >= 0) users.splice(idx, 1);
    writeJSON(usersFile, users);
    const rm = (p: string) => { if (fs.existsSync(p)) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } } };
    rm(path.join(DATA_DIR, 'wallets', `${userId}.json`));
    rm(path.join(DATA_DIR, 'sessions', `${userId}.json`));
    const dp = path.join(DATA_DIR, 'drawings');
    if (fs.existsSync(dp)) {
      for (const f of fs.readdirSync(dp)) {
        if (f.startsWith(`${userId}_`)) { try { fs.unlinkSync(path.join(dp, f)); } catch { /* ignore */ } }
      }
    }
  },
};
