import { PROTOCOL_VERSION } from '@mortar/shared';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';
import { handleConnection, startHeartbeat } from './connection';
import { lanUrls } from './lan';
import { RoomManager } from './RoomManager';

const PORT = Number(process.env.PORT ?? 8787);

// Serve the built client when it exists (production single-process mode).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = [
  path.resolve(here, '../../client/dist'),
  path.resolve(here, '../client/dist'),
].find((p) => existsSync(path.join(p, 'index.html')));
const serveStatic = clientDist
  ? sirv(clientDist, {
      single: true,
      etag: true,
      setHeaders(res, pathname) {
        // Hashed assets are immortal; everything else (index.html, manifest,
        // icons) must revalidate — iOS Safari otherwise serves stale builds
        // from its heuristic cache for days.
        if (pathname.startsWith('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  : null;

const rooms = new RoomManager();
const ROOMS_FILE = path.resolve(process.cwd(), 'rooms.json');
{
  const restored = rooms.restoreFrom(ROOMS_FILE);
  if (restored > 0) console.log(`restored ${restored} room(s) — players can rejoin seamlessly`);
}

// Persist live rooms on shutdown so deploys don't kill matches.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const saved = rooms.saveTo(ROOMS_FILE);
    if (saved > 0) console.log(`saved ${saved} room(s) for restart`);
  } catch {
    /* best effort */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.count }));
    return;
  }
  if (serveStatic) {
    serveStatic(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(
    'mortar server is running, but the client is not built.\n' +
      'Run `npm run build` then restart — or use `npm run dev` for development.\n',
  );
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
wss.on('connection', (ws) => handleConnection(ws, rooms));
startHeartbeat(() => wss.clients);

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanUrls(PORT);
  console.log(`\nMortar Mayhem server · protocol v${PROTOCOL_VERSION} · port ${PORT}`);
  console.log(`  local:  http://localhost:${PORT}`);
  for (const url of lan) console.log(`  lan:    ${url}`);
  if (!clientDist) {
    console.log('  (dev mode: open the Vite client at http://localhost:5173)');
  }
  const shareUrl = lan[0] ?? `http://localhost:${PORT}`;
  console.log(`\nScan to join from a phone on the same Wi-Fi (${shareUrl}):`);
  qrcode.generate(shareUrl, { small: true });
});
