import { PROTOCOL_VERSION, type ServerMsg } from '@mortar/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/routes';
import { useAppStore } from '../../app/store';
import { getGame } from '../../game/gameHost';
import { KeyboardInput } from '../../game/input/keyboard';
import { NetworkSession } from '../../session/NetworkSession';
import {
  clearRejoin,
  loadRejoin,
  savedNickname,
  saveNickname,
  saveRejoin,
} from '../../session/rejoinStorage';
import { WsClient } from '../../session/wsClient';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';
import { HudRoot } from '../hud/HudRoot';

type Stage = 'form' | 'connecting' | 'lobby' | 'game';
export type OnlineMode = 'create' | 'join' | 'rejoin';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Server heartbeats every 10s; silence beyond this means a zombie socket. */
const STALE_MS = 35_000;

/**
 * Create/join/rejoin a room and play over the wire.
 *
 * Connection resilience, from first principles: sockets die silently when
 * phones sleep, so no single event can be trusted. One recovery routine
 * covers every in-room stage (lobby, game, end screen) and is triggered by
 * socket close, tab wake (visibility/pageshow/focus), and a periodic
 * watchdog that also detects zombie sockets via heartbeat staleness. All
 * lobby truth (ready flags, membership) lives on the server and is re-derived
 * after every reconnect — the UI never owns it.
 */
export function OnlineScreen({ mode, initialCode }: { mode: OnlineMode; initialCode?: string }) {
  const [stage, setStage] = useState<Stage>('form');
  const [nickname, setNickname] = useState(() => savedNickname());
  const [codeDraft, setCodeDraft] = useState(initialCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const wsRef = useRef<WsClient | null>(null);
  const sessionRef = useRef<NetworkSession | null>(null);
  const pendingRef = useRef<ServerMsg[]>([]);
  const stageRef = useRef<Stage>('form');
  const nickRef = useRef('');
  const recoveringRef = useRef(false);
  const recoverRef = useRef<() => void>(() => {});
  stageRef.current = stage;

  const matchActive = useAppStore((s) => s.matchActive);
  const roomCode = useAppStore((s) => s.roomCode);
  const peers = useAppStore((s) => s.peers);
  const mySeat = useAppStore((s) => s.mySeat);
  const netError = useAppStore((s) => s.netError);

  const myReady = peers.find((p) => p.seat === mySeat)?.ready ?? false;

  // Cleanup everything when the screen unmounts.
  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onClose = null;
        ws.close();
      }
      useAppStore.getState().clearMatch();
    };
  }, []);

  useEffect(() => {
    if (matchActive) setStage('game');
  }, [matchActive]);

  // Keyboard control while in-game.
  useEffect(() => {
    if (stage !== 'game') return;
    const game = getGame();
    if (!game) return;
    const keyboard = new KeyboardInput({
      onFire: () => {
        const s = useAppStore.getState();
        if (s.matchPhase === 'aim' && !s.shopOpen && !s.menuOpen) sessionRef.current?.fire();
      },
      onEscape: () => {
        const s = useAppStore.getState();
        if (s.shopOpen) s.setShopOpen(false);
        else s.setMenuOpen(!s.menuOpen);
      },
    });
    const tickerCb = (ticker: { deltaMS: number }) => {
      const { dAngle, dPower } = keyboard.poll(ticker.deltaMS / 1000);
      if (dAngle !== 0 || dPower !== 0) sessionRef.current?.aimBy(dAngle, dPower);
    };
    game.app.ticker.add(tickerCb);
    return () => {
      keyboard.dispose();
      game.app.ticker.remove(tickerCb);
    };
  }, [stage]);

  // Lobby QR for phones on the LAN.
  useEffect(() => {
    if (!roomCode) return;
    const joinUrl = `${window.location.origin}${window.location.pathname}#/join/${roomCode}`;
    QRCode.toDataURL(joinUrl, { width: 220, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [roomCode]);

  /** Wire handlers onto a socket (initial connect and every reconnect). */
  const attach = useCallback((ws: WsClient) => {
    ws.on((msg) => {
      if (msg.type === 'ping') return; // liveness only
      if (msg.type === 'room:created' || msg.type === 'room:joined') {
        saveRejoin({ code: msg.code, token: msg.token, seat: msg.seat, nickname: nickRef.current });
        useAppStore.setState({ roomCode: msg.code, mySeat: msg.seat, netError: null });
        const game = getGame();
        if (game) {
          void game.whenReady().then(() => {
            if (wsRef.current !== ws) return;
            sessionRef.current?.dispose();
            const session = new NetworkSession(game, ws, msg.seat);
            sessionRef.current = session;
            session.start();
            for (const m of pendingRef.current) session.deliver(m);
            pendingRef.current = [];
          });
        }
        setStage((s) => (s === 'game' ? 'game' : 'lobby'));
      } else if (msg.type === 'error') {
        if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'BAD_TOKEN') {
          clearRejoin();
          useAppStore.setState({ netError: 'This room no longer exists.' });
        }
        setError(msg.msg);
        if (stageRef.current === 'connecting') setStage('form');
      } else if (msg.type === 'room:closed') {
        clearRejoin();
        useAppStore.setState({
          netError:
            msg.reason === 'opponentLeft'
              ? 'Your opponent left — no rematch this time.'
              : 'The room was closed.',
        });
      } else if (!sessionRef.current) {
        if (pendingRef.current.length < 200) pendingRef.current.push(msg);
      }
    });
    ws.onClose = () => {
      if (wsRef.current === ws) recoverRef.current();
    };
  }, []);

  /** The one reconnect path for every in-room stage. */
  const recover = useCallback(async () => {
    if (recoveringRef.current) return;
    const info = loadRejoin();
    const s = useAppStore.getState();
    if (!info || s.roomCode === null || s.netError) return;
    recoveringRef.current = true;
    setReconnecting(true);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (wsRef.current?.connected) return; // something else fixed it
        try {
          const next = new WsClient();
          await next.connect();
          wsRef.current?.close();
          wsRef.current = next;
          attach(next);
          next.send({
            type: 'room:rejoin',
            v: PROTOCOL_VERSION,
            code: info.code,
            token: info.token,
          });
          return;
        } catch {
          await sleep(Math.min(5000, 700 * 2 ** attempt));
        }
      }
      useAppStore.setState({ netError: 'Could not reconnect to the server.' });
    } finally {
      recoveringRef.current = false;
      setReconnecting(false);
    }
  }, [attach]);
  recoverRef.current = () => void recover();

  // Watchdog: wake-ups and a 5s pulse catch silently dead sockets.
  useEffect(() => {
    const check = () => {
      const s = useAppStore.getState();
      if (s.roomCode === null || s.netError) return;
      const ws = wsRef.current;
      if (!ws || !ws.connected || ws.sinceLastMessage() > STALE_MS) {
        ws?.close();
        recoverRef.current();
      } else {
        ws.send({ type: 'pong' }); // transport probe: dead sockets error fast
      }
    };
    const onWake = () => setTimeout(check, 300);
    const iv = setInterval(check, 5000);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('pageshow', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  const connect = useCallback(async () => {
    const info = mode === 'rejoin' ? loadRejoin() : null;
    if (mode === 'rejoin' && !info) {
      setError('No match to resume.');
      return;
    }
    const nick = (mode === 'rejoin' ? info!.nickname : nickname.trim()) || 'Player';
    nickRef.current = nick;
    saveNickname(nick);
    setError(null);
    setStage('connecting');
    try {
      const ws = new WsClient();
      await ws.connect();
      wsRef.current = ws;
      attach(ws);
      if (mode === 'create') {
        ws.send({ type: 'room:create', v: PROTOCOL_VERSION, nickname: nick });
      } else if (mode === 'join') {
        ws.send({
          type: 'room:join',
          v: PROTOCOL_VERSION,
          code: codeDraft.trim().toUpperCase(),
          nickname: nick,
        });
      } else {
        ws.send({ type: 'room:rejoin', v: PROTOCOL_VERSION, code: info!.code, token: info!.token });
      }
    } catch (e) {
      setError((e as Error).message);
      setStage('form');
    }
  }, [mode, nickname, codeDraft, attach]);

  // Rejoin mode connects immediately.
  useEffect(() => {
    if (mode === 'rejoin') void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const toggleReady = useCallback(() => {
    wsRef.current?.send({ type: 'lobby:ready', ready: !myReady });
  }, [myReady]);

  const onExit = useCallback(() => {
    sessionRef.current?.leave();
    clearRejoin();
    navigate('');
  }, []);

  if (stage === 'game') {
    return (
      <>
        <HudRoot
          onRestart={() => sessionRef.current?.rematch()}
          restartLabel="Rematch"
          onExit={onExit}
          onBuy={(id) => sessionRef.current?.buy(id)}
          onLoadoutReady={() => sessionRef.current?.loadoutReady()}
          onSelectWeapon={(id) => sessionRef.current?.selectWeapon(id)}
          onAimBy={(d) => sessionRef.current?.aimBy(d, 0)}
          onSetPower={(p) => sessionRef.current?.setAim(useAppStore.getState().aim.angle, p)}
          onFire={() => {
            const s = useAppStore.getState();
            if (s.matchPhase === 'aim' && !s.shopOpen && !s.menuOpen) sessionRef.current?.fire();
          }}
        />
        {reconnecting && <ReconnectingPill />}
        {netError && <ErrorOverlay message={netError} onHome={onExit} />}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <GlassPanel className="pointer-events-auto flex max-h-[88dvh] w-full max-w-md flex-col gap-4 overflow-y-auto px-8 py-8 max-sm:landscape:gap-2.5 max-sm:landscape:py-4">
        {stage !== 'lobby' && (
          <>
            <h1 className="text-center text-2xl font-bold text-white">
              {mode === 'create' ? 'Create a Room' : mode === 'join' ? 'Join a Room' : 'Resume Match'}
            </h1>
            {mode !== 'rejoin' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-white/55 uppercase">Your name</span>
                <input
                  className="rounded-xl border border-white/15 bg-black/25 px-4 py-2.5 text-white outline-none focus:border-white/40"
                  value={nickname}
                  maxLength={16}
                  placeholder="Commander"
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
            )}
            {mode === 'join' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-white/55 uppercase">Room code</span>
                <input
                  className="rounded-xl border border-white/15 bg-black/25 px-4 py-2.5 font-mono text-lg tracking-[0.4em] text-white uppercase outline-none focus:border-white/40"
                  value={codeDraft}
                  maxLength={4}
                  placeholder="KZWQ"
                  onChange={(e) => setCodeDraft(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                />
              </label>
            )}
            {(error ?? netError) && <p className="text-sm text-red-300">{error ?? netError}</p>}
            {mode !== 'rejoin' && (
              <Button
                onClick={() => void connect()}
                disabled={
                  stage === 'connecting' || (mode === 'join' && codeDraft.trim().length !== 4)
                }
              >
                {stage === 'connecting' ? 'Connecting…' : mode === 'create' ? 'Create' : 'Join'}
              </Button>
            )}
            {mode === 'rejoin' && stage === 'connecting' && (
              <p className="text-center text-sm text-white/60">Reconnecting to your match…</p>
            )}
            <Button variant="glass" onClick={() => navigate('')}>
              Back
            </Button>
          </>
        )}
        {stage === 'lobby' && (
          <>
            <h1 className="text-center text-xl font-bold text-white">Room</h1>
            <p className="text-center font-mono text-5xl font-bold tracking-[0.3em] text-white">
              {roomCode}
            </p>
            {qr && (
              <div className="flex justify-center">
                <img src={qr} alt="join QR" className="rounded-xl border border-white/20" />
              </div>
            )}
            <p className="text-center text-xs text-white/50">
              Share the code or scan from a phone on the same Wi-Fi.
            </p>
            <div className="flex flex-col gap-1.5">
              {peers.map((p) => (
                <div
                  key={p.seat}
                  className="flex items-center justify-between rounded-xl bg-black/20 px-4 py-2"
                >
                  <span className="text-sm font-semibold text-white/85">
                    {p.nickname}
                    {p.seat === mySeat && <span className="text-white/40"> (you)</span>}
                  </span>
                  <span className={`text-xs ${p.ready ? 'text-emerald-300' : 'text-white/40'}`}>
                    {p.connected ? (p.ready ? 'ready' : 'waiting') : 'disconnected'}
                  </span>
                </div>
              ))}
              {peers.length < 2 && (
                <div className="rounded-xl bg-black/10 px-4 py-2 text-sm text-white/35">
                  Waiting for opponent…
                </div>
              )}
            </div>
            {reconnecting && (
              <p className="text-center text-xs font-semibold text-amber-200">Reconnecting…</p>
            )}
            {(error ?? netError) && <p className="text-sm text-red-300">{error ?? netError}</p>}
            <Button onClick={toggleReady} variant={myReady ? 'glass' : 'primary'}>
              {myReady ? 'Not ready' : 'Ready'}
            </Button>
            <Button variant="glass" onClick={onExit}>
              Leave
            </Button>
          </>
        )}
      </GlassPanel>
    </div>
  );
}

function ReconnectingPill() {
  return (
    <div className="pointer-events-none absolute top-32 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-400/20 px-5 py-2 text-sm font-semibold text-amber-100 backdrop-blur-xl">
      Reconnecting…
    </div>
  );
}

function ErrorOverlay({ message, onHome }: { message: string; onHome: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/40">
      <GlassPanel className="flex flex-col items-center gap-4 px-8 py-6">
        <p className="text-sm text-white/85">{message}</p>
        <Button onClick={onHome}>Home</Button>
      </GlassPanel>
    </div>
  );
}
