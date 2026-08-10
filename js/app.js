/* ===== app.js · 主应用 (v6) =====
 * 日线级别进度、明亮UI
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const HISTORY_KEY = 'kline-trainer-history-v1';
  const WALLET_KEY = 'kline-trainer-wallet-v1';

  // ========== 游戏化钱包模块 ==========
  const Wallet = {
    INITIAL: 100000,
    BANKRUPT_THRESHOLD: 1000,
    FORTUNE_THRESHOLD: 100000000,

    balance: 100000,
    bankruptCount: 0,
    fortuneCount: 0,
    equityHistory: [],

    load: function () {
      try {
        var raw = localStorage.getItem(WALLET_KEY);
        if (raw) {
          var data = JSON.parse(raw);
          this.balance = data.balance || this.INITIAL;
          this.bankruptCount = data.bankruptCount || 0;
          this.fortuneCount = data.fortuneCount || 0;
          this.equityHistory = data.equityHistory || [];
          if (this.equityHistory.length === 0) {
            this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '初始资金' });
          }
        } else {
          this.reset();
        }
      } catch (e) {
        this.reset();
      }
    },

    save: function () {
      localStorage.setItem(WALLET_KEY, JSON.stringify({
        balance: this.balance,
        bankruptCount: this.bankruptCount,
        fortuneCount: this.fortuneCount,
        equityHistory: this.equityHistory
      }));
    },

    reset: function () {
      this.balance = this.INITIAL;
      this.bankruptCount = 0;
      this.fortuneCount = 0;
      this.equityHistory = [{ date: new Date().toLocaleDateString('zh-CN'), balance: this.INITIAL, note: '初始资金' }];
      this.save();
    },

    settle: function (finalEquity) {
      this.balance = finalEquity;
      var event = null;

      if (this.balance >= this.FORTUNE_THRESHOLD) {
        this.fortuneCount++;
        this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '暴富！' + this.fmtNum(this.balance) });
        this.balance = this.INITIAL;
        this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '暴富重置' });
        event = 'fortune';
      }
      else if (this.balance < this.BANKRUPT_THRESHOLD) {
        this.bankruptCount++;
        this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '破产！仅剩' + this.fmtNum(this.balance) });
        this.balance = this.INITIAL;
        this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '破产重置' });
        event = 'bankrupt';
      }
      else {
        this.equityHistory.push({ date: new Date().toLocaleDateString('zh-CN'), balance: this.balance, note: '训练结算' });
      }

      this.save();
      return event;
    },

    getStatus: function () {
      if (this.balance >= this.FORTUNE_THRESHOLD) return 'fortune';
      if (this.balance < this.BANKRUPT_THRESHOLD) return 'bankrupt';
      return 'active';
    },

    fmtNum: function (v) {
      if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
      if (v >= 10000) return (v / 10000).toFixed(1) + '万';
      return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    }
  };

  // ---------- 工具 ----------
  function fmtMoney(v) {
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    return sign + '¥' + abs.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  function fmtNum(v) { return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'toast'; }, 2000);
  }

  // ---------- 历史 ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistory(arr) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  }
  function addHistory(stats, state) {
    const arr = loadHistory();
    arr.unshift({
      id: Date.now(),
      time: new Date().toLocaleString('zh-CN'),
      symbol: state.symbol,
      code: state.code,
      startDate: state.startDate,
      endDate: state.endDate,
      trainStartDate: state.trainStartDate,
      trainEndDate: state.trainEndDate,
      period: state.period,
      isReal: state.isReal,
      pnl: stats.totalPnl,
      pnlPct: stats.totalPnlPct,
      stockReturnPct: stats.stockReturnPct,
      stockStartPrice: stats.stockStartPrice,
      stockEndPrice: stats.stockEndPrice,
      beatMarket: stats.beatMarket,
      winCount: stats.winCount,
      lossCount: stats.lossCount,
      totalTrades: stats.totalTrades,
      winRate: stats.winRate,
      totalWin: stats.winCount > 0 ? stats.avgWin * stats.winCount : 0,
      totalLoss: stats.lossCount > 0 ? stats.avgLoss * stats.lossCount : 0,
      maxWin: stats.maxWin,
      maxLoss: stats.maxLoss,
      equity: stats.finalEquity
    });
    if (arr.length > 200) arr.length = 200;
    saveHistory(arr);
  }

  // ---------- 累计统计 ----------
  function updateGlobalStats() {
    const arr = loadHistory();
    if (arr.length === 0) {
      $('stat-sessions').textContent = '0';
      $('stat-winrate').textContent = '--';
      $('stat-total-pnl').textContent = '¥0';
      $('stat-total-pnl').className = '';
      $('stat-pnl-ratio').textContent = '--';
      $('stat-avg-pnl').textContent = '--';
      $('stat-max-win').textContent = '--';
      $('stat-max-loss').textContent = '--';
      return;
    }
    let totalPnl = 0, totalWin$ = 0, totalLoss$ = 0, wins = 0, trades = 0, maxWin = 0, maxLoss = 0;
    for (let i = 0; i < arr.length; i++) {
      const h = arr[i];
      totalPnl += h.pnl;
      totalWin$ += h.totalWin || 0;
      totalLoss$ += h.totalLoss || 0;
      wins += h.winCount || 0;
      trades += h.totalTrades || 0;
      if (h.maxWin > maxWin) maxWin = h.maxWin;
      if (h.maxLoss < maxLoss) maxLoss = h.maxLoss;
    }
    $('stat-sessions').textContent = arr.length;
    $('stat-winrate').textContent = trades > 0 ? (wins / trades * 100).toFixed(0) + '%' : '--';
    const sp = $('stat-total-pnl');
    sp.textContent = fmtMoney(totalPnl);
    sp.className = cls(totalPnl);
    $('stat-pnl-ratio').textContent = totalLoss$ > 0 ? (totalWin$ / totalLoss$).toFixed(2) : '∞';
    $('stat-avg-pnl').textContent = fmtMoney(totalPnl / arr.length);
    const mw = $('stat-max-win'); mw.textContent = fmtMoney(maxWin); mw.className = 'up';
    const ml = $('stat-max-loss'); ml.textContent = fmtMoney(maxLoss); ml.className = 'down';
  }

  // ---------- 加载遮罩 ----------
  function showLoading(msg) {
    var overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;';
    overlay.innerHTML = '<div style="width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:#4361ee;border-radius:50%;animation:spin .8s linear infinite;"></div>' +
      '<div style="color:#475569;font-size:14px;">' + (msg || '加载中...') + '</div>';
    var style = document.createElement('style');
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
    document.body.appendChild(overlay);
  }
  function hideLoading() {
    var el = document.getElementById('loading-overlay');
    if (el) el.remove();
  }

  // ---------- 开始训练 ----------
  async function newSession() {
    Chart.setReviewMode(false);
    $('result-modal').style.display = 'none';
    $('event-modal').style.display = 'none';
    $('review-bar').style.display = 'none';

    // 显示加载状态
    var loadingEl = showInlineLoading('正在随机选取全市场股票...');

    try {
      var period = Trainer.getConfig().period || 'weekly';
      var market = await Market.generateAsync(150, period);

      var s = Trainer.startWithMarket(market, { capital: Wallet.balance, totalBars: 150, period: period });
      Chart.setData(s.bars, s.trainStart, s.trainEnd);
      Chart.setProgress(s.visibleCount);
      Chart.setTradeMarkers([], null);
      Chart.draw();
      updateAll(s);
      updateWalletUI();
      updateGlobalStats();

      var dataLabel = s.isReal ? '真实A股' : '模拟数据';
      toast('新训练开始 · ' + s.symbol + '（' + s.code + '）· ' + dataLabel, 'success');
    } catch (e) {
      console.error('[App] session start failed:', e);
      toast('数据加载失败，请确认服务器已启动', 'error');
      // 兜底：尝试模拟数据
      var fallback = Trainer.start({ capital: Wallet.balance, totalBars: 150 });
      Chart.setData(fallback.bars, fallback.trainStart, fallback.trainEnd);
      Chart.setProgress(fallback.visibleCount);
      Chart.setTradeMarkers([], null);
      Chart.draw();
      updateAll(fallback);
    }

    if (loadingEl) loadingEl.remove();
  }

  function showInlineLoading(msg) {
    var el = document.createElement('div');
    el.id = 'inline-loading';
    el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;background:rgba(255,255,255,.9);border-radius:12px;padding:20px 32px;box-shadow:0 4px 24px rgba(0,0,0,.1);display:flex;align-items:center;gap:12px;';
    el.innerHTML = '<div style="width:24px;height:24px;border:2px solid #e2e8f0;border-top-color:#4361ee;border-radius:50%;animation:spin .8s linear infinite;"></div>' +
      '<span style="color:#475569;font-size:14px;">' + (msg || '加载中...') + '</span>';
    var chartArea = document.querySelector('.chart-area');
    if (chartArea) chartArea.appendChild(el);
    else document.body.appendChild(el);
    return el;
  }

  // ---------- UI 更新 ----------
  function updateAll(s) {
    if (!s || !s.lastBar) return;
    const bar = s.lastBar;

    // 价格信息
    const isUp = bar.change >= 0;
    $('price-current').textContent = bar.close.toFixed(2);
    $('price-current').className = 'b ' + (isUp ? 'up' : 'down');
    const pc = $('price-change');
    pc.textContent = (bar.change >= 0 ? '+' : '') + bar.change.toFixed(2);
    pc.className = 'b ' + cls(bar.change);
    const pp = $('price-pct');
    pp.textContent = fmtPct(bar.pct);
    pp.className = 'b ' + cls(bar.pct);
    $('price-open').textContent = bar.open.toFixed(2);
    $('price-high').textContent = bar.high.toFixed(2);
    $('price-low').textContent = bar.low.toFixed(2);
    $('price-vol').textContent = fmtNum(bar.volume);

    // 进度（日线级别）
    var dailyProg = s.dailyProgress || 0;
    var dailyTotal = s.dailyTotal || 150;
    $('progress-label').textContent = '日线 ' + dailyProg + ' / ' + dailyTotal;
    $('progress-bar').style.width = (dailyProg / dailyTotal * 100) + '%';

    // 周期信息
    var periodLabel = s.period === 'daily' ? '日线' : s.period === 'weekly' ? '周线' : '月线';
    $('period-label').textContent = periodLabel;

    // 账户
    $('account-balance').textContent = fmtMoney(s.capital);
    $('account-cash').textContent = fmtMoney(s.cash);
    const pos = s.position;
    const posVal = pos ? pos.qty * pos.price : 0;
    $('account-equity').textContent = fmtMoney(s.equity);
    const ap = $('account-pnl');
    ap.textContent = fmtMoney(s.pnl);
    ap.className = cls(s.pnl);

    // 持仓
    if (pos) {
      $('position-empty').style.display = 'none';
      $('position-info').style.display = 'grid';
      const dir = $('pos-dir'); dir.textContent = '多头'; dir.className = 'long';
      $('pos-qty').textContent = pos.qty;
      $('pos-cost').textContent = '¥' + pos.cost.toFixed(2);
      $('pos-price').textContent = '¥' + pos.price.toFixed(2);
      const ppnl = $('pos-pnl'); ppnl.textContent = fmtMoney(pos.pnl); ppnl.className = cls(pos.pnl);
      const ppp = $('pos-pnl-pct'); ppp.textContent = fmtPct(pos.pnlPct); ppp.className = cls(pos.pnlPct);
    } else {
      $('position-empty').style.display = 'block';
      $('position-info').style.display = 'none';
    }

    // 按钮状态
    $('btn-buy-half').disabled = !!pos || s.finished;
    $('btn-buy-full').disabled = !!pos || s.finished;
    $('btn-sell-half').disabled = !pos || s.finished;
    $('btn-sell-full').disabled = !pos || s.finished;
    $('btn-next').disabled = s.finished;
    $('btn-close').disabled = !pos || s.finished;
    $('btn-finish').disabled = s.finished;
    if (s.finished) $('btn-next').textContent = '训练已结束';
    else $('btn-next').textContent = '观望下一根 ▶';

    // 交易日志
    const log = $('trade-log');
    if (s.trades.length === 0) {
      log.innerHTML = '<div class="log-empty">暂无交易</div>';
    } else {
      let html = '';
      for (let i = s.trades.length - 1; i >= 0 && i >= s.trades.length - 30; i--) {
        const t = s.trades[i];
        const pnlStr = t.type === 'sell' ? '<span class="log-pnl ' + cls(t.pnl) + '">' + (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(0) + '</span>' : '';
        html += '<div class="log-item"><span class="log-act ' + t.type + '">' +
          (t.type === 'buy' ? '买' : '卖') + '</span><span>¥' + t.price.toFixed(2) + ' ×' + t.qty + '</span>' + pnlStr + '</div>';
      }
      log.innerHTML = html;
    }
  }

  // ---------- 仓位计算 ----------
  function halfPositionQty() {
    var s = Trainer.getState();
    if (!s || !s.lastBar) return 0;
    var price = s.lastBar.close;
    var halfCash = s.cash / 2;
    var maxAfford = Math.floor(halfCash / (price * (1 + (s.fee || 0.0003))));
    return maxAfford;
  }

  function fullPositionQty() {
    var s = Trainer.getState();
    if (!s || !s.lastBar) return 0;
    var price = s.lastBar.close;
    var maxAfford = Math.floor(s.cash / (price * (1 + (s.fee || 0.0003))));
    return maxAfford;
  }

  // ---------- 交易操作（仓位档位） ----------
  function doBuyHalf() {
    var qty = halfPositionQty();
    if (qty <= 0) { toast('资金不足', 'warn'); return; }
    var s = Trainer.buy(qty);
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
    if (s.position) toast('半仓买入 ' + qty + ' 股 @ ¥' + s.position.cost.toFixed(2), 'success');
  }

  function doBuyFull() {
    var qty = fullPositionQty();
    if (qty <= 0) { toast('资金不足', 'warn'); return; }
    var s = Trainer.buy(qty);
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
    if (s.position) toast('全仓买入 ' + qty + ' 股 @ ¥' + s.position.cost.toFixed(2), 'success');
  }

  function doSellHalf() {
    var pos = Trainer.getState().position;
    if (!pos) return;
    var qty = Math.max(1, Math.floor(pos.qty / 2));
    var s = Trainer.sell(qty);
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
    toast('半仓卖出 ' + qty + ' 股 @ ¥' + (s.lastBar ? s.lastBar.close.toFixed(2) : '--'), 'success');
  }

  function doSellFull() {
    var pos = Trainer.getState().position;
    if (!pos) return;
    var s = Trainer.sell(pos.qty);
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
    toast('全仓卖出 ' + pos.qty + ' 股', 'success');
  }

  function doNext() {
    const s = Trainer.next();
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
  }

  function doClose() {
    const s = Trainer.close();
    Chart.setProgress(s.visibleCount);
    Chart.setTradeMarkers(s.trades, s.position);
    Chart.draw();
    updateAll(s);
    toast('已平仓', 'success');
  }

  function doFinish() { Trainer.finish(); }

  // ---------- 复盘模式 ----------
  function enterReview() {
    $('result-modal').style.display = 'none';
    var s = Trainer.getState();
    var stats = Trainer.getStats();
    Chart.setReviewMode(true);
    Chart.setTradeMarkers(s.trades, null);  // 复盘时 position 已清空但保留交易记录

    var periodLabel = s.period === 'daily' ? '日线' : s.period === 'weekly' ? '周线' : '月线';
    var dateRange = s.trainStartDate && s.trainEndDate ? (s.trainStartDate + ' ~ ' + s.trainEndDate) : '';
    var beatLabel = stats.beatMarket >= 0 ? '跑赢' : '跑输';
    var reviewBar = $('review-bar');
    reviewBar.innerHTML =
      '<div class="review-info">' +
        '<span class="review-stock"><b>' + s.symbol + '</b>（' + s.code + '）</span>' +
        '<span class="review-period">' + periodLabel + ' · 训练周期 ' + dateRange + '</span>' +
        '<span class="review-result ' + cls(stats.totalPnl) + '">你的收益 ' + fmtPct(stats.totalPnlPct) + '</span>' +
        '<span class="review-stock-ret ' + cls(stats.stockReturnPct) + '">股票涨幅 ' + fmtPct(stats.stockReturnPct) + '</span>' +
        '<span class="review-beat ' + cls(stats.beatMarket) + '">' + beatLabel + ' ' + fmtPct(Math.abs(stats.beatMarket)) + '</span>' +
        '<span class="review-trades">交易 ' + stats.totalTrades + ' 笔 · 胜率 ' + (stats.totalTrades > 0 ? stats.winRate.toFixed(0) + '%' : '—') + '</span>' +
        '<span class="review-data">' + (s.isReal ? '真实行情' : '模拟行情') + '</span>' +
      '</div>' +
      '<button id="btn-review-next" class="btn btn-primary" style="padding:6px 16px;font-size:13px;">下一盘</button>';
    reviewBar.style.display = 'flex';
    $('btn-review-next').onclick = newSession;
    toast('复盘模式 · 可查看完整K线走势（含训练后数据）', 'success');
  }

  // ---------- 训练结束 ----------
  Trainer.onFinish(function (s) {
    var stats = Trainer.getStats();
    addHistory(stats, s);
    updateGlobalStats();

    var event = Wallet.settle(stats.finalEquity);
    updateWalletUI();

    if (event === 'bankrupt') {
      showEventModal('bankrupt', stats);
    } else if (event === 'fortune') {
      showEventModal('fortune', stats);
    } else {
      showResult(s, stats);
    }
  });

  function showEventModal(type, stats) {
    var isBankrupt = type === 'bankrupt';
    $('event-icon').textContent = isBankrupt ? '💸' : '🤑';
    var titleEl = $('event-title');
    titleEl.textContent = isBankrupt ? '破产！' : '暴富！';
    titleEl.className = 'event-title ' + type;
    $('event-desc').textContent = isBankrupt
      ? '资金已跌破 ¥1,000，回到起点重新开始。'
      : '恭喜！资金突破 1 亿大关，回到起点重新开始。';
    $('event-stats').innerHTML =
      '<div>本局收益：<b class="' + cls(stats.totalPnl) + '">' + fmtMoney(stats.totalPnl) + '</b> (' + fmtPct(stats.totalPnlPct) + ')</div>' +
      '<div>累计破产：<b>' + Wallet.bankruptCount + '</b> 次　｜　累计暴富：<b>' + Wallet.fortuneCount + '</b> 次</div>' +
      '<div>当前资金已重置为：<b>' + fmtMoney(Wallet.INITIAL) + '</b></div>';
    $('event-modal').style.display = 'flex';
    $('result-modal').style.display = 'none';
    updateWalletUI();
  }

  function showResult(s, stats) {
    $('result-title').textContent = '训练完成 · ' + (s.pnl >= 0 ? '盈利' : '亏损');
    var dateRange = s.trainStartDate && s.trainEndDate ? (s.trainStartDate + ' ~ ' + s.trainEndDate) : (s.startDate || '');
    var dataLabel = s.isReal ? '真实行情' : '模拟行情';
    var periodLabel = s.period === 'daily' ? '日线' : s.period === 'weekly' ? '周线' : '月线';
    var hasAutoSold = s._autoSold;

    // 股票 + 钱包信息
    $('result-info').innerHTML =
      '<div>本次股票：<b>' + s.symbol + '</b>（' + s.code + '）· ' + periodLabel + ' · 日线训练 ' + (s.dailyProgress || 0) + ' / ' + (s.dailyTotal || 150) + ' · <span style="color:' + (s.isReal ? '#ef4444' : '#94a3b8') + '">' + dataLabel + '</span></div>' +
      '<div>游戏资金：<b>' + fmtMoney(Wallet.balance) + '</b> ｜ 破产 <b>' + Wallet.bankruptCount + '</b> 次 ｜ 暴富 <b>' + Wallet.fortuneCount + '</b> 次</div>' +
      (hasAutoSold ? '<div style="color:var(--orange);font-size:12px;margin-top:2px;">⚠ 训练结束时仍有持仓，已按收盘价自动卖出</div>' : '');

    // 卡片（7张，3列 grid）
    $('result-summary').innerHTML =
      card('你的收益', fmtPct(stats.totalPnlPct), cls(stats.totalPnlPct)) +
      card('股票涨幅', fmtPct(stats.stockReturnPct), cls(stats.stockReturnPct)) +
      card('超额收益', fmtPct(stats.beatMarket), cls(stats.beatMarket)) +
      card('最终资产', fmtMoney(stats.finalEquity), '') +
      card('胜率', stats.totalTrades > 0 ? stats.winRate.toFixed(1) + '%' : '—', '') +
      card('盈亏比', stats.pnlRatio >= 99 ? '∞' : stats.pnlRatio.toFixed(2), '') +
      card('交易次数', stats.totalTrades + '笔', '');

    drawEquityCurve(stats.equityCurve, stats);
    $('result-modal').style.display = 'flex';
  }

  function card(label, val, c) {
    return '<div class="result-card"><label>' + label + '</label><b class="' + c + '">' + val + '</b></div>';
  }

  // ---------- 钱包 UI ----------
  function updateWalletUI() {
    $('wallet-balance').textContent = fmtMoney(Wallet.balance);
    $('wallet-bankrupt').textContent = Wallet.bankruptCount + ' 次';
    $('wallet-fortune').textContent = Wallet.fortuneCount + ' 次';

    var statusEl = $('wallet-status');
    var status = Wallet.getStatus();
    statusEl.className = 'wallet-status ' + status;
    if (status === 'active') statusEl.textContent = '进行中';
    else if (status === 'bankrupt') statusEl.textContent = '濒临破产';
    else statusEl.textContent = '即将暴富';

    var s = Trainer.getState();
    if (s) { $('account-balance').textContent = fmtMoney(s.capital); }
    drawAssetCurve();
  }

  function drawAssetCurve() {
    var cv = $('asset-curve-canvas');
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    cv.width = rect.width * dpr; cv.height = rect.height * dpr;
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);

    var history = Wallet.equityHistory;
    if (!history || history.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('尚无足够数据', w / 2, h / 2);
      return;
    }

    var points = history.slice(-50);
    var balances = points.map(function (p) { return p.balance; });
    var min = Math.min.apply(null, balances);
    var max = Math.max.apply(null, balances);
    var range = max - min;
    if (range < 1) range = 1;
    var pad = range * 0.1;
    min -= pad; max += pad;

    var padL = 4, padR = 4, padT = 14, padB = 4;
    var cw = w - padL - padR, ch = h - padT - padB;

    var baseY = padT + ch * (1 - (Wallet.INITIAL - min) / (max - min));
    ctx.strokeStyle = 'rgba(0,0,0,.1)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(w - padR, baseY); ctx.stroke();
    ctx.setLineDash([]);

    var lastBal = points[points.length - 1].balance;
    var isUp = lastBal >= Wallet.INITIAL;
    var lineColor = isUp ? '#ef4444' : '#22c55e';
    var fillColor = isUp ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)';

    ctx.beginPath();
    ctx.moveTo(padL, padT + ch);
    for (var i = 0; i < points.length; i++) {
      var x = padL + cw * i / (points.length - 1);
      var y = padT + ch * (1 - (points[i].balance - min) / (max - min));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(padL + cw, padT + ch);
    ctx.closePath();
    ctx.fillStyle = fillColor; ctx.fill();

    ctx.beginPath();
    for (i = 0; i < points.length; i++) {
      x = padL + cw * i / (points.length - 1);
      y = padT + ch * (1 - (points[i].balance - min) / (max - min));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.5; ctx.stroke();

    for (i = 0; i < points.length; i++) {
      if (points[i].note && points[i].note.indexOf('破产') >= 0) {
        x = padL + cw * i / (points.length - 1);
        y = padT + ch * (1 - (points[i].balance - min) / (max - min));
        ctx.fillStyle = '#f97316';
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke();
      } else if (points[i].note && points[i].note.indexOf('暴富') >= 0) {
        x = padL + cw * i / (points.length - 1);
        y = padT + ch * (1 - (points[i].balance - min) / (max - min));
        ctx.fillStyle = '#eab308';
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke();
      }
    }

    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = lineColor;
    ctx.fillText(Wallet.fmtNum(lastBal), w - padR, padT);
  }

  function drawEquityCurve(curve, stats) {
    const cv = $('equity-canvas');
    const rect = cv.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    cv.width = rect.width * d; cv.height = rect.height * d;
    const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    if (!curve || curve.length < 2) return;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < curve.length; i++) { min = Math.min(min, curve[i]); max = Math.max(max, curve[i]); }

    const capital = Trainer.getConfig().capital;
    if (stats) {
      const stockEndEquity = capital * (1 + stats.stockReturnPct / 100);
      min = Math.min(min, stockEndEquity);
      max = Math.max(max, stockEndEquity, capital);
    }

    const pad_ = (max - min) * 0.1 || 1; min -= pad_; max += pad_;
    const padL = 8, padR = 8, padT = 10, padB = 10;
    const cw_ = w - padL - padR, ch = h - padT - padB;
    const isProfit = curve[curve.length - 1] >= capital;
    const lineColor = isProfit ? '#ef4444' : '#22c55e';
    const fillColor = isProfit ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)';

    const baseY = padT + ch * (1 - (capital - min) / (max - min));
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(w - padR, baseY); ctx.stroke();
    ctx.setLineDash([]);

    if (stats && stats.stockReturnPct !== undefined) {
      const stockEndY = padT + ch * (1 - (capital * (1 + stats.stockReturnPct / 100) - min) / (max - min));
      ctx.strokeStyle = 'rgba(148,163,184,.4)';
      ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(padL + cw_, stockEndY); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(padL, padT + ch);
    for (let i = 0; i < curve.length; i++) {
      const x = padL + cw_ * i / (curve.length - 1);
      const y = padT + ch * (1 - (curve[i] - min) / (max - min));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(padL + cw_, padT + ch);
    ctx.closePath();
    ctx.fillStyle = fillColor; ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const x = padL + cw_ * i / (curve.length - 1);
      const y = padT + ch * (1 - (curve[i] - min) / (max - min));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.stroke();

    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = lineColor;
    ctx.fillText('你的资金', w - padR, padT + 10);
    if (stats) {
      ctx.fillStyle = 'rgba(148,163,184,.7)';
      ctx.fillText('买入持有', w - padR, padT + 22);
    }
  }

  // ---------- 历史弹窗 ----------
  function showHistory() {
    const arr = loadHistory();
    const list = $('history-list');
    if (arr.length === 0) {
      list.innerHTML = '<div class="log-empty">暂无训练记录</div>';
    } else {
      let html = '<div class="history-item" style="color:#94a3b8;font-weight:600;">' +
        '<span class="hi-label">时间</span><span class="hi-label">股票</span><span class="hi-label">你的收益</span><span class="hi-label">股票涨幅</span><span class="hi-label">超额</span><span class="hi-label">胜率</span><span class="hi-label">盈亏</span></div>';
      for (let i = 0; i < arr.length; i++) {
        const h = arr[i];
        html += '<div class="history-item">' +
          '<span class="hi-val">' + h.time + '</span>' +
          '<span class="hi-val">' + (h.symbol || '—') + '</span>' +
          '<span class="hi-val ' + cls(h.pnlPct) + '">' + fmtPct(h.pnlPct) + '</span>' +
          '<span class="hi-val ' + cls(h.stockReturnPct || 0) + '">' + fmtPct(h.stockReturnPct || 0) + '</span>' +
          '<span class="hi-val ' + cls(h.beatMarket || 0) + '">' + fmtPct(h.beatMarket || 0) + '</span>' +
          '<span class="hi-val">' + (h.totalTrades > 0 ? h.winRate.toFixed(0) + '%' : '—') + '</span>' +
          '<span class="hi-val ' + cls(h.pnl) + '">' + fmtMoney(h.pnl) + '</span></div>';
      }
      list.innerHTML = html;
    }
    $('history-modal').style.display = 'flex';
  }

  // ---------- 设置 ----------
  function openSettings() {
    var cfg = Trainer.getConfig();
    var setPeriod = $('set-period');
    if (setPeriod) setPeriod.value = cfg.period || 'weekly';
    $('set-bars').value = cfg.totalBars;
    $('set-capital').value = cfg.capital;
    $('set-fee').value = cfg.fee;
    $('set-style').value = cfg.style;
    $('settings-modal').style.display = 'flex';
  }
  function saveSettings() {
    var newPeriod = $('set-period').value;
    Trainer.setConfig({
      totalBars: parseInt($('set-bars').value, 10),
      capital: parseFloat($('set-capital').value),
      fee: parseFloat($('set-fee').value),
      style: $('set-style').value,
      period: newPeriod
    });
    var periodBtns = document.querySelectorAll('.period-btn');
    for (var i = 0; i < periodBtns.length; i++) {
      if (periodBtns[i].getAttribute('data-period') === newPeriod) periodBtns[i].classList.add('active');
      else periodBtns[i].classList.remove('active');
    }
    $('settings-modal').style.display = 'none';
    toast('设置已保存，将在下一局生效', 'success');
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $('btn-buy-half').onclick = doBuyHalf;
    $('btn-buy-full').onclick = doBuyFull;
    $('btn-sell-half').onclick = doSellHalf;
    $('btn-sell-full').onclick = doSellFull;
    $('btn-next').onclick = doNext;
    $('btn-close').onclick = doClose;
    $('btn-restart').onclick = function () { if (confirm('确定重新开始训练？当前进度将丢失')) newSession(); };
    $('btn-finish').onclick = doFinish;
    $('btn-result-restart').onclick = newSession;
    $('btn-result-review').onclick = enterReview;
    $('btn-result-close').onclick = function () { $('result-modal').style.display = 'none'; };
    $('btn-history').onclick = showHistory;
    $('btn-history-close').onclick = function () { $('history-modal').style.display = 'none'; };
    $('btn-clear-history').onclick = function () {
      if (confirm('确定清空所有训练记录？此操作不可恢复')) {
        saveHistory([]); updateGlobalStats(); showHistory(); toast('记录已清空', 'success');
      }
    };
    $('btn-settings').onclick = openSettings;
    $('btn-settings-close').onclick = function () { $('settings-modal').style.display = 'none'; };
    $('btn-settings-save').onclick = saveSettings;
    $('btn-event-ok').onclick = function () {
      $('event-modal').style.display = 'none';
      newSession();
    };

    // 周期选择器
    var periodBtns = document.querySelectorAll('.period-btn');
    for (var pi = 0; pi < periodBtns.length; pi++) {
      periodBtns[pi].onclick = function () {
        var period = this.getAttribute('data-period');
        for (var j = 0; j < periodBtns.length; j++) periodBtns[j].classList.remove('active');
        this.classList.add('active');
        Trainer.setConfig({ period: period });
        var setPeriod = $('set-period');
        if (setPeriod) setPeriod.value = period;
        var s = Trainer.changePeriod(period);
        if (s) {
          Chart.setData(s.bars, s.trainStart, s.trainEnd);
          Chart.setProgress(s.visibleCount);
          Chart.draw();
          updateAll(s);
          toast('已切换至' + (period === 'daily' ? '日线' : period === 'weekly' ? '周线' : '月线') + ' · 同一只股票', 'success');
        }
      };
    }

    $('btn-zoom-in').onclick = function () { Chart.zoomIn(); };
    $('btn-zoom-out').onclick = function () { Chart.zoomOut(); };
    $('btn-zoom-reset').onclick = function () { Chart.resetView(); };

    $('toggle-macd').onchange = function () { Chart.setShowMACD(this.checked); };
    $('toggle-vol').onchange = function () {
      Chart.setShowVol(this.checked);
      $('vol-wrap').style.display = this.checked ? '' : 'none';
    };
    $('toggle-boll').onchange = function () { Chart.setShowBOLL(this.checked); };
    $('toggle-macd').onchange = function () { Chart.setShowMACD(this.checked); };
    $('toggle-kdj').onchange = function () { Chart.setShowKDJ(this.checked); };
    $('toggle-rsi').onchange = function () { Chart.setShowRSI(this.checked); };

    // 键盘快捷键（仓位档位状态机）
    var pendingKeyAction = null;  // 'buy' | 'sell' | null
    var pendingKeyTimer = null;

    function clearKeyPending() {
      pendingKeyAction = null;
      $('key-hint').textContent = '';
      $('key-hint').className = 'key-hint';
      if (pendingKeyTimer) { clearTimeout(pendingKeyTimer); pendingKeyTimer = null; }
    }

    function showKeyHint(msg) {
      $('key-hint').textContent = msg;
      $('key-hint').className = 'key-hint visible';
    }

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      var s = Trainer.getState();
      if (!s || s.finished) { clearKeyPending(); return; }

      // 仓位子选项：1=半仓 2=全仓
      if (pendingKeyAction && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        var action = pendingKeyAction;
        clearKeyPending();
        if (action === 'buy') {
          if (e.key === '1') doBuyHalf();
          else if (e.key === '2') doBuyFull();
        } else if (action === 'sell') {
          if (!s.position) return;
          if (e.key === '1') doSellHalf();
          else if (e.key === '2') doSellFull();
        }
        return;
      }

      // b = 进入买入选仓模式
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (s.position) { toast('已有持仓，先卖出', 'warn'); return; }
        pendingKeyAction = 'buy';
        showKeyHint('📈 选择仓位：1 = 半仓买入　｜　2 = 全仓买入');
        if (pendingKeyTimer) clearTimeout(pendingKeyTimer);
        pendingKeyTimer = setTimeout(clearKeyPending, 3000);
        return;
      }

      // m = 进入卖出选仓模式
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (!s.position) { toast('没有持仓', 'warn'); return; }
        pendingKeyAction = 'sell';
        showKeyHint('📉 选择仓位：1 = 半仓卖出　｜　2 = 全仓卖出');
        if (pendingKeyTimer) clearTimeout(pendingKeyTimer);
        pendingKeyTimer = setTimeout(clearKeyPending, 3000);
        return;
      }

      // 其他键清除等待状态
      clearKeyPending();

      if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); doNext(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (s.position) doClose(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearKeyPending(); }
    });

    let rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { Chart.resize(); drawAssetCurve(); }, 200);
    });
  }

  // ---------- 启动 ----------
  async function boot() {
    Wallet.load();

    // 快速检测服务器是否可用
    var ok = await Market.checkServer();

    var badge = document.querySelector('.sim-badge');
    if (badge) {
      if (ok) {
        badge.textContent = '全市场随机';
        badge.className = 'info-item sim-badge real-badge';
        badge.title = '真实A股历史K线数据 · 全市场 5000+ 只股票随机选取';
      } else {
        badge.textContent = '离线模式';
        badge.title = '服务器未启动，使用本地离线数据';
      }
    }

    Chart.init();
    bind();
    await newSession();
    updateGlobalStats();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); });
  else boot();
})();
