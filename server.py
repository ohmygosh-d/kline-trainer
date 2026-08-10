#!/usr/bin/env python3
"""K线练习助手 - 全市场随机选股数据服务器
启动后访问 http://localhost:8765 即可使用。
每次训练随机从 5000+ 只A股中选取，历史K线数据实时拉取。
"""

import http.server
import json
import os
import random
import signal
import sys
import time
import urllib.parse
import urllib.request

# ─── 代理绕过 ─────────────────────────────────────────────────
# 清除系统代理设置，直连东方财富API
for key in ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']:
    os.environ.pop(key, None)
os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'

PORT = 8765
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, 'data_cache')
STOCK_LIST_FILE = os.path.join(CACHE_DIR, 'stock_list.json')

stock_list_cache = None
stock_name_map = {}  # code -> name

def ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)

# ─── STOCK LIST ───────────────────────────────────────────────

def fetch_stock_list():
    """从东方财富拉取全A股列表 ~5000+ 只（分页拉取）"""
    global stock_list_cache, stock_name_map

    # 缓存7天
    if os.path.exists(STOCK_LIST_FILE):
        mtime = os.path.getmtime(STOCK_LIST_FILE)
        if time.time() - mtime < 86400 * 7:
            with open(STOCK_LIST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                stock_list_cache = data['stocks']
                stock_name_map = data.get('name_map', {})
                return stock_list_cache

    print('[Server] 正在拉取全A股列表...')

    stocks = []
    name_map = {}

    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://quote.eastmoney.com/'
    }

    # 先获取总数
    base_url = ('http://82.push2.eastmoney.com/api/qt/clist/get'
                '?pn={pn}&pz=1000&po=1&np=1&fltt=2&invt=2&fid=f3'
                '&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
                '&fields=f12,f14')

    total = 0
    try:
        url1 = base_url.format(pn=1)
        req = urllib.request.Request(url1, headers=headers)
        resp = opener.open(req, timeout=20)
        raw = json.loads(resp.read().decode('utf-8'))
        if raw and raw.get('data'):
            total = raw['data'].get('total', 0)
            items = raw['data'].get('diff', [])
            for item in items:
                code = str(item.get('f12', ''))
                name = str(item.get('f14', ''))
                if code and name and 'ST' not in name and '退' not in name:
                    if not code.startswith('8') and not code.startswith('4'):
                        stocks.append(code)
                        name_map[code] = name
    except Exception as e:
        print(f'[Server] 股票列表第1页失败: {e}')

    if total > 0:
        pages = (total + 999) // 1000
        print(f'[Server] 共 {total} 只股票, {pages} 页, 正在拉取...')

        for pn in range(2, pages + 1):
            try:
                url = base_url.format(pn=pn)
                req = urllib.request.Request(url, headers=headers)
                resp = opener.open(req, timeout=20)
                raw = json.loads(resp.read().decode('utf-8'))
                if raw and raw.get('data') and raw['data'].get('diff'):
                    for item in raw['data']['diff']:
                        code = str(item.get('f12', ''))
                        name = str(item.get('f14', ''))
                        if code and name and 'ST' not in name and '退' not in name:
                            if not code.startswith('8') and not code.startswith('4'):
                                stocks.append(code)
                                name_map[code] = name
                time.sleep(0.3)  # 避免频率限制
            except Exception as e:
                print(f'[Server] 第{pn}页失败: {e}')
                continue

    ensure_cache_dir()
    with open(STOCK_LIST_FILE, 'w', encoding='utf-8') as f:
        json.dump({'stocks': stocks, 'name_map': name_map}, f, ensure_ascii=False)

    stock_list_cache = stocks
    stock_name_map = name_map
    print(f'[Server] 已加载 {len(stocks)} 只A股')
    return stocks


def get_market_code(code):
    """转换为东方财富 secid 格式"""
    if code.startswith('6'):
        return f'1.{code}'  # 上海
    return f'0.{code}'      # 深圳


# ─── STOCK DATA ───────────────────────────────────────────────

def fetch_stock_data(code, name=None):
    """拉取单只股票历史日K线（最多3000根）"""
    cache_file = os.path.join(CACHE_DIR, f'{code}.json')

    # 缓存24小时
    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if time.time() - mtime < 86400:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cached = json.load(f)
                if cached.get('bars') and len(cached['bars']) >= 100:
                    return cached

    secid = get_market_code(code)
    url = (f'https://push2his.eastmoney.com/api/qt/stock/kline/get'
           f'?secid={secid}'
           f'&fields1=f1,f2,f3,f4,f5,f6'
           f'&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
           f'&klt=101&fqt=0&end=20500101&lmt=3000')

    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://quote.eastmoney.com/'
    })

    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)

    try:
        resp = opener.open(req, timeout=15)
        raw = json.loads(resp.read().decode('utf-8'))

        if raw and raw.get('data') and raw['data'].get('klines'):
            klines = raw['data']['klines']
            bars = []
            for line in klines:
                parts = line.split(',')
                if len(parts) >= 7:
                    bars.append({
                        'date': parts[0],
                        'open': float(parts[1]),
                        'close': float(parts[2]),
                        'high': float(parts[3]),
                        'low': float(parts[4]),
                        'volume': float(parts[5]),
                        'amount': float(parts[6]),
                        'pct': float(parts[8]) if len(parts) > 8 else 0
                    })

            result = {
                'code': code,
                'name': name or stock_name_map.get(code, code),
                'bars': bars,
                'count': len(bars)
            }

            ensure_cache_dir()
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False)

            return result
    except Exception as e:
        print(f'[Server] {code} 数据拉取失败: {e}')

    # 回退到缓存
    if os.path.exists(cache_file):
        with open(cache_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    return None


def get_random_stock_data(min_bars=200, max_retries=20):
    """随机选一只股票，拉取数据（重试直到有足够历史K线）"""
    stocks = stock_list_cache or fetch_stock_list()
    if not stocks:
        return None

    tried = set()
    for _ in range(max_retries):
        code = random.choice(stocks)
        if code in tried and len(tried) < len(stocks):
            code = random.choice(stocks)
        tried.add(code)

        name = stock_name_map.get(code, code)
        data = fetch_stock_data(code, name)
        if data and data.get('bars') and len(data['bars']) >= min_bars:
            return data

    # 放宽条件再试
    for _ in range(10):
        code = random.choice(stocks)
        name = stock_name_map.get(code, code)
        data = fetch_stock_data(code, name)
        if data and data.get('bars') and len(data['bars']) >= 100:
            return data

    return None


# ─── HTTP SERVER ──────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        global stock_list_cache
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/health':
            self._json({'status': 'ok', 'stocks': len(stock_list_cache or []),
                        'pool': stock_list_cache[:5] if stock_list_cache else []})
        elif path == '/api/random':
            self._handle_random()
        elif path == '/api/fetch':
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get('code', [None])[0]
            if not code:
                self._json({'error': 'missing code'}, 400)
                return
            data = fetch_stock_data(code, stock_name_map.get(code, ''))
            self._json(data if data else {'error': 'no data'})
        elif path == '/api/reload-list':
            stock_list_cache = None
            fetch_stock_list()
            self._json({'status': 'ok', 'stocks': len(stock_list_cache or [])})
        else:
            super().do_GET()

    def _handle_random(self):
        data = get_random_stock_data(min_bars=200, max_retries=20)
        if data:
            print(f'[Server] 随机选中: {data["name"]} ({data["code"]}) · {data["count"]} 根K线')
            self._json(data)
        else:
            self._json({'error': 'no stock data available'}, 500)

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # 只打印API请求，忽略静态文件
        if '/api/' in str(args[0] if args else ''):
            print(f'[API] {args[0]}')
        # 忽略静态文件日志


# ─── MAIN ─────────────────────────────────────────────────────

def main():
    ensure_cache_dir()

    print('=' * 55)
    print('  📈  K线练习助手 — 全市场随机选股服务器')
    print('=' * 55)
    print(f'  端口: {PORT}')
    print(f'  静态目录: {BASE_DIR}')
    print()
    print('  正在加载全A股列表...')

    fetch_stock_list()

    print(f'  已就绪: {len(stock_list_cache or [])} 只A股可供选择')
    print()
    print(f'  🌐 打开浏览器访问: http://localhost:{PORT}')
    print('  🛑 按 Ctrl+C 停止服务器')
    print('=' * 55)
    print()

    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)

    def shutdown(sig, frame):
        print('\n👋 服务器已停止')
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == '__main__':
    main()
