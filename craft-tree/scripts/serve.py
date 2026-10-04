"""靜態網站，並把清單存進 data/lists.json。"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "data" / "lists.json"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/state":
            self.send_state()
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/state":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400)
            return
        if not isinstance(data, dict) or not isinstance(data.get("lists"), list):
            self.send_error(400)
            return
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_state(self):
        if STATE.exists():
            payload = STATE.read_bytes()
        else:
            payload = b"{}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("http://127.0.0.1:8765/", flush=True)
    server.serve_forever()
