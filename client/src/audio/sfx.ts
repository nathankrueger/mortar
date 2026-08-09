import { audio } from './AudioEngine';
import { playNoise, playTone } from './synth';

// Named, procedurally synthesized effects. Tier scales explosions 0..4.

export const sfx = {
  fire(tier: number): void {
    audio.sfx((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [170, 55], dur: 0.22 + tier * 0.03, gain: 0.5 });
      playNoise(ctx, out, t0, { dur: 0.09, gain: 0.35, lp: [3200, 500] });
    });
  },

  explosion(tier: number): void {
    audio.sfx((ctx, out, t0) => {
      const dur = 0.7 + tier * 0.4;
      const gain = 0.55 + tier * 0.14;
      // Body rumble.
      playNoise(ctx, out, t0, { color: 'brown', dur, gain, lp: [850 + tier * 250, 70] });
      // Sub thump.
      playTone(ctx, out, t0, {
        freq: [64 + tier * 8, 26],
        dur: 0.5 + tier * 0.28,
        gain: 0.55 + tier * 0.12,
      });
      // Initial crack.
      playNoise(ctx, out, t0, { dur: 0.05, gain: 0.4 + tier * 0.08, hp: 1200 });
      if (tier >= 2) {
        // Long shimmering tail for the big ones.
        playNoise(ctx, out, t0 + 0.15, {
          color: 'brown',
          dur: dur * 1.3,
          gain: 0.25 + tier * 0.06,
          lp: [300, 45],
        });
      }
    });
  },

  bounce(): void {
    audio.sfx((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [330, 140], dur: 0.16, gain: 0.3 });
      playNoise(ctx, out, t0, { dur: 0.05, gain: 0.15, lp: [2500, 900] });
    });
  },

  split(): void {
    audio.sfx((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [520, 620], dur: 0.05, gain: 0.25 });
      playTone(ctx, out, t0 + 0.06, { freq: [650, 760], dur: 0.05, gain: 0.25 });
      playTone(ctx, out, t0 + 0.12, { freq: [800, 930], dur: 0.05, gain: 0.25 });
    });
  },

  dud(): void {
    audio.sfx((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [130, 62], dur: 0.3, gain: 0.3 });
      playNoise(ctx, out, t0, { dur: 0.2, gain: 0.12, lp: [700, 200] });
    });
  },

  fall(): void {
    audio.sfx((ctx, out, t0) => {
      playNoise(ctx, out, t0, { dur: 0.18, gain: 0.3, lp: [900, 250] });
    });
  },

  uiTick(): void {
    audio.ui((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [1250, 1150], dur: 0.04, gain: 0.2 });
    });
  },

  turn(): void {
    audio.ui((ctx, out, t0) => {
      playTone(ctx, out, t0, { freq: [620, 620], dur: 0.07, gain: 0.16 });
      playTone(ctx, out, t0 + 0.09, { freq: [930, 930], dur: 0.09, gain: 0.16 });
    });
  },

  win(): void {
    audio.ui((ctx, out, t0) => {
      const notes = [523, 659, 784];
      notes.forEach((f, i) =>
        playTone(ctx, out, t0 + i * 0.12, { type: 'triangle', freq: [f, f], dur: 0.22, gain: 0.2 }),
      );
    });
  },

  lose(): void {
    audio.ui((ctx, out, t0) => {
      const notes = [392, 330, 262];
      notes.forEach((f, i) =>
        playTone(ctx, out, t0 + i * 0.14, { type: 'triangle', freq: [f, f * 0.97], dur: 0.26, gain: 0.18 }),
      );
    });
  },
};
