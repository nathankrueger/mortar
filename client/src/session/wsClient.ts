import { decodeServer, encode, type ClientMsg, type ServerMsg } from '@mortar/shared';

export type ServerHandler = (msg: ServerMsg) => void;

/** Thin WebSocket wrapper: connect, typed send, decoded dispatch. */
export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<ServerHandler>();
  onClose: ((clean: boolean) => void) | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error('could not reach the game server'));
      ws.onmessage = (ev) => {
        const msg = decodeServer(String(ev.data));
        if (!msg) return;
        for (const h of [...this.handlers]) h(msg);
      };
      ws.onclose = (ev) => {
        const wasOpen = this.ws === ws;
        this.ws = null;
        if (wasOpen) this.onClose?.(ev.wasClean);
      };
    });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg): void {
    if (this.connected) this.ws!.send(encode(msg));
  }

  on(handler: ServerHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
