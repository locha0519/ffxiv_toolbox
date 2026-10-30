"""排軸小抄的本機網頁。OverlayPlugin 也指到這個網址。"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = 8766


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("排軸小抄  http://127.0.0.1:%d/" % PORT)
    print("OverlayPlugin 的網址填上面這一行。")
    server.serve_forever()
