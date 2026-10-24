export class AudioManager {
  private ctx?: AudioContext;
  private isMuted: boolean = false;
  private noiseBuffer?: AudioBuffer;

  // Continuous Jetpack Audio Nodes
  private jetGain?: GainNode;
  private jetOsc?: OscillatorNode;
  private jetNoise?: AudioBufferSourceNode;

  constructor() {
    // AudioContext will initialize on first user gesture
    const initAudio = () => {
      this.initContext();
      window.removeEventListener('click', initAudio);
      window.removeEventListener('keydown', initAudio);
      window.removeEventListener('touchstart', initAudio);
    };

    window.addEventListener('click', initAudio);
    window.addEventListener('keydown', initAudio);
    window.addEventListener('touchstart', initAudio);
  }

  private initContext() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.buildNoiseBuffer();
    } catch {
      console.warn('[AudioManager] Web Audio API not supported.');
    }
  }

  private resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private buildNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  /**
   * Procedural sci-fi boot footstep on solid terrain
   */
  public playFootstep(isSprinting: boolean = false) {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const pitchMod = isSprinting ? 1.25 : 1.0;
    const baseFreq = 90 * pitchMod;

    // Sub-bass thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.07);

    oscGain.gain.setValueAtTime(isSprinting ? 0.35 : 0.22, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.08);

    // Boot sole scuff noise
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isSprinting ? 1800 : 1300, t);
      filter.Q.setValueAtTime(2.5, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(isSprinting ? 0.15 : 0.09, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(t);
      noise.stop(t + 0.06);
    }
  }

  /**
   * Jump takeoff and cybernetic double/triple jump impulses
   */
  public playJump(tierOrDouble: number | boolean = 1) {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const tier = typeof tierOrDouble === 'boolean' ? (tierOrDouble ? 2 : 1) : tierOrDouble;

    if (tier === 1) {
      // Normal ground jump: Servo leap sound
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.14);

      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    } else if (tier === 2) {
      // Double Jump: Sci-Fi Neon Thruster Pulse
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(850, t + 0.18);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(3600, t + 0.18);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.23);
    } else {
      // Triple Jump: High-velocity Sonic Bloom & Shimmer Chime
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(520, t);
      osc1.frequency.exponentialRampToValueAtTime(1450, t + 0.22);

      gain1.gain.setValueAtTime(0.42, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(t);
      osc1.stop(t + 0.28);

      // Shimmer accent
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.5, t);
      osc2.frequency.exponentialRampToValueAtTime(2093, t + 0.18);
      gain2.gain.setValueAtTime(0.25, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(t);
      osc2.stop(t + 0.22);
    }
  }

  /**
   * Heavy landing thud on terrain
   */
  public playLanding() {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // Heavy bass impact
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.16);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);

    // Dust shockwave burst
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(650, t);
      filter.frequency.exponentialRampToValueAtTime(180, t + 0.15);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.22, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(t);
      noise.stop(t + 0.18);
    }
  }

  /**
   * Continuous Cyber Jetpack Propulsion Audio
   */
  public startJetpack() {
    this.resume();
    if (!this.ctx || this.isMuted || this.jetGain) return;

    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, t);
    masterGain.gain.exponentialRampToValueAtTime(0.24, t + 0.12);
    masterGain.connect(this.ctx.destination);
    this.jetGain = masterGain;

    // Sub-harmonic plasma turbine hum
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.25);

    const oscFilter = this.ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.setValueAtTime(320, t);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.18, t);

    osc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(t);
    this.jetOsc = osc;

    // High velocity gas hiss / exhaust rush
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(2200, t);
      noiseFilter.Q.setValueAtTime(1.8, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.16, t);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noise.start(t);
      this.jetNoise = noise;
    }
  }

  public stopJetpack() {
    if (!this.ctx || !this.jetGain) return;

    const t = this.ctx.currentTime;
    this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t);
    this.jetGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    const oldOsc = this.jetOsc;
    const oldNoise = this.jetNoise;
    const oldGain = this.jetGain;

    this.jetGain = undefined;
    this.jetOsc = undefined;
    this.jetNoise = undefined;

    setTimeout(() => {
      try {
        oldOsc?.stop();
        oldNoise?.stop();
        oldOsc?.disconnect();
        oldNoise?.disconnect();
        oldGain?.disconnect();
      } catch {
        // Disposed
      }
    }, 220);
  }

  /**
   * Ultra-satisfying crystal energy core collection sound with sparkling chime and tactile bass pop
   */
  public playCollectible(combo: number = 0) {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // Pentatonic scale arpeggio frequencies: C5, D5, E5, G5, A5, C6, D6, E6
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
    const baseFreq = scale[combo % scale.length];

    // 1. Sparkling Crystal Chime (Pure harmonic bell tone)
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, t);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 2.0, t + 0.14);

    gain1.gain.setValueAtTime(0.38, t);
    gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.48);

    // 2. High Shimmer Harmonics (Octave sparkle ping)
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(baseFreq * 2.5, t);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 4.0, t + 0.18);

    gain2.gain.setValueAtTime(0.22, t);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.35);

    // 3. Tactile Satisfying Sub-Bass Thump (Punchy tactile physical sensation)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(95, t);
    subOsc.frequency.exponentialRampToValueAtTime(32, t + 0.08);

    subGain.gain.setValueAtTime(0.42, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);

    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(t);
    subOsc.stop(t + 0.11);
  }
}
