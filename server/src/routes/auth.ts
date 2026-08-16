import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { createToken, authMiddleware, AuthRequest } from '../auth.js';

const router = Router();

router.post('/register', (req: AuthRequest, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' });
    return;
  }
  if (username.length < 2 || username.length > 20) {
    res.status(400).json({ error: '用户名长度 2-20 个字符' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: '密码至少 6 位' });
    return;
  }

  const existing = db.getUserByName(username);
  if (existing) {
    res.status(409).json({ error: '用户名已被注册' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const user = db.createUser(username, hash);

  const token = createToken(user.id, user.username);
  res.json({ token, user: { id: user.id, username: user.username } });
});

router.post('/login', (req: AuthRequest, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' });
    return;
  }

  const user = db.getUserByName(username);
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const token = createToken(user.id, user.username);
  res.json({ token, user: { id: user.id, username: user.username } });
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const user = db.getUserById(req.userId);
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }
  res.json({ user: { id: user.id, username: user.username, created_at: user.created_at } });
});

// 修改密码
router.put('/password', authMiddleware, (req: AuthRequest, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: '请填写原密码和新密码' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: '新密码至少 6 位' });
    return;
  }
  const user = db.getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    res.status(401).json({ error: '原密码错误' });
    return;
  }
  db.changePassword(req.userId!, bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true });
});

// 用户统计总览
router.get('/stats', authMiddleware, (req: AuthRequest, res) => {
  res.json(db.getUserStats(req.userId!));
});

// 注销账号
router.delete('/account', authMiddleware, (req: AuthRequest, res) => {
  db.deleteUser(req.userId!);
  res.json({ ok: true });
});

export default router;
