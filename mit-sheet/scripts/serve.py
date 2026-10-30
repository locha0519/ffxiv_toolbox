"""排軸小抄的本機網頁。OverlayPlugin 也指到這個網址。"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PORT = 8766
MIT = "https://mit.xivtc.com/data/"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/mit/"):
            self.proxy_mit(path[len("/api/mit/"):])
            return
        super().do_GET()

    def proxy_mit(self, rel):
        rel = unquote(rel).lstrip("/")
        if not rel or "\\" in rel or ".." in rel.split("/"):
            self.send_error(400, "bad path")
            return
        try:
            req = Request(MIT + rel, headers={"User-Agent": "mit-sheet"})
            with urlopen(req, timeout=20) as res:
                body = res.read()
                ctype = (res.headers.get("Content-Type") or "application/json").split(";")[0]
        except HTTPError as err:
            self.send_error(err.code, "mit upstream")
            return
        except URLError:
            self.send_error(502, "mit unreachable")
            return
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("排軸小抄  http://127.0.0.1:%d/" % PORT)
    print("OverlayPlugin 的網址填上面這一行。")
    server.serve_forever()
