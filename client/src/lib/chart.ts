/**
 * chart.ts — K线绘制引擎 (TypeScript)
 * 移植自 chart.js v7，保留丝滑拖拽 + 划线系统
 */

import type { Bar, Drawing, Position, Trade } from '../types';
import { calcMA, calcMACD, calcKDJ, calcRSI, calcBOLL } from './indicators';

const COLOR = {
  up: '#ef4444', upFill: '#ef4444',
  down: '#22c55e', downFill: '#22c55e',
  flat: '#94a3b8',
  ma: ['#f59e0b', '#3b82f6', '#f97316', '#8b5cf6'],
  boll: { mid: '#f59e0b', upper: 'rgba(59,130,246,.45)', lower: 'rgba(59,130,246,.45)' },
  kdj: { k: '#f59e0b', d: '#3b82f6', j: '#f97316' },
  rsi: '#8b5cf6',
  macd: { dif: '#3b82f6', dea: '#f59e0b' },
  grid: 'rgba(0,0,0,.10)',
  gridStrong: 'rgba(0,0,0,.16)',
  text: '#94a3b8',
  textDim: '#64748b',
  textBright: '#334155',
  cross: 'rgba(148,163,184,.6)',
  zoneBg: 'rgba(0,0,0,.02)',
  bg: '#ffffff',
};

const DRAW_TOOLS_CFG: Record<string, { label: string; color: string; hint: string }> = {
  cursor:  { label: '光标', color: '', hint: '' },
  trend:   { label: '趋势线', color: '#4361ee', hint: '拖动绘制趋势线' },
  h:       { label: '水平线', color: '#f59e0b', hint: '拖动设定水平线价格' },
  ray:     { label: '射线', color: '#8b5cf6', hint: '拖动绘制射线（向右延伸）' },
  channel: { label: '平行通道', color: '#10b981', hint: '拖动确定基准线，再点一下确定通道宽度' },
  fib:     { label: '斐波那契', color: '#f59e0b', hint: '拖动绘制斐波那契回撤' },
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

interface FlashEffect { barIdx: number; type: string; price: number; qty: number; startTime: number; duration: number; }
interface SlideAnim { from: number; to: number; startTime: number; duration: number; }
interface PulseAnim { barIdx: number; startTime: number; duration: number; }
interface Momentum { v: number; lastT: number; }
interface ZoomAnim { t0: number; dur: number; fromBars: number; fromStart: number; toBars: number; toStart: number; }
interface Draft { type: string; pts: { bi: number; price: number }[]; stage: number; price: number; }

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class ChartEngine {
  private canvases: Record<string, HTMLCanvasElement> = {};
  private ctxs: Record<string, CanvasRenderingContext2D> = {};
  private container!: HTMLElement;

  private bars: Bar[] = [];
  private trainStartIdx = 0;
  private trainEndIdx = 0;
  private reviewMode = false;
  private progressCount = 0;
  private viewStart = 0;
  private viewBars = 60;
  private autoFollow = true;
  private period: string = 'daily';

  private opts = { showMA: true, showVol: true, showMACD: false, showKDJ: false, showRSI: false, showBOLL: false, maPeriods: [5, 10, 20] };
  private maData: (number | null)[][] = [];
  private macdData: any = null;
  private kdjData: any = null;
  private rsiData: any = null;
  private bollData: any = null;

  private crossIdx = -1;
  private dpr = 1;
  private priceRange = { min: 0, max: 0 };
  private volMax = 0;

  private tradeList: Trade[] = [];
  private activePosition: Position | null = null;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartViewStart = 0;
  private dragState: { lastX: number; lastT: number; vels: { x: number; t: number }[] } | null = null;
  private momentum: Momentum | null = null;
  private zoomAnim: ZoomAnim | null = null;

  // Drawing tools
  private drawTools: Drawing[] = [];
  private selectedDraw = -1;
  private activeTool = 'cursor';
  private draft: Draft | null = null;
  private editDrag: any = null;
  private drawingKey = '';
  private lastSaveT = 0;

  // Animations
  private flashEffects: FlashEffect[] = [];
  private slideAnim: SlideAnim | null = null;
  private pulseAnim: PulseAnim | null = null;
  private animRAF: number | null = null;
  private initialized = false;

  // 指标行容器（用于按需显隐并重排主图高度）
  private rowEls: Record<string, HTMLElement | null> = {};
  private mainEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: any = null;

  // Touch state (mobile)
  private pinchStartDist = 0;
  private pinchStartBars = 60;

  // Callbacks for saving drawings
  public onSaveDrawings: ((key: string, drawings: Drawing[]) => void) | null = null;
  public onLoadDrawings: ((key: string) => Drawing[] | null) | null = null;

  init(container: HTMLElement) {
    if (this.initialized) return;
    this.initialized = true;
    this.container = container;
    const ids = ['kline-canvas', 'vol-canvas', 'macd-canvas', 'kdj-canvas', 'rsi-canvas', 'crosshair'];
    for (const id of ids) {
      const el = container.querySelector('#' + id) as HTMLCanvasElement;
      if (el) {
        this.canvases[id] = el;
        this.ctxs[id] = el.getContext('2d')!;
        // 记录指标行容器，便于按开关显隐并重排主图高度
        if (id === 'vol-canvas' || id === 'macd-canvas' || id === 'kdj-canvas' || id === 'rsi-canvas') {
          this.rowEls[id] = el.closest('[data-row]') as HTMLElement | null;
        }
        if (id === 'kline-canvas') {
          this.mainEl = el.parentElement as HTMLElement | null;
        }
      }
    }
    this.bindResize();
    this.bindEvents();
    this.applyLayout();
  }

  private bindResize() {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.setupCanvas();
        this.draw();
      }, 50);
    });
    if (this.container) this.resizeObserver.observe(this.container);
    if (this.mainEl) this.resizeObserver.observe(this.mainEl);
    for (const id in this.rowEls) {
      const el = this.rowEls[id];
      if (el) this.resizeObserver.observe(el);
    }
  }

  /** 每个 canvas 按其自身区块尺寸设置，而不是用容器全尺寸（修复成交量/指标被撑满整屏）。
   * 注意：只设置 canvas 内部缓冲区尺寸，不设置 style.width/height，避免内联样式覆盖 Tailwind 的 w-full/h-full，
   * 导致容器变小后 canvas 无法跟随收缩而与其它区域重叠。 */
  setupCanvas() {
    this.dpr = window.devicePixelRatio || 1;
    for (const id in this.canvases) {
      const c = this.canvases[id];
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) continue; // 隐藏的指标行跳过
      const w = rect.width, h = rect.height;
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      // 不固定 style 尺寸：让 CSS class (w-full h-full absolute inset-0) 控制显示尺寸，
      // 这样父容器变化时 getBoundingClientRect 会返回最新尺寸，setupCanvas 可正确更新缓冲区。
      this.ctxs[id].setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  /** 按开关显隐指标行 → 重排 canvas 尺寸 → 重绘 */
  applyLayout() {
    const vis: Record<string, boolean> = {
      'vol-canvas': this.opts.showVol,
      'macd-canvas': this.opts.showMACD,
      'kdj-canvas': this.opts.showKDJ,
      'rsi-canvas': this.opts.showRSI,
    };
    for (const id in vis) {
      const row = this.rowEls[id];
      if (row) row.style.display = vis[id] ? '' : 'none';
    }
    this.setupCanvas();
    this.draw();
  }

  setData(bars: Bar[], trainStart: number, trainEnd: number, period?: string) {
    if (period) this.period = period;
    this.bars = bars;
    this.trainStartIdx = trainStart;
    this.trainEndIdx = trainEnd;
    this.progressCount = trainEnd;
    this.viewStart = Math.max(0, this.progressCount - this.viewBars);
    this.autoFollow = true;
    this.computeIndicators();
    this.clampView();
    this.draw();
  }

  setProgress(count: number) {
    if (count === this.progressCount) return;
    const old = this.progressCount;
    this.progressCount = count;
    if (this.autoFollow || count >= this.progressCount) {
      this.viewStart = Math.max(0, count - this.viewBars);
    }
    this.clampView();
    if (count > old) this.startPulse(count - 1);
    this.draw();
  }

  setReviewMode(on: boolean) {
    this.reviewMode = on;
    if (on) {
      this.progressCount = this.bars.length;
      // 定位视口到「训练结束」边界附近，向右展示后续走势（结束节点 → 今天）
      this.viewStart = Math.max(0, this.trainEndIdx - Math.floor(this.viewBars * 0.6));
      this.autoFollow = false;
    }
    this.clampView();
    this.draw();
  }

  setTradeMarkers(trades: Trade[], pos: Position | null) {
    this.tradeList = trades;
    this.activePosition = pos;
    this.draw();
  }

  flashTrade(barIdx: number, type: string, price: number, qty: number) {
    if (barIdx < 0 || barIdx >= this.bars.length) return;
    this.flashEffects.push({ barIdx, type, price, qty, startTime: performance.now(), duration: 800 });
    this.ensureAnimLoop();
  }

  // Drawing tools
  setActiveTool(tool: string) { this.activeTool = tool; this.selectedDraw = -1; this.draw(); }
  getActiveTool() { return this.activeTool; }
  setDrawingContext(key: string) {
    this.drawingKey = key;
    this.drawTools = this.onLoadDrawings ? (this.onLoadDrawings(key) || []) : [];
    this.selectedDraw = -1;
    this.draw();
  }
  clearDrawings() { this.drawTools = []; this.selectedDraw = -1; this.saveDrawingsNow(); this.draw(); }
  deleteSelectedDrawing() {
    if (this.selectedDraw >= 0 && this.selectedDraw < this.drawTools.length) {
      this.drawTools.splice(this.selectedDraw, 1);
      this.selectedDraw = -1;
      this.saveDrawingsNow();
      this.draw();
    }
  }

  private saveDrawingsNow() {
    if (this.drawingKey && this.onSaveDrawings) this.onSaveDrawings(this.drawingKey, this.drawTools);
  }
  private saveDrawingsThrottled() {
    const now = performance.now();
    if (now - this.lastSaveT > 1500) { this.lastSaveT = now; this.saveDrawingsNow(); }
  }

  // ---- Viewport helpers ----
  private getView() {
    const visStart = Math.floor(this.viewStart);
    let visEnd = Math.min(Math.ceil(this.viewStart + this.viewBars), this.progressCount);
    if (visEnd < visStart) visEnd = visStart;
    return { visStart, visEnd, dc: visEnd - visStart, xOff: visStart - this.viewStart };
  }

  private clampSoft(v: number, min: number, max: number) {
    if (v < min) return min + (v - min) * 0.25;
    if (v > max) return max + (v - max) * 0.25;
    return v;
  }

  private clampView() {
    const maxStart = Math.max(0, this.progressCount - this.viewBars);
    if (this.viewStart < 0) this.viewStart = 0;
    if (this.viewStart > maxStart) this.viewStart = maxStart;
  }

  private computeIndicators() {
    if (this.bars.length === 0) return;
    this.maData = this.opts.maPeriods.map(p => calcMA(this.bars, p));
    this.macdData = calcMACD(this.bars);
    this.kdjData = calcKDJ(this.bars);
    this.rsiData = calcRSI(this.bars);
    this.bollData = calcBOLL(this.bars);
  }

  private computeRanges() {
    const { visStart, visEnd } = this.getView();
    let pmin = Infinity, pmax = -Infinity, vmax = 0;
    for (let i = visStart; i < visEnd && i < this.bars.length; i++) {
      const b = this.bars[i];
      pmin = Math.min(pmin, b.low);
      pmax = Math.max(pmax, b.high);
      vmax = Math.max(vmax, b.volume);
    }
    if (pmin === Infinity) { pmin = 0; pmax = 100; }
    const pad = (pmax - pmin) * 0.08 || 1;
    this.priceRange = { min: pmin - pad, max: pmax + pad };
    this.volMax = vmax || 1;
  }

  // ---- Coordinate conversion ----
  private mainH(): number { return (this.canvases['kline-canvas']?.height || 0) / this.dpr; }
  private mainW(): number { return (this.canvases['kline-canvas']?.width || 0) / this.dpr; }

  private xOf(i: number, xOff: number): number {
    const cw = this.mainW();
    const slot = cw / this.viewBars;
    return (i - this.viewStart) * slot + xOff * slot;
  }

  private yOf(price: number): number {
    const h = this.mainH();
    const { min, max } = this.priceRange;
    return h - ((price - min) / (max - min || 1)) * h;
  }

  private screenToData(clientX: number, clientY: number): { bi: number; price: number } {
    const rect = this.canvases['kline-canvas'].getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { xOff } = this.getView();
    const slot = this.mainW() / this.viewBars;
    const bi = Math.round(this.viewStart + x / slot - xOff);
    const price = this.priceRange.min + (this.mainH() - y) / this.mainH() * (this.priceRange.max - this.priceRange.min);
    return { bi, price };
  }

  private dataToXY(bi: number, price: number): { x: number; y: number } {
    const { xOff } = this.getView();
    const x = this.xOf(bi, xOff);
    const y = this.yOf(price);
    return { x, y };
  }

  // ---- Main draw ----
  draw() {
    if (!this.bars.length) return;
    this.computeRanges();
    this.drawMain();
    this.drawVolume();
    if (this.opts.showMACD) this.drawMACD(); else this.clearCanvas('macd-canvas');
    if (this.opts.showKDJ) this.drawKDJ(); else this.clearCanvas('kdj-canvas');
    if (this.opts.showRSI) this.drawRSI(); else this.clearCanvas('rsi-canvas');
    this.drawCrosshair();
    this.drawAllDrawings();
  }

  private clearCanvas(id: string) {
    const ctx = this.ctxs[id];
    if (!ctx) return;
    ctx.clearRect(0, 0, this.mainW(), this.mainH());
  }

  private drawMain() {
    const ctx = this.ctxs['kline-canvas'];
    if (!ctx) return;
    const w = this.mainW(), h = this.mainH();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = (h / 5) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const x = (w / 6) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    const { visStart, visEnd, xOff } = this.getView();
    const slot = w / this.viewBars;
    const cw = slot * 0.7;

    // Training zone background
    if (!this.reviewMode && this.trainStartIdx < visEnd) {
      const x1 = this.xOf(Math.max(this.trainStartIdx, visStart), xOff);
      const x2 = this.xOf(Math.min(this.trainEndIdx, visEnd), xOff);
      ctx.fillStyle = 'rgba(67,97,238,.04)';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    // Review divider: 训练结束边界 → 后续走势（复盘可见，训练时不可见）
    if (this.reviewMode && this.trainEndIdx > 0 && this.trainEndIdx < this.bars.length) {
      const x = this.xOf(this.trainEndIdx, xOff);
      if (x >= 0 && x <= w) {
        ctx.strokeStyle = 'rgba(245,158,11,.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        const label = '训练结束 · 后续走势 →';
        ctx.fillText(label, Math.min(x + 4, w - label.length * 6 - 4), 12);
      }
    }

    // Candles
    for (let i = visStart; i < visEnd && i < this.bars.length; i++) {
      const b = this.bars[i];
      const x = this.xOf(i, xOff);
      const isUp = b.close >= b.open;
      const color = isUp ? COLOR.up : COLOR.down;
      const yHigh = this.yOf(b.high);
      const yLow = this.yOf(b.low);
      const yOpen = this.yOf(b.open);
      const yClose = this.yOf(b.close);
      const yTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      ctx.fillStyle = isUp ? color : color;
      ctx.fillRect(x - cw / 2, yTop, cw, bodyH);

      // Pulse on new bar
      if (this.pulseAnim && this.pulseAnim.barIdx === i) {
        const pt = (performance.now() - this.pulseAnim.startTime) / this.pulseAnim.duration;
        if (pt < 1) {
          ctx.fillStyle = `rgba(67,97,238,${0.25 * (1 - pt)})`;
          ctx.fillRect(x - cw / 2 - 2, 0, cw + 4, h);
        }
      }
    }

    // MA lines
    if (this.opts.showMA) {
      for (let mi = 0; mi < this.maData.length; mi++) {
        const ma = this.maData[mi];
        ctx.strokeStyle = COLOR.ma[mi % COLOR.ma.length];
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        for (let i = visStart; i < visEnd && i < ma.length; i++) {
          const v = ma[i];
          if (v == null) { started = false; continue; }
          const x = this.xOf(i, xOff);
          const y = this.yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // BOLL
    if (this.opts.showBOLL && this.bollData) {
      const drawLine = (arr: (number | null)[], color: string, fill?: boolean) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let i = visStart; i < visEnd && i < arr.length; i++) {
          const v = arr[i];
          if (v == null) { started = false; continue; }
          const x = this.xOf(i, xOff);
          const y = this.yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      drawLine(this.bollData.upper, COLOR.boll.upper);
      drawLine(this.bollData.lower, COLOR.boll.lower);
      drawLine(this.bollData.mid, COLOR.boll.mid);
    }

    // Trade markers
    this.drawTradeMarkers(ctx, xOff);

    // Flash effects
    this.drawFlashes(ctx, xOff, cw);

    // Price labels
    ctx.fillStyle = COLOR.textDim;
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const price = this.priceRange.max - (this.priceRange.max - this.priceRange.min) * i / 4;
      ctx.fillText(price.toFixed(2), w - 4, (h / 4) * i + 12);
    }

    // Date labels (按周期格式化)
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(this.viewBars / 8));
    const fmtDate = (d: string): string => {
      if (this.period === 'monthly') return d.slice(0, 7);      // YYYY-MM
      if (this.period === 'weekly') return d.slice(2, 7);        // YY-MM
      return d.slice(5);                                         // MM-DD
    };
    for (let i = visStart; i < visEnd; i += labelStep) {
      if (i < this.bars.length) {
        const x = this.xOf(i, xOff);
        ctx.fillText(fmtDate(this.bars[i].date), x, h - 4);
      }
    }
  }

  private drawVolume() {
    const ctx = this.ctxs['vol-canvas'];
    if (!ctx) return;
    const w = this.mainW();
    const canvas = this.canvases['vol-canvas'];
    const h = canvas ? canvas.height / this.dpr : 0;
    ctx.clearRect(0, 0, w, h);
    if (!this.opts.showVol) return;

    // baseline + 标签
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
    ctx.fillStyle = COLOR.textDim;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', 6, 12);

    const { visStart, visEnd, xOff } = this.getView();
    const slot = w / this.viewBars;
    const cw = slot * 0.7;

    for (let i = visStart; i < visEnd && i < this.bars.length; i++) {
      const b = this.bars[i];
      const x = this.xOf(i, xOff);
      const isUp = b.close >= b.open;
      const vh = (b.volume / this.volMax) * h * 0.82;
      ctx.fillStyle = isUp ? 'rgba(239,68,68,.55)' : 'rgba(34,197,94,.55)';
      ctx.fillRect(x - cw / 2, h - vh, cw, vh);
    }
  }

  private drawMACD() {
    const ctx = this.ctxs['macd-canvas'];
    if (!ctx || !this.macdData) return;
    const w = this.mainW();
    const canvas = this.canvases['macd-canvas'];
    const h = canvas ? canvas.height / this.dpr : 0;
    ctx.clearRect(0, 0, w, h);
    const { visStart, visEnd, xOff } = this.getView();
    ctx.fillStyle = COLOR.textDim;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('MACD(12,26,9)', 6, 12);
    const hist = this.macdData.hist;
    const all = [...hist, ...this.macdData.dif, ...this.macdData.dea];
    const vmin = Math.min(...all), vmax = Math.max(...all);
    const range = vmax - vmin || 1;
    const zeroY = h - ((0 - vmin) / range) * h;

    // Histogram
    for (let i = visStart; i < visEnd && i < hist.length; i++) {
      const v = hist[i];
      const x = this.xOf(i, xOff);
      const y = h - ((v - vmin) / range) * h;
      ctx.fillStyle = v >= 0 ? 'rgba(239,68,68,.5)' : 'rgba(34,197,94,.5)';
      ctx.fillRect(x - 2, Math.min(y, zeroY), 4, Math.abs(y - zeroY));
    }
    // DIF + DEA
    const drawLine = (arr: number[], color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      let started = false;
      for (let i = visStart; i < visEnd && i < arr.length; i++) {
        const x = this.xOf(i, xOff);
        const y = h - ((arr[i] - vmin) / range) * h;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawLine(this.macdData.dif, COLOR.macd.dif);
    drawLine(this.macdData.dea, COLOR.macd.dea);
  }

  private drawKDJ() {
    const ctx = this.ctxs['kdj-canvas'];
    if (!ctx || !this.kdjData) return;
    const w = this.mainW();
    const canvas = this.canvases['kdj-canvas'];
    const h = canvas ? canvas.height / this.dpr : 0;
    ctx.clearRect(0, 0, w, h);
    const { visStart, visEnd, xOff } = this.getView();
    ctx.fillStyle = COLOR.textDim;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('KDJ(9,3,3)', 6, 12);
    const drawLine = (arr: number[], color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      let started = false;
      for (let i = visStart; i < visEnd && i < arr.length; i++) {
        const x = this.xOf(i, xOff);
        const y = h - (arr[i] / 100) * h;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawLine(this.kdjData.k, COLOR.kdj.k);
    drawLine(this.kdjData.d, COLOR.kdj.d);
    drawLine(this.kdjData.j, COLOR.kdj.j);
  }

  private drawRSI() {
    const ctx = this.ctxs['rsi-canvas'];
    if (!ctx || !this.rsiData) return;
    const w = this.mainW();
    const canvas = this.canvases['rsi-canvas'];
    const h = canvas ? canvas.height / this.dpr : 0;
    ctx.clearRect(0, 0, w, h);
    const { visStart, visEnd, xOff } = this.getView();
    ctx.fillStyle = COLOR.textDim;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('RSI(6)', 6, 12);
    ctx.strokeStyle = COLOR.rsi; ctx.lineWidth = 1; ctx.beginPath();
    let started = false;
    for (let i = visStart; i < visEnd && i < this.rsiData.length; i++) {
      const x = this.xOf(i, xOff);
      const y = h - (this.rsiData[i] / 100) * h;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawCrosshair() {
    const ctx = this.ctxs['crosshair'];
    if (!ctx) return;
    const w = this.mainW(), h = this.mainH();
    ctx.clearRect(0, 0, w, h);
    if (this.crossIdx < 0 || this.crossIdx >= this.progressCount) return;

    const { xOff } = this.getView();
    const x = this.xOf(this.crossIdx, xOff);

    // Vertical line
    ctx.strokeStyle = COLOR.cross;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.setLineDash([]);

    // Tooltip
    if (this.crossIdx < this.bars.length) {
      const b = this.bars[this.crossIdx];
      const lines = [
        b.date,
        `开 ${b.open.toFixed(2)}`,
        `高 ${b.high.toFixed(2)}`,
        `低 ${b.low.toFixed(2)}`,
        `收 ${b.close.toFixed(2)}`,
        `量 ${(b.volume / 1e4).toFixed(0)}万`,
      ];
      ctx.font = '11px system-ui';
      const tw = 90, th = lines.length * 16 + 8;
      let tx = x + 10;
      if (tx + tw > w) tx = x - tw - 10;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.strokeStyle = COLOR.gridStrong;
      ctx.fillRect(tx, 4, tw, th);
      ctx.strokeRect(tx, 4, tw, th);
      ctx.fillStyle = COLOR.textBright;
      ctx.textAlign = 'left';
      lines.forEach((line, i) => ctx.fillText(line, tx + 6, 18 + i * 16));
    }
  }

  private drawTradeMarkers(ctx: CanvasRenderingContext2D, xOff: number) {
    for (const t of this.tradeList) {
      if (t.index < 0 || t.index >= this.bars.length) continue;
      const { visStart, visEnd } = this.getView();
      if (t.index < visStart || t.index >= visEnd) continue;
      const x = this.xOf(t.index, xOff);
      const y = this.yOf(t.price);
      const isBuy = t.action === 'buy';
      const color = isBuy ? COLOR.up : COLOR.down;
      // Triangle
      ctx.fillStyle = color;
      ctx.beginPath();
      if (isBuy) {
        ctx.moveTo(x, y + 14);
        ctx.lineTo(x - 5, y + 22);
        ctx.lineTo(x + 5, y + 22);
      } else {
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x - 5, y - 22);
        ctx.lineTo(x + 5, y - 22);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Active position cost line
    if (this.activePosition && !this.reviewMode) {
      const y = this.yOf(this.activePosition.entryPrice);
      ctx.strokeStyle = 'rgba(67,97,238,.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mainW(), y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#4361ee';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('成本 ' + this.activePosition.entryPrice.toFixed(2), 4, y - 4);
    }
  }

  private drawFlashes(ctx: CanvasRenderingContext2D, xOff: number, cw: number) {
    const now = performance.now();
    this.flashEffects = this.flashEffects.filter(f => now - f.startTime < f.duration);
    for (const f of this.flashEffects) {
      const t = (now - f.startTime) / f.duration;
      const x = this.xOf(f.barIdx, xOff);
      const y = this.yOf(f.price);
      const r = 8 + t * 20;
      const alpha = 0.5 * (1 - t);
      ctx.strokeStyle = f.type === 'buy' ? `rgba(239,68,68,${alpha})` : `rgba(34,197,94,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- Drawing tools ----
  private drawAllDrawings() {
    const ctx = this.ctxs['crosshair'];
    if (!ctx) return;
    for (let i = 0; i < this.drawTools.length; i++) {
      this.drawOneDrawing(ctx, this.drawTools[i], i === this.selectedDraw);
    }
    if (this.draft) this.drawDraft(ctx);
  }

  private drawOneDrawing(ctx: CanvasRenderingContext2D, d: Drawing, selected: boolean) {
    const cfg = DRAW_TOOLS_CFG[d.tool];
    if (!cfg) return;
    const color = d.color || cfg.color;
    const p1 = this.dataToXY(d.p1.bi, d.p1.price);
    const p2 = this.dataToXY(d.p2.bi, d.p2.price);

    // Glow underlayer
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 4;
    ctx.beginPath();
    this.drawToolStroke(ctx, d.tool, p1, p2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Main line
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.beginPath();
    this.drawToolStroke(ctx, d.tool, p1, p2);
    ctx.stroke();

    // Fib levels
    if (d.tool === 'fib') {
      const dy = p2.y - p1.y;
      for (const lvl of FIB_LEVELS) {
        const y = p1.y + dy * lvl;
        ctx.strokeStyle = `rgba(245,158,11,${0.3 + lvl * 0.4})`;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mainW(), y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOR.textDim;
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText((lvl * 100).toFixed(1) + '%', 4, y - 2);
      }
    }

    // Handles
    if (selected) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (const p of [p1, p2]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawToolStroke(ctx: CanvasRenderingContext2D, tool: string, p1: { x: number; y: number }, p2: { x: number; y: number }) {
    ctx.moveTo(p1.x, p1.y);
    if (tool === 'h') { ctx.lineTo(this.mainW(), p1.y); return; }
    if (tool === 'ray') {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const farX = p1.x + dx / len * this.mainW();
      const farY = p1.y + dy / len * this.mainW();
      ctx.lineTo(farX, farY);
      return;
    }
    ctx.lineTo(p2.x, p2.y);
  }

  private drawDraft(ctx: CanvasRenderingContext2D) {
    if (!this.draft || this.draft.pts.length < 1) return;
    const cfg = DRAW_TOOLS_CFG[this.draft.type];
    if (!cfg) return;
    const p1 = this.dataToXY(this.draft.pts[0].bi, this.draft.pts[0].price);
    const p2 = this.draft.pts.length > 1 ? this.dataToXY(this.draft.pts[1].bi, this.draft.pts[1].price) : p1;
    ctx.strokeStyle = cfg.color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    this.drawToolStroke(ctx, this.draft.type, p1, p2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ---- Hit testing ----
  private hitTestDrawings(mx: number, my: number): number {
    for (let i = this.drawTools.length - 1; i >= 0; i--) {
      const d = this.drawTools[i];
      const p1 = this.dataToXY(d.p1.bi, d.p1.price);
      const p2 = this.dataToXY(d.p2.bi, d.p2.price);
      // Handle hit (radius 9)
      if (Math.hypot(mx - p1.x, my - p1.y) < 9) return i;
      if (Math.hypot(mx - p2.x, my - p2.y) < 9) return i;
      // Line distance
      const dist = this.distToSeg(mx, my, p1.x, p1.y, p2.x, p2.y);
      if (dist < 7) return i;
    }
    return -1;
  }

  private distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    const len = dx * dx + dy * dy;
    if (len === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ---- Event handling ----
  private bindEvents() {
    const mc = this.canvases['kline-canvas'];
    if (!mc) return;
    mc.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onWindowMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    mc.addEventListener('wheel', this.onWheel, { passive: false });
    mc.addEventListener('dblclick', this.onDblClick);
    mc.addEventListener('mouseleave', this.onMouseLeave);
    // Touch (mobile)
    mc.addEventListener('touchstart', this.onTouchStart, { passive: false } as any);
    mc.addEventListener('touchmove', this.onTouchMove, { passive: false } as any);
    mc.addEventListener('touchend', this.onTouchEnd);
    mc.addEventListener('touchcancel', this.onTouchEnd);
  }

  private onMouseDown = (e: MouseEvent) => {
    const rect = this.canvases['kline-canvas'].getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (this.activeTool === 'cursor') {
      // Check if clicking on a drawing handle
      const hit = this.hitTestDrawings(mx, my);
      if (hit >= 0) {
        this.selectedDraw = hit;
        const d = this.drawTools[hit];
        this.editDrag = { idx: hit, startBi: d.p1.bi, startPrice: d.p1.price, startBi2: d.p2.bi, startPrice2: d.p2.price, startMX: mx, startMY: my };
        this.draw();
        return;
      }
      this.selectedDraw = -1;
      // Start panning
      this.isDragging = true;
      this.dragStartX = mx;
      this.dragStartViewStart = this.viewStart;
      this.dragState = { lastX: mx, lastT: performance.now(), vels: [] };
      this.momentum = null;
    } else {
      // Start drawing
      const { bi, price } = this.screenToData(e.clientX, e.clientY);
      if (this.draft && this.draft.stage === 1 && this.draft.type === 'channel') {
        // Complete channel
        this.draft.pts.push({ bi, price });
        this.drawTools.push({ tool: this.draft.type, p1: this.draft.pts[0], p2: this.draft.pts[1] });
        this.draft = null;
        this.saveDrawingsThrottled();
        this.setActiveTool('cursor');
      } else {
        this.draft = { type: this.activeTool, pts: [{ bi, price }], stage: 0, price };
      }
      this.draw();
    }
  };

  private onWindowMouseMove = (e: MouseEvent) => {
    const rect = this.canvases['kline-canvas']?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Crosshair
    if (!this.isDragging && this.activeTool === 'cursor' && !this.editDrag) {
      const { bi } = this.screenToData(e.clientX, e.clientY);
      this.crossIdx = bi;
      this.drawCrosshair();
    }

    // Editing drawing
    if (this.editDrag) {
      const d = this.drawTools[this.editDrag.idx];
      if (!d) { this.editDrag = null; return; }
      const dx = mx - this.editDrag.startMX;
      const slot = this.mainW() / this.viewBars;
      const dbi = dx / slot;
      const { min, max } = this.priceRange;
      const dprice = (my - this.editDrag.startMY) / this.mainH() * (max - min);
      d.p1 = { bi: this.editDrag.startBi + dbi, price: this.editDrag.startPrice + dprice };
      d.p2 = { bi: this.editDrag.startBi2 + dbi, price: this.editDrag.startPrice2 + dprice };
      this.saveDrawingsThrottled();
      this.draw();
      return;
    }

    // Drawing draft
    if (this.draft && this.draft.stage === 0) {
      const { bi, price } = this.screenToData(e.clientX, e.clientY);
      this.draft.pts = [this.draft.pts[0], { bi, price }];
      this.draw();
      return;
    }

    // Panning
    if (this.isDragging) {
      const dx = mx - this.dragStartX;
      const slot = this.mainW() / this.viewBars;
      const dBars = -dx / slot;
      const maxStart = Math.max(0, this.progressCount - this.viewBars);
      this.viewStart = this.clampSoft(this.dragStartViewStart + dBars, 0, maxStart);
      this.autoFollow = (this.viewStart + this.viewBars >= this.progressCount);

      // Velocity sampling
      const now = performance.now();
      if (this.dragState) {
        this.dragState.vels.push({ x: mx, t: now });
        if (this.dragState.vels.length > 5) this.dragState.vels.shift();
      }
      this.computeRanges();
      this.draw();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.isDragging) {
      this.isDragging = false;
      // Compute momentum from velocity samples
      if (this.dragState && this.dragState.vels.length >= 2) {
        const vels = this.dragState.vels;
        const last = vels[vels.length - 1];
        const prev = vels[vels.length - 2];
        const dt = last.t - prev.t;
        if (dt > 0) {
          const slot = this.mainW() / this.viewBars;
          const v = (last.x - prev.x) / dt / slot; // bars per ms
          if (Math.abs(v) > 0.005) {
            this.momentum = { v, lastT: performance.now() };
            this.ensureAnimLoop();
          }
        }
      }
      this.dragState = null;
      // Snap to integer if no momentum
      if (!this.momentum) {
        this.viewStart = Math.round(this.viewStart);
        this.clampView();
        this.draw();
      }
    }

    // Finish draft
    if (this.draft && this.draft.stage === 0 && this.draft.pts.length > 1) {
      if (this.draft.type === 'channel') {
        this.draft.stage = 1; // wait for second click
      } else {
        this.drawTools.push({ tool: this.draft.type, p1: this.draft.pts[0], p2: this.draft.pts[1] });
        this.draft = null;
        this.saveDrawingsThrottled();
        this.setActiveTool('cursor');
      }
    }
    this.editDrag = null;
  };

  // ---- Touch handling (mobile) ----
  private touchDist(e: TouchEvent): number {
    const a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private onTouchStart = (e: TouchEvent) => {
    const mc = this.canvases['kline-canvas'];
    if (!mc) return;
    if (e.touches.length === 2) {
      this.isDragging = false;
      this.pinchStartDist = this.touchDist(e);
      this.pinchStartBars = this.viewBars;
      e.preventDefault();
      return;
    }
    if (e.touches.length !== 1) return;
    const rect = mc.getBoundingClientRect();
    const t = e.touches[0];
    const mx = t.clientX - rect.left;
    const my = t.clientY - rect.top;
    if (this.activeTool !== 'cursor') {
      const { bi, price } = this.screenToData(t.clientX, t.clientY);
      this.draft = { type: this.activeTool, pts: [{ bi, price }], stage: 0, price };
      this.draw();
      return;
    }
    this.isDragging = true;
    this.dragStartX = mx;
    this.dragStartViewStart = this.viewStart;
    this.dragState = { lastX: mx, lastT: performance.now(), vels: [] };
    this.momentum = null;
  };

  private onTouchMove = (e: TouchEvent) => {
    const mc = this.canvases['kline-canvas'];
    if (!mc) return;
    if (e.touches.length === 2) {
      const dist = this.touchDist(e);
      if (this.pinchStartDist > 0) {
        const ratio = this.pinchStartDist / dist;
        this.viewBars = Math.max(20, Math.min(240, this.pinchStartBars * ratio));
        this.clampView();
        this.draw();
      }
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1 && this.draft && this.draft.stage === 0) {
      const t = e.touches[0];
      const { bi, price } = this.screenToData(t.clientX, t.clientY);
      this.draft.pts = [this.draft.pts[0], { bi, price }];
      this.draw();
      e.preventDefault();
      return;
    }
    if (e.touches.length !== 1 || !this.isDragging) return;
    const rect = mc.getBoundingClientRect();
    const t = e.touches[0];
    const mx = t.clientX - rect.left;
    const dx = mx - this.dragStartX;
    const slot = this.mainW() / this.viewBars;
    const dBars = -dx / slot;
    const maxStart = Math.max(0, this.progressCount - this.viewBars);
    this.viewStart = this.clampSoft(this.dragStartViewStart + dBars, 0, maxStart);
    this.autoFollow = (this.viewStart + this.viewBars >= this.progressCount);
    if (this.dragState) {
      this.dragState.vels.push({ x: mx, t: performance.now() });
      if (this.dragState.vels.length > 5) this.dragState.vels.shift();
    }
    this.computeRanges();
    this.draw();
    e.preventDefault();
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (this.draft && this.draft.pts.length > 1) {
      this.drawTools.push({ tool: this.draft.type, p1: this.draft.pts[0], p2: this.draft.pts[1] });
      this.draft = null;
      this.saveDrawingsThrottled();
      this.setActiveTool('cursor');
    }
    this.isDragging = false;
    this.dragState = null;
    this.pinchStartDist = 0;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.canvases['kline-canvas'].getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const delta = e.deltaY > 0 ? 1.15 : 0.87;
    this.animateZoom(this.viewBars * delta, ratio);
  };

  private onDblClick = (e: MouseEvent) => {
    const rect = this.canvases['kline-canvas'].getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = this.hitTestDrawings(mx, my);
    if (hit >= 0) {
      this.drawTools.splice(hit, 1);
      this.selectedDraw = -1;
      this.saveDrawingsNow();
      this.draw();
    }
  };

  private onMouseLeave = () => {
    if (!this.isDragging) {
      this.crossIdx = -1;
      this.drawCrosshair();
    }
  };

  // Zoom by API
  zoomBy(factor: number) {
    this.animateZoom(this.viewBars * factor, 0.5);
  }
  resetView() {
    this.viewBars = 60;
    this.viewStart = Math.max(0, this.progressCount - this.viewBars);
    this.clampView();
    this.draw();
  }

  // ---- Animation loop ----
  private startPulse(barIdx: number) {
    this.pulseAnim = { barIdx, startTime: performance.now(), duration: 600 };
    this.ensureAnimLoop();
  }

  private animateZoom(toBars: number, anchorRatio: number) {
    toBars = Math.max(8, Math.min(300, Math.round(toBars)));
    const fromBars = this.viewBars, fromStart = this.viewStart;
    if (Math.abs(toBars - fromBars) < 0.5) return;
    const max = Math.max(1, this.progressCount);
    const ratio = Math.max(0, Math.min(1, anchorRatio));
    const anchorIdx = fromStart + ratio * fromBars;
    let toStart = anchorIdx - ratio * toBars;
    toStart = Math.max(0, Math.min(toStart, Math.max(0, max - toBars)));
    this.zoomAnim = { t0: performance.now(), dur: 220, fromBars, fromStart, toBars, toStart };
    this.ensureAnimLoop();
  }

  private ensureAnimLoop() {
    if (this.animRAF !== null) return;
    const tick = () => {
      const now = performance.now();
      let hasActive = false;

      // Flash effects
      this.flashEffects = this.flashEffects.filter(f => now - f.startTime < f.duration);
      if (this.flashEffects.length > 0) hasActive = true;

      // Slide anim
      if (this.slideAnim) {
        if ((now - this.slideAnim.startTime) / this.slideAnim.duration >= 1) this.slideAnim = null;
        else hasActive = true;
      }

      // Pulse
      if (this.pulseAnim) {
        if ((now - this.pulseAnim.startTime) / this.pulseAnim.duration >= 1) this.pulseAnim = null;
        else hasActive = true;
      }

      // Momentum
      if (this.momentum) {
        const dt = Math.min(64, now - this.momentum.lastT);
        this.momentum.lastT = now;
        const maxV = Math.max(1, this.progressCount) - this.viewBars;
        let next = this.viewStart + this.momentum.v * dt;
        this.momentum.v *= Math.pow(0.93, dt / 16);
        if (next < 0) { next = next * 0.4; this.momentum.v *= 0.5; }
        if (next > maxV) { next = maxV + (next - maxV) * 0.4; this.momentum.v *= 0.5; }
        if (Math.abs(this.momentum.v) < 0.002) {
          this.momentum = null;
          this.viewStart = Math.round(this.viewStart);
          this.clampView();
        } else {
          this.viewStart = next;
        }
        this.autoFollow = (this.viewStart + this.viewBars >= this.progressCount);
        this.computeRanges();
        hasActive = true;
      }

      // Zoom anim
      if (this.zoomAnim) {
        const t = (now - this.zoomAnim.t0) / this.zoomAnim.dur;
        if (t >= 1) {
          this.viewBars = this.zoomAnim.toBars;
          this.viewStart = this.zoomAnim.toStart;
          this.zoomAnim = null;
        } else {
          const e = easeOutCubic(t);
          this.viewBars = this.zoomAnim.fromBars + (this.zoomAnim.toBars - this.zoomAnim.fromBars) * e;
          this.viewStart = this.zoomAnim.fromStart + (this.zoomAnim.toStart - this.zoomAnim.fromStart) * e;
          hasActive = true;
        }
        this.clampView();
        this.computeRanges();
      }

      this.draw();

      if (hasActive) {
        this.animRAF = requestAnimationFrame(tick);
      } else {
        this.animRAF = null;
      }
    };
    this.animRAF = requestAnimationFrame(tick);
  }

  // Toggle indicators
  toggleMA(v?: boolean) { this.opts.showMA = v ?? !this.opts.showMA; this.draw(); }
  toggleVol(v?: boolean) { this.opts.showVol = v ?? !this.opts.showVol; this.applyLayout(); }
  toggleMACD(v?: boolean) { this.opts.showMACD = v ?? !this.opts.showMACD; this.applyLayout(); }
  toggleKDJ(v?: boolean) { this.opts.showKDJ = v ?? !this.opts.showKDJ; this.applyLayout(); }
  toggleRSI(v?: boolean) { this.opts.showRSI = v ?? !this.opts.showRSI; this.applyLayout(); }
  toggleBOLL(v?: boolean) { this.opts.showBOLL = v ?? !this.opts.showBOLL; this.draw(); }

  getOpts() { return this.opts; }
}

// Singleton
export const chart = new ChartEngine();
if (typeof window !== 'undefined') (window as any).__chart = chart;
