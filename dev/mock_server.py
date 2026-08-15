"""
dev/mock_server.py — Máy chủ giả lập API của backend/Code.gs, chạy trên máy
local, dùng để TEST giao diện khi chưa muốn deploy Google Sheet thật.

Bản nâng cấp: 
- Tự động lưu dữ liệu xuống file mock_backend_data.json
- Tích hợp check_update (Performance Guard)
- Tích hợp batch_upsert (Batch Request)
- Giả lập link upload file

Chạy:  python3 dev/mock_server.py
Rồi tạm sửa js/config.js -> API_URL: "http://localhost:8899/"
"""
import json, uuid
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# Đường dẫn tuyệt đối tới file JSON database
FILE_PATH = os.path.join(os.path.dirname(__file__), 'mock_backend_data.json')
DATA = json.load(open(FILE_PATH, encoding='utf-8'))

def save_data():
    """Hàm ghi toàn bộ dữ liệu từ RAM xuống file JSON"""
    with open(FILE_PATH, 'w', encoding='utf-8') as f:
        json.dump(DATA, f, ensure_ascii=False, indent=1)

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
        elif action == 'check_update':
            # Trả về thời gian chỉnh sửa cuối cùng của file JSON (tính bằng ms)
            mtime = os.path.getmtime(FILE_PATH) * 1000
            self._send({'lastUpdated': mtime})
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
            if sheet not in DATA: 
                DATA[sheet] = {'columns': list(data.keys()), 'rows': []}
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
                
            save_data() # Lưu xuống ổ cứng
            self._send({'ok': True, 'id': rid})
            
        elif action == 'batch_upsert':
            payloads = body.get('payloads', [])
            n = 0
            for p in payloads:
                s_name = p.get('sheet')
                data = p.get('data', {})
                if s_name not in DATA: 
                    DATA[s_name] = {'columns': list(data.keys()), 'rows': []}
                rid = data.get('ID')
                rows = DATA[s_name]['rows']
                existing = next((r for r in rows if r.get('ID') == rid), None) if rid else None
                
                if existing:
                    existing.update(data)
                else:
                    rid = rid or uuid.uuid4().hex[:10]
                    data['ID'] = rid
                    for c in DATA[s_name]['columns']:
                        if c not in data: data[c] = ''
                    rows.append(data)
                n += 1
                
            save_data() # Lưu toàn bộ lô xuống ổ cứng
            self._send({'ok': True, 'processed': n})
            
        elif action == 'delete':
            rid = body.get('id')
            if sheet in DATA:
                DATA[sheet]['rows'] = [r for r in DATA[sheet]['rows'] if r.get('ID') != rid]
                save_data()
            self._send({'ok': True})
            
        elif action == 'deleteGroup':
            gc, gv = body.get('groupColumn'), body.get('groupValue')
            if sheet in DATA:
                before = len(DATA[sheet]['rows'])
                DATA[sheet]['rows'] = [r for r in DATA[sheet]['rows'] if r.get(gc) != gv]
                save_data()
                self._send({'ok': True, 'deleted': before - len(DATA[sheet]['rows'])})
            else:
                self._send({'ok': False})
                
        elif action == 'renameGroup':
            gc, ov, nv = body.get('groupColumn'), body.get('oldValue'), body.get('newValue')
            n = 0
            if sheet in DATA:
                for r in DATA[sheet]['rows']:
                    if r.get(gc) == ov:
                        r[gc] = nv; n += 1
                save_data()
            self._send({'ok': True, 'updated': n})
            
        elif action == 'upload':
            # Giả lập trả về một link ảnh/file fake để test giao diện
            fake_url = "http://localhost:8899/fake_drive/" + body.get('filename', 'uploaded_file')
            self._send({'ok': True, 'url': fake_url})
            
        else:
            self._send({'error': 'unknown action'})

    def log_message(self, format, *args):
        # Ẩn log của các request HTTP liên tục để console dễ nhìn hơn
        pass

if __name__ == '__main__':
    port = 8899
    print(f'=== MOCK BACKEND RUNNING ON PORT {port} ===')
    print('Dữ liệu sẽ được LƯU THẬT vào file mock_backend_data.json')
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()