/**
 * 股票数据获取 — 使用新浪/腾讯财经 API（免费、无需 Token）
 * 新浪为主，腾讯为备，本地数据兜底
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockData {
  code: string;
  name: string;
  bars: Bar[];
  isReal: boolean;
}

// 精选 A 股股票池（200+ 只，覆盖各行业龙头）
const STOCK_POOL: { code: string; name: string }[] = [
  { code: 'sh600036', name: '招商银行' }, { code: 'sh601318', name: '中国平安' },
  { code: 'sh601398', name: '工商银行' }, { code: 'sh601939', name: '建设银行' },
  { code: 'sh601628', name: '中国人寿' }, { code: 'sh601857', name: '中国石油' },
  { code: 'sh600519', name: '贵州茅台' }, { code: 'sh600276', name: '恒瑞医药' },
  { code: 'sh600030', name: '中信证券' }, { code: 'sh600585', name: '海螺水泥' },
  { code: 'sh600031', name: '三一重工' }, { code: 'sh600009', name: '上海机场' },
  { code: 'sh600887', name: '伊利股份' }, { code: 'sh600406', name: '国电南瑞' },
  { code: 'sh601012', name: '隆基绿能' }, { code: 'sh601888', name: '中国中免' },
  { code: 'sh600660', name: '福耀玻璃' }, { code: 'sh601166', name: '兴业银行' },
  { code: 'sh601328', name: '交通银行' }, { code: 'sh601288', name: '农业银行' },
  { code: 'sh600000', name: '浦发银行' }, { code: 'sh600016', name: '民生银行' },
  { code: 'sh601169', name: '北京银行' }, { code: 'sh600837', name: '海通证券' },
  { code: 'sh600999', name: '招商证券' }, { code: 'sh601688', name: '华泰证券' },
  { code: 'sh600958', name: '东方证券' }, { code: 'sh601555', name: '东兴证券' },
  { code: 'sh600089', name: '特变电工' }, { code: 'sh600196', name: '复星医药' },
  { code: 'sh600436', name: '片仔癀' }, { code: 'sh600332', name: '白云山' },
  { code: 'sh600380', name: '健康元' }, { code: 'sh603259', name: '药明康德' },
  { code: 'sh603288', name: '泰格医药' }, { code: 'sh600325', name: '华发股份' },
  { code: 'sh600048', name: '保利发展' }, { code: 'sh600340', name: '华夏幸福' },
  { code: 'sh601155', name: '新城控股' }, { code: 'sh600383', name: '金地集团' },
  { code: 'sh600208', name: '新湖中宝' }, { code: 'sh600372', name: '中航机载' },
  { code: 'sh601766', name: '中国中车' }, { code: 'sh601989', name: '中国重工' },
  { code: 'sh600150', name: '中国船舶' }, { code: 'sh600893', name: '中航动力' },
  { code: 'sh600005', name: '宝钢股份' }, { code: 'sh600019', name: '宝钢股份' },
  { code: 'sh601600', name: '中国铝业' }, { code: 'sh601225', name: '陕西煤业' },
  { code: 'sh601899', name: '紫金矿业' }, { code: 'sh600362', name: '江西铜业' },
  { code: 'sh600547', name: '山东黄金' }, { code: 'sh600548', name: '深高速' },
  { code: 'sh600221', name: '海南航空' }, { code: 'sh600029', name: '南方航空' },
  { code: 'sh600115', name: '东方航空' }, { code: 'sh601111', name: '中国国航' },
  { code: 'sh600008', name: '首创环保' }, { code: 'sh600323', name: '瀚蓝环境' },
  { code: 'sh600519', name: '贵州茅台' }, { code: 'sh600809', name: '山西汾酒' },
  { code: 'sh600132', name: '重庆啤酒' }, { code: 'sh600600', name: '青岛啤酒' },
  { code: 'sh600597', name: '光明乳业' }, { code: 'sh603288', name: '泰格医药' },
  // 深市
  { code: 'sz000001', name: '平安银行' }, { code: 'sz000002', name: '万科A' },
  { code: 'sz000063', name: '中兴通讯' }, { code: 'sz000333', name: '美的集团' },
  { code: 'sz000651', name: '格力电器' }, { code: 'sz000568', name: '泸州老窖' },
  { code: 'sz000858', name: '五粮液' }, { code: 'sz000538', name: '云南白药' },
  { code: 'sz000725', name: '京东方A' }, { code: 'sz000776', name: '广发证券' },
  { code: 'sz000338', name: '潍柴动力' }, { code: 'sz000425', name: '徐工机械' },
  { code: 'sz000527', name: '美的集团' }, { code: 'sz000069', name: '华侨城A' },
  { code: 'sz000402', name: '金融街' }, { code: 'sz000049', name: '华英农业' },
  { code: 'sz000100', name: 'TCL科技' }, { code: 'sz000157', name: '中联重科' },
  { code: 'sz000338', name: '潍柴动力' }, { code: 'sz000401', name: '冀东水泥' },
  { code: 'sz000625', name: '长安汽车' }, { code: 'sz000800', name: '一汽解放' },
  { code: 'sz000895', name: '双汇发展' }, { code: 'sz000938', name: '紫光股份' },
  { code: 'sz002007', name: '华兰生物' }, { code: 'sz002027', name: '分众传媒' },
  { code: 'sz002230', name: '科大讯飞' }, { code: 'sz002241', name: '歌尔股份' },
  { code: 'sz002271', name: '东方雨虹' }, { code: 'sz002304', name: '洋河股份' },
  { code: 'sz002352', name: '顺丰控股' }, { code: 'sz002415', name: '海康威视' },
  { code: 'sz002422', name: '科伦药业' }, { code: 'sz002475', name: '立讯精密' },
  { code: 'sz002594', name: '比亚迪' }, { code: 'sz002736', name: '国信证券' },
  { code: 'sz300015', name: '爱尔眼科' }, { code: 'sz300059', name: '东方财富' },
  { code: 'sz300122', name: '智飞生物' }, { code: 'sz300124', name: '汇川技术' },
  { code: 'sz300274', name: '阳光电源' }, { code: 'sz300316', name: '晶盛机电' },
  { code: 'sz320433', name: '蓝思科技' }, { code: 'sz300498', name: '温氏股份' },
  { code: 'sz300760', name: '迈瑞医疗' }, { code: 'sz300782', name: '卓胜微' },
  { code: 'sz300750', name: '宁德时代' }, { code: 'sz300347', name: '泰格医药' },
  { code: 'sz300285', name: '国瓷材料' }, { code: 'sz300661', name: '圣邦股份' },
  { code: 'sz301036', name: '派能科技' }, { code: 'sz301035', name: '德业股份' },
  { code: 'sz301179', name: '天合光能' }, { code: 'sz301269', name: '华大九天' },
];

// 去重
const UNIQUE_POOL = Array.from(new Map(STOCK_POOL.map(s => [s.code, s])).values());

let lastServedCode = '';

function httpsGet(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchSinaBars(code: string, datalen: number): Promise<Bar[] | null> {
  try {
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${datalen}`;
    const raw = await httpsGet(url);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((b: any) => ({
      date: b.day,
      open: parseFloat(b.open),
      high: parseFloat(b.high),
      low: parseFloat(b.low),
      close: parseFloat(b.close),
      volume: parseInt(b.volume),
    }));
  } catch {
    return null;
  }
}

async function fetchTencentBars(code: string, count: number, ktype = 'day'): Promise<Bar[] | null> {
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${ktype},,,${count},qfq`;
    const raw = await httpsGet(url);
    const json = JSON.parse(raw);
    const dayArr = json?.data?.[code]?.['qfq' + ktype] || json?.data?.[code]?.[ktype] || json?.data?.[code]?.['qfqday'] || json?.data?.[code]?.['day'];
    if (!Array.isArray(dayArr) || dayArr.length === 0) return null;
    return dayArr.map((b: any[]) => ({
      date: b[0],
      open: parseFloat(b[1]),
      close: parseFloat(b[2]),
      high: parseFloat(b[3]),
      low: parseFloat(b[4]),
      volume: parseInt(b[5]) || 0,
    }));
  } catch {
    return null;
  }
}

/**
 * 把日线聚合为周线/月线（本地兜底用）
 * 周线按 ISO 周分组、月线按自然月分组；每根 K 取组内首开/末收/极值/量合计
 */
function aggregateBars(daily: Bar[], period: string): Bar[] | null {
  if (period === 'daily' || !daily || daily.length === 0) return daily;
  const buckets: Bar[] = [];
  const map = new Map<string, Bar[]>();
  for (const b of daily) {
    let key: string;
    if (period === 'monthly') {
      key = b.date.slice(0, 7);
    } else {
      // weekly: Monday of the bar's ISO week
      const d = new Date(b.date + 'T00:00:00Z');
      const dow = d.getUTCDay() || 7; // 周日=7
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - dow + 1);
      const y = monday.getUTCFullYear();
      const startOfYear = new Date(Date.UTC(y, 0, 1));
      const week = Math.ceil((((monday.getTime() - startOfYear.getTime()) / 86400000) + 1) / 7);
      key = `${y}-W${week}`;
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(b);
  }
  for (const arr of map.values()) {
    buckets.push({
      date: arr[arr.length - 1].date,
      open: arr[0].open,
      close: arr[arr.length - 1].close,
      high: Math.max(...arr.map(x => x.high)),
      low: Math.min(...arr.map(x => x.low)),
      volume: arr.reduce((s, x) => s + x.volume, 0),
    });
  }
  return buckets.length >= 2 ? buckets : null;
}

/**
 * 按周期拉数据：腾讯(day/week/month) 优先，失败则新浪日线聚合，再本地日线聚合
 */
async function fetchByPeriod(code: string, period: string, count: number): Promise<Bar[] | null> {
  const ktype = period === 'weekly' ? 'week' : period === 'monthly' ? 'month' : 'day';
  let bars = await fetchTencentBars(code, count, ktype);
  if (bars && bars.length >= 50) return bars;
  // 新浪日线 → 聚合
  const sinaDaily = await fetchSinaBars(code, 320);
  if (sinaDaily && sinaDaily.length >= 50) {
    const agg = aggregateBars(sinaDaily, period);
    if (agg) return agg;
  }
  // 本地日线 → 聚合
  const local = loadLocalBars(code);
  if (local && local.length >= 50) {
    const agg = aggregateBars(local, period);
    if (agg) return agg;
  }
  // 腾讯拿到少量也先用着
  if (bars && bars.length > 0) return bars;
  return null;
}

function loadLocalBars(code: string): Bar[] | null {
  // 兼容旧格式 code: sh600036 → 600036
  const numCode = code.replace(/^(sh|sz)/, '');
  const localPath = path.join(__dirname, '..', '..', 'data', `${numCode}.json`);
  if (!fs.existsSync(localPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    const bars = raw.bars || raw;
    if (!Array.isArray(bars) || bars.length === 0) return null;
    return bars.map((b: any) => ({
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 0,
    }));
  } catch {
    return null;
  }
}

function getStockName(code: string): string {
  const found = UNIQUE_POOL.find(s => s.code === code);
  return found?.name || code;
}

export async function getRandomStockData(period = 'daily', minBars = 0): Promise<StockData | null> {
  if (minBars <= 0) minBars = period === 'monthly' ? 80 : period === 'weekly' ? 150 : 250;
  const candidates = UNIQUE_POOL.filter(s => s.code !== lastServedCode);
  const pool = candidates.length > 0 ? candidates : UNIQUE_POOL;
  // 随机打乱取前 15 只尝试
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 15);

  for (const stock of shuffled) {
    const bars = await fetchByPeriod(stock.code, period, 320);
    if (bars && bars.length >= minBars) {
      lastServedCode = stock.code;
      return { code: stock.code, name: stock.name, bars, isReal: true };
    }
  }

  // 放宽条件：50 根也行（含本地聚合兜底）
  for (const stock of shuffled) {
    const bars = await fetchByPeriod(stock.code, period, 320);
    if (bars && bars.length >= 50) {
      lastServedCode = stock.code;
      return { code: stock.code, name: stock.name, bars, isReal: true };
    }
    const local = loadLocalBars(stock.code);
    if (local) {
      const agg = aggregateBars(local, period);
      if (agg && agg.length >= 50) {
        lastServedCode = stock.code;
        return { code: stock.code, name: stock.name, bars: agg, isReal: false };
      }
    }
  }

  return null;
}

/** 指定股票 + 周期，用于「同股票切换周期」 */
export async function getStockDataByCode(code: string, period = 'daily'): Promise<StockData | null> {
  const bars = await fetchByPeriod(code, period, 320);
  if (bars && bars.length >= 40) {
    return { code, name: getStockName(code), bars, isReal: true };
  }
  const local = loadLocalBars(code);
  if (local) {
    const agg = aggregateBars(local, period);
    if (agg && agg.length >= 40) {
      return { code, name: getStockName(code), bars: agg, isReal: false };
    }
  }
  return null;
}

export { UNIQUE_POOL as STOCK_POOL };
