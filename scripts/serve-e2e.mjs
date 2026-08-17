// ExamPro — concurrent static file server for E2E runs.
//
// Replaces `python -m http.server` (single-threaded: under 4+ parallel
// Playwright workers its backlog overflows and the browser gets
// ERR_CONNECTION_REFUSED, which surfaced as `EP.renderAuth is not a function`
// crashes and console-network-audit failures). Node's http server is fully
// asynchronous, so every concurrent request is served without a queue.
//
// Usage: node scripts/serve-e2e.mjs [port] [root]
//   port  (default 3000)
//   root  (default: repository root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || 3000);
const ROOT = path.resolve(process.argv[3] || '.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let rel = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel.startsWith('/')) rel = rel.slice(1);
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(file);
      stream.on('error', () => { res.destroy(); });
      stream.pipe(res);
    });
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`exampro-e2e server: http://127.0.0.1:${PORT} (root ${ROOT})`);
});