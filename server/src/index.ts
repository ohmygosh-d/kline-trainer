import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware, AuthRequest } from './auth.js';
import authRoutes from './routes/auth.js';
import stockRoutes from './routes/stock.js';
import sessionRoutes from './routes/session.js';
import drawingsRoutes from './routes/drawings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', '..', 'client', 'dist')));

// 公开路由
app.use('/api/auth', authRoutes);

// 需要认证的路由
app.use('/api/stock', authMiddleware, stockRoutes);
app.use('/api/wallet', authMiddleware, sessionRoutes); // wallet + history 在同一个 router
app.use('/api/drawings', authMiddleware, drawingsRoutes);

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[server] running at http://127.0.0.1:${PORT}`);
});
