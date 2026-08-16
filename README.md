# K线练习助手

> A股全市场随机选股 K线交易训练工具（React + TypeScript + Vite + Express）

## ✨ 功能特性

- **账号体系** — 注册/登录，用户数据持久化保存
- **数据持久化** — 钱包、训练记录、划线全部保存在服务端 JSON 数据库
- **全市场随机选股** — 覆盖 200+ A股真实股票，新浪/腾讯财经 API 双重保障
- **多周期K线** — 支持日线训练，含完整历史K线复盘浏览
- **仓位交易** — 半仓/全仓买入卖出，键盘快捷键操作（B/M + 1/2，空格下一根）
- **技术指标** — MA、VOL、BOLL、MACD、KDJ、RSI 多种指标切换
- **划线工具** — 趋势线、水平线、射线、平行通道、斐波那契回撤
- **游戏化资金系统** — 初始资金 ¥100,000，破产(≤¥1,000)/暴富(≥¥100M)判定
- **训练记录** — 每局盈亏、胜率、盈亏比自动归档
- **复盘模式** — 训练结束后查看完整 K 线与交易标记

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 同时启动前端 + 后端（开发模式）
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3001

### 生产构建

```bash
npm run build
npm run build -w server
npm run build -w client
```

## 🛠 技术栈

- **前端**：React 18 + TypeScript 5 + Vite 6 + Tailwind CSS 3 + Zustand 5
- **后端**：Express 4 + TypeScript 5 + JSON 文件数据库
- **认证**：JWT + bcryptjs
- **数据源**：新浪财经 API（主）/ 腾讯财经 API（备）/ 本地 JSON 数据兜底

## 📁 项目结构

```
kline-trainer/
├── package.json              # 工作区根
├── client/                   # React 前端
│   ├── src/
│   │   ├── pages/            # 登录/训练/记录页面
│   │   ├── components/       # 图表、工具栏、面板等组件
│   │   ├── lib/              # API、图表引擎、训练逻辑、指标计算
│   │   ├── store/            # Zustand 全局状态
│   │   └── styles/           # Tailwind 全局样式
│   └── index.html
├── server/                   # Express 后端
│   └── src/
│       ├── db.ts             # JSON 文件数据库
│       ├── auth.ts           # JWT 认证
│       ├── stockApi.ts       # 股票数据获取
│       └── routes/           # 路由
└── data/                     # 本地股票数据 + 运行时 JSON 数据库
```

## ⌨️ 操作说明

| 快捷键 | 功能 |
|--------|------|
| `B` → `1` | 半仓买入 |
| `B` → `2` | 全仓买入 |
| `M` → `1` | 半仓卖出 |
| `M` → `2` | 全仓卖出 |
| `Space` | 观望下一根 K 线 |
| `Esc` | 取消当前划线工具 |
| 滚轮/触控板 | 缩放K线 |
| 拖拽 | 平移K线 |

## 📄 License

MIT
