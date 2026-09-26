// Serves the Super Admin console on its own port (default 3001) by forwarding to the web app while
// keeping the original Host header, so proxy.ts can tell the console origin apart (PLATFORM_HOST).
// In production, point a dedicated hostname (e.g. console.example.com) at the web app instead.
import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PLATFORM_PORT ?? 3001);
const TARGET = new URL(process.env.WEB_INTERNAL_URL ?? 'http://localhost:3000');

const server = http.createServer((req, res) => {
  const up = http.request(
    { host: TARGET.hostname, port: TARGET.port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Web app is not running'); });
  req.pipe(up);
});

// Websocket upgrades (Next.js dev hot reload).
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(TARGET.port), TARGET.hostname, () => {
    up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, () => console.log(`Super Admin console on http://localhost:${PORT}/platform → ${TARGET.origin}`));
