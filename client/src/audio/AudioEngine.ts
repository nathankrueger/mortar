/**
 * AudioContext lifecycle + bus graph:
 *   voices → sfx/ui gains → gentle compressor → hard limiter → destination
 * The context is created inside the first user gesture (iOS requirement).
 */
class AudioEngineImpl {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private unlocked = false;
  sfxVolume = 0.8;
  uiVolume = 0.5;

  /** Call once at app start; arms one-time gesture listeners. */
  installUnlock(): void {
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.ctx?.resume();
    });
  }

  private ensure(): void {
    if (this.unlocked) {
      void this.ctx?.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      // iOS 17+: keep SFX alive under the mute switch like a game should.
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -5;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      compressor.connect(limiter);
      limiter.connect(ctx.destination);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(compressor);
      this.uiGain = ctx.createGain();
      this.uiGain.gain.value = this.uiVolume;
      this.uiGain.connect(compressor);

      // Silent tick fully unlocks playback on iOS.
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();

      this.ctx = ctx;
      this.unlocked = true;
    } catch {
      // Audio stays off; the game is fully playable silent.
    }
  }

  setVolumes(sfx: number, ui: number): void {
    this.sfxVolume = sfx;
    this.uiVolume = ui;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
    if (this.uiGain) this.uiGain.gain.value = ui;
  }

  sfx(build: (ctx: AudioContext, out: AudioNode, t0: number) => void): void {
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running' || this.sfxVolume <= 0) return;
    try {
      build(this.ctx, this.sfxGain, this.ctx.currentTime);
    } catch {
      // Never let a sound effect take down the game loop.
    }
  }

  ui(build: (ctx: AudioContext, out: AudioNode, t0: number) => void): void {
    if (!this.ctx || !this.uiGain || this.ctx.state !== 'running' || this.uiVolume <= 0) return;
    try {
      build(this.ctx, this.uiGain, this.ctx.currentTime);
    } catch {
      /* ignore */
    }
  }
}

export const audio = new AudioEngineImpl();
