// Low-level Web Audio building blocks for the procedural SFX recipes.

const noiseCache = new WeakMap<AudioContext, { white: AudioBuffer; brown: AudioBuffer }>();

export function noiseBuffers(ctx: AudioContext): { white: AudioBuffer; brown: AudioBuffer } {
  let entry = noiseCache.get(ctx);
  if (entry) return entry;
  const len = Math.floor(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const n = Math.random() * 2 - 1;
    w[i] = n;
    last = (last + 0.02 * n) / 1.02;
    b[i] = last * 3.5;
  }
  entry = { white, brown };
  noiseCache.set(ctx, entry);
  return entry;
}

export function playNoise(
  ctx: AudioContext,
  out: AudioNode,
  t0: number,
  opts: {
    color?: 'white' | 'brown';
    dur: number;
    gain: number;
    /** Lowpass sweep [from, to] Hz; omit for unfiltered. */
    lp?: [number, number];
    hp?: number;
    /** Exponential gain decay to near-zero over dur (default true). */
    decay?: boolean;
    playbackRate?: number;
  },
): void {
  const src = ctx.createBufferSource();
  const { white, brown } = noiseBuffers(ctx);
  src.buffer = opts.color === 'brown' ? brown : white;
  src.loop = true;
  if (opts.playbackRate) src.playbackRate.value = opts.playbackRate;

  let node: AudioNode = src;
  if (opts.lp) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.max(30, opts.lp[0]), t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(30, opts.lp[1]), t0 + opts.dur);
    node.connect(lp);
    node = lp;
  }
  if (opts.hp) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = opts.hp;
    node.connect(hp);
    node = hp;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, t0);
  if (opts.decay !== false) g.gain.exponentialRampToValueAtTime(0.0005, t0 + opts.dur);
  node.connect(g);
  g.connect(out);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.05);
}

export function playTone(
  ctx: AudioContext,
  out: AudioNode,
  t0: number,
  opts: {
    type?: OscillatorType;
    freq: [number, number];
    dur: number;
    gain: number;
    /** Attack seconds (default 0.005). */
    attack?: number;
  },
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, opts.freq[0]), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freq[1]), t0 + opts.dur);
  const g = ctx.createGain();
  const attack = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0005, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + opts.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.05);
}
