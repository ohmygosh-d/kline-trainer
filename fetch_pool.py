#!/usr/bin/env python3
"""一次性拉取全A股列表 + 批量下载历史K线，保存为本地数据池。
运行: python fetch_pool.py
"""
import json, os, socket, ssl, time, sys

POOL_SIZE = 100  # 要下载的股票数量
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data_cache')

def http_get(host, port, path, use_ssl=False, timeout=15):
    """Raw socket HTTP(S) GET，返回 (status, body_bytes)"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)

    try:
        if use_ssl:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=host)

        s.connect((host, port))
        req = f'GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nReferer: https://quote.eastmoney.com/\r\nConnection: close\r\n\r\n'
        s.send(req.encode())

        data = b''
        while True:
            chunk = s.recv(16384)
            if not chunk:
                break
            data += chunk
        s.close()

        # 解析HTTP响应
        header_end = data.find(b'\r\n\r\n')
        if header_end < 0:
            return (0, b'')

        headers_part = data[:header_end].decode('utf-8', errors='replace')
        status_line = headers_part.split('\r\n')[0]
        status = int(status_line.split(' ')[1]) if len(status_line.split(' ')) > 1 else 0

        body = data[header_end + 4:]
        return (status, body)
    except Exception as e:
        try:
            s.close()
        except:
            pass
        raise e


def fetch_stock_list():
    """拉取全A股列表"""
    print('拉取全A股列表...')
    stocks = []
    name_map = {}

    for pn in range(1, 6):  # 5页 × 1000 = 5000
        path = (f'/api/qt/clist/get?pn={pn}&pz=1000&po=1&np=1&fltt=2&invt=2'
                f'&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
                f'&fields=f12,f14')
        try:
            status, body = http_get('82.push2.eastmoney.com', 80, path)
            if status != 200:
                print(f'  第{pn}页 HTTP {status}')
                continue
            data = json.loads(body.decode('utf-8'))
            items = data.get('data', {}).get('diff', [])
            for item in items:
                code = str(item.get('f12', ''))
                name = str(item.get('f14', ''))
                if not code or not name:
                    continue
                if 'ST' in name or '退' in name:
                    continue
                if code.startswith('8') or code.startswith('4'):
                    continue
                stocks.append(code)
                name_map[code] = name
            print(f'  第{pn}页: {len(items)} 只 (累计 {len(stocks)})')
            time.sleep(0.3)
        except Exception as e:
            print(f'  第{pn}页失败: {e}')

    print(f'共获取 {len(stocks)} 只A股')
    return stocks, name_map


def fetch_stock_data(code, name):
    """拉取单只股票历史日K线"""
    market = '1' if code.startswith('6') else '0'
    path = (f'/api/qt/stock/kline/get?secid={market}.{code}'
            f'&fields1=f1,f2,f3,f4,f5,f6'
            f'&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
            f'&klt=101&fqt=0&end=20500101&lmt=3000')

    try:
        status, body = http_get('push2his.eastmoney.com', 443, path, use_ssl=True)
        if status != 200:
            return None
        data = json.loads(body.decode('utf-8'))
        klines = data.get('data', {}).get('klines', [])
        if not klines or len(klines) < 50:
            return None

        bars = []
        for line in klines:
            parts = line.split(',')
            if len(parts) >= 7:
                bars.append({
                    'date': parts[0],
                    'open': round(float(parts[1]), 2),
                    'close': round(float(parts[2]), 2),
                    'high': round(float(parts[3]), 2),
                    'low': round(float(parts[4]), 2),
                    'volume': float(parts[5]),
                    'amount': float(parts[6]),
                    'pct': round(float(parts[8]), 2) if len(parts) > 8 else 0
                })

        result = {'code': code, 'name': name, 'bars': bars}
        return result
    except Exception as e:
        print(f'    {code} {name}: {e}')
        return None


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    # 1. 拉取股票列表
    stocks, name_map = fetch_stock_list()

    if not stocks:
        print('❌ 无法获取股票列表，请检查网络连接')
        return

    # 保存股票列表
    with open(os.path.join(CACHE_DIR, 'stock_list.json'), 'w', encoding='utf-8') as f:
        json.dump({'stocks': stocks, 'name_map': name_map}, f, ensure_ascii=False)

    # 2. 随机选POOL_SIZE只下载
    import random
    selected = random.sample(stocks, min(POOL_SIZE, len(stocks)))

    print(f'\n开始下载 {len(selected)} 只股票的历史K线...')
    all_data = []
    success = 0

    for i, code in enumerate(selected):
        name = name_map.get(code, code)
        print(f'  [{i+1}/{len(selected)}] {code} {name}...', end=' ', flush=True)
        data = fetch_stock_data(code, name)
        if data and len(data.get('bars', [])) >= 100:
            all_data.append(data)
            success += 1
            print(f'✓ {len(data["bars"])}根')
        else:
            print('✗')
        time.sleep(0.15)

    print(f'\n成功下载 {success}/{len(selected)} 只')

    # 3. 保存为data/*.json
    index = {'stocks': []}
    for i, d in enumerate(all_data):
        filename = f'pool_{i:04d}.json'
        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False)
        index['stocks'].append({'code': d['code'], 'name': d['name'], 'file': filename})

    with open(os.path.join(DATA_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)

    print(f'已保存 {len(all_data)} 只股票到 data/ 目录')
    print('完成！现在可以启动 server.py 了')


if __name__ == '__main__':
    main()
