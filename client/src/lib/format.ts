/** 格式化工具 */

export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + ' 亿';
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + ' 万';
  return sign + abs.toFixed(0);
}

export function fmtMoneyFull(n: number): string {
  return '¥' + Math.round(n).toLocaleString('zh-CN');
}

export function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

export function fmtPrice(n: number): string {
  return n.toFixed(2);
}

export function fmtVol(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return String(n);
}

export function cls(n: number): string {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return '';
}

export function formatDate(date: string): string {
  return date.slice(5); // MM-DD
}

export function clsColor(n: number): string {
  if (n > 0) return '#ef4444';
  if (n < 0) return '#22c55e';
  return '#64748b';
}
