#!/usr/bin/env python3
"""
server.py — ARTEMIS TRACKER development server
===============================================
Serves the static app files AND proxies external tracking API calls so that
the browser can reach artemistracker.com without running into CORS errors.

Usage
-----
    python server.py          # default port 8080
    python server.py 9000     # custom port

Endpoints
---------
    http://localhost:8080/                  → static app (index.html)
    http://localhost:8080/tests/            → test runner
    http://localhost:8080/docs/report.html  → implementation report
    http://localhost:8080/proxy?url=<enc>   → CORS proxy (whitelisted hosts only)

The proxy forwards GET requests to the remote server, strips any existing
CORS headers from the response, and adds permissive ones so the browser
accepts the reply.
"""

import sys
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlparse, parse_qs
from urllib.error import HTTPError, URLError

# ── Configuration ─────────────────────────────────────────────────────────────
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Only allow the proxy to reach these hostnames (security measure)
ALLOWED_PROXY_HOSTS = {
    'artemistracker.com',
    'ssd.jpl.nasa.gov',
    'www.nasa.gov',
}

PROXY_TIMEOUT = 15  # seconds

# ── Request handler ───────────────────────────────────────────────────────────
class ArtemisHandler(SimpleHTTPRequestHandler):
    """Extends SimpleHTTPRequestHandler with a /proxy route."""

    def do_GET(self):
        if self.path.startswith('/proxy'):
            self._handle_proxy()
        else:
            # Serve static files from the directory containing this script
            super().do_GET()

    def do_OPTIONS(self):
        """Handle CORS pre-flight so fetch() OPTIONS requests don't stall."""
        self.send_response(200)
        self._add_cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ── Proxy handler ─────────────────────────────────────────────────────────
    def _handle_proxy(self):
        # Parse query string to get ?url=...
        raw_qs = self.path[len('/proxy'):]          # everything after /proxy
        raw_qs = raw_qs.lstrip('?')
        params = parse_qs(raw_qs)
        target_list = params.get('url', [])

        if not target_list:
            self._send_error_json(400, 'Missing required query parameter: url')
            return

        target = target_list[0]

        # Validate the target host against the whitelist
        try:
            parsed = urlparse(target)
        except Exception:
            self._send_error_json(400, 'Malformed URL')
            return

        if parsed.scheme not in ('http', 'https'):
            self._send_error_json(400, 'Only http/https targets are allowed')
            return

        if parsed.netloc not in ALLOWED_PROXY_HOSTS:
            self._send_error_json(403,
                f'Host "{parsed.netloc}" is not in the allowed list. '
                f'Permitted: {sorted(ALLOWED_PROXY_HOSTS)}')
            return

        # Forward the request
        try:
            req = Request(
                target,
                headers={
                    'User-Agent': 'ArtemisTracker-Proxy/1.0',
                    'Accept':     'application/json, text/plain, */*',
                },
            )
            with urlopen(req, timeout=PROXY_TIMEOUT) as resp:
                body         = resp.read()
                content_type = resp.headers.get('Content-Type', 'application/json')
                status       = resp.status

            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self._add_cors_headers()
            self.end_headers()
            self.wfile.write(body)

            self._log_proxy('OK', status, target, len(body))

        except HTTPError as exc:
            self._send_error_json(exc.code,
                f'Upstream returned HTTP {exc.code}: {exc.reason}')
            self._log_proxy('UPSTREAM_ERROR', exc.code, target)

        except URLError as exc:
            self._send_error_json(502,
                f'Could not reach upstream server: {exc.reason}')
            self._log_proxy('CONNECT_ERROR', 502, target)

        except TimeoutError:
            self._send_error_json(504, 'Upstream request timed out')
            self._log_proxy('TIMEOUT', 504, target)

        except Exception as exc:
            self._send_error_json(500, f'Proxy internal error: {exc}')
            self._log_proxy('INTERNAL_ERROR', 500, target)

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _add_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Accept, Content-Type')

    def _send_error_json(self, code, message):
        import json
        body = json.dumps({'error': message}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _log_proxy(self, result, status, url, bytes_=None):
        host = urlparse(url).netloc
        path = urlparse(url).path[:60]
        size = f' ({bytes_} bytes)' if bytes_ is not None else ''
        print(f'[PROXY] {result} {status}  {host}{path}{size}')

    # Suppress per-request static file noise; always show proxy and errors
    def log_message(self, fmt, *args):
        if self.path.startswith('/proxy') or (len(args) > 1 and args[1] not in ('200', '304')):
            super().log_message(fmt, *args)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Serve from the directory that contains this script
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = HTTPServer(('', PORT), ArtemisHandler)

    print()
    print('=' * 54)
    print('  ARTEMIS TRACKER -- Development Server')
    print('=' * 54)
    print(f'  App      ->  http://localhost:{PORT}/')
    print(f'  Tests    ->  http://localhost:{PORT}/tests/')
    print(f'  Report   ->  http://localhost:{PORT}/docs/report.html')
    print(f'  Proxy    ->  http://localhost:{PORT}/proxy?url=<enc>')
    print('=' * 54)
    print()
    print('Press Ctrl+C to stop.\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
