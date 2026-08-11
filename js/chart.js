/* ===== chart.js · K线绘制引擎 (v7) =====
 * 明亮配色、日线级别进度
 * v7: 丝滑交互升级
 *  - 浮点视口渲染：拖拽像素级跟手（不再按整根K线跳动）
 *  - 惯性滚动（松手后按速度衰减滑动，边界软阻尼）
 *  - 滚轮/按钮缩放缓动动画（220ms easeOutCubic，以光标为锚点）
 *  - 划线系统：趋势线 / 水平线 / 射线 / 平行通道 / 斐波那契
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
    textDim: '#94a3b8',
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
  var viewStart = 0, viewBars = 60;   // 浮点：拖拽/动画期间允许小数
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

  // 拖拽 / 触控状态
  var isDragging = false, dragStartX = 0, dragStartViewStart = 0;
  var dragState = null;         // { lastX, lastT, vels:[] }
  var momentum = null;          // 惯性 { v(bars/ms), lastT }
  var zoomAnim = null;          // 缩放动画
  var touchMode = null, pinchStartDist = 0, pinchStartViewBars = 0;
  var touchStartX = 0, touchStartViewStart = 0;

  // ===== 划线系统状态 =====
  var DRAW_TOOLS_CFG = {
    cursor:  { label: '光标',        hint: '' },
    trend:   { label: '趋势线',      color: '#4361ee', hint: '拖动绘制趋势线' },
    h:       { label: '水平线',      color: '#f59e0b', hint: '拖动设定水平线价格' },
    ray:     { label: '射线',        color: '#8b5cf6', hint: '拖动绘制射线（向右延伸）' },
    channel: { label: '平行通道',    color: '#10b981', hint: '拖动确定基准线，再点一下确定通道宽度' },
    fib:     { label: '斐波那契',    color: '#f59e0b', hint: '拖动绘制斐波那契回撤' }
  };
  var FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  var drawTools = [];      // 已完成的划线
  var selectedDraw = -1;   // 选中索引
  var activeTool = 'cursor';
  var draft = null;        // 绘制中的划线 {type, pts, stage, price}
  var editDrag = null;     // 编辑拖拽 {idx, handle, startClientX/Y}
  var drawingKey = '';     // 持久化键（股票+周期）
  var lastSaveT = 0;

  // ===== 动画系统 =====
  var flashEffects = [];   // 交易闪光效果队列
  var slideAnim = null;    // K线推进滑动动画
  var pulseAnim = null;    // 新K线高光脉冲
  var animRAF = null;      // requestAnimationFrame ID

  // 缓动函数
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

  // ---------- 视口辅助 ----------
  // 浮点 viewStart/viewBars 下，切片用整数，绘制 x 用 xOff 偏移
  function getView() {
    var visStart = Math.floor(viewStart);
    var visEnd = Math.min(Math.ceil(viewStart + viewBars), progressCount);
    if (visEnd < visStart) visEnd = visStart;
    return {
      visStart: visStart,
      visEnd: visEnd,
      dc: visEnd - visStart,
      xOff: visStart - viewStart    // 小数偏移 ∈ (-1, 0]，x 计算时叠加
    };
  }

  // 软边界（橡皮筋）：超出范围时按比例缩放，产生阻尼感
  function clampSoft(v, min, max) {
    if (v < min) return min + (v - min) * 0.25;
    if (v > max) return max + (v - max) * 0.25;
    return v;
  }

  function cancelMomentum() { momentum = null; }

  // ---------- 启动交易闪光 ----------
  function flashTrade(barIdx, type, price, qty) {
    if (barIdx < 0 || barIdx >= bars.length) return;
    flashEffects.push({
      barIdx: barIdx,
      type: type,     // 'buy' | 'sell'
      price: price,
      qty: qty,
      startTime: performance.now(),
      duration: 800
    });
    ensureAnimLoop();
  }

  // 启动K线推进动画
  function startSlideAnim(fromProgress, toProgress) {
    if (fromProgress === toProgress) return;
    slideAnim = {
      from: fromProgress,
      to: toProgress,
      startTime: performance.now(),
      duration: 350
    };
    ensureAnimLoop();
  }

  // 启动新K线脉冲
  function startPulse(barIdx) {
    pulseAnim = {
      barIdx: barIdx,
      startTime: performance.now(),
      duration: 600
    };
    ensureAnimLoop();
  }

  // 平滑缩放动画（以 chart 内 anchorRatio 处为锚点）
  function animateZoom(toBars, anchorRatio) {
    toBars = Math.max(8, Math.min(300, Math.round(toBars)));
    var fromBars = viewBars, fromStart = viewStart;
    if (Math.abs(toBars - fromBars) < 0.5) return;
    var max = Math.max(1, progressCount);
    var ratio = (anchorRatio === undefined || anchorRatio === null) ? 0.5 : anchorRatio;
    ratio = Math.max(0, Math.min(1, ratio));
    var anchorIdx = fromStart + ratio * fromBars;
    var toStart = anchorIdx - ratio * toBars;
    toStart = Math.max(0, Math.min(toStart, Math.max(0, max - toBars)));
    zoomAnim = { t0: performance.now(), dur: 220, fromBars: fromBars, fromStart: fromStart, toBars: toBars, toStart: toStart };
    ensureAnimLoop();
  }

  // 确保动画循环运行
  function ensureAnimLoop() {
    if (animRAF !== null) return;
    function tick() {
      var now = performance.now();
      var hasActive = false;

      // 清理过期的闪光
      flashEffects = flashEffects.filter(function (f) {
        return now - f.startTime < f.duration;
      });
      if (flashEffects.length > 0) hasActive = true;

      // 检查滑动动画
      if (slideAnim) {
        var t = (now - slideAnim.startTime) / slideAnim.duration;
        if (t >= 1) slideAnim = null;
        else hasActive = true;
      }

      // 检查脉冲动画
      if (pulseAnim) {
        var pt = (now - pulseAnim.startTime) / pulseAnim.duration;
        if (pt >= 1) pulseAnim = null;
        else hasActive = true;
      }

      // 惯性滚动
      if (momentum) {
        var dt = Math.min(64, now - momentum.lastT);
        momentum.lastT = now;
        var maxV = Math.max(1, progressCount) - viewBars;
        var next = viewStart + momentum.v * dt;
        momentum.v *= Math.pow(0.93, dt / 16);
        if (next < 0) { next = next * 0.4; momentum.v *= 0.5; }
        if (next > maxV) { next = maxV + (next - maxV) * 0.4; momentum.v *= 0.5; }
        if (Math.abs(momentum.v) < 0.002) {
          momentum = null;
          viewStart = Math.round(viewStart);
          clampView();
        } else {
          viewStart = next;
        }
        autoFollow = (viewStart + viewBars >= progressCount);
        computeRanges();
        hasActive = true;
      }

      // 缩放动画
      if (zoomAnim) {
        var tz = (now - zoomAnim.t0) / zoomAnim.dur;
        if (tz > 1) tz = 1;
        var ez = easeOutCubic(tz);
        viewBars = zoomAnim.fromBars + (zoomAnim.toBars - zoomAnim.fromBars) * ez;
        viewStart = zoomAnim.fromStart + (zoomAnim.toStart - zoomAnim.fromStart) * ez;
        clampView();
        autoFollow = (viewStart + viewBars >= progressCount);
        computeRanges();
        if (tz >= 1) {
          viewBars = Math.round(viewBars);
          viewStart = Math.round(viewStart);
          clampView();
          zoomAnim = null;
        }
        hasActive = true;
      }

      draw();
      if (hasActive) {
        animRAF = requestAnimationFrame(tick);
      } else {
        animRAF = null;
      }
    }
    animRAF = requestAnimationFrame(tick);
  }

  // 绘制交易闪光效果（在 crosshair canvas 上）
  function drawFlashEffects(layout) {
    if (flashEffects.length === 0 && !pulseAnim) return;
    var now = performance.now();
    var v = getView();

    // 交易闪光
    for (var i = 0; i < flashEffects.length; i++) {
      var f = flashEffects[i];
      var elapsed = now - f.startTime;
      var t = elapsed / f.duration;
      if (t > 1) continue;

      var bi = f.barIdx - v.visStart;
      if (bi < 0 || bi >= v.dc) continue;

      var layout2 = getLayout();
      var chartW = layout2.w - layout2.padR - layout2.padL;
      var cw = chartW / viewBars;
      var x = layout2.padL + cw * (bi + v.xOff + 0.5);

      var bar = bars[f.barIdx];
      if (!bar) continue;

      var rgb = f.type === 'buy' ? '34,197,94' : '239,68,68';
      var y = f.type === 'buy' ? priceToY(bar.low, layout2, priceRange) + 18 : priceToY(bar.high, layout2, priceRange) - 18;

      // 脉冲光环
      var ringR = 8 + t * 28;
      var ringAlpha = (1 - t) * 0.6;
      xctx.strokeStyle = 'rgba(' + rgb + ',' + ringAlpha + ')';
      xctx.lineWidth = 2 * (1 - t * 0.5);
      xctx.beginPath();
      xctx.arc(x, y, ringR, 0, Math.PI * 2);
      xctx.stroke();

      // 第二层光环（延迟）
      if (t > 0.2) {
        var t2 = (t - 0.2) / 0.8;
        var ringR2 = 6 + t2 * 22;
        var ringAlpha2 = (1 - t2) * 0.3;
        xctx.strokeStyle = 'rgba(' + rgb + ',' + ringAlpha2 + ')';
        xctx.lineWidth = 1.5;
        xctx.beginPath();
        xctx.arc(x, y, ringR2, 0, Math.PI * 2);
        xctx.stroke();
      }

      // 浮动文字（向上飘）
      var textY = y - t * 30;
      var textAlpha = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85);
      var scale = t < 0.2 ? easeOutBack(t / 0.2) : 1;
      var label = (f.type === 'buy' ? '买 ' : '卖 ') + f.qty + '股';
      xctx.save();
      xctx.translate(x, textY);
      xctx.scale(scale, scale);
      xctx.font = 'bold 12px -apple-system,"Microsoft YaHei",sans-serif';
      xctx.textAlign = 'center';
      xctx.textBaseline = 'middle';
      var tw = xctx.measureText(label).width + 16;
      xctx.fillStyle = 'rgba(' + rgb + ',' + (textAlpha * 0.9) + ')';
      xctx.beginPath();
      var rr = 8;
      if (xctx.roundRect) xctx.roundRect(-tw / 2, -10, tw, 20, rr);
      else {
        xctx.moveTo(-tw / 2 + rr, -10);
        xctx.arcTo(tw / 2, -10, tw / 2, 10, rr);
        xctx.arcTo(tw / 2, 10, -tw / 2, 10, rr);
        xctx.arcTo(-tw / 2, 10, -tw / 2, -10, rr);
        xctx.arcTo(-tw / 2, -10, tw / 2, -10, rr);
        xctx.fill();
      }
      xctx.fill();
      xctx.fillStyle = 'rgba(255,255,255,' + textAlpha + ')';
      xctx.fillText(label, 0, 0);
      xctx.restore();
    }

    // 新K线脉冲
    if (pulseAnim) {
      var pt = (now - pulseAnim.startTime) / pulseAnim.duration;
      if (pt < 1) {
        var pBi = pulseAnim.barIdx - v.visStart;
        if (pBi >= 0 && pBi < v.dc) {
          var pLayout = getLayout();
          var pChartW = pLayout.w - pLayout.padR - pLayout.padL;
          var pCw = pChartW / viewBars;
          var pX = pLayout.padL + pCw * (pBi + v.xOff + 0.5);
          var pBar = bars[pulseAnim.barIdx];
          if (pBar) {
            var pulseAlpha = (1 - pt) * 0.25;
            xctx.fillStyle = 'rgba(67,97,238,' + pulseAlpha + ')';
            xctx.fillRect(pX - pCw / 2, pLayout.padT, pCw, pLayout.h - pLayout.padT - pLayout.padB);
          }
        }
      }
    }
  }

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
    var v = getView();
    var f = (x - layout.padL) / cw - 0.5 - v.xOff;
    var idx = Math.floor(f);
    if (idx < 0 || idx >= dc) return -1;
    return idx;
  }

  function indexToX(idx) {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var cw = chartW / viewBars;
    var v = getView();
    return layout.padL + cw * (idx + v.xOff + 0.5);
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
    var max = Math.max(1, bars.length);
    viewBars = Math.max(8, Math.min(viewBars, 300));
    if (viewBars > max) viewBars = max;
    viewStart = Math.max(0, Math.min(viewStart, max - viewBars));
  }

  function pan(deltaIdx) {
    var max = Math.max(1, progressCount);
    viewStart = Math.max(0, Math.min(Math.round(viewStart) + deltaIdx, max - viewBars));
    autoFollow = (viewStart + viewBars >= progressCount);
    computeRanges();
    draw();
  }

  function resetView() {
    cancelMomentum();
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
      crossCanvas.addEventListener('dblclick', onDblClick);
      crossCanvas.addEventListener('contextmenu', onContextMenu);
      crossCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
      crossCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
      crossCanvas.addEventListener('touchend', onTouchEnd);
    }
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('keydown', onKeyDown);

    // ---- 划线工具栏 ----
    var toolbar = document.getElementById('draw-toolbar');
    if (toolbar) {
      var btns = toolbar.querySelectorAll('.draw-btn[data-tool]');
      for (var i = 0; i < btns.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            setActiveTool(btn.getAttribute('data-tool'));
          });
        })(btns[i]);
      }
      var btnClear = document.getElementById('btn-clear-draw');
      if (btnClear) {
        btnClear.addEventListener('click', function () {
          if (drawTools.length > 0 || draft) {
            clearDrawings();
          }
        });
      }
    }
  }

  // ---------- 事件 ----------
  function onWheel(e) {
    e.preventDefault();
    var rect = crossCanvas.getBoundingClientRect();
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var ratio = chartW > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left - layout.padL) / chartW)) : 0.5;
    animateZoom(viewBars + (e.deltaY > 0 ? 6 : -6), ratio);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    cancelMomentum();
    zoomAnim = null;

    var rect = crossCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;

    // 通道第三步：点击完成
    if (draft && draft.type === 'channel' && draft.stage === 2 && activeTool === 'channel') {
      finishDraft(x, y);
      draw();
      return;
    }

    // 划线模式：开始绘制
    if (activeTool !== 'cursor') {
      startDraft(x, y);
      isDragging = true;
      draw();
      return;
    }

    // 光标模式：优先命中划线进行编辑
    var hit = hitTestDrawings(x, y);
    if (hit) {
      selectedDraw = hit.idx;
      editDrag = { idx: hit.idx, handle: hit.handle, startClientX: e.clientX, startClientY: e.clientY };
      saveDrawingsThrottled(true);
      draw();
      return;
    }
    selectedDraw = -1;

    // 平移（像素级跟手）
    isDragging = true;
    dragStartX = e.clientX;
    dragStartViewStart = viewStart;
    dragState = { lastX: e.clientX, lastT: performance.now(), vels: [] };
    if (crossCanvas) crossCanvas.style.cursor = 'grabbing';
  }

  function onMouseUp(e) {
    // 结束绘制
    if (draft) {
      isDragging = false;
      var rect0 = crossCanvas.getBoundingClientRect();
      finishDraft(e.clientX - rect0.left, e.clientY - rect0.top);
      draw();
      return;
    }
    // 结束编辑拖拽
    if (editDrag) {
      editDrag = null;
      if (crossCanvas) crossCanvas.style.cursor = 'crosshair';
      return;
    }
    if (isDragging && dragState) {
      isDragging = false;
      if (crossCanvas) crossCanvas.style.cursor = 'crosshair';

      // 惯性：取最近两帧速度
      var v = 0;
      var vels = dragState.vels;
      if (vels.length >= 2) {
        var a = vels[vels.length - 2], b = vels[vels.length - 1];
        if (b.t - a.t > 8) v = (b.x - a.x) / (b.t - a.t);   // px/ms
      }
      var layout = getLayout();
      var cw = (layout.w - layout.padR - layout.padL) / viewBars;
      v = -v / cw;                                          // px/ms -> bars/ms
      v = Math.max(-0.06, Math.min(0.06, v));
      if (Math.abs(v) > 0.003) {
        momentum = { v: v, lastT: performance.now() };
        ensureAnimLoop();
      } else {
        var max = Math.max(1, progressCount) - viewBars;
        viewStart = Math.max(0, Math.min(Math.round(viewStart), max));
        autoFollow = (viewStart + viewBars >= progressCount);
        computeRanges();
        draw();
      }
      dragState = null;
    }
  }

  function onWindowMouseMove(e) {
    // 编辑划线（拖手柄 / 拖整体）
    if (editDrag) {
      var rect = crossCanvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var d = drawTools[editDrag.idx];
      if (!d) { editDrag = null; return; }
      if (editDrag.handle >= 0) {
        d.pts[editDrag.handle] = screenToData(mx, my);
      } else if (d.type === 'h') {
        d.price = screenToData(mx, my).price;
      } else {
        var cur = screenToData(mx, my);
        var prev = screenToData(editDrag.startClientX - rect.left, editDrag.startClientY - rect.top);
        var dBi = cur.bi - prev.bi, dP = cur.price - prev.price;
        for (var k = 0; k < d.pts.length; k++) {
          d.pts[k].bi += dBi;
          d.pts[k].price += dP;
        }
        editDrag.startClientX = e.clientX;
        editDrag.startClientY = e.clientY;
      }
      saveDrawingsThrottled(false);
      draw();
      return;
    }

    // 绘制中：实时跟随鼠标
    if (isDragging && draft) {
      var rect2 = crossCanvas.getBoundingClientRect();
      updateDraft(e.clientX - rect2.left, e.clientY - rect2.top);
      draw();
      return;
    }

    // 平移
    if (!isDragging || !dragState) return;
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var cw = chartW / viewBars;
    var dx = e.clientX - dragStartX;
    var desired = dragStartViewStart - dx / cw;
    var max = Math.max(1, progressCount) - viewBars;
    viewStart = clampSoft(desired, 0, max);
    autoFollow = (viewStart + viewBars >= progressCount);
    crossIdx = -1;
    computeRanges();
    draw();

    // 记录速度采样
    var t = performance.now();
    dragState.vels.push({ x: e.clientX, t: t });
    var cutoff = t - 160;
    while (dragState.vels.length > 2 && dragState.vels[0].t < cutoff) dragState.vels.shift();
  }

  function onMouseMove(e) {
    var rect = crossCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left;

    // 划线模式 / 绘制中：不显示十字光标
    if (activeTool !== 'cursor' || draft) {
      if (draft && draft.type === 'channel' && draft.stage === 2) {
        updateDraft(x, e.clientY - rect.top);
        draw();
      }
      if (crossIdx !== -1) { crossIdx = -1; drawCross(); }
      return;
    }

    if (isDragging) return;
    var idx = xToIndex(x);
    if (idx >= 0 && idx < getDisplayCount() && idx !== crossIdx) { crossIdx = idx; drawCross(); }
    else if ((idx < 0 || idx >= getDisplayCount()) && crossIdx !== -1) { crossIdx = -1; drawCross(); }
  }

  function onDblClick(e) {
    var rect = crossCanvas.getBoundingClientRect();
    var hit = hitTestDrawings(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      drawTools.splice(hit.idx, 1);
      selectedDraw = -1;
      saveDrawingsThrottled(true);
      draw();
    }
  }

  function onContextMenu(e) {
    if (draft || activeTool !== 'cursor') {
      e.preventDefault();
      draft = null;
      setActiveTool('cursor');
    }
  }

  function onKeyDown(e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') {
      if (draft) { draft = null; draw(); }
      else if (activeTool !== 'cursor') { setActiveTool('cursor'); }
      else if (selectedDraw >= 0) { selectedDraw = -1; draw(); }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedDraw >= 0) { e.preventDefault(); deleteSelectedDrawing(); }
    }
  }

  function onTouchStart(e) {
    e.preventDefault();
    cancelMomentum();
    if (e.touches.length === 1) { touchMode = 'pan'; touchStartX = e.touches[0].clientX; touchStartViewStart = viewStart; }
    else if (e.touches.length === 2) { touchMode = 'pinch'; pinchStartDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX); pinchStartViewBars = viewBars; }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (touchMode === 'pan' && e.touches.length === 1) {
      var layout = getLayout(); var chartW = layout.w - layout.padR - layout.padL; var cw = chartW / viewBars;
      var dx = e.touches[0].clientX - touchStartX;
      var desired = touchStartViewStart - dx / cw;
      var max = Math.max(1, progressCount) - viewBars;
      viewStart = clampSoft(desired, 0, max);
      autoFollow = (viewStart + viewBars >= progressCount);
      crossIdx = -1; computeRanges(); draw();
    } else if (touchMode === 'pinch' && e.touches.length === 2) {
      var dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      if (pinchStartDist > 0) {
        var targetBars = Math.max(8, Math.min(300, Math.round(pinchStartViewBars * (pinchStartDist / dist))));
        animateZoom(targetBars, 0.5);
      }
    }
  }

  function onTouchEnd() { touchMode = null; }

  // ---------- 划线系统 ----------
  function screenToData(x, y) {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var chartH = layout.h - layout.padT - layout.padB;
    var cw = chartW / viewBars;
    var bi = viewStart + (x - layout.padL) / cw - 0.5;
    var price = priceRange.max - (y - layout.padT) / chartH * (priceRange.max - priceRange.min || 1);
    return { bi: bi, price: price };
  }

  function dataToXY(pt) {
    var layout = getLayout();
    var chartW = layout.w - layout.padR - layout.padL;
    var cw = chartW / viewBars;
    return {
      x: layout.padL + cw * (pt.bi - viewStart + 0.5),
      y: priceToY(pt.price, layout, priceRange)
    };
  }

  // Liang-Barsky 线段裁剪到图表区域
  function clipSeg(x1, y1, x2, y2) {
    var layout = getLayout();
    var xmin = layout.padL, xmax = layout.w - layout.padR;
    var ymin = layout.padT, ymax = layout.h - layout.padB;
    var dx = x2 - x1, dy = y2 - y1;
    var p = [-dx, dx, -dy, dy];
    var q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
    var u1 = 0, u2 = 1;
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        var r = q[i] / p[i];
        if (p[i] < 0) { if (r > u2) return null; if (r > u1) u1 = r; }
        else { if (r < u1) return null; if (r < u2) u2 = r; }
      }
    }
    return [{ x: x1 + u1 * dx, y: y1 + u1 * dy }, { x: x1 + u2 * dx, y: y1 + u2 * dy }];
  }

  // 过 (px,py)、方向 (dx,dy) 的整条直线（裁剪到图表区）
  function drawDirLine(ctx, px, py, dx, dy, layout) {
    var L = (layout.w - layout.padR - layout.padL) + (layout.h - layout.padT - layout.padB);
    var s1 = clipSeg(px, py, px + dx * L, py + dy * L);
    if (s1) { ctx.beginPath(); ctx.moveTo(s1[0].x, s1[0].y); ctx.lineTo(s1[1].x, s1[1].y); ctx.stroke(); }
    var s2 = clipSeg(px, py, px - dx * L, py - dy * L);
    if (s2) { ctx.beginPath(); ctx.moveTo(s2[0].x, s2[0].y); ctx.lineTo(s2[1].x, s2[1].y); ctx.stroke(); }
  }

  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function startDraft(x, y) {
    var pt = screenToData(x, y);
    if (activeTool === 'h') {
      draft = { type: 'h', price: pt.price, stage: 1 };
    } else {
      draft = { type: activeTool, pts: [pt], stage: 1 };
    }
  }

  function updateDraft(x, y) {
    if (!draft) return;
    var pt = screenToData(x, y);
    if (draft.type === 'h') { draft.price = pt.price; return; }
    if (draft.type === 'channel') {
      if (draft.stage === 1) draft.pts[1] = pt;
      else draft.pts[2] = pt;
    } else {
      draft.pts[1] = pt;
    }
  }

  function finishDraft(x, y) {
    if (!draft) return;
    var pt = screenToData(x, y);
    var minLen = 3; // px

    if (draft.type === 'h') {
      draft.price = pt.price;
      pushDrawing({ type: 'h', price: draft.price, color: DRAW_TOOLS_CFG.h.color });
      draft = null;
      return;
    }
    if (draft.type === 'channel') {
      if (draft.stage === 1) {
        if (!draft.pts[1]) { draft = null; return; }
        var A = dataToXY(draft.pts[0]), B = dataToXY(draft.pts[1]);
        if (Math.hypot(B.x - A.x, B.y - A.y) < minLen) { draft = null; return; }
        draft.stage = 2;
        draft.pts[2] = pt;
        return; // 等待第三次点击确定通道宽度
      } else {
        if (!draft.pts[2]) { draft = null; return; }
        pushDrawing({ type: 'channel', pts: draft.pts.slice(0, 3), color: DRAW_TOOLS_CFG.channel.color });
        draft = null;
        return;
      }
    }
    // trend / ray / fib
    if (!draft.pts[1]) { draft = null; return; }
    var pA = dataToXY(draft.pts[0]), pB = dataToXY(draft.pts[1]);
    if (Math.hypot(pB.x - pA.x, pB.y - pA.y) < minLen) { draft = null; return; }
    pushDrawing({ type: draft.type, pts: draft.pts.slice(0, 2), color: DRAW_TOOLS_CFG[draft.type].color });
    draft = null;
  }

  function pushDrawing(d) {
    drawTools.push(d);
    selectedDraw = drawTools.length - 1;
    saveDrawingsThrottled(true);
  }

  function setActiveTool(tool) {
    if (!DRAW_TOOLS_CFG[tool]) tool = 'cursor';
    activeTool = tool;
    draft = null;
    if (tool !== 'cursor') selectedDraw = -1;
    crossIdx = -1;

    var btns = document.querySelectorAll('.draw-btn[data-tool]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tool') === tool);
    }
    var hint = document.getElementById('draw-hint');
    if (hint) {
      if (tool === 'cursor') {
        hint.classList.remove('show');
      } else {
        hint.textContent = DRAW_TOOLS_CFG[tool].hint + ' · Esc 取消';
        hint.classList.add('show');
      }
    }
    draw();
  }

  function setDrawingContext(key) {
    drawingKey = key || '';
    drawTools = [];
    selectedDraw = -1;
    draft = null;
    if (drawingKey) {
      try {
        var raw = localStorage.getItem('kt_draw_' + drawingKey);
        if (raw) drawTools = JSON.parse(raw) || [];
      } catch (e) { drawTools = []; }
    }
  }

  function saveDrawingsThrottled(force) {
    if (!drawingKey) return;
    var t = Date.now();
    if (!force && t - lastSaveT < 200) return;
    lastSaveT = t;
    try { localStorage.setItem('kt_draw_' + drawingKey, JSON.stringify(drawTools)); } catch (e) {}
  }

  function clearDrawings() {
    drawTools = [];
    selectedDraw = -1;
    draft = null;
    if (drawingKey) { try { localStorage.removeItem('kt_draw_' + drawingKey); } catch (e) {} }
    draw();
  }

  function deleteSelectedDrawing() {
    if (selectedDraw < 0 || selectedDraw >= drawTools.length) return;
    drawTools.splice(selectedDraw, 1);
    selectedDraw = -1;
    saveDrawingsThrottled(true);
    draw();
  }

  // ---------- 划线命中检测 ----------
  function hitTestDrawings(x, y) {
    for (var i = drawTools.length - 1; i >= 0; i--) {
      var d = drawTools[i];
      // 手柄优先
      if (d.type !== 'h') {
        var pts = d.type === 'channel' ? d.pts.slice(0, 3) : d.pts.slice(0, 2);
        for (var j = 0; j < pts.length; j++) {
          var p = dataToXY(pts[j]);
          if (Math.hypot(x - p.x, y - p.y) <= 9) return { idx: i, handle: j };
        }
      }
      if (pointOnDrawing(d, x, y)) return { idx: i, handle: -1 };
    }
    return null;
  }

  function pointOnDrawing(d, x, y) {
    var layout = getLayout();
    var w = layout.w, padL = layout.padL, padR = layout.padR, padT = layout.padT, padB = layout.padB;
    var span = (w - padL - padR) + (layout.h - padT - padB);

    if (d.type === 'h') {
      var p = dataToXY({ bi: 0, price: d.price });
      return Math.abs(y - p.y) <= 7 && x >= padL && x <= w - padR;
    }
    if (d.type === 'trend') {
      if (!d.pts[1]) return false;
      var A = dataToXY(d.pts[0]), B = dataToXY(d.pts[1]);
      return segDist(x, y, A.x, A.y, B.x, B.y) <= 7;
    }
    if (d.type === 'ray') {
      if (!d.pts[1]) return false;
      var A2 = dataToXY(d.pts[0]), B2 = dataToXY(d.pts[1]);
      var dx2 = B2.x - A2.x, dy2 = B2.y - A2.y, l2 = Math.hypot(dx2, dy2);
      if (l2 < 1e-4) return false;
      var seg = clipSeg(A2.x, A2.y, A2.x + dx2 / l2 * span, A2.y + dy2 / l2 * span);
      if (!seg) return false;
      return segDist(x, y, seg[0].x, seg[0].y, seg[1].x, seg[1].y) <= 7;
    }
    if (d.type === 'channel') {
      if (!d.pts[1]) return false;
      var A3 = dataToXY(d.pts[0]), B3 = dataToXY(d.pts[1]);
      var dx3 = B3.x - A3.x, dy3 = B3.y - A3.y, l3 = Math.hypot(dx3, dy3);
      if (l3 < 1e-4) return false;
      dx3 /= l3; dy3 /= l3;
      var anchors = [A3];
      if (d.pts[2]) anchors.push(dataToXY(d.pts[2]));
      for (var a = 0; a < anchors.length; a++) {
        var s1 = clipSeg(anchors[a].x, anchors[a].y, anchors[a].x + dx3 * span, anchors[a].y + dy3 * span);
        if (s1 && segDist(x, y, s1[0].x, s1[0].y, s1[1].x, s1[1].y) <= 7) return true;
        var s2 = clipSeg(anchors[a].x, anchors[a].y, anchors[a].x - dx3 * span, anchors[a].y - dy3 * span);
        if (s2 && segDist(x, y, s2[0].x, s2[0].y, s2[1].x, s2[1].y) <= 7) return true;
      }
      return false;
    }
    if (d.type === 'fib') {
      if (!d.pts[1]) return false;
      var pA = dataToXY(d.pts[0]), pB = dataToXY(d.pts[1]);
      var x0 = Math.min(pA.x, pB.x), x1 = Math.max(pA.x, pB.x);
      if (x < x0 - 4 || x > x1 + 4) return false;
      var pr0 = Math.min(d.pts[0].price, d.pts[1].price), pr1 = Math.max(d.pts[0].price, d.pts[1].price);
      for (var i = 0; i < FIB_LEVELS.length; i++) {
        var ly = priceToY(pr0 + (pr1 - pr0) * FIB_LEVELS[i], layout, priceRange);
        if (Math.abs(y - ly) <= 7) return true;
      }
    }
    return false;
  }

  // ---------- 划线绘制 ----------
  function drawDrawings(layout) {
    if (!drawTools.length && !draft) return;
    var list = drawTools.slice();
    if (draft) list.push(draft);
    for (var i = 0; i < list.length; i++) {
      drawOneDrawing(list[i], list[i] === draft, layout);
    }
    if (selectedDraw >= 0 && selectedDraw < drawTools.length && !draft) {
      drawHandles(drawTools[selectedDraw], layout);
    }
  }

  function drawOneDrawing(d, isDraft, layout) {
    var ctx = mctx;
    var color = d.color || '#4361ee';
    ctx.save();
    ctx.globalAlpha = isDraft ? 0.85 : 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 发光底层（高级感）
    ctx.save();
    ctx.globalAlpha *= 0.22;
    ctx.lineWidth = (isDraft ? 1.6 : 1.5) + 3.5;
    ctx.strokeStyle = color;
    drawToolStroke(ctx, d, layout);
    ctx.restore();

    // 主线条
    ctx.lineWidth = isDraft ? 1.6 : 1.5;
    ctx.strokeStyle = color;
    drawToolStroke(ctx, d, layout);

    // 标签
    drawToolLabels(ctx, d, layout);

    // 锚点（草稿时高亮起点）
    if (isDraft && d.pts && d.pts[0]) {
      var p0 = dataToXY(d.pts[0]);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawToolStroke(ctx, d, layout) {
    var w = layout.w, h = layout.h, padL = layout.padL, padR = layout.padR, padT = layout.padT, padB = layout.padB;

    if (d.type === 'h') {
      var p = dataToXY({ bi: 0, price: d.price });
      if (p.y > padT - 2 && p.y < h - padB + 2) {
        ctx.beginPath();
        ctx.moveTo(padL, p.y);
        ctx.lineTo(w - padR, p.y);
        ctx.stroke();
      }
      return;
    }
    if (d.type === 'trend') {
      if (!d.pts[1]) return;
      var A = dataToXY(d.pts[0]), B = dataToXY(d.pts[1]);
      var seg = clipSeg(A.x, A.y, B.x, B.y);
      if (seg) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
        ctx.stroke();
      }
      return;
    }
    if (d.type === 'ray') {
      if (!d.pts[1]) return;
      var A2 = dataToXY(d.pts[0]), B2 = dataToXY(d.pts[1]);
      var dx = B2.x - A2.x, dy = B2.y - A2.y;
      var len = Math.hypot(dx, dy);
      if (len < 1e-4) return;
      dx /= len; dy /= len;
      var L = (w - padR - padL) * 2 + (h - padT - padB) * 2;
      var seg2 = clipSeg(A2.x, A2.y, A2.x + dx * L, A2.y + dy * L);
      if (seg2) {
        ctx.beginPath();
        ctx.moveTo(seg2[0].x, seg2[0].y);
        ctx.lineTo(seg2[1].x, seg2[1].y);
        ctx.stroke();
      }
      return;
    }
    if (d.type === 'channel') {
      if (!d.pts[1]) return;
      var A3 = dataToXY(d.pts[0]), B3 = dataToXY(d.pts[1]);
      var dx3 = B3.x - A3.x, dy3 = B3.y - A3.y;
      var l3 = Math.hypot(dx3, dy3);
      if (l3 < 1e-4) return;
      dx3 /= l3; dy3 /= l3;
      drawDirLine(ctx, A3.x, A3.y, dx3, dy3, layout);
      if (d.pts[2]) {
        var C = dataToXY(d.pts[2]);
        drawDirLine(ctx, C.x, C.y, dx3, dy3, layout);
      }
      return;
    }
    if (d.type === 'fib') {
      if (!d.pts[1]) return;
      var pA = dataToXY(d.pts[0]), pB = dataToXY(d.pts[1]);
      var x0 = Math.min(pA.x, pB.x), x1 = Math.max(pA.x, pB.x);
      var pr0 = Math.min(d.pts[0].price, d.pts[1].price), pr1 = Math.max(d.pts[0].price, d.pts[1].price);
      for (var i = 0; i < FIB_LEVELS.length; i++) {
        var lvl = FIB_LEVELS[i];
        var price = pr0 + (pr1 - pr0) * lvl;
        var y = priceToY(price, layout, priceRange);
        if (y < padT - 2 || y > h - padB + 2) continue;
        ctx.beginPath();
        if (lvl === 0 || lvl === 1) ctx.setLineDash([]);
        else ctx.setLineDash([5, 4]);
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawTag(ctx, x, y, text, color) {
    var tw = ctx.measureText(text).width + 14;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 7, y, tw, 18, 9);
    else ctx.rect(x - 7, y, tw, 18);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.fillText(text, x, y + 9);
    ctx.restore();
  }

  function drawToolLabels(ctx, d, layout) {
    var w = layout.w, h = layout.h, padL = layout.padL, padR = layout.padR, padT = layout.padT, padB = layout.padB;
    ctx.font = '10px -apple-system,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (d.type === 'h') {
      var p = dataToXY({ bi: 0, price: d.price });
      if (p.y > padT + 12 && p.y < h - padB - 4) {
        drawTag(ctx, padL + 4, p.y - 10, '¥' + d.price.toFixed(2), d.color);
      }
      return;
    }
    if (d.type === 'fib') {
      if (!d.pts[1]) return;
      var pA = dataToXY(d.pts[0]), pB = dataToXY(d.pts[1]);
      var x0 = Math.min(pA.x, pB.x), x1 = Math.max(pA.x, pB.x);
      var pr0 = Math.min(d.pts[0].price, d.pts[1].price), pr1 = Math.max(d.pts[0].price, d.pts[1].price);
      var xLab = x0 + 4;
      ctx.fillStyle = 'rgba(100,116,139,.9)';
      for (var i = 0; i < FIB_LEVELS.length; i++) {
        var lvl = FIB_LEVELS[i];
        var price = pr0 + (pr1 - pr0) * lvl;
        var y = priceToY(price, layout, priceRange);
        if (y < padT + 8 || y > h - padB - 2) continue;
        var lvlName = (lvl * 100).toFixed(0) + '%';
        ctx.fillText(lvlName + ' ' + price.toFixed(2), xLab, y);
      }
      void x1;
      return;
    }
    // trend / ray / channel：草稿时在光标处显示价格标签
    if (d.pts && d.pts[1]) {
      var cur = dataToXY(d.pts[1]);
      if (cur.x > padL - 30 && cur.x < w - padR + 30 && cur.y > padT - 20 && cur.y < h - padB + 20) {
        var label = '¥' + d.pts[1].price.toFixed(2);
        if (d.pts[0]) {
          var diff = d.pts[1].price - d.pts[0].price;
          var base = Math.abs(d.pts[0].price) > 1e-9 ? d.pts[0].price : 1;
          if (Math.abs(diff) > 1e-9) label += '  ' + (diff > 0 ? '+' : '') + (diff / base * 100).toFixed(1) + '%';
        }
        drawTag(ctx, cur.x - 30, cur.y - 24, label, d.color);
      }
    }
  }

  function drawHandles(d, layout) {
    var ctx = mctx;
    var pts = [];
    if (d.type !== 'h') pts = d.type === 'channel' ? d.pts.slice(0, 3) : d.pts.slice(0, 2);
    for (var i = 0; i < pts.length; i++) {
      var p = dataToXY(pts[i]);
      if (p.x < layout.padL - 20 || p.x > layout.w - layout.padR + 20 || p.y < layout.padT - 20 || p.y > layout.h - layout.padB + 20) continue;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

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
    viewBars = Math.min(getDefaultViewBars(), Math.max(progressCount, 25, bars.length));
    viewStart = 0;
    autoFollow = true;
    cancelMomentum();
    zoomAnim = null;
    drawTools = [];
    selectedDraw = -1;
    draft = null;
    computeRanges();
  }

  function setReviewMode(b) {
    reviewMode = b;
    progressCount = b ? bars.length : trainStartIdx;
    viewBars = Math.min(getDefaultViewBars(), Math.max(1, bars.length));
    cancelMomentum();
    zoomAnim = null;

    if (b && trainStartIdx > 0 && trainEndIdx > 0) {
      var desiredStart = Math.max(0, trainStartIdx - Math.round(viewBars * 0.2));
      viewStart = Math.min(desiredStart, Math.max(0, bars.length - viewBars));
    } else {
      viewStart = Math.max(0, progressCount - viewBars);
    }

    autoFollow = false;
    clampView();
    computeRanges();
    draw();
  }

  function setProgress(n) {
    var oldProgress = progressCount;
    progressCount = Math.max(1, Math.min(n, bars.length));
    if (autoFollow) {
      viewStart = Math.max(0, progressCount - viewBars);
    }
    clampView();
    computeRanges();
    // 新K线出现时触发脉冲
    if (progressCount > oldProgress && progressCount > 1) {
      startPulse(progressCount - 1);
    }
  }

  function computeRanges() {
    var start = Math.floor(viewStart);
    var end = Math.min(Math.ceil(viewStart + viewBars), progressCount);
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
    var v = getView();
    var xOff = v.xOff;

    var chartH = layout.h - layout.padT - layout.padB;
    var arrowHalf = 5;

    // --- 成本线（持仓中） ---
    if (activePosition && activePosition.cost > 0) {
      var costY = priceToY(activePosition.cost, layout, range);
      if (costY > layout.padT && costY < layout.h - layout.padB) {
        mctx.strokeStyle = 'rgba(245,158,11,.7)';
        mctx.lineWidth = 1.5;
        mctx.setLineDash([6, 3]);
        mctx.beginPath();
        mctx.moveTo(layout.padL, costY);
        mctx.lineTo(layout.w - layout.padR, costY);
        mctx.stroke();
        mctx.setLineDash([]);

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
      var barIdx = trade.idx;
      if (barIdx < visStart || barIdx >= visStart + dc) continue;

      var bi = barIdx - visStart;
      var x = layout.padL + cw * (bi + xOff + 0.5);
      var bar = bars[barIdx];
      if (!bar) continue;

      if (trade.type === 'buy') {
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

        mctx.fillStyle = '#16a34a';
        mctx.font = 'bold 9px -apple-system,"Microsoft YaHei",sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'top';
        mctx.fillText('¥' + trade.price.toFixed(2), x, mY + arrowHalf + 2);
      } else if (trade.type === 'sell') {
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
    drawFlashEffects(getLayout());
  }

  // ===== 主K线图 =====
  function drawMain() {
    if (!mctx) return;
    var layout = getLayout();
    var w = layout.w, h = layout.h;
    mctx.clearRect(0, 0, w, h);
    if (bars.length === 0 || progressCount === 0) return;

    var v = getView();
    var visStart = v.visStart;
    var visEnd = v.visEnd;
    var dc = v.dc;
    var xOff = v.xOff;
    if (dc === 0) return;

    var vis = bars.slice(visStart, visEnd);
    var range = priceRange;
    var chartW = w - layout.padR - layout.padL;
    var chartH = h - layout.padT - layout.padB;
    var cw = chartW / viewBars;
    var bodyW = Math.max(1, cw * 0.7);
    function bx(i) { return layout.padL + cw * (i + xOff + 0.5); }

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
      if (trainStartIdx >= visStart && trainStartIdx < visEnd) tStartX = bx(trainStartIdx - visStart);
      if (trainEndIdx >= visStart && trainEndIdx < visEnd) tEndX = bx(trainEndIdx - visStart);
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
        var bx0 = bx(bi);
        if (!bStarted) { mctx.moveTo(bx0, upperY); bStarted = true; }
        else mctx.lineTo(bx0, upperY);
      }
      if (bStarted) {
        for (bi = dc - 1; bi >= 0; bi--) {
          barIdx = visStart + bi;
          lowerY = bollData.lower[barIdx] != null ? priceToY(bollData.lower[barIdx], layout, range) : null;
          if (lowerY != null) mctx.lineTo(bx(bi), lowerY);
        }
        mctx.closePath(); mctx.fill();
      }
      drawLineOnMain(mctx, bollData.upper, visStart, dc, cw, layout, range, xOff, COLOR.boll.upper, 1);
      drawLineOnMain(mctx, bollData.mid, visStart, dc, cw, layout, range, xOff, COLOR.boll.mid, 1);
      drawLineOnMain(mctx, bollData.lower, visStart, dc, cw, layout, range, xOff, COLOR.boll.upper, 1);
    }

    // 蜡烛
    for (var i = 0; i < dc; i++) {
      var b = vis[i];
      if (!b) continue;
      var x = bx(i);
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
        drawLineOnMain(mctx, ma.data, visStart, dc, cw, layout, range, xOff, COLOR.ma[m % COLOR.ma.length], 1.5);
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
        var dx = bx(trainStartIdx - visStart);
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
        var ex = bx(trainEndIdx - visStart);
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
      if (sDate) {
        mctx.font = '9px sans-serif'; mctx.fillStyle = 'rgba(217,119,6,.7)'; mctx.textAlign = 'center';
        mctx.fillText(sDate, bx(trainStartIdx - visStart), h - layout.padB + 5);
      }
      if (eDate) {
        mctx.font = '9px sans-serif'; mctx.fillStyle = 'rgba(220,38,38,.7)'; mctx.textAlign = 'center';
        mctx.fillText(eDate, bx(trainEndIdx - visStart), h - layout.padB + 5);
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

    // 划线图层
    drawDrawings(layout);

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
      var dx2 = bx(idx2);
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

  function drawLineOnMain(ctx, data, visStart, dc, cw, layout, range, xOff, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < dc; i++) {
      var idx = visStart + i;
      if (data[idx] == null) { started = false; continue; }
      var x = layout.padL + cw * (i + xOff + 0.5);
      var y = priceToY(data[idx], layout, range);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ===== 通用：训练区间竖线（穿透子图） =====
  function drawTrainZoneLines(ctx, lay, visStart, dc, cw) {
    if (!reviewMode || trainStartIdx < 0 || trainEndIdx <= 0) return;
    var padT = lay.padT, h = lay.h, padB = lay.padB;
    var v = getView();
    var xOff = v.xOff;
    if (trainStartIdx >= visStart && trainStartIdx < visStart + dc) {
      var sx = lay.padL + cw * (trainStartIdx - visStart + xOff + 0.5);
      ctx.strokeStyle = 'rgba(245,158,11,.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, h - padB); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (trainEndIdx >= visStart && trainEndIdx < visStart + dc) {
      var ex = lay.padL + cw * (trainEndIdx - visStart + xOff + 0.5);
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
    var v = getView();
    var xOff = v.xOff;
    for (var i = 0; i < dc; i++) {
      var idx = visStart + i;
      if (data[idx] == null) { started = false; continue; }
      var x = lay.padL + cw * (i + xOff + 0.5);
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

    var v = getView();
    var visStart = v.visStart, visEnd = v.visEnd, dc = v.dc, xOff = v.xOff;
    if (dc === 0) return;

    var vis = bars.slice(visStart, visEnd);
    var chartW = w - padR - padL, chartH = h - padT - padB;
    var cw = chartW / viewBars, bodyW = Math.max(1, cw * 0.7), vmax = volMax || 1;

    vctx.strokeStyle = COLOR.grid; vctx.lineWidth = 1;
    vctx.beginPath(); vctx.moveTo(padL, padT + chartH / 2); vctx.lineTo(w - padR, padT + chartH / 2); vctx.stroke();
    vctx.fillStyle = COLOR.text; vctx.font = '10px sans-serif'; vctx.textAlign = 'left';
    vctx.fillText(fmt(vmax), w - padR + 4, padT + 8);

    for (var i = 0; i < dc; i++) {
      var b = vis[i];
      if (!b) continue;
      var x = padL + cw * (i + xOff + 0.5);
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

    var v = getView();
    var visStart = v.visStart, visEnd = v.visEnd, dc = v.dc, xOff = v.xOff;
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
      var vv = macdData.macd[barIdx] || 0;
      var x = padL + cw * (i2 + xOff + 0.5);
      var bh = (Math.abs(vv) / absMax) * (chartH / 2);
      dctx.fillStyle = vv >= 0 ? COLOR.up : COLOR.down;
      dctx.globalAlpha = 0.7;
      dctx.fillRect(x - bodyW / 2, vv >= 0 ? yMid - bh : yMid, bodyW, bh);
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

    var v = getView();
    var visStart = v.visStart, visEnd = v.visEnd, dc = v.dc;
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

    var v = getView();
    var visStart = v.visStart, visEnd = v.visEnd, dc = v.dc;
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
    var v = getView();
    var dc = v.dc;
    if (crossIdx < 0 || crossIdx >= dc) return;

    var barIdx = v.visStart + crossIdx;
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

    xctx.shadowColor = 'rgba(0,0,0,.15)';
    xctx.shadowBlur = 12;
    xctx.shadowOffsetY = 2;

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

    xctx.shadowBlur = 0;
    xctx.shadowOffsetY = 0;
    xctx.strokeStyle = 'rgba(0,0,0,.08)';
    xctx.lineWidth = 1;
    xctx.stroke();

    xctx.fillStyle = isUp ? COLOR.up : COLOR.down;
    xctx.beginPath();
    xctx.moveTo(tx + 1, ty + 8);
    xctx.lineTo(tx + 5, ty + 8);
    xctx.lineTo(tx + 5, ty + tipH - 8);
    xctx.lineTo(tx + 1, ty + tipH - 8);
    xctx.closePath();
    xctx.fill();

    var cx = tx + tipPad;
    var cy = ty + 8;

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

    xctx.strokeStyle = 'rgba(0,0,0,.06)';
    xctx.lineWidth = 1;
    xctx.beginPath();
    xctx.moveTo(cx, cy - 2);
    xctx.lineTo(tx + tipW - tipPad, cy - 2);
    xctx.stroke();

    var rowH = 22;
    var col2X = cx + 80;

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

    var lineY = cy + rowH * 4 - 2;
    xctx.strokeStyle = 'rgba(0,0,0,.06)';
    xctx.beginPath();
    xctx.moveTo(cx, lineY);
    xctx.lineTo(tx + tipW - tipPad, lineY);
    xctx.stroke();
    cy = lineY + 4;

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
    flashTrade: flashTrade,
    draw: draw, resize: resize,
    setShowMA: setShowMA, setShowVol: setShowVol,
    setShowMACD: setShowMACD, setShowKDJ: setShowKDJ,
    setShowRSI: setShowRSI, setShowBOLL: setShowBOLL,
    getVisibleCount: getVisibleCount,
    zoomIn: function () { animateZoom(viewBars - 8, 0.5); },
    zoomOut: function () { animateZoom(viewBars + 8, 0.5); },
    resetView: resetView,
    isAutoFollow: isAutoFollow,
    // 划线 API
    setActiveTool: setActiveTool,
    getActiveTool: function () { return activeTool; },
    setDrawingContext: setDrawingContext,
    clearDrawings: clearDrawings,
    deleteSelectedDrawing: deleteSelectedDrawing
  };
})(window);
