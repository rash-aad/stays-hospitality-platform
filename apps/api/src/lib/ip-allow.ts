import { BlockList, isIP } from 'node:net';

/** Parse "203.0.113.0/24, 198.51.100.7, 2001:db8::/32" into a matcher. Empty → null (no restriction). */
export function ipAllowList(spec: string | undefined | null) {
  const entries = (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return null;
  const list = new BlockList();
  for (const e of entries) {
    const [addr, bits] = e.split('/');
    const family = isIP(addr!);
    if (!family) throw new Error(`Invalid IP allow-list entry: ${e}`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits) list.addSubnet(addr!, Number(bits), type);
    else list.addAddress(addr!, type);
  }
  return (ip: string) => {
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    const a = v4 ?? ip;
    const family = isIP(a);
    return family !== 0 && list.check(a, family === 4 ? 'ipv4' : 'ipv6');
  };
}

let memo: { spec: string | undefined; fn: ((ip: string) => boolean) | null } | null = null;
/** Whether an address may use the platform console (PLATFORM_IP_ALLOWLIST; empty = anywhere). */
export function platformIpAllowed(ip: string, spec: string | undefined): boolean {
  if (!memo || memo.spec !== spec) memo = { spec, fn: ipAllowList(spec) };
  return !memo.fn || memo.fn(ip);
}
