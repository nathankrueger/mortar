import { decodeClient, PROTOCOL_VERSION, type Seat } from '@mortar/shared';
import type { WebSocket } from 'ws';
import type { Room } from './Room';
import type { RoomManager } from './RoomManager';

interface ConnState {
  room: Room | null;
  seat: Seat | null;
}

/** Per-socket plumbing: parse, route to a room, heartbeat, cleanup. */
export function handleConnection(ws: WebSocket, rooms: RoomManager): void {
  const state: ConnState = { room: null, seat: null };
  const anyWs = ws as WebSocket & { isAlive?: boolean };
  anyWs.isAlive = true;

  const sendErr = (code: string, msg: string): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', code, msg }));
  };

  ws.on('pong', () => {
    anyWs.isAlive = true;
  });

  ws.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (text.length > 512 * 1024) {
      sendErr('BAD_MESSAGE', 'message too large');
      ws.close();
      return;
    }
    const msg = decodeClient(text);
    if (!msg) {
      sendErr('BAD_MESSAGE', 'malformed message');
      return;
    }

    // Pre-room messages establish membership; everything else routes to a room.
    if (msg.type === 'room:create' || msg.type === 'room:join' || msg.type === 'room:rejoin') {
      if (state.room) {
        sendErr('BAD_PHASE', 'already in a room');
        return;
      }
      if (msg.v !== PROTOCOL_VERSION) {
        sendErr('VERSION_MISMATCH', `server protocol v${PROTOCOL_VERSION}; reload the page`);
        ws.close();
        return;
      }
      if (msg.type === 'room:create') {
        const room = rooms.create(msg.config);
        const res = room.addPlayer(ws, msg.nickname);
        if (res === 'full') {
          sendErr('ROOM_FULL', 'room is full');
          return;
        }
        state.room = room;
        state.seat = res.seat;
        ws.send(
          JSON.stringify({
            type: 'room:created',
            code: room.code,
            seat: res.seat,
            token: res.token,
            v: PROTOCOL_VERSION,
          }),
        );
        room.broadcastPeers();
      } else if (msg.type === 'room:join') {
        const room = rooms.get(msg.code);
        if (!room) {
          sendErr('ROOM_NOT_FOUND', `no room ${msg.code}`);
          return;
        }
        const res = room.addPlayer(ws, msg.nickname);
        if (res === 'full') {
          sendErr('ROOM_FULL', 'room already has two players');
          return;
        }
        state.room = room;
        state.seat = res.seat;
        ws.send(
          JSON.stringify({
            type: 'room:joined',
            code: room.code,
            seat: res.seat,
            token: res.token,
            v: PROTOCOL_VERSION,
          }),
        );
        room.broadcastPeers();
      } else {
        const room = rooms.get(msg.code);
        if (!room) {
          sendErr('ROOM_NOT_FOUND', `no room ${msg.code}`);
          return;
        }
        const seat = room.rejoin(ws, msg.token);
        if (seat === 'bad-token') {
          sendErr('BAD_TOKEN', 'invalid rejoin token');
          return;
        }
        state.room = room;
        state.seat = seat;
        ws.send(
          JSON.stringify({
            type: 'room:joined',
            code: room.code,
            seat,
            token: msg.token,
            v: PROTOCOL_VERSION,
          }),
        );
        room.broadcastPeers();
        room.sendSnapshot(seat);
      }
      return;
    }

    if (!state.room || state.seat === null) {
      sendErr('BAD_PHASE', 'join a room first');
      return;
    }
    state.room.handleMsg(state.seat, msg);
  });

  ws.on('close', () => {
    if (state.room && state.seat !== null) state.room.onDisconnect(state.seat);
  });

  ws.on('error', () => {
    ws.close();
  });
}

export function startHeartbeat(getClients: () => Set<WebSocket>): void {
  setInterval(() => {
    for (const ws of getClients()) {
      const anyWs = ws as WebSocket & { isAlive?: boolean };
      if (anyWs.isAlive === false) {
        ws.terminate();
        continue;
      }
      anyWs.isAlive = false;
      ws.ping();
      // App-level heartbeat too: protocol pings never reach page JS, and
      // clients need recent traffic to tell zombie sockets from idle ones.
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 10_000).unref();
}
