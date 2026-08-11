"""
dev/mock_server.py — Máy chủ giả lập API của backend/Code.gs, chạy trên máy
local, dùng để TEST giao diện khi chưa muốn deploy Google Sheet thật.
Bao gồm sẵn 1 tab "TaiLieuDaoTao" KHÔNG khai báo trong config.js để minh hoạ
tính năng tự phát hiện module mới.

Chạy:  python3 dev/mock_server.py
Rồi tạm sửa js/config.js -> API_URL: "http://localhost:8899/"
KHÔNG dùng cho dữ liệu thật / production.
"""
import json, uuid
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

DATA = json.load(open(os.path.join(os.path.dirname(__file__), 'mock_backend_data.json'), encoding='utf-8'))

class Handler(BaseHTTPRequestHandler):
    def _send(self, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        action = q.get('action', ['all'])[0]
        if action == 'meta':
            self._send({'sheets': list(DATA.keys())})
        elif action == 'schema':
            sheet = q.get('sheet', [''])[0]
            self._send({'sheet': sheet, 'columns': DATA[sheet]['columns']})
        elif action == 'list':
            sheet = q.get('sheet', [''])[0]
            self._send({'sheet': sheet, 'columns': DATA[sheet]['columns'], 'rows': DATA[sheet]['rows']})
        elif action == 'all':
            self._send({'sheets': list(DATA.keys()), 'data': DATA})
        else:
            self._send({'error': 'unknown action'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        action = body.get('action')
        sheet = body.get('sheet')
        if action == 'upsert':
            data = body.get('data', {})
            rid = data.get('ID')
            rows = DATA[sheet]['rows']
            existing = next((r for r in rows if r.get('ID') == rid), None) if rid else None
            if existing:
                existing.update(data)
            else:
                rid = rid or uuid.uuid4().hex[:10]
                data['ID'] = rid
                for c in DATA[sheet]['columns']:
                    if c not in data: data[c] = ''
                rows.append(data)
            self._send({'ok': True, 'id': rid})
        elif action == 'delete':
            rid = body.get('id')
            DATA[sheet]['rows'] = [r for r in DATA[sheet]['rows'] if r.get('ID') != rid]
            self._send({'ok': True})
        elif action == 'deleteGroup':
            gc, gv = body.get('groupColumn'), body.get('groupValue')
            before = len(DATA[sheet]['rows'])
            DATA[sheet]['rows'] = [r for r in DATA[sheet]['rows'] if r.get(gc) != gv]
            self._send({'ok': True, 'deleted': before - len(DATA[sheet]['rows'])})
        elif action == 'renameGroup':
            gc, ov, nv = body.get('groupColumn'), body.get('oldValue'), body.get('newValue')
            n = 0
            for r in DATA[sheet]['rows']:
                if r.get(gc) == ov:
                    r[gc] = nv; n += 1
            self._send({'ok': True, 'updated': n})
        else:
            self._send({'error': 'unknown action'})

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = 8899
    print('Mock backend running on port', port)
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
