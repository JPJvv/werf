/**
 * A real HTTP static file server for `dist/`, applying the REAL `_headers` file the production
 * build actually ships (`scripts/generate-headers.mjs`) — not `vite preview`, which applies no
 * headers at all and is explicitly not proof of anything header-related (see
 * `deployed-connectivity.spec.ts`'s own header). Parses the Netlify `_headers` convention this
 * repo already uses (blank-line-separated blocks: a path glob, then indented `Key: Value` lines)
 * because that convention is genuinely what `dist/_headers` contains; a server that invented its
 * own header source instead of reading the real artifact would prove nothing about what ships.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

interface HeaderBlock {
  readonly pattern: string;
  readonly headers: ReadonlyMap<string, string>;
}

/** Netlify `_headers` syntax: `/*` matches everything, an exact path matches only itself — the
 *  two shapes `apps/web/public/_headers` (and its generated replacement) actually use. */
function parseHeadersFile(raw: string): readonly HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  let current: { pattern: string; headers: Map<string, string> } | null = null;
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      if (current) blocks.push({ pattern: current.pattern, headers: current.headers });
      current = { pattern: line.trim(), headers: new Map() };
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      current.headers.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
  }
  if (current) blocks.push({ pattern: current.pattern, headers: current.headers });
  return blocks;
}

function headersFor(blocks: readonly HeaderBlock[], urlPath: string): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const block of blocks) {
    const matches = block.pattern === '/*' || block.pattern === urlPath;
    if (matches) for (const [key, value] of block.headers) merged.set(key, value);
  }
  return merged;
}

export interface DeployedServer {
  readonly origin: string;
  close(): Promise<void>;
}

/** Starts the server on `port` and resolves once it is actually listening. */
export function startDeployedServer(port: number): Promise<DeployedServer> {
  const headersPath = join(DIST_DIR, '_headers');
  if (!existsSync(headersPath)) {
    throw new Error(
      `${headersPath} not found — run \`pnpm --filter @werf/web build\` (which runs generate-headers.mjs) before this test.`,
    );
  }
  const blocks = parseHeadersFile(readFileSync(headersPath, 'utf8'));

  const server: Server = createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]!;
    // SPA fallback: any path with no file extension resolves to index.html, exactly like the real
    // CDN's default-document behaviour for a client-routed app.
    const hasExtension = extname(urlPath) !== '';
    const relative = urlPath === '/' || !hasExtension ? 'index.html' : urlPath.slice(1);
    const filePath = normalize(join(DIST_DIR, relative));
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403).end();
      return;
    }

    for (const [key, value] of headersFor(blocks, urlPath === '/' ? '/index.html' : urlPath)) {
      res.setHeader(key, value);
    }

    let body: Buffer;
    try {
      body = readFileSync(filePath);
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
    res.writeHead(200).end(body);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
