"""Serve the local lab dashboard: python ui/serve.py [--port 8080]."""
import argparse
import http.server
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui"
EVIDENCE = ("data_audit", "replay", "scenarios", "openloop", "closedloop", "agents", "gate", "fix", "report_details")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(False)

    def do_HEAD(self):
        self.respond(True)

    def respond(self, head):
        route = unquote(urlsplit(self.path).path)
        try:
            if route == "/api/evidence":
                bundle = {}
                for name in EVIDENCE:
                    path = ROOT / "evidence" / f"{name}.json"
                    if path.exists():
                        bundle[name] = json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda _: None)
                body = json.dumps(bundle, ensure_ascii=False, allow_nan=False).encode("utf-8")
                content_type = "application/json; charset=utf-8"
            else:
                if route == "/REPORT.md":
                    path = ROOT / "REPORT.md"
                elif route.startswith("/evidence/"):
                    path = self.safe_path(ROOT / "evidence", route[len("/evidence/"):])
                    if path.suffix not in (".json", ".png", ".txt"):
                        raise FileNotFoundError
                elif route.startswith("/viz/"):
                    path = self.safe_path(ROOT / "viz", route[len("/viz/"):] or "index.html")
                    if path.suffix not in (".html", ".css", ".js"):
                        raise FileNotFoundError
                else:
                    name = route.lstrip("/") or "index.html"
                    if name not in ("index.html", "styles.css", "app.js", "favicon.ico", "favicon.svg"):
                        raise FileNotFoundError
                    path = UI / ("favicon.svg" if name == "favicon.ico" else name)
                body = path.read_bytes()
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                if path.suffix in (".html", ".css", ".js", ".json", ".md", ".txt"):
                    content_type += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if route == "/REPORT.md":
                self.send_header("Content-Disposition", 'attachment; filename="REPORT.md"')
            self.end_headers()
            if not head:
                self.wfile.write(body)
        except (FileNotFoundError, ValueError, IsADirectoryError):
            self.send_error(404, "File not found")
        except (OSError, json.JSONDecodeError):
            self.send_error(503, "Evidence unavailable; run the lab pipeline first")

    @staticmethod
    def safe_path(base, name):
        path = (base / name).resolve()
        path.relative_to(base.resolve())
        return path

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"Looplab is running at http://localhost:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
