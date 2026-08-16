import { Router } from 'express';
import { db } from '../db.js';
import { AuthRequest } from '../auth.js';

const router = Router();

// 获取划线
router.get('/:stockCode/:period', (req: AuthRequest, res) => {
  const { stockCode, period } = req.params;
  const drawings = db.getDrawings(req.userId!, stockCode, period);
  res.json({ drawings });
});

// 保存划线
router.put('/:stockCode/:period', (req: AuthRequest, res) => {
  const { stockCode, period } = req.params;
  const { drawings } = req.body;
  db.setDrawings(req.userId!, stockCode, period, drawings);
  res.json({ ok: true });
});

// 清空划线
router.delete('/:stockCode/:period', (req: AuthRequest, res) => {
  const { stockCode, period } = req.params;
  db.clearDrawings(req.userId!, stockCode, period);
  res.json({ ok: true });
});

export default router;
