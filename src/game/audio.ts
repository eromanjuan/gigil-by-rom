/**
 * The recorded voice.
 *
 * Everything else in this file is synthesised, but a real person in pain has a
 * rasp and a break in it that no amount of formant filtering reproduces, so
 * these are samples. They're fetched once on the first user gesture, alongside
 * the AudioContext that has to be created there anyway.
 *
 * Nothing here knows what any clip says, and that's deliberate. They're sorted
 * by how long they turn out to be once decoded, and picked from a band chosen
 * by how much damage has been done - because a short sharp noise is what a
 * light hit gets and a long one is what someone does when they've had enough,
 * in any language. Dropping another file in the folder and adding its name
 * below is the whole of adding a new line.
 */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const VOICE_FILES = [
  '/voice/voice-01.mp3',
  '/voice/voice-02.mp3',
  '/voice/voice-03.mp3',
  '/voice/voice-04.mp3',
  '/voice/voice-05.mp3',
  '/voice/voice-06.mp3',
  '/voice/voice-07.mp3',
  '/voice/voice-08.mp3',
  '/voice/voice-09.mp3',
  '/voice/voice-10.mp3',
  '/voice/voice-11.mp3',
  '/voice/voice-12.mp3',
  '/voice/voice-13.mp3',
  '/voice/voice-14.mp3',
  '/voice/voice-15.mp3',
]

/**
 * Spitting. Recorded rather than synthesised for the same reason the voice is:
 * it's a mouth noise, and gated noise through a filter gets the hiss but never
 * the wetness.
 */
const SPIT_FILES = ['/sfx/spit-01.mp3', '/sfx/spit-02.mp3', '/sfx/spit-03.mp3']

/**
 * Every sound is synthesised at runtime - no audio files to load, license or
 * cache-bust, and pitch/length can react to how hard the hit landed.
 */
export class Sfx {
  /** Wall-clock time the current line finishes; guards against overlap. */
  private voiceBusyUntil = 0
  /** Decoded clips, shortest first. */
  private voices: AudioBuffer[] = []
  private spits: AudioBuffer[] = []
  private voiceLoad: Promise<void> | null = null

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  muted = false

  /** Must be called from a user gesture; browsers won't start audio otherwise. */
  async resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.85
      this.master.connect(this.ctx.destination)

      const len = this.ctx.sampleRate * 1.5
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    // Kicked off here rather than awaited: the clips are only wanted once
    // something has actually been hit, and blocking the gesture that starts
    // audio on a network round trip would swallow the first punch's sound.
    void this.loadVoices()
  }

  private get t() {
    return this.ctx!.currentTime
  }

  private ready() {
    return !this.muted && this.ctx && this.master && this.noise
  }

  /** A gated slice of white noise. The workhorse behind every impact. */
  private burst(opts: {
    duration: number
    gain: number
    type: BiquadFilterType
    freq: number
    freqEnd?: number
    q?: number
    delay?: number
    /** Seconds to reach full level. A crack needs ~1ms; a thud wants more. */
    attack?: number
  }) {
    const ctx = this.ctx!
    const t0 = this.t + (opts.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = opts.type
    filter.frequency.setValueAtTime(opts.freq, t0)
    if (opts.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.freqEnd), t0 + opts.duration)
    }
    filter.Q.value = opts.q ?? 1

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(opts.gain, t0 + (opts.attack ?? 0.004))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)

    src.connect(filter).connect(gain).connect(this.master!)
    src.start(t0)
    src.stop(t0 + opts.duration + 0.05)
  }

  /** A pitched tone with an exponential pitch slide. */
  private tone(opts: {
    type: OscillatorType
    from: number
    to: number
    duration: number
    gain: number
    delay?: number
    destination?: AudioNode
  }) {
    const ctx = this.ctx!
    const t0 = this.t + (opts.delay ?? 0)
    const osc = ctx.createOscillator()
    osc.type = opts.type
    osc.frequency.setValueAtTime(opts.from, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.duration)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(opts.gain, t0 + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)

    osc.connect(gain).connect(opts.destination ?? this.master!)
    osc.start(t0)
    osc.stop(t0 + opts.duration + 0.05)
    return osc
  }

  /**
   * A little detune, fresh per hit.
   *
   * This does more for realism than any amount of extra layering. Two
   * identical impacts back to back are the single clearest tell that a sound
   * is synthetic - real ones never repeat exactly, because the hand never
   * lands in quite the same place twice.
   */
  private get vary() {
    return 0.9 + Math.random() * 0.2
  }

  /**
   * A punch is three events inside 100ms: knuckle hitting skin, flesh
   * compressing, and the low thump of a head's worth of mass being shifted.
   * Layering them with different decays is what separates it from a beep.
   */
  punch(power = 1) {
    if (!this.ready()) return
    this.burst({ duration: 0.014, gain: 0.4, type: 'highpass', freq: 3600 * this.vary, attack: 0.001 })
    this.burst({ duration: 0.08, gain: 0.55, type: 'lowpass', freq: 1500 * this.vary, freqEnd: 260, attack: 0.002 })
    this.tone({ type: 'sine', from: 168 * power * this.vary, to: 38, duration: 0.26, gain: 0.85 })
    this.tone({ type: 'triangle', from: 95 * this.vary, to: 44, duration: 0.17, gain: 0.3, delay: 0.006 })
  }

  /**
   * A slap is nearly all transient. Bright, extremely fast, and with far less
   * low end than a punch - the sound is skin cracking against skin, not mass
   * being moved, so the body under it barely contributes.
   */
  slap() {
    if (!this.ready()) return
    this.burst({ duration: 0.009, gain: 0.85, type: 'highpass', freq: 3000 * this.vary, attack: 0.0008 })
    this.burst({ duration: 0.05, gain: 0.6, type: 'bandpass', freq: 2300 * this.vary, q: 0.7, attack: 0.001 })
    this.burst({ duration: 0.085, gain: 0.26, type: 'lowpass', freq: 640 * this.vary, freqEnd: 190 })
    this.tone({ type: 'sine', from: 265 * this.vary, to: 78, duration: 0.07, gain: 0.2 })
  }

  /** Dull and close. Fingers into soft tissue make no crack at all. */
  poke() {
    if (!this.ready()) return
    this.burst({ duration: 0.045, gain: 0.34, type: 'lowpass', freq: 950 * this.vary, freqEnd: 300, attack: 0.003 })
    this.tone({ type: 'triangle', from: 430 * this.vary, to: 115, duration: 0.13, gain: 0.26 })
  }

  /** Nasal honk. Bandpassed square wave sits right in the "nose" formant range. */
  pinch(twist = false) {
    if (!this.ready()) return
    const ctx = this.ctx!
    const shaper = ctx.createBiquadFilter()
    shaper.type = 'bandpass'
    shaper.frequency.value = 1000
    shaper.Q.value = 4
    shaper.connect(this.master!)
    this.tone({
      type: 'square',
      from: twist ? 260 : 330,
      to: twist ? 460 : 250,
      duration: twist ? 0.3 : 0.18,
      gain: 0.22,
      destination: shaper,
    })
    this.burst({ duration: 0.05, gain: 0.15, type: 'highpass', freq: 1800 })
  }

  /** Sustained strangle. Returns the stop function. */
  choke(): () => void {
    if (!this.ready()) return () => {}
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 420
    filter.Q.value = 6

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, this.t)
    gain.gain.linearRampToValueAtTime(0.32, this.t + 0.08)

    // A slow warble so the gurgle doesn't sit still.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 7
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 150
    lfo.connect(lfoGain).connect(filter.frequency)

    src.connect(filter).connect(gain).connect(this.master!)
    src.start()
    lfo.start()

    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      const end = this.t + 0.18
      gain.gain.cancelScheduledValues(this.t)
      gain.gain.setValueAtTime(gain.gain.value, this.t)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      src.stop(end + 0.05)
      lfo.stop(end + 0.05)
    }
  }

  /**
   * The recording if it has arrived, otherwise the synthesised version below:
   * two events with a gap, the hiss of it leaving through the teeth and then
   * the wet slap of it landing, where the gap is what sells the distance.
   *
   * The fallback stays because the clips are fetched on the first gesture and
   * the first spit can beat them to it - and a silent attack reads as broken
   * in a way a slightly worse one doesn't.
   */
  spit() {
    if (!this.ready()) return
    if (this.spits.length) {
      const buffer = this.spits[Math.floor(Math.random() * this.spits.length)]
      this.playSample(buffer, 0.95, clamp(this.vary, 0.9, 1.1))
      return
    }
    this.burst({ duration: 0.075, gain: 0.34, type: 'bandpass', freq: 4600 * this.vary, freqEnd: 1400, q: 0.9, attack: 0.004 })
    // The landing: low, short and damp, with no high end at all.
    this.burst({ duration: 0.1, gain: 0.42, type: 'lowpass', freq: 1200 * this.vary, freqEnd: 170, delay: 0.16, attack: 0.002 })
    this.tone({ type: 'sine', from: 190 * this.vary, to: 58, duration: 0.1, gain: 0.22, delay: 0.16 })
  }

  /**
   * Cartoon yelp: a sawtooth pushed through two formant bandpasses, which is
   * enough to read as an "ow" without recording anyone.
   */
  yelp(pitch = 1) {
    if (!this.ready()) return
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.value = 0.5
    out.connect(this.master!)

    for (const [freq, q, level] of [
      [700, 8, 1],
      [1180, 10, 0.7],
      [2600, 12, 0.25],
    ]) {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = freq * pitch
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.value = level
      f.connect(g).connect(out)
      const base = 190 * pitch * (0.9 + Math.random() * 0.2)
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      const t0 = this.t
      osc.frequency.setValueAtTime(base, t0)
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, t0 + 0.06)
      osc.frequency.exponentialRampToValueAtTime(base * 0.75, t0 + 0.3)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t0)
      env.gain.linearRampToValueAtTime(0.5, t0 + 0.02)
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34)
      osc.connect(env).connect(f)
      osc.start(t0)
      osc.stop(t0 + 0.4)
    }
  }

  /* --------------------------------------------------------------- voice */

  /**
   * Fetches and decodes the voice clips. Safe to call repeatedly - the promise
   * is cached - and safe to fail: a clip that doesn't load simply never gets
   * picked, and the synthesised reflex yelp still fires on every hit.
   */
  private async decodeAll(urls: string[]): Promise<AudioBuffer[]> {
    const ctx = this.ctx
    if (!ctx) return []
    const decoded = await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error(String(response.status))
          return await ctx.decodeAudioData(await response.arrayBuffer())
        } catch {
          console.warn(`[gigil] sample ${url} failed to load`)
          return null
        }
      }),
    )
    return decoded.filter((b): b is AudioBuffer => b !== null)
  }

  private loadVoices() {
    if (this.voiceLoad) return this.voiceLoad
    if (!this.ctx) return Promise.resolve()
    this.voiceLoad = Promise.all([
      // Sorted by length, so the bands are positional rather than
      // hand-maintained: a clip that turns out short becomes a light reaction
      // whatever it happens to say.
      this.decodeAll(VOICE_FILES).then((b) => {
        this.voices = b.sort((x, y) => x.duration - y.duration)
      }),
      this.decodeAll(SPIT_FILES).then((b) => {
        this.spits = b
      }),
    ]).then(() => {})
    return this.voiceLoad
  }

  /** Fires a decoded one-shot straight at the master. Returns its length. */
  private playSample(buffer: AudioBuffer, gain: number, rate: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    const out = ctx.createGain()
    out.gain.value = gain
    src.connect(out).connect(this.master!)
    src.start()
    return buffer.duration / rate
  }

  /**
   * Picks a clip for a given intensity, 0 (barely touched) to 1 (finished).
   *
   * The band widens at the top: there are far more short exclamations than
   * long ones, and a fight that's gone on a while should be reaching for the
   * latter more often than chance would give it.
   */
  private pickVoice(intensity: number): AudioBuffer | null {
    if (!this.voices.length) return null
    const t = clamp(intensity, 0, 1)
    const span = this.voices.length - 1
    // A window around the target rather than a hard index, so repeated hits at
    // the same damage level don't cycle the same two clips.
    const centre = t * span
    const radius = Math.max(1, span * 0.22)
    const lo = Math.max(0, Math.round(centre - radius))
    const hi = Math.min(span, Math.round(centre + radius))
    return this.voices[lo + Math.floor(Math.random() * (hi - lo + 1))]
  }

  /**
   * Plays one recorded line.
   *
   * Returns its length in seconds, or 0 if nothing played - which the caller
   * uses to decide how long to stay quiet afterwards.
   */
  voice(intensity = 0, pitch = 1): number {
    if (!this.ready()) return 0
    // One voice at a time. Two overlapping lines stop sounding like a person
    // and start sounding like a crowd, and the head is only one person.
    if (this.t < this.voiceBusyUntil) return 0
    const buffer = this.pickVoice(intensity)
    if (!buffer) return 0

    // Resampling a real recording is only convincing over a narrow range -
    // push it further and a person in pain turns into a cartoon mouse - so the
    // caller's strain factor is squeezed into a band rather than used directly.
    const length = this.playSample(buffer, 0.9, clamp(0.94 + (pitch - 1) * 0.35, 0.88, 1.16))
    // A short gap on top, so lines don't run into each other back to back.
    this.voiceBusyUntil = this.t + length + 0.12
    return length
  }

  /** The longest thing on file, for when they're nearly finished. */
  cry(): number {
    return this.voice(1, 1)
  }

  /** True when nothing is currently being said. */
  get voiceIdle() {
    return !this.ctx || this.t >= this.voiceBusyUntil
  }

  /** Rising chime as the combo climbs. */
  comboBlip(step: number) {
    if (!this.ready()) return
    const base = 440 * Math.pow(2, Math.min(step, 12) / 12)
    this.tone({ type: 'triangle', from: base, to: base * 1.5, duration: 0.12, gain: 0.12 })
  }

  setMuted(value: boolean) {
    this.muted = value
    if (this.master) this.master.gain.value = value ? 0 : 0.85
  }
}

export const sfx = new Sfx()
