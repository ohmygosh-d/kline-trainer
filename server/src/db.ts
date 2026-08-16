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
};
