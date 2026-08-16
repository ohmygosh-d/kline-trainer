import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'kline-trainer-secret-2026';

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

export function createToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as any;
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
