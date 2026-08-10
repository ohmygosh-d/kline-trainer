/* ===== chart.js · K线绘制引擎 (v6) =====
 * 明亮配色、日线级别进度
 */
(function (global) {
  'use strict';

  var COLOR = {
    up: '#ef4444', upFill: '#ef4444',
    down: '#22c55e', downFill: '#22c55e',
    flat: '#94a3b8',
    ma: ['#f59e0b', '#3b82f6', '#f97316', '#8b5cf6'],
    boll: { mid: '#f59e0b', upper: 'rgba(59,130,246,.45)', lower: 'rgba(59,130,246,.45)' },
    kdj: { k: '#f59e0b', d: '#3b82f6', j: '#f97316' },
    rsi: '#8b5cf6',
    macd: { dif: '#3b82f6', dea: '#f59e0b' },
    grid: 'rgba(0,0,0,.06)',
    gridStrong: 'rgba(0,0,0,.1)',
    text: '#94a3b8',
    textBright: '#334155',
    cross: 'rgba(148,163,184,.5)',
    zoneBg: 'rgba(0,0,0,.02)',
    bg: '#f8fafc'
  };

  var mainCanvas, volCanvas, macdCanvas, kdjCanvas, rsiCanvas, crossCanvas;
  var mctx, vctx, dctx, kctx, rctx, xctx;
  var bars = [];
  var trainStartIdx = 0, trainEndIdx = 0;
  var reviewMode = false;

  var progressCount = 0;
  var viewStart = 0, viewBars = 60;
  var autoFollow = true;

  var opts = {
    showMA: true, showVol: true,
    showMACD: false, showKDJ: false, showRSI: false, showBOLL: false,
    maPeriods: [5, 10, 20]
  };

  var maData = [];
  var macdData = null;
  var kdjData = null;
  var rsiData = null;
  var bollData = null;

  var crossIdx = -1;
  var dpr = 1;
  var priceRange = { min: 0, max: 0 };
  var volMax = 0;

  // 交易标记
  var tradeList = [];
  var activePosition = null;

  var isDragging = false, dragStartX = 0, dragStartViewStart = 0;
  var touchMode = null, pinchStartDist = 0, pinchStartViewBars = 0;
  var touchStartX = 0, touchStartViewStart = 0;

  // ---------- 工具 ----------
  function setupCanvas(canvas) {
    if (!canvas) return null;
    var parent = canvas.parentElement;
    var rect = parent.getBoundingClientRect();
    var d = window.devicePixelRatio || 1;
    dpr = d;
    canvas.width = Math.max(1, Math.round(rect.width * d));
    canvas.height = Math.max(1, Math.round(rect.height * d));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx: ctx, w: rect.width, h: rect.height };
  }

  function fmt(n) {
    if (n >= 100000000) return (n / 100000000).toFixed(2) + '\u4ebf';
    if (n >= 10000) return (n / 10000).toFixed(2) + '\u4e07';
    return n.toFixed(2);
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return parts[1] + '-' + parts[2];
  }

  function fmtDateLong(dateStr) { return dateStr || ''; }

  // ---------- 布局 ----------
  function getLayout() {
    var rect = mainCanvas.parentElement.getBoundingClientRect();
    return { w: rect.width, h: rect.height, padR: 62, padT: 8, padB: 24, padL: 8 };
  }

  function getSubLayout(canvasEl) {
    if (!canvasEl) return null;
    var parent = canvasEl.parentElement.getBoundingClientRect();
    return { w: parent.width, h: parent.height, padR: 62, padT: 6, padB: 6, padL: 8 };
  }

  function getDisplayCount() {
    return Math.min(viewBars, Math.max(0, progressCount - viewStart));
  }

  function xToIndex(x) {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var dc = getDisplayCount();
    if (dc === 0 || viewBars === 0) return -1;
    var cw = chartW / viewBars;
    var idx = Math.floor((x - layout.padL) / cw);
    if (idx < 0 || idx >= dc) return -1;
    return idx;
  }

  function indexToX(idx) {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var cw = chartW / viewBars;
    return layout.padL + cw * (idx + 0.5);
  }

  function priceToY(p, layout, range) {
    var chartH = layout.h - layout.padT - layout.padB;
    var ratio = (p - range.min) / (range.max - range.min || 1);
    return layout.padT + chartH * (1 - ratio);
  }

  // ---------- viewport ----------
  function getDefaultViewBars() {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    return Math.max(25, Math.min(120, Math.round(chartW / 8)));
  }

  function clampView() {
    // 视口边界用 bars.length 而非 progressCount，
    // 这样周线/月线聚合后即使历史K线较少也能自由缩放拖拽
    var max = Math.max(1, bars.length);
    viewBars = Math.max(8, Math.min(viewBars, 300));
    if (viewBars > max) viewBars = max;
    viewStart = Math.max(0, Math.min(viewStart, max - viewBars));
  }

  function zoom(delta, centerX) {
    var oldViewBars = viewBars;
    viewBars = Math.max(8, Math.min(300, viewBars + delta));
    if (viewBars === oldViewBars) return;

    if (centerX !== undefined && centerX !== null) {
      var layout = getLayout();
      var chartW = layout.w - layout.padR - layout.padL;
      var ratio = chartW > 0 ? (centerX - layout.padL) / chartW : 0.5;
      var centerIdx = viewStart + ratio * oldViewBars;
      viewStart = Math.round(centerIdx - ratio * viewBars);
    }
    clampView();
    autoFollow = (viewStart + viewBars >= progressCount);
    computeRanges();
    draw();
  }

  function pan(deltaIdx) {
    var max = Math.max(1, progressCount);
    viewStart = Math.max(0, Math.min(viewStart + deltaIdx, max - viewBars));
    autoFollow = (viewStart + viewBars >= progressCount);
    computeRanges();
    draw();
  }

  function resetView() {
    viewBars = Math.min(getDefaultViewBars(), Math.max(1, bars.length));
    viewStart = Math.max(0, progressCount - viewBars);
    autoFollow = true;
    computeRanges();
    draw();
  }

  // ---------- 初始化 ----------
  function init() {
    mainCanvas = document.getElementById('kline-canvas');
    volCanvas = document.getElementById('volume-canvas');
    macdCanvas = document.getElementById('macd-canvas');
    kdjCanvas = document.getElementById('kdj-canvas');
    rsiCanvas = document.getElementById('rsi-canvas');
    crossCanvas = document.getElementById('crosshair');

    var m = setupCanvas(mainCanvas); if (m) mctx = m.ctx;
    var v = setupCanvas(volCanvas); if (v) vctx = v.ctx;
    var d = setupCanvas(macdCanvas); if (d) dctx = d.ctx;
    var k = setupCanvas(kdjCanvas); if (k) kctx = k.ctx;
    var r = setupCanvas(rsiCanvas); if (r) rctx = r.ctx;
    var x = setupCanvas(crossCanvas); if (x) xctx = x.ctx;

    if (crossCanvas) {
      crossCanvas.addEventListener('mousemove', onMouseMove);
      crossCanvas.addEventListener('mouseleave', function () { crossIdx = -1; drawCross(); });
      crossCanvas.addEventListener('wheel', onWheel, { passive: false });
      crossCanvas.addEventListener('mousedown', onMouseDown);
      crossCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
      crossCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
      crossCanvas.addEventListener('touchend', onTouchEnd);
    }
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onWindowMouseMove);
  }

  // ---------- 事件 ----------
  function onWheel(e) { e.preventDefault(); var rect = crossCanvas.getBoundingClientRect(); zoom(e.deltaY > 0 ? 6 : -6, e.clientX - rect.left); }
  function onMouseDown(e) { isDragging = true; dragStartX = e.clientX; dragStartViewStart = viewStart; crossCanvas.style.cursor = 'grabbing'; }
  function onMouseUp() { if (isDragging) { isDragging = false; if (crossCanvas) crossCanvas.style.cursor = 'crosshair'; } }

  function onWindowMouseMove(e) {
    if (!isDragging) return;
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var cw = chartW / viewBars;
    var dx = e.clientX - dragStartX;
    var deltaIdx = Math.round(-dx / cw);
    if (deltaIdx !== 0) {
      var newStart = dragStartViewStart + deltaIdx;
      var max = Math.max(1, progressCount);
      viewStart = Math.max(0, Math.min(newStart, max - viewBars));
      autoFollow = (viewStart + viewBars >= progressCount);
      crossIdx = -1;
      computeRanges(); draw();
    }
  }

  function onMouseMove(e) {
    if (isDragging) return;
    var rect = crossCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var idx = xToIndex(x);
    if (idx >= 0 && idx < getDisplayCount() && idx !== crossIdx) { crossIdx = idx; drawCross(); }
    else if ((idx < 0 || idx >= getDisplayCount()) && crossIdx !== -1) { crossIdx = -1; drawCross(); }
  }

  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) { touchMode = 'pan'; touchStartX = e.touches[0].clientX; touchStartViewStart = viewStart; }
    else if (e.touches.length === 2) { touchMode = 'pinch'; pinchStartDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX); pinchStartViewBars = viewBars; }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (touchMode === 'pan' && e.touches.length === 1) {
      var layout = getLayout(); var chartW = layout.w - layout.padR - layout.padL; var cw = chartW / viewBars;
      var dx = e.touches[0].clientX - touchStartX;
      var deltaIdx = Math.round(-dx / cw);
      var newStart = touchStartViewStart + deltaIdx;
      viewStart = Math.max(0, Math.min(newStart, Math.max(1, progressCount) - viewBars));
      autoFollow = (viewStart + viewBars >= progressCount);
      crossIdx = -1; computeRanges(); draw();
    } else if (touchMode === 'pinch' && e.touches.length === 2) {
      var dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      if (pinchStartDist > 0) {
        viewBars = Math.max(8, Math.min(300, Math.round(pinchStartViewBars * (pinchStartDist / dist))));
        clampView(); autoFollow = (viewStart + viewBars >= progressCount);
        computeRanges(); draw();
      }
    }
  }
  function onTouchEnd() { touchMode = null; }

  // ---------- 指标计算 ----------
  function recalcIndicators() {
    maData = opts.maPeriods.map(function (p) {
      return { period: p, data: global.Market.calcMA(bars, p) };
    });
    macdData = global.Market.calcMACD(bars);
    kdjData = global.Market.calcKDJ(bars);
    rsiData = global.Market.calcRSI(bars);
    bollData = global.Market.calcBOLL(bars);
  }

  // ---------- 数据设置 ----------
  function setData(b, trainStart, trainEnd) {
    bars = b || [];
    trainStartIdx = Math.max(0, trainStart || 0);
    trainEndIdx = trainEnd || 0;
    reviewMode = false;
    recalcIndicators();
    progressCount = Math.max(1, trainStartIdx);
    // 视口至少要能容纳 25 根K线的宽度，保证周线/月线也有缩放拖拽空间
    viewBars = Math.min(getDefaultViewBars(), Math.max(progressCount, 25, bars.length));
    viewStart = 0;  // 从最开始展示，确保历史K线可见
    autoFollow = true;
    computeRanges();
  }

  function setReviewMode(b) {
    reviewMode = b;
    progressCount = b ? bars.length : trainStartIdx;
    viewBars = Math.min(getDefaultViewBars(), Math.max(1, bars.length));

    if (b && trainStartIdx > 0 && trainEndIdx > 0) {
      // 复盘模式：定位到训练周期，训练起点在视口左 20% 处
      var desiredStart = Math.max(0, trainStartIdx - Math.round(viewBars * 0.2));
      viewStart = Math.min(desiredStart, Math.max(0, bars.length - viewBars));
    } else {
      viewStart = Math.max(0, progressCount - viewBars);
    }

    autoFollow = false;  // 复盘模式下不自动跟随最新K线
    clampView();
    computeRanges();
    draw();
  }

  function setProgress(n) {
    progressCount = Math.max(1, Math.min(n, bars.length));
    if (autoFollow) {
      // 自动跟踪：最新可见K线靠右
      viewStart = Math.max(0, progressCount - viewBars);
    }
    clampView();
    computeRanges();
  }

  function computeRanges() {
    var start = viewStart;
    var end = Math.min(viewStart + viewBars, progressCount);
    var vis = bars.slice(start, end);
    if (vis.length === 0) { priceRange = { min: 0, max: 1 }; volMax = 1; return; }
    var min = Infinity, max = -Infinity, vmax = 0;
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].low < min) min = vis[i].low;
      if (vis[i].high > max) max = vis[i].high;
      if (bollData && opts.showBOLL) {
        var bi = start + i;
        if (bollData.upper[bi] != null && bollData.upper[bi] > max) max = bollData.upper[bi];
        if (bollData.lower[bi] != null && bollData.lower[bi] < min) min = bollData.lower[bi];
      }
      if (vis[i].volume > vmax) vmax = vis[i].volume;
    }
    var pad = (max - min) * 0.08 || max * 0.02;
    priceRange = { min: min - pad, max: max + pad };
    volMax = vmax;
  }

  // ===== 交易标记 & 成本线 =====
  function setTradeMarkers(trades, pos) {
    tradeList = trades ? trades.slice() : [];
    activePosition = pos || null;
  }

  function drawTradeMarkers(layout, visStart, dc, cw, range) {
    var hasMarkers = tradeList.length > 0 || activePosition;
    if (!hasMarkers) return;

    var chartH = layout.h - layout.padT - layout.padB;
    var arrowHalf = 5;

    // --- 成本线（持仓中） ---
    if (activePosition && activePosition.cost > 0) {
      var costY = priceToY(activePosition.cost, layout, range);
      // 只有成本价在可视范围内才画
      if (costY > layout.padT && costY < layout.h - layout.padB) {
        mctx.strokeStyle = 'rgba(245,158,11,.7)';
        mctx.lineWidth = 1.5;
        mctx.setLineDash([6, 3]);
        mctx.beginPath();
        mctx.moveTo(layout.padL, costY);
        mctx.lineTo(layout.w - layout.padR, costY);
        mctx.stroke();
        mctx.setLineDash([]);

        // 成本标签
        mctx.fillStyle = '#d97706';
        mctx.font = 'bold 10px -apple-system,"Microsoft YaHei",sans-serif';
        mctx.textAlign = 'left';
        mctx.textBaseline = costY < layout.padT + chartH / 2 ? 'bottom' : 'top';
        mctx.fillText('成本 ¥' + activePosition.cost.toFixed(2), layout.padL + 4, costY + (costY < layout.padT + chartH / 2 ? -3 : 3));
      }
    }

    // --- 交易标记点 ---
    for (var t = 0; t < tradeList.length; t++) {
      var trade = tradeList[t];
      var barIdx = trade.idx;  // 聚合K线索引
      if (barIdx < visStart || barIdx >= visStart + dc) continue;

      var bi = barIdx - visStart;
      var x = layout.padL + cw * (bi + 0.5);
      var bar = bars[barIdx];
      if (!bar) continue;

      if (trade.type === 'buy') {
        // 买入标记：绿色三角在 K 线下方
        var mY = priceToY(bar.low, layout, range) + 14;
        mctx.fillStyle = '#22c55e';
        mctx.strokeStyle = '#16a34a';
        mctx.lineWidth = 1.5;
        mctx.beginPath();
        mctx.moveTo(x, mY + arrowHalf);
        mctx.lineTo(x - arrowHalf, mY - arrowHalf);
        mctx.lineTo(x + arrowHalf, mY - arrowHalf);
        mctx.closePath();
        mctx.fill();
        mctx.stroke();

        // 买入价格标签
        mctx.fillStyle = '#16a34a';
        mctx.font = 'bold 9px -apple-system,"Microsoft YaHei",sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'top';
        mctx.fillText('¥' + trade.price.toFixed(2), x, mY + arrowHalf + 2);
      } else if (trade.type === 'sell') {
        // 卖出标记：红色三角在 K 线上方
        var sY = priceToY(bar.high, layout, range) - 14;
        mctx.fillStyle = '#ef4444';
        mctx.strokeStyle = '#dc2626';
        mctx.lineWidth = 1.5;
        mctx.beginPath();
        mctx.moveTo(x, sY - arrowHalf);
        mctx.lineTo(x - arrowHalf, sY + arrowHalf);
        mctx.lineTo(x + arrowHalf, sY + arrowHalf);
        mctx.closePath();
        mctx.fill();
        mctx.stroke();

        // 卖出盈亏标签
        var pnlLabel = trade.pnl !== undefined ? ((trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(0)) : '';
        mctx.fillStyle = trade.pnl >= 0 ? '#16a34a' : '#dc2626';
        mctx.font = 'bold 9px -apple-system,"Microsoft YaHei",sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'bottom';
        mctx.fillText((pnlLabel ? pnlLabel + ' ' : '') + '¥' + trade.price.toFixed(2), x, sY - arrowHalf - 2);
      }
    }
  }

  // ---------- 主绘制 ----------
  function draw() {
    drawMain();
    if (opts.showVol) drawVolume();
    if (opts.showMACD) drawMACDPanel();
    if (opts.showKDJ) drawKDJPanel();
    if (opts.showRSI) drawRSIPanel();
    drawCross();
  }

  // ===== 主K线图 =====
  function drawMain() {
    if (!mctx) return;
    var layout = getLayout();
    var w = layout.w, h = layout.h;
    mctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    var visStart = viewStart;
    var visEnd = Math.min(viewStart + viewBars, progressCount);
    var vis = bars.slice(visStart, visEnd);
    var dc = vis.length;
    if (dc === 0) return;

    var range = priceRange;
    var chartW = w - layout.padR - layout.padL;
    var chartH = h - layout.padT - layout.padB;
    var cw = chartW / viewBars;
    var bodyW = Math.max(1, cw * 0.7);

    // 背景填充
    mctx.fillStyle = COLOR.bg;
    mctx.fillRect(0, 0, w, h);

    // 网格
    mctx.strokeStyle = COLOR.grid;
    mctx.lineWidth = 1;
    mctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
    mctx.fillStyle = COLOR.text;
    mctx.textAlign = 'left';
    mctx.textBaseline = 'middle';
    var steps = 5;
    for (var s = 0; s <= steps; s++) {
      var y = layout.padT + chartH * s / steps;
      var p = range.max - (range.max - range.min) * s / steps;
      mctx.beginPath();
      mctx.moveTo(layout.padL, y);
      mctx.lineTo(w - layout.padR, y);
      mctx.stroke();
      mctx.fillText(p.toFixed(2), w - layout.padR + 4, y);
    }

    // 训练区域背景（复盘中）
    if (reviewMode && trainStartIdx > 0 && trainEndIdx > 0) {
      var tStartX = -1, tEndX = -1;
      if (trainStartIdx >= visStart && trainStartIdx < visEnd) tStartX = layout.padL + cw * (trainStartIdx - visStart);
      if (trainEndIdx >= visStart && trainEndIdx < visEnd) tEndX = layout.padL + cw * (trainEndIdx - visStart);
      var shadeL = (tStartX >= 0) ? tStartX : (trainStartIdx < visStart ? layout.padL : -1);
      var shadeR = (tEndX >= 0) ? tEndX : (trainEndIdx > visEnd ? w - layout.padR : -1);
      if (shadeL >= 0 && shadeR >= 0 && shadeR > shadeL) {
        mctx.fillStyle = 'rgba(59,130,246,.06)';
        mctx.fillRect(shadeL, layout.padT, shadeR - shadeL, chartH);
      }
    }

    // BOLL 带
    if (opts.showBOLL && bollData) {
      mctx.fillStyle = 'rgba(59,130,246,.05)';
      mctx.beginPath();
      var bStarted = false;
      for (var bi = 0; bi < dc; bi++) {
        var barIdx = visStart + bi;
        var upperY = bollData.upper[barIdx] != null ? priceToY(bollData.upper[barIdx], layout, range) : null;
        var lowerY = bollData.lower[barIdx] != null ? priceToY(bollData.lower[barIdx], layout, range) : null;
        if (upperY == null || lowerY == null) { bStarted = false; continue; }
        var x = layout.padL + cw * (bi + 0.5);
        if (!bStarted) { mctx.moveTo(x, upperY); bStarted = true; }
        else mctx.lineTo(x, upperY);
      }
      if (bStarted) {
        for (bi = dc - 1; bi >= 0; bi--) {
          barIdx = visStart + bi;
          lowerY = bollData.lower[barIdx] != null ? priceToY(bollData.lower[barIdx], layout, range) : null;
          if (lowerY != null) mctx.lineTo(layout.padL + cw * (bi + 0.5), lowerY);
        }
        mctx.closePath(); mctx.fill();
      }
      drawLineOnMain(mctx, bollData.upper, visStart, dc, cw, layout, range, COLOR.boll.upper, 1);
      drawLineOnMain(mctx, bollData.mid, visStart, dc, cw, layout, range, COLOR.boll.mid, 1);
      drawLineOnMain(mctx, bollData.lower, visStart, dc, cw, layout, range, COLOR.boll.upper, 1);
    }

    // 蜡烛
    for (var i = 0; i < dc; i++) {
      var b = vis[i];
      var x = layout.padL + cw * (i + 0.5);
      var isUp = b.close >= b.open;
      var color = isUp ? COLOR.up : COLOR.down;
      var yOpen = priceToY(b.open, layout, range);
      var yClose = priceToY(b.close, layout, range);
      var yHigh = priceToY(b.high, layout, range);
      var yLow = priceToY(b.low, layout, range);

      mctx.strokeStyle = color;
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(x, yHigh);
      mctx.lineTo(x, yLow);
      mctx.stroke();

      var bodyTop = Math.min(yOpen, yClose);
      var bodyH = Math.max(1, Math.abs(yClose - yOpen));
      mctx.fillStyle = color;
      mctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);

      if (b.isLimitUp || b.isLimitDown) {
        mctx.fillStyle = b.isLimitUp ? COLOR.up : COLOR.down;
        mctx.font = '9px sans-serif';
        mctx.textAlign = 'center';
        mctx.fillText(b.isLimitUp ? '\u6da8\u505c' : '\u8dcc\u505c', x, yHigh - 8);
        mctx.textAlign = 'left';
      }
    }

    // MA线
    if (opts.showMA) {
      for (var m = 0; m < maData.length; m++) {
        var ma = maData[m];
        drawLineOnMain(mctx, ma.data, visStart, dc, cw, layout, range, COLOR.ma[m % COLOR.ma.length], 1.5);
      }
      var lx = layout.padL + 4;
      mctx.font = 'bold 10px sans-serif';
      mctx.textAlign = 'left'; mctx.textBaseline = 'top';
      for (m = 0; m < maData.length; m++) {
        ma = maData[m];
        var lastIdx = Math.min(visStart + dc - 1, progressCount - 1);
        var last = ma.data[lastIdx];
        if (last == null) continue;
        mctx.fillStyle = COLOR.ma[m % COLOR.ma.length];
        mctx.fillText('MA' + ma.period + ':' + last.toFixed(2), lx, layout.padT + 2);
        lx += mctx.measureText('MA' + ma.period + ':' + last.toFixed(2)).width + 10;
      }
      if (opts.showBOLL && bollData) {
        lx += 8;
        var bLast = bollData.mid[lastIdx];
        if (bLast != null) {
          mctx.fillStyle = COLOR.boll.mid;
          mctx.fillText('BOLL:' + bLast.toFixed(2), lx, layout.padT + 2);
        }
      }
    }

    // 训练起点/终点分隔线
    if (trainStartIdx > 0) {
      var sDate = null, eDate = null;
      if (trainStartIdx >= visStart && trainStartIdx < visEnd) {
        var dx = layout.padL + cw * (trainStartIdx - visStart);
        mctx.strokeStyle = 'rgba(245,158,11,.75)';
        mctx.lineWidth = 2;
        mctx.setLineDash([6, 3]);
        mctx.beginPath(); mctx.moveTo(dx, layout.padT); mctx.lineTo(dx, h - layout.padB); mctx.stroke();
        mctx.setLineDash([]);
        mctx.fillStyle = '#d97706';
        mctx.font = 'bold 11px sans-serif';
        mctx.textAlign = 'left'; mctx.textBaseline = 'top';
        mctx.fillText('\u25b6 \u8bad\u7ec3\u8d77\u70b9', dx + 5, layout.padT + 2);
        var sBar = bars[trainStartIdx];
        sDate = sBar && sBar.date ? sBar.date : '';
      }
      if (reviewMode && trainEndIdx > 0 && trainEndIdx >= visStart && trainEndIdx < visEnd) {
        var ex = layout.padL + cw * (trainEndIdx - visStart);
        mctx.strokeStyle = 'rgba(239,68,68,.75)';
        mctx.lineWidth = 2;
        mctx.setLineDash([6, 3]);
        mctx.beginPath(); mctx.moveTo(ex, layout.padT); mctx.lineTo(ex, h - layout.padB); mctx.stroke();
        mctx.setLineDash([]);
        mctx.fillStyle = '#dc2626';
        mctx.font = 'bold 11px sans-serif';
        mctx.textAlign = 'left';
        mctx.fillText('\u25c0 \u8bad\u7ec3\u7ed3\u675f', ex + 5, layout.padT + 2);
        var eBar = bars[Math.min(trainEndIdx - 1, bars.length - 1)];
        eDate = eBar && eBar.date ? eBar.date : '';
      }
      // 底部日期标签
      if (sDate) {
        mctx.font = '9px sans-serif'; mctx.fillStyle = 'rgba(217,119,6,.7)'; mctx.textAlign = 'center';
        mctx.fillText(sDate, layout.padL + cw * (trainStartIdx - visStart), h - layout.padB + 5);
      }
      if (eDate) {
        mctx.font = '9px sans-serif'; mctx.fillStyle = 'rgba(220,38,38,.7)'; mctx.textAlign = 'center';
        var eX = layout.padL + cw * (trainEndIdx - visStart);
        mctx.fillText(eDate, eX, h - layout.padB + 5);
      }
    }

    // 最新价标线
    if (progressCount > 0) {
      var lastBarIdx = progressCount - 1;
      if (lastBarIdx >= visStart && lastBarIdx < visEnd) {
        var lastBar = bars[lastBarIdx];
        var lpy = priceToY(lastBar.close, layout, range);
        mctx.strokeStyle = lastBar.close >= lastBar.open ? COLOR.up : COLOR.down;
        mctx.lineWidth = 1;
        mctx.setLineDash([3, 3]);
        mctx.beginPath();
        mctx.moveTo(layout.padL, lpy);
        mctx.lineTo(w - layout.padR, lpy);
        mctx.stroke();
        mctx.setLineDash([]);
      }
    }

    // 交易标记 + 成本线
    drawTradeMarkers(layout, visStart, dc, cw, range);

    // X轴日期
    mctx.fillStyle = COLOR.text;
    mctx.font = '10px sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'top';
    var labelCount = Math.min(6, dc);
    for (s = 0; s < labelCount; s++) {
      var idx2 = Math.floor(s * (dc - 1) / Math.max(1, labelCount - 1));
      var barIdx2 = visStart + idx2;
      if (barIdx2 >= bars.length) continue;
      var dx2 = layout.padL + cw * (idx2 + 0.5);
      mctx.fillText(fmtDate(bars[barIdx2].date || ('#' + (barIdx2 + 1))), dx2, h - layout.padB + 6);
    }

    // 视口指示器
    if (viewStart > 0 || viewStart + viewBars < progressCount) {
      var totalW = w - layout.padR - layout.padL;
      var trackY = h - 4;
      var trackW = Math.max(2, totalW * viewBars / progressCount);
      var trackX = layout.padL + totalW * viewStart / progressCount;
      mctx.fillStyle = 'rgba(59,130,246,.3)';
      mctx.fillRect(trackX, trackY, trackW, 2);
    }
  }

  function drawLineOnMain(ctx, data, visStart, dc, cw, layout, range, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < dc; i++) {
      var idx = visStart + i;
      if (data[idx] == null) { started = false; continue; }
      var x = layout.padL + cw * (i + 0.5);
      var y = priceToY(data[idx], layout, range);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ===== 通用：训练区间竖线（穿透子图） =====
  function drawTrainZoneLines(ctx, lay, visStart, dc, cw) {
    if (!reviewMode || trainStartIdx < 0 || trainEndIdx <= 0) return;
    var padT = lay.padT, h = lay.h, padB = lay.padB;
    if (trainStartIdx >= visStart && trainStartIdx < visStart + dc) {
      var sx = lay.padL + cw * (trainStartIdx - visStart);
      ctx.strokeStyle = 'rgba(245,158,11,.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, h - padB); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (trainEndIdx >= visStart && trainEndIdx < visStart + dc) {
      var ex = lay.padL + cw * (trainEndIdx - visStart);
      ctx.strokeStyle = 'rgba(239,68,68,.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(ex, padT); ctx.lineTo(ex, h - padB); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawSubGrid(ctx, lay, yLabels) {
    var w = lay.w, h = lay.h, padR = lay.padR, padT = lay.padT, padB = lay.padB, padL = lay.padL;
    var chartH = h - padT - padB;
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (yLabels) {
      for (var s = 0; s < yLabels.length; s++) {
        var pos = yLabels[s].pos;
        var label = yLabels[s].label;
        var y = padT + chartH * pos;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillText(label, w - padR + 4, y);
      }
    }
  }

  function drawSubLine(ctx, lay, data, visStart, dc, cw, dataMin, dataMax, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    var started = false;
    var chartH = lay.h - lay.padT - lay.padB;
    var range = dataMax - dataMin || 1;
    for (var i = 0; i < dc; i++) {
      var idx = visStart + i;
      if (data[idx] == null) { started = false; continue; }
      var x = lay.padL + cw * (i + 0.5);
      var y = lay.padT + chartH * (1 - (data[idx] - dataMin) / range);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawSubZone(ctx, lay, y1Pct, y2Pct, color) {
    var chartH = lay.h - lay.padT - lay.padB;
    var y1 = lay.padT + chartH * y1Pct;
    var y2 = lay.padT + chartH * y2Pct;
    ctx.fillStyle = color;
    ctx.fillRect(lay.padL, Math.min(y1, y2), lay.w - lay.padR - lay.padL, Math.abs(y2 - y1));
    ctx.strokeStyle = 'rgba(148,163,184,.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(lay.padL, y1); ctx.lineTo(lay.w - lay.padR, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lay.padL, y2); ctx.lineTo(lay.w - lay.padR, y2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ===== 成交量 =====
  function drawVolume() {
    if (!vctx) return;
    var lay = getSubLayout(volCanvas);
    if (!lay) return;
    var w = lay.w, h = lay.h, padR = lay.padR, padT = lay.padT, padB = lay.padB, padL = lay.padL;
    vctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    vctx.fillStyle = COLOR.bg;
    vctx.fillRect(0, 0, w, h);

    var visStart = viewStart;
    var visEnd = Math.min(viewStart + viewBars, progressCount);
    var vis = bars.slice(visStart, visEnd);
    var dc = vis.length;
    if (dc === 0) return;

    var chartW = w - padR - padL, chartH = h - padT - padB;
    var cw = chartW / viewBars, bodyW = Math.max(1, cw * 0.7), vmax = volMax || 1;

    vctx.strokeStyle = COLOR.grid; vctx.lineWidth = 1;
    vctx.beginPath(); vctx.moveTo(padL, padT + chartH / 2); vctx.lineTo(w - padR, padT + chartH / 2); vctx.stroke();
    vctx.fillStyle = COLOR.text; vctx.font = '10px sans-serif'; vctx.textAlign = 'left';
    vctx.fillText(fmt(vmax), w - padR + 4, padT + 8);

    for (var i = 0; i < dc; i++) {
      var b = vis[i];
      var x = padL + cw * (i + 0.5);
      var isUp = b.close >= b.open;
      var bh = (b.volume / vmax) * chartH;
      vctx.fillStyle = isUp ? COLOR.upFill : COLOR.downFill;
      vctx.globalAlpha = 0.7;
      vctx.fillRect(x - bodyW / 2, padT + chartH - bh, bodyW, bh);
    }
    vctx.globalAlpha = 1;
    drawTrainZoneLines(vctx, lay, visStart, dc, cw);
  }

  // ===== MACD =====
  function drawMACDPanel() {
    if (!dctx || !macdData) return;
    var lay = getSubLayout(macdCanvas);
    if (!lay) return;
    var w = lay.w, h = lay.h, padR = lay.padR, padT = lay.padT, padB = lay.padB, padL = lay.padL;
    dctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    dctx.fillStyle = COLOR.bg;
    dctx.fillRect(0, 0, w, h);

    var visStart = viewStart;
    var visEnd = Math.min(viewStart + viewBars, progressCount);
    var dc = visEnd - visStart;
    if (dc === 0) return;

    var chartW = w - padR - padL, chartH = h - padT - padB;
    var cw = chartW / viewBars, bodyW = Math.max(1, cw * 0.7);

    var mx = 0, mn = 0;
    for (var i = visStart; i < visEnd; i++) {
      mx = Math.max(mx, macdData.macd[i] || 0, macdData.dif[i] || 0, macdData.dea[i] || 0);
      mn = Math.min(mn, macdData.macd[i] || 0, macdData.dif[i] || 0, macdData.dea[i] || 0);
    }
    var absMax = Math.max(Math.abs(mx), Math.abs(mn), 0.01);
    var yMid = padT + chartH / 2;

    dctx.strokeStyle = COLOR.grid; dctx.lineWidth = 1;
    dctx.beginPath(); dctx.moveTo(padL, yMid); dctx.lineTo(w - padR, yMid); dctx.stroke();

    for (var i2 = 0; i2 < dc; i2++) {
      var barIdx = visStart + i2;
      var v = macdData.macd[barIdx] || 0;
      var x = padL + cw * (i2 + 0.5);
      var bh = (Math.abs(v) / absMax) * (chartH / 2);
      dctx.fillStyle = v >= 0 ? COLOR.up : COLOR.down;
      dctx.globalAlpha = 0.7;
      dctx.fillRect(x - bodyW / 2, v >= 0 ? yMid - bh : yMid, bodyW, bh);
    }
    dctx.globalAlpha = 1;

    drawSubLine(dctx, lay, macdData.dif, visStart, dc, cw, -absMax, absMax, COLOR.macd.dif, 1.2);
    drawSubLine(dctx, lay, macdData.dea, visStart, dc, cw, -absMax, absMax, COLOR.macd.dea, 1.2);

    dctx.fillStyle = COLOR.text; dctx.font = '10px sans-serif'; dctx.textAlign = 'left';
    dctx.fillText(absMax.toFixed(2), w - padR + 4, padT + 8);
    dctx.fillText((-absMax).toFixed(2), w - padR + 4, padT + chartH - 4);
    drawTrainZoneLines(dctx, lay, visStart, dc, cw);
  }

  // ===== KDJ =====
  function drawKDJPanel() {
    if (!kctx || !kdjData) return;
    var lay = getSubLayout(kdjCanvas);
    if (!lay) return;
    var w = lay.w, h = lay.h, padR = lay.padR, padT = lay.padT, padB = lay.padB, padL = lay.padL;
    kctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    kctx.fillStyle = COLOR.bg;
    kctx.fillRect(0, 0, w, h);

    var visStart = viewStart;
    var visEnd = Math.min(viewStart + viewBars, progressCount);
    var dc = visEnd - visStart;
    if (dc === 0) return;

    var chartW = w - padR - padL, cw = chartW / viewBars;

    drawSubZone(kctx, lay, 0.2, 0, 'rgba(34,197,94,.06)');
    drawSubZone(kctx, lay, 0.2, 0.8, 'rgba(239,68,68,.06)');

    var chartH = h - padT - padB;
    var gridLabels = [
      { pos: 0, label: '100' }, { pos: 0.2, label: '80' },
      { pos: 0.5, label: '50' }, { pos: 0.8, label: '20' }, { pos: 1, label: '0' }
    ];

    kctx.strokeStyle = COLOR.grid; kctx.lineWidth = 1;
    kctx.font = '10px sans-serif'; kctx.fillStyle = COLOR.text;
    kctx.textAlign = 'left'; kctx.textBaseline = 'middle';
    for (var g = 0; g < gridLabels.length; g++) {
      var gy = padT + chartH * gridLabels[g].pos;
      kctx.beginPath(); kctx.moveTo(padL, gy); kctx.lineTo(w - padR, gy); kctx.stroke();
      kctx.fillText(gridLabels[g].label, w - padR + 4, gy);
    }

    drawSubLine(kctx, lay, kdjData.k, visStart, dc, cw, 0, 100, COLOR.kdj.k, 1.2);
    drawSubLine(kctx, lay, kdjData.d, visStart, dc, cw, 0, 100, COLOR.kdj.d, 1.2);
    drawSubLine(kctx, lay, kdjData.j, visStart, dc, cw, 0, 100, COLOR.kdj.j, 1);
    drawTrainZoneLines(kctx, lay, visStart, dc, cw);
  }

  // ===== RSI =====
  function drawRSIPanel() {
    if (!rctx || !rsiData) return;
    var lay = getSubLayout(rsiCanvas);
    if (!lay) return;
    var w = lay.w, h = lay.h, padR = lay.padR, padT = lay.padT, padB = lay.padB, padL = lay.padL;
    rctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    rctx.fillStyle = COLOR.bg;
    rctx.fillRect(0, 0, w, h);

    var visStart = viewStart;
    var visEnd = Math.min(viewStart + viewBars, progressCount);
    var dc = visEnd - visStart;
    if (dc === 0) return;

    var chartW = w - padR - padL, cw = chartW / viewBars;

    drawSubZone(rctx, lay, 0.3, 0, 'rgba(34,197,94,.06)');
    drawSubZone(rctx, lay, 0.3, 0.7, 'rgba(239,68,68,.06)');

    var chartH = h - padT - padB;
    var gridLabels = [
      { pos: 0, label: '100' }, { pos: 0.3, label: '70' },
      { pos: 0.5, label: '50' }, { pos: 0.7, label: '30' }, { pos: 1, label: '0' }
    ];

    rctx.strokeStyle = COLOR.grid; rctx.lineWidth = 1;
    rctx.font = '10px sans-serif'; rctx.fillStyle = COLOR.text;
    rctx.textAlign = 'left'; rctx.textBaseline = 'middle';
    for (var g = 0; g < gridLabels.length; g++) {
      var gy = padT + chartH * gridLabels[g].pos;
      rctx.beginPath(); rctx.moveTo(padL, gy); rctx.lineTo(w - padR, gy); rctx.stroke();
      rctx.fillText(gridLabels[g].label, w - padR + 4, gy);
    }

    drawSubLine(rctx, lay, rsiData, visStart, dc, cw, 0, 100, COLOR.rsi, 1.5);
    drawTrainZoneLines(rctx, lay, visStart, dc, cw);
  }

  // ===== 十字光标 & 高级Tooltip =====
  function drawCross() {
    if (!xctx) return;
    var layout = getLayout();
    xctx.clearRect(0, 0, layout.w, layout.h);
    var dc = getDisplayCount();
    if (crossIdx < 0 || crossIdx >= dc) return;

    var barIdx = viewStart + crossIdx;
    var x = indexToX(crossIdx);
    var b = bars[barIdx];
    if (!b) return;

    // 十字线
    xctx.strokeStyle = COLOR.cross;
    xctx.lineWidth = 1;
    xctx.setLineDash([4, 4]);
    xctx.beginPath();
    xctx.moveTo(x, layout.padT);
    xctx.lineTo(x, layout.h - layout.padB);
    xctx.stroke();

    var y = priceToY(b.close, layout, priceRange);
    xctx.beginPath();
    xctx.moveTo(layout.padL, y);
    xctx.lineTo(layout.w - layout.padR, y);
    xctx.stroke();
    xctx.setLineDash([]);

    // ===== Tooltip 高级设计 =====
    var isUp = b.close >= b.open;
    var tipW = 175, tipH = 142, tipPad = 14, tipGap = 6;
    var tx = x + 14, ty = layout.padT + 6;
    if (tx + tipW > layout.w - layout.padR) tx = x - tipW - 14;

    // 阴影
    xctx.shadowColor = 'rgba(0,0,0,.15)';
    xctx.shadowBlur = 12;
    xctx.shadowOffsetY = 2;

    // 白色主体 + 圆角
    var r = 10;
    xctx.fillStyle = '#fff';
    xctx.beginPath();
    xctx.moveTo(tx + r, ty);
    xctx.lineTo(tx + tipW - r, ty);
    xctx.quadraticCurveTo(tx + tipW, ty, tx + tipW, ty + r);
    xctx.lineTo(tx + tipW, ty + tipH - r);
    xctx.quadraticCurveTo(tx + tipW, ty + tipH, tx + tipW - r, ty + tipH);
    xctx.lineTo(tx + r, ty + tipH);
    xctx.quadraticCurveTo(tx, ty + tipH, tx, ty + tipH - r);
    xctx.lineTo(tx, ty + r);
    xctx.quadraticCurveTo(tx, ty, tx + r, ty);
    xctx.closePath();
    xctx.fill();

    // 细边框
    xctx.shadowBlur = 0;
    xctx.shadowOffsetY = 0;
    xctx.strokeStyle = 'rgba(0,0,0,.08)';
    xctx.lineWidth = 1;
    xctx.stroke();

    // 左侧色条 (红涨绿跌)
    xctx.fillStyle = isUp ? COLOR.up : COLOR.down;
    xctx.beginPath();
    xctx.moveTo(tx + 1, ty + 8);
    xctx.lineTo(tx + 5, ty + 8);
    xctx.lineTo(tx + 5, ty + tipH - 8);
    xctx.lineTo(tx + 1, ty + tipH - 8);
    xctx.closePath();
    xctx.fill();

    // === 内容区域 ===
    var cx = tx + tipPad;
    var cy = ty + 8;

    // 日期 + 涨跌幅
    var dateStr = b.date ? fmtDateLong(b.date) : ('第' + (barIdx + 1) + '根');
    xctx.fillStyle = COLOR.textBright;
    xctx.font = 'bold 13px -apple-system,"Microsoft YaHei",sans-serif';
    xctx.textAlign = 'left';
    xctx.textBaseline = 'top';
    xctx.fillText(dateStr, cx, cy);

    var pctStr = b.pct !== undefined ? ((b.pct >= 0 ? '+' : '') + b.pct.toFixed(2) + '%') : '';
    if (pctStr) {
      xctx.fillStyle = b.pct >= 0 ? COLOR.up : COLOR.down;
      xctx.font = 'bold 12px -apple-system,"Microsoft YaHei",sans-serif';
      xctx.textAlign = 'right';
      xctx.fillText(pctStr, tx + tipW - tipPad, cy);
      xctx.textAlign = 'left';
    }

    cy += 22;

    // 分隔线
    xctx.strokeStyle = 'rgba(0,0,0,.06)';
    xctx.lineWidth = 1;
    xctx.beginPath();
    xctx.moveTo(cx, cy - 2);
    xctx.lineTo(tx + tipW - tipPad, cy - 2);
    xctx.stroke();

    // 价格信息：两列布局
    var rowH = 22;
    var col2X = cx + 80;

    // 列1: O/H/L/C
    xctx.font = '12px -apple-system,"Microsoft YaHei",sans-serif';
    xctx.fillStyle = COLOR.textDim;
    xctx.fillText('开', cx, cy + 2);
    xctx.fillText('高', cx, cy + rowH + 2);
    xctx.fillText('低', cx, cy + rowH * 2 + 2);
    xctx.fillText('收', cx, cy + rowH * 3 + 2);

    xctx.fillStyle = COLOR.textBright;
    xctx.font = 'bold 12px -apple-system,"Microsoft YaHei",sans-serif';
    xctx.textAlign = 'right';
    xctx.fillText(b.open.toFixed(2), col2X + 60, cy + 2);
    xctx.fillText(b.high.toFixed(2), col2X + 60, cy + rowH + 2);
    xctx.fillText(b.low.toFixed(2), col2X + 60, cy + rowH * 2 + 2);
    xctx.fillStyle = isUp ? COLOR.up : COLOR.down;
    xctx.fillText(b.close.toFixed(2), col2X + 60, cy + rowH * 3 + 2);
    xctx.textAlign = 'left';

    // 底部分隔线
    var lineY = cy + rowH * 4 - 2;
    xctx.strokeStyle = 'rgba(0,0,0,.06)';
    xctx.beginPath();
    xctx.moveTo(cx, lineY);
    xctx.lineTo(tx + tipW - tipPad, lineY);
    xctx.stroke();
    cy = lineY + 4;

    // 成交量
    xctx.font = '12px -apple-system,"Microsoft YaHei",sans-serif';
    xctx.fillStyle = COLOR.textDim;
    xctx.fillText('量', cx, cy + 4);
    xctx.fillStyle = COLOR.textBright;
    xctx.font = 'bold 12px -apple-system,"Microsoft YaHei",sans-serif';
    xctx.fillText(fmt(b.volume), cx + 20, cy + 4);
  }

  // ---------- 控制 ----------
  function resize() {
    var m = setupCanvas(mainCanvas); if (m) mctx = m.ctx;
    var v = setupCanvas(volCanvas); if (v) vctx = v.ctx;
    var d = setupCanvas(macdCanvas); if (d) dctx = d.ctx;
    var k = setupCanvas(kdjCanvas); if (k) kctx = k.ctx;
    var r = setupCanvas(rsiCanvas); if (r) rctx = r.ctx;
    var x = setupCanvas(crossCanvas); if (x) xctx = x.ctx;
    recalcIndicators();
    draw();
  }

  function setShowMA(b)   { opts.showMA = b; draw(); }
  function setShowVol(b)  { opts.showVol = b; draw(); }
  function setShowMACD(b) {
    opts.showMACD = b;
    var wrap = document.getElementById('macd-wrap');
    if (wrap) wrap.style.display = b ? '' : 'none';
    if (b && macdCanvas) { var d = setupCanvas(macdCanvas); if (d) dctx = d.ctx; }
    draw();
  }
  function setShowKDJ(b) {
    opts.showKDJ = b;
    var wrap = document.getElementById('kdj-wrap');
    if (wrap) wrap.style.display = b ? '' : 'none';
    if (b && kdjCanvas) { var k = setupCanvas(kdjCanvas); if (k) kctx = k.ctx; }
    draw();
  }
  function setShowRSI(b) {
    opts.showRSI = b;
    var wrap = document.getElementById('rsi-wrap');
    if (wrap) wrap.style.display = b ? '' : 'none';
    if (b && rsiCanvas) { var r = setupCanvas(rsiCanvas); if (r) rctx = r.ctx; }
    draw();
  }
  function setShowBOLL(b) { opts.showBOLL = b; computeRanges(); draw(); }

  function getVisibleCount() { return progressCount; }
  function isAutoFollow() { return autoFollow; }

  global.Chart = {
    init: init, setData: setData, setProgress: setProgress,
    setReviewMode: setReviewMode,
    setTradeMarkers: setTradeMarkers,
    draw: draw, resize: resize,
    setShowMA: setShowMA, setShowVol: setShowVol,
    setShowMACD: setShowMACD, setShowKDJ: setShowKDJ,
    setShowRSI: setShowRSI, setShowBOLL: setShowBOLL,
    getVisibleCount: getVisibleCount,
    zoomIn: function () { zoom(-8, null); },
    zoomOut: function () { zoom(8, null); },
    resetView: resetView,
    isAutoFollow: isAutoFollow
  };
})(window);
