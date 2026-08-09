import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'solo' }
  | { name: 'online'; mode: 'create' | 'join' | 'rejoin'; code?: string }
  | { name: 'dev-terrain' }
  | { name: 'dev-hotseat' }
  | { name: 'dev-sandbox' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0];
  if (path.startsWith('/solo')) return { name: 'solo' };
  if (path.startsWith('/online/create')) return { name: 'online', mode: 'create' };
  if (path.startsWith('/online/join')) return { name: 'online', mode: 'join' };
  if (path.startsWith('/online/rejoin')) return { name: 'online', mode: 'rejoin' };
  const joinMatch = /^\/join\/([a-zA-Z]{4})/.exec(path);
  if (joinMatch) return { name: 'online', mode: 'join', code: joinMatch[1].toUpperCase() };
  if (path.startsWith('/dev/terrain')) return { name: 'dev-terrain' };
  if (path.startsWith('/dev/hotseat')) return { name: 'dev-hotseat' };
  if (path.startsWith('/dev/sandbox')) return { name: 'dev-sandbox' };
  return { name: 'home' };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}
