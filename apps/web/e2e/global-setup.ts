import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export default async function globalSetup() {
  // Deterministic data: reset + seed, and an empty mailbox.
  execSync('npm run db:reset', { cwd: new URL('../../../', import.meta.url).pathname, stdio: 'inherit' });
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
  // The reseed changes every id: drop the web tier's cached site data.
  const secret = /REVALIDATE_SECRET=(.+)/.exec(readFileSync(new URL('../.env.local', import.meta.url), 'utf8'))?.[1]?.trim();
  const r = await fetch('http://localhost:3000/internal/revalidate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret ?? '' }, body: JSON.stringify({ hosts: ['seabreeze.localhost', 'printworks.localhost'] }) });
  if (!r.ok) throw new Error(`revalidate failed: ${r.status}`);
  // Warm up routes so first-compile time doesn't eat test timeouts in dev mode.
  for (const [host, path] of [['seabreeze.localhost:3000', '/'], ['seabreeze.localhost:3000', '/book'], ['seabreeze.localhost:3000', '/stay'], ['localhost:3000', '/admin/login'], ['localhost:3000', '/admin']]) {
    await fetch(`http://${host}${path}`).catch(() => {});
  }
}
