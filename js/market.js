/* ===== market.js · 行情数据引擎 (v7) =====
 * 全市场动态选股：从本地服务器 API 随机获取任意A股数据
 */
(function (global) {
  'use strict';

  var SERVER_URL = '';      // 同源访问
  var serverAvailable = null;  // null=未检测, true/false
  var lastServerCode = null;  // 上次从服务器获取的股票代码，用于去重

  // ===== 服务器检测 =====
  function checkServer() {
    if (serverAvailable !== null) return Promise.resolve(serverAvailable);
    return fetch(SERVER_URL + '/api/health')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // 服务器在运行但需要确认能否拉取到数据
        // 如果 stocks=0 说明API也连不上，直接跳过
        if (data && data.status === 'ok' && data.stocks > 0) {
          // 快速验证：尝试拉取一次
          return fetch(SERVER_URL + '/api/random');
        }
        throw new Error('no stocks');
      })
      .then(function (r) {
        if (r.ok) {
          serverAvailable = true;
          console.log('[Market] server available with live data');
          return true;
        }
        throw new Error('random failed');
      })
      .catch(function () {
        serverAvailable = false;
        console.log('[Market] server data unavailable, using local pool');
        return false;
      });
  }

  function hasRealData() {
    return serverAvailable === true;
  }

  // ===== 异步从服务器获取随机股票 =====
  function generateAsync(dailyTrainCount, period) {
    dailyTrainCount = dailyTrainCount || 150;
    period = period || 'weekly';

    return checkServer().then(function (ok) {
      if (!ok) {
        // 回退到老的本地 JSON 数据池
        return generateFromLocalPool(dailyTrainCount, period);
      }
      return generateFromServer(dailyTrainCount, period);
    });
  }

  function generateFromServer(dailyTrainCount, period) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 8000);

    return fetch(SERVER_URL + '/api/random', { signal: controller.signal })
      .then(function (r) {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('API error: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.bars || data.bars.length < 100) {
          throw new Error('insufficient data');
        }

        // 前端去重：如果服务器返回了和上次相同的股票，再请求一次
        var code = data.code;
        if (lastServerCode && code === lastServerCode) {
          console.log('[Market] server returned same stock as last time, retrying...');
          return fetch(SERVER_URL + '/api/random', { signal: new AbortController().signal })
            .then(function (r) { return r.json(); })
            .then(function (data2) {
              if (data2 && data2.bars && data2.bars.length >= 100) {
                lastServerCode = data2.code;
                return data2;
              }
              lastServerCode = code;
              return data;  // 用第一次的数据
            });
        }
        lastServerCode = code;
        return data;
      })
      .then(function (data) {
        var rawDaily = data.bars.map(function (b, i) {
          return {
            idx: i,
            date: b.date,
            open: round2(b.open),
            close: round2(b.close),
            high: round2(b.high),
            low: round2(b.low),
            volume: b.volume || 0,
            change: round2(b.close - (i > 0 ? data.bars[i - 1].close : b.open)),
            pct: b.pct || 0,
            isLimitUp: false,
            isLimitDown: false
          };
        });

        // 选择训练区间（日线级别）
        var totalDaily = rawDaily.length;
        var maxStart = totalDaily - dailyTrainCount - 1;
        var minHistory = Math.min(Math.floor(totalDaily * 0.25), 80);
        minHistory = Math.max(30, Math.min(minHistory, maxStart));

        var dailyTrainStart;
        if (maxStart <= minHistory) {
          dailyTrainStart = Math.floor(Math.random() * Math.max(1, maxStart + 1));
        } else {
          dailyTrainStart = Math.floor(Math.random() * (maxStart - minHistory + 1)) + minHistory;
        }
        var dailyTrainEnd = Math.min(dailyTrainStart + dailyTrainCount, totalDaily);

        // 聚合
        var allBars = aggregate(rawDaily, period);

        // 映射训练区间到聚合K线
        var aggTrainStart = 0;
        for (var i = 0; i < allBars.length; i++) {
          if (allBars[i].dailyEnd >= dailyTrainStart) { aggTrainStart = i; break; }
        }
        var aggTrainEnd = allBars.length;
        for (var i2 = aggTrainStart; i2 < allBars.length; i2++) {
          if (allBars[i2].dailyStart >= dailyTrainEnd) { aggTrainEnd = i2; break; }
        }

        var code = data.code;
        var prefix = String(code).charAt(0) === '6' ? 'SH' : 'SZ';

        console.log('[Market] loaded: ' + data.name + ' (' + code + ') · ' + rawDaily.length + ' daily bars');

        return {
          bars: allBars,
          rawDailyBars: rawDaily,
          symbol: data.name || code,
          code: prefix + code,
          startDate: allBars[0].date,
          endDate: allBars[allBars.length - 1].date,
          trainStart: aggTrainStart,
          trainCount: aggTrainEnd - aggTrainStart,
          dailyTrainStart: dailyTrainStart,
          dailyTrainEnd: dailyTrainEnd,
          dailyTotal: dailyTrainCount,
          isReal: true
        };
      })
      .catch(function (e) {
        console.warn('[Market] server fetch failed: ' + e.message + ', falling back');
        return generateFromLocalPool(dailyTrainCount, period);
      });
  }

  // ===== 本地数据池回退（老数据） =====
  var localPool = [];
  var localLoaded = false;
  var lastLocalIdx = -1;

  function loadLocalData() {
    if (localLoaded) return Promise.resolve(localPool.length > 0);
    return fetch('data/index.json')
      .then(function (r) { if (!r.ok) throw new Error('no index'); return r.json(); })
      .then(function (index) {
        var promises = (index.stocks || []).map(function (item) {
          return fetch('data/' + item.file)
            .then(function (r) { return r.json(); })
            .catch(function () { return null; });
        });
        return Promise.all(promises);
      })
      .then(function (results) {
        localPool = [];
        for (var i = 0; i < results.length; i++) {
          if (results[i] && results[i].bars && results[i].bars.length >= 50) {
            localPool.push(results[i]);
          }
        }
        localLoaded = true;
        if (localPool.length > 0) {
          console.log('[Market] local data loaded: ' + localPool.length + ' stocks');
        }
        return localPool.length > 0;
      })
      .catch(function () {
        localLoaded = true;
        return false;
      });
  }

  function generateFromLocalPool(dailyTrainCount, period) {
    return loadLocalData().then(function (ok) {
      if (ok && localPool.length > 0) {
        // 随机选（不重复上次）
        var idx;
        if (localPool.length === 1) {
          idx = 0;
        } else {
          do { idx = Math.floor(Math.random() * localPool.length); }
          while (idx === lastLocalIdx && localPool.length > 1);
        }
        lastLocalIdx = idx;
        return buildMarketFromStock(localPool[idx], dailyTrainCount, period);
      }
      // 第三层回退：STOCK_POOL（200只真实股名）+ 合成K线
      console.log('[Market] no local data, using STOCK_POOL');
      return generateFromStockPool(dailyTrainCount, period);
    });
  }

  // ===== 从 STOCK_POOL 选股 + 合成K线 =====
  var poolUsed = {};

  function generateFromStockPool(dailyTrainCount, period) {
    // 过滤未用过
    var available = [];
    for (var i = 0; i < STOCK_POOL.length; i++) {
      if (!poolUsed[STOCK_POOL[i].code]) available.push(i);
    }
    if (available.length === 0) { poolUsed = {}; for (var j = 0; j < STOCK_POOL.length; j++) available.push(j); }

    var pick = available[Math.floor(Math.random() * available.length)];
    var stock = STOCK_POOL[pick];
    poolUsed[stock.code] = true;

    var d = generateSynthetic(dailyTrainCount, 'mixed', period);
    d.symbol = stock.name;
    d.code = (stock.code.charAt(0) === '6' ? 'SH' : 'SZ') + stock.code;
    d.isReal = true;
    return Promise.resolve(d);
  }

  function buildMarketFromStock(stock, dailyTrainCount, period) {
    var rawDaily = stock.bars.map(function (b) { return Object.assign({}, b); });
    var totalDaily = rawDaily.length;
    var maxStart = totalDaily - dailyTrainCount - 1;
    if (maxStart < 10) maxStart = Math.max(0, totalDaily - dailyTrainCount);
    var minHistory = Math.min(Math.floor(totalDaily * 0.2), 60);
    minHistory = Math.max(20, Math.min(minHistory, maxStart));

    var dailyTrainStart;
    if (maxStart <= minHistory) {
      dailyTrainStart = Math.floor(Math.random() * (maxStart + 1));
    } else {
      dailyTrainStart = Math.floor(Math.random() * (maxStart - minHistory + 1)) + minHistory;
    }
    var dailyTrainEnd = Math.min(dailyTrainStart + dailyTrainCount, totalDaily);

    var allBars = aggregate(rawDaily, period);

    var aggTrainStart = 0;
    for (var i = 0; i < allBars.length; i++) {
      if (allBars[i].dailyEnd >= dailyTrainStart) { aggTrainStart = i; break; }
    }
    var aggTrainEnd = allBars.length;
    for (var i2 = aggTrainStart; i2 < allBars.length; i2++) {
      if (allBars[i2].dailyStart >= dailyTrainEnd) { aggTrainEnd = i2; break; }
    }

    var code = stock.code;
    var prefix = String(code).charAt(0) === '6' ? 'SH' : 'SZ';

    return {
      bars: allBars,
      rawDailyBars: rawDaily,
      symbol: stock.name,
      code: prefix + code,
      startDate: allBars[0].date,
      endDate: allBars[allBars.length - 1].date,
      trainStart: aggTrainStart,
      trainCount: aggTrainEnd - aggTrainStart,
      dailyTrainStart: dailyTrainStart,
      dailyTrainEnd: dailyTrainEnd,
      dailyTotal: dailyTrainCount,
      isReal: true
    };
  }

  // ===== 同步 generate（兼容旧代码，返回模拟数据） =====
  function generate(dailyTrainCount, style, period) {
    // 同步调用只能用模拟数据
    console.warn('[Market] generate() called synchronously - using synthetic data. Use generateAsync() instead.');
    return generateSynthetic(dailyTrainCount, style, period);
  }

  // ===== 模拟数据（保持不变） =====
  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  var SYMBOL_NAMES = [
    '双盲训练-A','双盲训练-B','双盲训练-C','双盲训练-D','双盲训练-E',
    '双盲训练-F','双盲训练-G','双盲训练-H','双盲训练-I','双盲训练-J'
  ];

  function formatDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function generateSynthetic(dailyTrainCount, style, period) {
    style = style || 'mixed';
    period = period || 'daily';

    var totalDailyNeeded = dailyTrainCount + 200;
    var bars = [];
    var price = rand(5, 80);
    var baseVol = randInt(500, 5000) * 100;
    var currentDate = new Date(2018, randInt(0, 11), randInt(1, 28));
    var i = 0, segEnd = 0, seg = null;
    var volatility = rand(0.015, 0.035);

    while (i < totalDailyNeeded) {
      if (i >= segEnd) {
        var segLen = randInt(8, 25); segEnd = i + segLen;
        var type;
        if (style === 'trend') type = pick(['up','down','up','down','up']);
        else if (style === 'volatile') type = pick(['range','range','spike','range']);
        else if (style === 'limit') type = pick(['up','down','limit-up','limit-down','range']);
        else type = pick(['up','down','range','range','up','down','spike']);
        var driftMap = {
          up: rand(0.002, 0.008), down: rand(-0.008, -0.002),
          range: rand(-0.001, 0.001), spike: 0,
          'limit-up': rand(0.005, 0.01), 'limit-down': rand(-0.01, -0.005)
        };
        seg = { type: type, drift: driftMap[type], len: segLen, start: i };
        if (type === 'range') volatility = rand(0.008, 0.02);
        else if (type === 'spike') volatility = rand(0.03, 0.06);
        else volatility = rand(0.015, 0.04);
      }

      var prevClose = bars.length > 0 ? bars[bars.length - 1].close : price;
      var gap = 0;
      if (i > 0 && Math.random() < 0.08) gap = gauss() * volatility * prevClose * 0.5;
      var open = prevClose + gap;
      var change = seg.drift * prevClose + gauss() * volatility * prevClose;
      var close = open + change;

      if (seg.type === 'limit-up' && i === seg.start) { close = prevClose * 1.1; open = prevClose * 1.1; }
      else if (seg.type === 'limit-down' && i === seg.start) { close = prevClose * 0.9; open = prevClose * 0.9; }

      var limitUp = prevClose * 1.1, limitDown = prevClose * 0.9;
      if (style === 'limit' || seg.type === 'limit-up' || seg.type === 'limit-down') {
        close = Math.min(close, limitUp); close = Math.max(close, limitDown);
        open = Math.min(Math.max(open, limitDown), limitUp);
      }
      close = Math.max(close, 0.5); open = Math.max(open, 0.5);

      var bodyHigh = Math.max(open, close), bodyLow = Math.min(open, close);
      var range = Math.abs(gauss()) * volatility * prevClose * 0.8 + Math.abs(close - open) * 0.3;
      var high = bodyHigh + Math.abs(range) * Math.random();
      var low = bodyLow - Math.abs(range) * Math.random();
      high = Math.max(high, bodyHigh, close, open);
      low = Math.min(Math.max(low, 0.3), bodyLow, close, open);

      var isLimitUp = Math.abs(close - limitUp) < 0.01;
      var isLimitDown = Math.abs(close - limitDown) < 0.01;
      if (isLimitUp) { high = close; low = Math.min(open, close); }
      if (isLimitDown) { low = close; high = Math.max(open, close); }

      var volMul = 0.5 + Math.abs(change / prevClose) / volatility * 0.8 + (seg.type !== 'range' ? 0.5 : 0);
      var volume = Math.round(baseVol * volMul * (0.7 + Math.random() * 0.6));
      var pct = ((close - prevClose) / prevClose * 100);

      bars.push({
        idx: i, date: formatDate(currentDate),
        open: round2(open), close: round2(close), high: round2(high), low: round2(low),
        volume: volume, change: round2(close - prevClose), pct: round2(pct),
        isLimitUp: isLimitUp, isLimitDown: isLimitDown
      });

      currentDate.setDate(currentDate.getDate() + 1);
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) currentDate.setDate(currentDate.getDate() + 1);
      price = close; i++;
    }

    var totalDaily = bars.length;
    var maxStart = totalDaily - dailyTrainCount - 1;
    if (maxStart < 10) maxStart = Math.max(0, totalDaily - dailyTrainCount);
    var minHistory = Math.min(Math.floor(totalDaily * 0.2), 60);
    minHistory = Math.max(20, Math.min(minHistory, maxStart));

    var dailyTrainStart;
    if (maxStart <= minHistory) {
      dailyTrainStart = Math.floor(Math.random() * (maxStart + 1));
    } else {
      dailyTrainStart = Math.floor(Math.random() * (maxStart - minHistory + 1)) + minHistory;
    }
    var dailyTrainEnd = Math.min(dailyTrainStart + dailyTrainCount, totalDaily);

    var allBars = aggregate(bars, period);

    var aggTrainStart = 0;
    for (var j = 0; j < allBars.length; j++) {
      if (allBars[j].dailyEnd >= dailyTrainStart) { aggTrainStart = j; break; }
    }
    var aggTrainEnd = allBars.length;
    for (var k = aggTrainStart; k < allBars.length; k++) {
      if (allBars[k].dailyStart >= dailyTrainEnd) { aggTrainEnd = k; break; }
    }

    return {
      bars: allBars,
      rawDailyBars: bars,
      symbol: pick(SYMBOL_NAMES),
      code: 'SH' + randInt(600000, 699999),
      startDate: allBars[0].date,
      endDate: allBars[allBars.length - 1].date,
      trainStart: aggTrainStart,
      trainCount: aggTrainEnd - aggTrainStart,
      dailyTrainStart: dailyTrainStart,
      dailyTrainEnd: dailyTrainEnd,
      dailyTotal: dailyTrainCount,
      isReal: false
    };
  }

  // ===== 聚合 =====
  function mergeBars(group, dailyStartIdx, dailyEndIdx) {
    if (group.length === 0) return null;
    var first = group[0], last = group[group.length - 1];
    var high = -Infinity, low = Infinity, volume = 0;
    for (var i = 0; i < group.length; i++) {
      if (group[i].high > high) high = group[i].high;
      if (group[i].low < low) low = group[i].low;
      volume += group[i].volume || 0;
    }
    var change = last.close - first.open;
    var pct = first.open !== 0 ? (change / first.open * 100) : 0;
    return {
      idx: 0,
      date: first.date,
      open: round2(first.open),
      close: round2(last.close),
      high: round2(high),
      low: round2(low),
      volume: Math.round(volume),
      change: round2(change),
      pct: round2(pct),
      isLimitUp: false,
      isLimitDown: false,
      dailyStart: dailyStartIdx,
      dailyEnd: dailyEndIdx,
      dailyCount: dailyEndIdx - dailyStartIdx + 1
    };
  }

  function getISOWeek(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    var week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  function aggregateWeekly(dailyBars) {
    var result = [];
    var currentKey = null;
    var group = [];
    var groupStartIdx = 0;
    for (var i = 0; i < dailyBars.length; i++) {
      var bar = dailyBars[i];
      if (!bar.date) { group.push(bar); continue; }
      var date = new Date(bar.date);
      var weekNum = getISOWeek(date);
      var key = date.getFullYear() + '-W' + String(weekNum).padStart(2, '0');
      if (key !== currentKey) {
        if (group.length > 0) {
          var merged = mergeBars(group, groupStartIdx, i - 1);
          if (merged) result.push(merged);
        }
        currentKey = key;
        group = [bar];
        groupStartIdx = i;
      } else {
        group.push(bar);
      }
    }
    if (group.length > 0) {
      var last = mergeBars(group, groupStartIdx, dailyBars.length - 1);
      if (last) result.push(last);
    }
    for (var j = 0; j < result.length; j++) result[j].idx = j;
    return result;
  }

  function aggregateMonthly(dailyBars) {
    var result = [];
    var currentKey = null;
    var group = [];
    var groupStartIdx = 0;
    for (var i = 0; i < dailyBars.length; i++) {
      var bar = dailyBars[i];
      if (!bar.date) { group.push(bar); continue; }
      var key = bar.date.substring(0, 7);
      if (key !== currentKey) {
        if (group.length > 0) {
          var merged = mergeBars(group, groupStartIdx, i - 1);
          if (merged) result.push(merged);
        }
        currentKey = key;
        group = [bar];
        groupStartIdx = i;
      } else {
        group.push(bar);
      }
    }
    if (group.length > 0) {
      var last = mergeBars(group, groupStartIdx, dailyBars.length - 1);
      if (last) result.push(last);
    }
    for (var j = 0; j < result.length; j++) result[j].idx = j;
    return result;
  }

  function aggregate(dailyBars, period) {
    if (!period || period === 'daily') {
      var result = [];
      for (var i = 0; i < dailyBars.length; i++) {
        var b = Object.assign({}, dailyBars[i]);
        b.idx = i;
        b.dailyStart = i;
        b.dailyEnd = i;
        b.dailyCount = 1;
        result.push(b);
      }
      return result;
    }
    if (period === 'weekly') return aggregateWeekly(dailyBars);
    if (period === 'monthly') return aggregateMonthly(dailyBars);
    var fallback = [];
    for (var j = 0; j < dailyBars.length; j++) {
      var fb = Object.assign({}, dailyBars[j]);
      fb.idx = j; fb.dailyStart = j; fb.dailyEnd = j; fb.dailyCount = 1;
      fallback.push(fb);
    }
    return fallback;
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  // ===== 技术指标 =====
  function calcMA(bars, period) {
    var result = [];
    for (var i = 0; i < bars.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      var sum = 0;
      for (var j = 0; j < period; j++) sum += bars[i - j].close;
      result.push(round2(sum / period));
    }
    return result;
  }

  function calcEMA(data, period) {
    var k = 2 / (period + 1);
    var ema = [];
    for (var i = 0; i < data.length; i++) {
      if (i === 0) { ema.push(data[0]); continue; }
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  }

  function calcMACD(bars, short, long, signal) {
    short = short || 12; long = long || 26; signal = signal || 9;
    var closes = bars.map(function(b) { return b.close; });
    var emaShort = calcEMA(closes, short);
    var emaLong = calcEMA(closes, long);
    var dif = [];
    for (var i = 0; i < closes.length; i++) dif.push(round2(emaShort[i] - emaLong[i]));
    var dea = calcEMA(dif, signal);
    for (i = 0; i < dea.length; i++) dea[i] = round2(dea[i]);
    var macd = [];
    for (i = 0; i < dif.length; i++) macd.push(round2((dif[i] - dea[i]) * 2));
    return { dif: dif, dea: dea, macd: macd };
  }

  function calcKDJ(bars, n, m1, m2) {
    n = n || 9; m1 = m1 || 3; m2 = m2 || 3;
    var k = [], d = [], j = [], rsv = [];
    for (var i = 0; i < bars.length; i++) {
      if (i < n - 1) { rsv.push(null); k.push(null); d.push(null); j.push(null); continue; }
      var h = -Infinity, l = Infinity;
      for (var t = i - n + 1; t <= i; t++) {
        if (bars[t].high > h) h = bars[t].high;
        if (bars[t].low < l) l = bars[t].low;
      }
      var c = bars[i].close;
      var rsvVal = h !== l ? ((c - l) / (h - l)) * 100 : 50;
      rsv.push(rsvVal); k.push(null); d.push(null); j.push(null);
    }
    for (i = 0; i < bars.length; i++) {
      if (i < n - 1) continue;
      var sumRSV = 0;
      var startK = i - m1 + 1;
      if (startK < n - 1) startK = n - 1;
      for (var t = startK; t <= i; t++) sumRSV += (rsv[t] || 50);
      k[i] = round2(sumRSV / (i - startK + 1));
      var sumK = 0;
      var startD = i - m2 + 1;
      if (startD < n - 1) startD = n - 1;
      for (t = startD; t <= i; t++) sumK += (k[t] !== null ? k[t] : 50);
      d[i] = round2(sumK / (i - startD + 1));
      j[i] = round2(3 * k[i] - 2 * d[i]);
    }
    return { k: k, d: d, j: j };
  }

  function calcRSI(bars, period) {
    period = period || 14;
    var rsi = [];
    for (var i = 0; i < bars.length; i++) {
      if (i < period) { rsi.push(null); continue; }
      var gain = 0, loss = 0;
      for (var t = i - period + 1; t <= i; t++) {
        var ch = bars[t].close - bars[t - 1].close;
        if (ch > 0) gain += ch; else loss -= ch;
      }
      var avgGain = gain / period, avgLoss = loss / period;
      if (avgLoss === 0) rsi.push(100);
      else rsi.push(round2(100 - 100 / (1 + avgGain / avgLoss)));
    }
    return rsi;
  }

  function calcBOLL(bars, period, multiplier) {
    period = period || 20; multiplier = multiplier || 2;
    var mid = [], upper = [], lower = [];
    for (var i = 0; i < bars.length; i++) {
      if (i < period - 1) { mid.push(null); upper.push(null); lower.push(null); continue; }
      var sum = 0;
      for (var t = i - period + 1; t <= i; t++) sum += bars[t].close;
      var ma = sum / period;
      var variance = 0;
      for (t = i - period + 1; t <= i; t++) variance += (bars[t].close - ma) * (bars[t].close - ma);
      var std = Math.sqrt(variance / period);
      mid.push(round2(ma)); upper.push(round2(ma + multiplier * std)); lower.push(round2(ma - multiplier * std));
    }
    return { mid: mid, upper: upper, lower: lower };
  }

  global.Market = {
    generate: generate,
    generateAsync: generateAsync,
    checkServer: checkServer,
    calcMA: calcMA, calcMACD: calcMACD,
    calcKDJ: calcKDJ, calcRSI: calcRSI, calcBOLL: calcBOLL,
    aggregate: aggregate, aggregateWeekly: aggregateWeekly, aggregateMonthly: aggregateMonthly,
    round2: round2,
    hasRealData: hasRealData,
    getPoolSize: function () { return serverAvailable ? '全市场' : '本地'; }
  };
})(window);
