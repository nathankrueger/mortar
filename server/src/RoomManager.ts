import { Room } from './Room';

// Room codes avoid vowels and lookalikes: no accidental words, no 0/O 1/I.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE_LEN = 4;
const IDLE_TTL_MS = 30 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(config?: unknown): Room {
    let code = '';
    do {
      code = Array.from(
        { length: CODE_LEN },
        () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, config);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  remove(room: Room): void {
    this.rooms.delete(room.code);
  }

  get count(): number {
    return this.rooms.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const idle = now - room.lastActivity;
      if (idle > IDLE_TTL_MS || (room.empty && idle > 5 * 60 * 1000)) {
        room.dispose();
        this.rooms.delete(room.code);
      }
    }
  }
}
