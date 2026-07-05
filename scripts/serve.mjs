// A tiny dependency-free static file server. Can mount the site under a base
// path (e.g. /solvent/) to mimic GitHub Pages project hosting.
//
//   node scripts/serve.mjs [port] [basePath]
//   node scripts/serve.mjs 8080 /solvent
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export function createServer(basePath = '') {
  const base = basePath.replace(/\/$/, '');
  return http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (base && urlPath.startsWith(base)) urlPath = urlPath.slice(base.length);
      if (urlPath === '' || urlPath === '/') urlPath = '/index.html';

      const filePath = normalize(join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const s = await stat(filePath).catch(() => null);
      if (!s || !s.isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500);
      res.end('error: ' + err.message);
    }
  });
}

// Run directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.argv[2] || 8080);
  const base = process.argv[3] || '';
  createServer(base).listen(port, () => {
    console.log(`Solvent serving at http://localhost:${port}${base || ''}/`);
  });
}
