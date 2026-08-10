#!/usr/bin/env python3
"""
fetch_data.py - 抓取真实A股日线K线数据
从东方财富公开API获取，保存为JSON文件供K线练习助手使用
"""
import json
import os
import urllib.request
import urllib.parse
import time
import sys

# 禁用代理，直连东方财富API（避免127.0.0.1:7890代理干扰）
os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("all_proxy", None)
os.environ.pop("ALL_PROXY", None)

# 创建不走代理的 opener
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# 股票池：secid, 代码, 名称
# secid 前缀: 1=沪市, 0=深市(含创业板)
STOCKS = [
    # 沪市主板
    ("1.600519", "600519", "贵州茅台"),
    ("1.601318", "601318", "中国平安"),
    ("1.600036", "600036", "招商银行"),
    ("1.601012", "601012", "隆基绿能"),
    ("1.600276", "600276", "恒瑞医药"),
    ("1.600887", "600887", "伊利股份"),
    ("1.601633", "601633", "长城汽车"),
    ("1.600030", "600030", "中信证券"),
    ("1.600585", "600585", "海螺水泥"),
    ("1.600009", "600009", "上海机场"),
    ("1.603259", "603259", "药明康德"),
    ("1.601888", "601888", "中国中免"),
    ("1.600690", "600690", "海尔智家"),
    ("1.600406", "600406", "国电南瑞"),
    ("1.600886", "600886", "国投电力"),
    ("1.600196", "600196", "复星医药"),
    ("1.601166", "601166", "兴业银行"),
    ("1.600048", "600048", "保利发展"),
    # 深市主板/中小板
    ("0.000858", "000858", "五粮液"),
    ("0.000651", "000651", "格力电器"),
    ("0.000333", "000333", "美的集团"),
    ("0.002594", "002594", "比亚迪"),
    ("0.000725", "000725", "京东方A"),
    ("0.002475", "002475", "立讯精密"),
    ("0.000568", "000568", "泸州老窖"),
    ("0.002271", "002271", "东方雨虹"),
    ("0.000002", "000002", "万科A"),
    ("0.002230", "002230", "科大讯飞"),
    ("0.000063", "000063", "中兴通讯"),
    ("0.002241", "002241", "歌尔股份"),
    # 创业板
    ("0.300750", "300750", "宁德时代"),
    ("0.300059", "300059", "东方财富"),
    ("0.300760", "300760", "迈瑞医疗"),
    ("0.300015", "300015", "爱尔眼科"),
    ("0.300124", "300124", "汇川技术"),
]

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
BEG_DATE = "20180101"
END_DATE = "20261231"
LMT = 2000  # 最多获取2000根K线


def fetch_klines(secid, max_retries=4):
    """从东方财富API获取日线K线数据（带重试）"""
    base = "http://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": "101",      # 101=日线
        "fqt": "1",         # 1=前复权
        "beg": BEG_DATE,
        "end": END_DATE,
        "lmt": str(LMT),
    }
    url = base + "?" + urllib.parse.urlencode(params)

    last_err = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://quote.eastmoney.com/",
                "Accept": "application/json, text/plain, */*",
                "Connection": "keep-alive",
            })
            with _NO_PROXY_OPENER.open(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8")
            return json.loads(raw)
        except Exception as e:
            last_err = e
            wait = 2 * (attempt + 1)  # 2s, 4s, 6s, 8s
            time.sleep(wait)
    raise last_err


def parse_klines(raw_json, code, name):
    """解析API返回的K线数据，转为统一格式"""
    data = raw_json.get("data")
    if not data or not data.get("klines"):
        return None

    bars = []
    klines = data["klines"]
    prev_close = None

    for i, line in enumerate(klines):
        parts = line.split(",")
        # date, open, close, high, low, volume, amount, amplitude, pct, change, turnover
        date = parts[0]
        o = float(parts[1])
        c = float(parts[2])
        h = float(parts[3])
        lo = float(parts[4])
        vol = int(float(parts[5]))  # 成交量(手)

        if prev_close is None:
            change = c - o
            pct = (c - o) / o * 100 if o != 0 else 0
        else:
            change = c - prev_close
            pct = (c - prev_close) / prev_close * 100 if prev_close != 0 else 0

        # 涨跌停判断（A股10%限制，ST股5%但这里简化处理）
        is_limit_up = False
        is_limit_down = False
        if prev_close is not None:
            limit_up_price = round(prev_close * 1.1, 2)
            limit_down_price = round(prev_close * 0.9, 2)
            if abs(c - limit_up_price) < 0.01:
                is_limit_up = True
            if abs(c - limit_down_price) < 0.01:
                is_limit_down = True

        bars.append({
            "idx": i,
            "date": date,
            "open": round(o, 2),
            "close": round(c, 2),
            "high": round(h, 2),
            "low": round(lo, 2),
            "volume": vol,
            "change": round(change, 2),
            "pct": round(pct, 2),
            "isLimitUp": is_limit_up,
            "isLimitDown": is_limit_down,
        })

        prev_close = c

    return {
        "code": code,
        "name": name,
        "bars": bars,
        "totalBars": len(bars),
    }


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    manifest = []
    success = 0
    fail = 0

    for secid, code, name in STOCKS:
        print(f"[{success+fail+1}/{len(STOCKS)}] {code} {name} ...", end=" ", flush=True)

        # 跳过已下载的
        filepath = os.path.join(DATA_DIR, f"{code}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                if existing.get("bars") and len(existing["bars"]) >= 50:
                    manifest.append({
                        "code": code,
                        "name": name,
                        "file": f"{code}.json",
                        "bars": existing["totalBars"],
                        "startDate": existing["bars"][0]["date"],
                        "endDate": existing["bars"][-1]["date"],
                    })
                    print(f"SKIP (已存在 {existing['totalBars']}根)")
                    success += 1
                    continue
            except Exception:
                pass  # 文件损坏，重新下载

        try:
            raw = fetch_klines(secid)
            parsed = parse_klines(raw, code, name)
            if parsed is None or len(parsed["bars"]) < 50:
                print(f"FAIL (数据不足: {len(parsed['bars']) if parsed else 0}根)")
                fail += 1
                continue

            filepath = os.path.join(DATA_DIR, f"{code}.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(parsed, f, ensure_ascii=False)

            manifest.append({
                "code": code,
                "name": name,
                "file": f"{code}.json",
                "bars": parsed["totalBars"],
                "startDate": parsed["bars"][0]["date"],
                "endDate": parsed["bars"][-1]["date"],
            })

            print(f"OK ({parsed['totalBars']}根, {parsed['bars'][0]['date']} ~ {parsed['bars'][-1]['date']})")
            success += 1
        except Exception as e:
            print(f"ERROR ({e})")
            fail += 1

        time.sleep(1.0)  # 礼貌延迟，避免被限流

    # 写入索引清单
    index_path = os.path.join(DATA_DIR, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({"stocks": manifest, "total": len(manifest)}, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"成功: {success} / 失败: {fail} / 总计: {len(STOCKS)}")
    print(f"数据目录: {DATA_DIR}")
    print(f"索引文件: {index_path}")

    if fail > 0:
        print(f"⚠ {fail} 只股票获取失败，可稍后重试")

    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
