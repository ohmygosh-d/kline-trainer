import { Router } from 'express';
import { db } from '../db.js';
import { AuthRequest } from '../auth.js';

const router = Router();

// 获取钱包状态
router.get('/', (req: AuthRequest, res) => {
  const state = db.getWallet(req.userId!);
  res.json(state);
});

// 更新钱包状态
router.put('/', (req: AuthRequest, res) => {
  const { balance, bankrupt_count, fortune_count, total_sessions } = req.body;
  db.setWallet(req.userId!, { balance, bankrupt_count, fortune_count, total_sessions });
  res.json({ ok: true });
});

// 获取训练历史
router.get('/history', (req: AuthRequest, res) => {
  const sessions = db.getSessions(req.userId!);
  res.json({ sessions });
});

// 保存训练记录
router.post('/', (req: AuthRequest, res) => {
  const { stock_code, stock_name, period, total_pnl, total_pnl_pct,
          stock_return_pct, beat_market, total_trades, win_rate, is_real, stats_json } = req.body;

  const id = db.addSession(req.userId!, {
    stock_code, stock_name, period, total_pnl, total_pnl_pct,
    stock_return_pct, beat_market, total_trades, win_rate, is_real, stats_json,
  });

  // 更新总训练次数
  const wallet = db.getWallet(req.userId!);
  wallet.total_sessions = (wallet.total_sessions || 0) + 1;
  db.setWallet(req.userId!, wallet);

  res.json({ id });
});

export default router;
