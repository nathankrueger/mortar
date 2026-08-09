import os from 'node:os';

/** Non-internal IPv4 addresses of this machine, for LAN join URLs. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

export function lanUrls(port: number): string[] {
  return lanAddresses().map((a) => `http://${a}:${port}`);
}
