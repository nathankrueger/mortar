# Mortar Mayhem

A modern web remake of the classic DOS artillery duel — minimalist, smooth, and
playable on desktop and mobile browsers. Two play modes:

- **Solo vs Computer** — three AI difficulties (the hard one simulates its shots
  before firing; bring nukes).
- **Online 1v1** — create a room, share the 4-letter code (or the lobby QR code),
  and duel across devices on your network. No accounts.

One continuous battlefield per match: terrain is seeded randomly, every crater
persists, tanks fall (and take damage) when the ground is blown out from under
them, and the match ends when someone runs out of health.

## Quick start

```bash
./install_requirements.sh   # npm install (needs Node >= 22.12)
./run_tests.sh              # vitest suites + typecheck
./run_server.sh             # build + run in background on http://localhost:8787
./run_server.sh -s          # status/health/join URLs · -r restart · -k stop
./cloc.sh                   # line counts (git-aware; -history for growth table)
```

The server prints your LAN URLs and a QR code — scan it from a phone on the
same Wi-Fi to join. For development, `npm run dev` runs the Vite client on
`:5173` (proxying game traffic to the server on `:8787`) with hot reload.

## How to play

Each player starts with **10,000 credits** and a pre-match loadout shop. The
basic Mortar is free and unlimited; everything else is bought — before the
match or mid-battle with the **Shop** button on your turn. Every turn grants a
**1,000 cr allowance**, and dealing damage pays **36 cr per HP** plus a
**300 cr direct-hit bonus**. Wind drifts a little each turn.

| Desktop | Mobile |
|---|---|
| ← / → aim the barrel | drag left/right anywhere on the field |
| ↑ / ↓ set power | power slider (right thumb) |
| Space fires | big Fire button |
| 1–9, 0, − select weapon | tap the weapon tray |
| Esc opens the menu | ≡ button (top-left) |

### Arsenal (17)

Mortar · Sniper Shell (tiny blast, brutal direct hits) · Large Mortar ·
Dirt Bomb (builds a hill instead of a crater) · Roller (rolls downhill to the
valley) · Bounce Bomb (3–6 hopping blasts, 18% dud finale) · Mirv (splits into
5) · Digger (burrows deep, then detonates) · Small/Medium/Large Nuke ·
Airstrike (six shells rain from above) · Multi Mirv (splits into 9) ·
Mirv Bounce (5 hopping warheads) · MNW (mirv gamble: splits high into 1–5
small nukes) · The Big One (you'll know) · Mega MNW (the same gamble, large
nukes).

Terrain obeys gravity: dirt with nothing under it falls, crater lips slump
inward, and a Dirt Bomb hill will bury (or elevate) whoever it lands on.

## Tuning

Gameplay numbers all live in `shared/src`:

- `weapons.ts` — prices, blast radii, damage, split/bounce behavior
- `economy.ts` — credits per HP, direct-hit bonus
- `config.ts` — starting credits/HP, wind strength (lobby-tunable defaults)
- `constants.ts` — gravity, muzzle velocity, world size

## Architecture

npm workspaces monorepo, TypeScript end to end:

- **`shared/`** — deterministic simulation (terrain, ballistics, all weapon
  behaviors), economy, AI search, and the zod wire protocol. No build step;
  consumed as raw TS by everything below.
- **`client/`** — Vite + React 19 UI over a PixiJS v8 (WebGL) battlefield.
  Terrain renders through CPU canvas tiles mirrored from the sim's collision
  mask; explosions are particles + procedural Web Audio (no asset files).
- **`server/`** — Node + `ws` referee/relay (~500 lines): validates turns and
  purchases, rolls wind and shot seeds, relays resolved shot event logs, and
  keeps rejoin snapshots. It never simulates physics.

The active player's client resolves each shot with the shared engine and
uploads the event log; the opponent replays it. Carve circles are exact, so
both battlefields stay bit-identical (the test suite asserts convergence).

Refresh mid-match? The home screen offers **Resume match** — the server
snapshot (seed + carve list + state) rebuilds everything. Disconnected players
get 3 minutes to return before forfeiting.

## LAN troubleshooting

- Both devices must be on the **same network**, and guest Wi-Fi with
  "AP/client isolation" will block them from seeing your machine.
- On first run your OS firewall may prompt to allow Node on port 8787 — allow it.
- Sound starts after your first tap/keypress (browser autoplay rules).
- `PORT=9000 npm start` changes the port.

## Dev extras

- `#/dev/terrain?seed=N` — terrain/theme previewer
- `#/dev/sandbox` — firing range with every weapon unlocked
- `#/dev/hotseat` — two players, one keyboard
