import { Router } from 'express';
import { AuthRequest } from '../auth.js';
import { getRandomStockData } from '../stockApi.js';

const router = Router();

router.get('/random', async (req: AuthRequest, res) => {
  try {
    const data = await getRandomStockData(250);
    if (!data) {
      res.status(500).json({ error: '获取股票数据失败，请稍后重试' });
      return;
    }
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: '服务器错误: ' + e.message });
  }
});

export default router;
