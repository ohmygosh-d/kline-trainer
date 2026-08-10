/* ===== trainer.js · 训练逻辑 (v6) =====
 * 日线级别进度追踪：150根始终指日线，
 * 周线/月线下 next() 按该周期的实际日线数扣除
 */
(function (global) {
  'use strict';

  var state = null;
  var config = { capital: 100000, fee: 0.0003, totalBars: 150, style: 'mixed', period: 'weekly' };
  var equityCurve = [];
  var onFinishCb = null;

  // ---------- 开始训练 ----------
  function start(cfg) {
    if (cfg) config = Object.assign({}, config, cfg);

    var market = global.Market.generate(config.totalBars, config.style, config.period);
    return buildState(market);
  }

  // 接受预加载的市场数据（异步模式下使用）
  function startWithMarket(market, cfg) {
    if (cfg) config = Object.assign({}, config, cfg);
    return buildState(market);
  }

  function buildState(market) {
    var bars = market.bars;
    var rawDaily = market.rawDailyBars || null;
    var aggTrainStart = market.trainStart || 0;
    var aggTrainCount = Math.min(market.trainCount || config.totalBars, bars.length - aggTrainStart);
    var aggTrainEnd = aggTrainStart + aggTrainCount;

    // 日线级别数据
    var dailyTrainStart = market.dailyTrainStart != null ? market.dailyTrainStart : aggTrainStart;
    var dailyTrainEnd = market.dailyTrainEnd != null ? market.dailyTrainEnd : (dailyTrainStart + config.totalBars);
    var dailyTotal = market.dailyTotal || config.totalBars;

    var sessionCapital = config.capital;

    state = {
      bars: bars,
      rawDailyBars: rawDaily,
      symbol: market.symbol,
      code: market.code,
      startDate: market.startDate,
      endDate: market.endDate || null,
      isReal: market.isReal || false,
      period: config.period || 'weekly',

      // 聚合K线级别
      aggTrainStart: aggTrainStart,
      aggTrainCount: aggTrainCount,
      aggTrainEnd: aggTrainEnd,
      visibleCount: Math.max(1, aggTrainStart),  // 当前显示到的聚合K线位置
      totalBars: bars.length,

      // 日线级别
      dailyTrainStart: dailyTrainStart,
      dailyTrainEnd: dailyTrainEnd,
      dailyTotal: dailyTotal,
      dailyProgress: 0,   // 已消耗的日线数量（从训练开始算）
      currentDailyIdx: dailyTrainStart - 1,  // 当前最新揭示到的日线索引

      cash: sessionCapital,
      capital: sessionCapital,
      position: null,
      trades: [],
      finished: false,
      fee: config.fee
    };

    // 启动时揭示所有历史K线（aggTrainStart 之前的部分已经可见）
    // dailyProgress 从 0 开始
    equityCurve = [];
    recordEquity();
    return getState();
  }

  // ---------- 切换周期（不换股票，保留日线进度） ----------
  function changePeriod(newPeriod) {
    if (!state || !state.rawDailyBars) return getState();

    config.period = newPeriod;

    // 从原始日线重新聚合
    var newBars = global.Market.aggregate(state.rawDailyBars, newPeriod);

    // 根据当前日线进度找到对应的聚合K线
    var currentDaily = state.currentDailyIdx;  // 当前揭示到的日线索引
    var newVisible = 0;
    for (var i = 0; i < newBars.length; i++) {
      if (newBars[i].dailyEnd >= currentDaily) {
        newVisible = i + 1;  // 揭示到包含 currentDaily 的那根K线
        break;
      }
    }
    if (newVisible === 0) newVisible = 1;

    // 确保至少有历史K线可见（至少 10 根聚合K线的历史）
    var newAggStart = 0;
    for (var j = 0; j < newBars.length; j++) {
      if (newBars[j].dailyEnd >= state.dailyTrainStart) {
        newAggStart = j;
        break;
      }
    }
    // 确保 visibleCount >= newAggStart（所有历史K线可见）
    newVisible = Math.max(newVisible, newAggStart);

    // 映射训练终点
    var newAggEnd = newBars.length;
    for (var k = newAggStart; k < newBars.length; k++) {
      if (newBars[k].dailyStart >= state.dailyTrainEnd) {
        newAggEnd = k;
        break;
      }
    }

    state.bars = newBars;
    state.period = newPeriod;
    state.aggTrainStart = newAggStart;
    state.aggTrainEnd = newAggEnd;
    state.aggTrainCount = newAggEnd - newAggStart;
    state.visibleCount = newVisible;
    state.totalBars = newBars.length;
    state.position = null;
    state.trades = [];
    state.finished = false;
    equityCurve = [];

    // 日线进度不变
    recordEquity();
    return getState();
  }

  // ---------- 内部 ----------
  function currentBar() {
    if (!state || state.bars.length === 0) return null;
    // 始终返回最新的聚合K线（用户看到的这根）
    var idx = Math.min(state.visibleCount - 1, state.bars.length - 1);
    return state.bars[Math.max(0, idx)];
  }

  function currentPrice() {
    var b = currentBar();
    return b ? b.close : 0;
  }

  function recordEquity() {
    var posVal = state.position ? state.position.qty * currentPrice() : 0;
    equityCurve.push(state.cash + posVal);
  }

  function calcPosition() {
    if (!state.position) return null;
    var price = currentPrice();
    var pos = state.position;
    var pnl = (price - pos.cost) * pos.qty;
    var pnlPct = pos.cost > 0 ? (pnl / (pos.cost * pos.qty)) * 100 : 0;
    return {
      dir: pos.dir, qty: pos.qty, cost: pos.cost, price: price,
      pnl: pnl, pnlPct: pnlPct, entryIdx: pos.entryIdx
    };
  }

  // ---------- 买入（在当前聚合K线收盘价成交） ----------
  function buy(qty) {
    if (!state || state.position || state.finished) return getState();
    var price = currentPrice();
    var feeAmt = price * qty * state.fee;
    var need = price * qty + feeAmt;
    if (state.cash < need) {
      qty = Math.floor(state.cash / (price * (1 + state.fee)) / 100) * 100;
      if (qty <= 0) return getState();
    }
    var cost = price * qty;
    var fee = cost * state.fee;
    state.cash -= (cost + fee);
    state.position = { dir: 'long', qty: qty, cost: price, entryIdx: state.visibleCount - 1 };
    state.trades.push({ type: 'buy', idx: state.visibleCount - 1, price: price, qty: qty, pnl: 0 });
    recordEquity();
    return getState();
  }

  function sell(qty) {
    if (!state || !state.position || state.finished) return getState();
    qty = Math.min(qty, state.position.qty);
    var price = currentPrice();
    var pnl = (price - state.position.cost) * qty - price * qty * state.fee;
    var proceeds = price * qty;
    var fee = proceeds * state.fee;
    state.cash += (proceeds - fee);
    state.position.qty -= qty;
    state.trades.push({ type: 'sell', idx: state.visibleCount - 1, price: price, qty: qty, pnl: pnl });
    if (state.position.qty <= 0) state.position = null;
    recordEquity();
    return getState();
  }

  // ---------- 推进一根K线 ----------
  // 在聚合K线级别推进：每次 visibleCount +1，
  // 日线级别按该聚合K线的 dailyCount 扣除
  function next() {
    if (!state || state.finished) return getState();

    // 获取即将揭示的下一个聚合K线的日线数量
    var nextBar = state.bars[state.visibleCount];
    var dailyStep = nextBar ? (nextBar.dailyCount || 1) : 1;

    // 检查是否超过训练终点
    if (state.visibleCount >= state.aggTrainEnd) {
      finish();
      return getState();
    }

    // 前进一根聚合K线
    state.visibleCount++;

    // 更新日线进度
    state.dailyProgress += dailyStep;
    state.currentDailyIdx = Math.min(
      state.dailyTrainEnd - 1,
      state.bars[state.visibleCount - 1].dailyEnd
    );

    recordEquity();

    // 日线消耗达到目标 或 聚合K线到终点 → 结束
    if (state.dailyProgress >= state.dailyTotal || state.visibleCount >= state.aggTrainEnd) {
      finish();
    }

    return getState();
  }

  function close() {
    if (!state || !state.position) return getState();
    return sell(state.position.qty);
  }

  function finish() {
    if (state.finished) return;
    if (state.position) {
      var price = currentPrice();
      var pos = state.position;
      state.cash += price * pos.qty - price * pos.qty * state.fee;
      state.trades.push({ type: 'sell', idx: state.visibleCount - 1, price: price, qty: pos.qty, pnl: (price - pos.cost) * pos.qty - price * pos.qty * state.fee });
      state.position = null;
      state._autoSold = true;
    }
    state.finished = true;
    if (onFinishCb) onFinishCb(getState());
  }

  function getState() {
    if (!state) return null;
    var pos = calcPosition();
    var posVal = pos ? pos.qty * pos.price : 0;
    var trainProgress = Math.max(0, state.dailyProgress);
    return {
      bars: state.bars,
      rawDailyBars: state.rawDailyBars,
      symbol: state.symbol,
      code: state.code,
      startDate: state.startDate,
      endDate: state.endDate,
      isReal: state.isReal,
      period: state.period,
      // 向后兼容 + 新字段
      trainStart: state.aggTrainStart,
      trainCount: state.aggTrainCount,
      trainEnd: state.aggTrainEnd,
      trainStartDate: state.bars[state.aggTrainStart] ? state.bars[state.aggTrainStart].date : null,
      trainEndDate: state.bars[Math.min(state.aggTrainEnd - 1, state.bars.length - 1)] ? state.bars[Math.min(state.aggTrainEnd - 1, state.bars.length - 1)].date : null,
      trainProgress: trainProgress,
      dailyProgress: state.dailyProgress,
      dailyTotal: state.dailyTotal,
      visibleCount: state.visibleCount,
      totalBars: state.totalBars,
      cash: state.cash,
      capital: state.capital,
      position: pos,
      trades: state.trades.slice(),
      finished: state.finished,
      fee: state.fee,
      equity: state.cash + posVal,
      lastBar: currentBar(),
      pnl: (state.cash + posVal) - state.capital,
      pnlPct: ((state.cash + posVal) - state.capital) / state.capital * 100,
      _autoSold: state._autoSold || false
    };
  }

  function getStats() {
    if (!state) return null;
    var sells = state.trades.filter(function (t) { return t.type === 'sell'; });
    var wins = sells.filter(function (t) { return t.pnl > 0; });
    var losses = sells.filter(function (t) { return t.pnl < 0; });
    var totalWin = wins.reduce(function (s, t) { return s + t.pnl; }, 0);
    var totalLoss = Math.abs(losses.reduce(function (s, t) { return s + t.pnl; }, 0));
    var s = getState();

    // 股票区间买入持有收益率（用聚合K线的起止点）
    var stockStartBar = state.bars[state.aggTrainStart];
    var stockEndBar = state.bars[Math.min(state.aggTrainEnd - 1, state.bars.length - 1)];
    var stockReturn = 0, stockReturnPct = 0;
    if (stockStartBar && stockEndBar && stockStartBar.close > 0) {
      stockReturn = stockEndBar.close - stockStartBar.close;
      stockReturnPct = (stockEndBar.close / stockStartBar.close - 1) * 100;
    }

    var beatMarket = s.pnlPct - stockReturnPct;

    return {
      sessions: 0,
      totalPnl: s.pnl,
      totalPnlPct: s.pnlPct,
      stockReturn: stockReturn,
      stockReturnPct: stockReturnPct,
      stockStartPrice: stockStartBar ? stockStartBar.close : 0,
      stockEndPrice: stockEndBar ? stockEndBar.close : 0,
      beatMarket: beatMarket,
      winCount: wins.length,
      lossCount: losses.length,
      totalTrades: sells.length,
      winRate: sells.length > 0 ? (wins.length / sells.length * 100) : 0,
      avgWin: wins.length > 0 ? totalWin / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
      pnlRatio: losses.length > 0 && totalLoss > 0 ? (totalWin / wins.length) / (totalLoss / losses.length) : (wins.length > 0 ? 99 : 0),
      maxWin: wins.length > 0 ? Math.max.apply(null, wins.map(function (t) { return t.pnl; })) : 0,
      maxLoss: losses.length > 0 ? Math.min.apply(null, losses.map(function (t) { return t.pnl; })) : 0,
      equityCurve: equityCurve.slice(),
      finalEquity: s.equity
    };
  }

  function getConfig() { return Object.assign({}, config); }
  function setConfig(cfg) { if (cfg) config = Object.assign({}, config, cfg); }

  global.Trainer = {
    start: start,
    startWithMarket: startWithMarket,
    buy: buy,
    sell: sell,
    next: next,
    close: close,
    finish: finish,
    changePeriod: changePeriod,
    getState: getState,
    getStats: getStats,
    getConfig: getConfig,
    setConfig: setConfig,
    onFinish: function (cb) { onFinishCb = cb; }
  };
})(window);
