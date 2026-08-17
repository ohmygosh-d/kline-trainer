import { Router } from 'express';
import { AuthRequest } from '../auth.js';
import { getRandomStockData, getStockDataByCode } from '../stockApi.js';

const router = Router();

const VALID_PERIODS = ['daily', 'weekly', 'monthly'];

router.get('/random', async (req: AuthRequest, res) => {
  try {
    const period = VALID_PERIODS.includes(req.query.period as string) ? (req.query.period as string) : 'daily';
    const data = await getRandomStockData(period);
    if (!data) {
      res.status(500).json({ error: '获取股票数据失败，请稍后重试' });
      return;
    }
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: '服务器错误: ' + e.message });
  }
});

router.get('/bycode', async (req: AuthRequest, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).json({ error: '缺少股票代码' });
      return;
    }
    const period = VALID_PERIODS.includes(req.query.period as string) ? (req.query.period as string) : 'daily';
    const data = await getStockDataByCode(code, period);
    if (!data) {
      res.status(404).json({ error: '未找到该股票数据' });
      return;
    }
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: '服务器错误: ' + e.message });
  }
});

export default router;
