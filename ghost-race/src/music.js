// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Generative instrumental music with the Web Audio API. No audio files.
// makeTrack(style, seed) turns a seed into a deterministic track description;
// createMusicPlayer().play(track) synthesises it live as an endless loop.

export const STYLES = {
  lofi: 'Lo-fi keys',
  piano: 'Piano',
  synthwave: 'Synthwave',
  downtempo: 'Downtempo',
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
}
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
// Chord progressions as scale degrees (0 = tonic).
const PROGS = {
  lofi: [[1, 4, 0, 5], [0, 5, 3, 4], [3, 4, 2, 5], [5, 3, 0, 4], [0, 3, 1, 4]],
  piano: [[0, 4, 5, 3], [3, 0, 4, 5], [0, 2, 3, 4], [5, 3, 0, 4], [0, 5, 3, 4]],
  synthwave: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0], [0, 6, 5, 6], [0, 5, 3, 6]],
  downtempo: [[0, 3, 0, 6], [0, 6, 5, 6], [0, 2, 3, 4], [5, 3, 0, 6], [0, 4, 5, 3]],
}
const MODES = { lofi: ['dorian', 'major', 'minor'], piano: ['major', 'lydian', 'minor'], synthwave: ['minor', 'minor', 'dorian'], downtempo: ['dorian', 'minor', 'major'] }
const BPM = { lofi: [72, 88], piano: [64, 80], synthwave: [96, 112], downtempo: [88, 100] }
const ADJ = ['Neon', 'Granite', 'Midnight', 'Alpine', 'Velvet', 'Static', 'Lunar', 'Glacier', 'Amber', 'Cobalt', 'Hollow', 'Summit', 'Drifting', 'Afterglow', 'Polar', 'Paper', 'Slow', 'Distant', 'Electric', 'Quiet']
const NOUN = ['Ridgeline', 'Lanterns', 'Tide', 'Highway', 'Meadow', 'Signal', 'Basin', 'Horizon', 'Cassette', 'Snowfield', 'Embers', 'Orbit', 'Trailhead', 'Daybreak', 'Pines', 'Arcade', 'Moraine', 'Skyline', 'Echoes', 'Switchbacks']

export function makeTrack(style, seed) {
  // Hash style and seed together so neighbouring seeds don't produce similar tracks.
  let h = 2166136261
  for (const ch of `${style}:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const r = mulberry32(h)
  r(); r()
  const pick = a => a[Math.floor(r() * a.length)]
  const [lo, hi] = BPM[style]
  const mode = pick(MODES[style])
  const rootPc = Math.floor(r() * 12)
  // Melody motif: two bars of rhythm (16th-step positions) and chord-tone indexes.
  const rhythm = [0, 1].map(() => {
    const steps = []
    for (let s = 0; s < 16; s += 2) if (r() < (style === 'piano' ? 0.55 : 0.42)) steps.push(s + (r() < 0.2 ? 1 : 0))
    if (!steps.length) steps.push(0)
    return steps
  })
  const pitches = [0, 1].map(() => rhythm[0].concat(rhythm[1]).map(() => Math.floor(r() * 5)))
  return {
    id: `${style}-${seed}`, style, seed,
    name: `${pick(ADJ)} ${pick(NOUN)}`,
    bpm: Math.round(lo + r() * (hi - lo)),
    rootPc, mode,
    key: `${NOTE_NAMES[rootPc]} ${mode}`,
    prog: pick(PROGS[style]),
    swing: style === 'lofi' ? 0.12 + r() * 0.12 : style === 'downtempo' ? 0.06 + r() * 0.08 : 0,
    groove: Math.floor(r() * 3),
    arp: Math.floor(r() * 3),
    softBeat: style === 'piano' ? r() < 0.45 : true,
    brightness: 0.6 + r() * 0.8,
    space: 0.25 + r() * 0.35,
    motif: { rhythm, pitches },
  }
}

const hz = m => 440 * 2 ** ((m - 69) / 12)

export function createMusicPlayer() {
  let ctx = null, out, tone, analyser, current = null, volume = 0.8

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext()
      out = ctx.createGain()
      out.gain.value = volume
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14; comp.ratio.value = 3
      // Master tone control: hosts can darken the whole mix (for example at night).
      tone = ctx.createBiquadFilter()
      tone.type = 'lowpass'; tone.frequency.value = 18000; tone.Q.value = 0.5
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      out.connect(comp).connect(tone).connect(analyser).connect(ctx.destination)
    }
    ctx.resume()
  }

  function stop() {
    if (!current) return
    const c = current
    current = null
    clearInterval(c.timer)
    c.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.25)
    setTimeout(() => { c.bus.disconnect(); c.crackle?.stop() }, 1500)
  }

  function play(track) {
    ensure()
    stop()
    current = startTrack(track)
  }

  function startTrack(T) {
    const bus = ctx.createGain()
    bus.gain.value = 0
    bus.gain.setTargetAtTime(1, ctx.currentTime, 0.3)
    bus.connect(out)

    // Effects: reverb and a filtered dotted-eighth delay.
    const reverb = ctx.createConvolver()
    reverb.buffer = impulse(T.style === 'synthwave' ? 3.2 : T.style === 'piano' ? 4.5 : 2.6)
    const revOut = ctx.createGain()
    revOut.gain.value = T.space
    reverb.connect(revOut).connect(bus)
    const beat = 60 / T.bpm
    const delay = ctx.createDelay(2)
    delay.delayTime.value = beat * 0.75
    const fb = ctx.createGain(), dl = ctx.createBiquadFilter()
    fb.gain.value = 0.32; dl.type = 'lowpass'; dl.frequency.value = 2600
    delay.connect(dl).connect(fb).connect(delay)
    const delOut = ctx.createGain()
    delOut.gain.value = 0.35
    dl.connect(delOut).connect(bus)

    const keys = ctx.createGain(), pads = ctx.createGain(), drums = ctx.createGain(), bass = ctx.createGain()
    keys.connect(bus); pads.connect(bus); bass.connect(bus)
    for (const g of [keys, pads]) g.connect(reverb)
    if (T.style === 'lofi') {
      // Muffled drums and a little vinyl crackle.
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 3200
      drums.connect(lp).connect(bus)
    } else drums.connect(bus)
    const drumVerb = ctx.createGain()
    drumVerb.gain.value = T.style === 'synthwave' ? 0.5 : 0.15
    drums.connect(drumVerb).connect(reverb)

    const send = (node, amount, to) => { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(to) }
    const noise = noiseBuffer()
    let crackle = null
    if (T.style === 'lofi') {
      crackle = ctx.createBufferSource()
      crackle.buffer = crackleBuffer(); crackle.loop = true
      const cg = ctx.createGain(); cg.gain.value = 0.35
      crackle.connect(cg).connect(bus)
      crackle.start()
    }

    // ----- instruments -----
    const amp = (t, peak, attack, decayTo, end) => {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + attack)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, decayTo), end)
      return g
    }
    const osc = (type, f, t, end, detune = 0) => {
      const o = ctx.createOscillator()
      o.type = type; o.frequency.value = f; o.detune.value = detune
      o.start(t); o.stop(end + 0.05)
      return o
    }
    const wobble = () => (T.style === 'lofi' ? (Math.random() - 0.5) * 14 : 0)

    function piano(t, midi, vel, to = keys) {
      const f = hz(midi), ring = 1.2 + Math.max(0, 84 - midi) * 0.05, end = t + ring
      const g = amp(t, vel, 0.004, 0.0001, end)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(Math.min(12000, f * 7 * T.brightness), t)
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 2), t + ring * 0.6)
      osc('triangle', f, t, end).connect(lp)
      const h = ctx.createGain(); h.gain.value = 0.35
      osc('sine', f * 2, t, end).connect(h).connect(lp)
      lp.connect(g).connect(to)
    }
    function epiano(t, midi, vel, len) {
      const f = hz(midi), end = t + len + 1.2, d = wobble()
      const car = osc('sine', f, t, end, d), mod = osc('sine', f, t, end, d)
      const idx = ctx.createGain()
      idx.gain.setValueAtTime(f * 2.2 * T.brightness, t)
      idx.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.7)
      mod.connect(idx).connect(car.frequency)
      car.connect(amp(t, vel, 0.006, 0.0001, end)).connect(keys)
    }
    function pad(t, notes, len, vel) {
      const end = t + len + 1.5
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 900 + 1400 * T.brightness; lp.Q.value = 0.5
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vel, t + 0.6)
      g.gain.setValueAtTime(vel, t + len)
      g.gain.linearRampToValueAtTime(0.0001, end)
      for (const m of notes) for (const dt of [-9, 0, 9]) osc('sawtooth', hz(m), t, end, dt).connect(lp)
      lp.connect(g).connect(pads)
    }
    function bassNote(t, midi, len, vel, type = 'sawtooth') {
      const end = t + len
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(type === 'sine' ? 800 : 1400 * T.brightness, t)
      lp.frequency.exponentialRampToValueAtTime(type === 'sine' ? 300 : 260, t + 0.18)
      osc(type, hz(midi), t, end).connect(lp)
      lp.connect(amp(t, vel, 0.008, 0.0001, end)).connect(bass)
    }
    function pluck(t, midi, vel, decay = 0.35, type = 'sawtooth', to = keys) {
      const end = t + decay
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(3500 * T.brightness, t)
      lp.frequency.exponentialRampToValueAtTime(400, end)
      osc(type, hz(midi), t, end).connect(lp)
      const g = amp(t, vel, 0.003, 0.0001, end)
      lp.connect(g).connect(to)
      return g
    }
    function lead(t, midi, len, vel) {
      const end = t + len + 0.25, f = hz(midi)
      const o = osc('sawtooth', f, t, end), vib = osc('sine', 5.2, t, end), vd = ctx.createGain()
      vd.gain.value = f * 0.006
      vib.connect(vd).connect(o.frequency)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 2200
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vel, t + 0.03)
      g.gain.setValueAtTime(vel, t + len)
      g.gain.linearRampToValueAtTime(0.0001, end)
      o.connect(lp).connect(g)
      g.connect(keys); send(g, 0.6, delay)
    }
    function bell(t, midi, vel) {
      const f = hz(midi), end = t + 2.5
      const car = osc('sine', f, t, end), mod = osc('sine', f * 3.5, t, end), idx = ctx.createGain()
      idx.gain.setValueAtTime(f * 2, t)
      idx.gain.exponentialRampToValueAtTime(1, end)
      mod.connect(idx).connect(car.frequency)
      const g = amp(t, vel, 0.004, 0.0001, end)
      car.connect(g).connect(keys); send(g, 0.5, delay)
    }
    function kick(t, vel) {
      const o = ctx.createOscillator()
      o.frequency.setValueAtTime(140, t)
      o.frequency.exponentialRampToValueAtTime(44, t + 0.12)
      o.start(t); o.stop(t + 0.45)
      o.connect(amp(t, vel, 0.003, 0.0001, t + 0.42)).connect(drums)
      if (T.style === 'synthwave' || T.style === 'downtempo') {
        pads.gain.cancelScheduledValues(t)
        pads.gain.setValueAtTime(0.3, t)
        pads.gain.linearRampToValueAtTime(1, t + beat * 0.7)
      }
    }
    function snare(t, vel, rim = false) {
      const n = ctx.createBufferSource()
      n.buffer = noise
      const bp = ctx.createBiquadFilter()
      bp.type = rim ? 'bandpass' : 'highpass'; bp.frequency.value = rim ? 2400 : 1200
      const end = t + (rim ? 0.06 : T.style === 'synthwave' ? 0.3 : 0.18)
      n.connect(bp).connect(amp(t, vel, 0.002, 0.0001, end)).connect(drums)
      n.start(t); n.stop(end + 0.05)
      osc('triangle', rim ? 400 : 190, t, t + 0.08).connect(amp(t, vel * 0.6, 0.002, 0.0001, t + 0.08)).connect(drums)
    }
    function hat(t, vel, open = false) {
      const n = ctx.createBufferSource()
      n.buffer = noise
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'; hp.frequency.value = 7000
      const end = t + (open ? 0.28 : 0.045)
      n.connect(hp).connect(amp(t, vel, 0.001, 0.0001, end)).connect(drums)
      n.start(t); n.stop(end + 0.05)
    }

    // ----- harmony -----
    const scale = SCALES[T.mode]
    const deg = (d, base) => base + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7)
    const root = 48 + T.rootPc // C3..B3
    const chordTones = (d, octave, n = 4) => Array.from({ length: n }, (_, i) => deg(d + i * 2, root + octave * 12))
    const chordBars = T.style === 'piano' || T.style === 'downtempo' ? 2 : 1

    // ----- sequencer -----
    const stepDur = beat / 4
    let step = 0, nextTime = ctx.currentTime + 0.12
    const human = () => (T.style === 'lofi' || T.style === 'piano' ? Math.random() * 0.012 : 0)
    const vary = v => v * (0.88 + Math.random() * 0.24)

    function scheduleStep(i, t0) {
      const bar = Math.floor(i / 16), s = i % 16
      const t = t0 + (s % 2 === 1 ? T.swing * stepDur : 0)
      const sec = bar % 32
      const drumsOn = sec >= 4 && !(sec >= 24 && sec < 28)
      const melodyOn = (sec >= 8 && sec < 24) || sec >= 28
      const chordDeg = T.prog[Math.floor(bar / chordBars) % 4]
      const newChord = s === 0 && bar % chordBars === 0
      const motifBar = bar % 2
      const playMelody = (play) => {
        const r = T.motif.rhythm[motifBar], k = r.indexOf(s)
        if (melodyOn && k >= 0) {
          const offset = motifBar === 0 ? 0 : T.motif.rhythm[0].length
          const variation = Math.floor(bar / 8) % 2 === 1 ? 1 : 0
          const tone = (T.motif.pitches[variation][offset + k] ?? 0)
          play(t + human(), chordTones(chordDeg, 2, 5)[tone])
        }
      }

      if (T.style === 'lofi') {
        if (newChord) chordTones(chordDeg, 0, 5).forEach((m, k) => epiano(t + k * 0.018 + human(), m, vary(0.09), beat * 4))
        if (s === 10 && T.groove === 1) chordTones(chordDeg, 0, 4).forEach((m, k) => epiano(t + k * 0.015, m, 0.06, beat * 1.5))
        if (s === 0 || s === (T.groove === 2 ? 7 : 10)) bassNote(t, deg(chordDeg, root - 24), beat * 1.2, 0.32, 'sine')
        if (drumsOn) {
          const kicks = [[0, 7, 10], [0, 8, 11], [0, 6, 10, 14]][T.groove]
          if (kicks.includes(s)) kick(t, vary(0.55))
          if (s === 4 || s === 12) snare(t + 0.01, vary(0.32))
          if (s % 2 === 0) hat(t, vary(s % 4 === 0 ? 0.09 : 0.05))
          if (s === 14 && bar % 4 === 3) hat(t, 0.06, true)
        }
        playMelody((tt, m) => epiano(tt, m, vary(0.1), beat))
      }

      if (T.style === 'piano') {
        if (s === 0 && bar % chordBars === 0) piano(t, deg(chordDeg, root - 12), 0.22)
        if (s === 8) piano(t, deg(chordDeg + 4, root - 12), 0.14)
        const tones = chordTones(chordDeg, 0, 4)
        const pattern = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 2, 3, 1, 2], [0, 1, 2, 1, 3, 2, 1, 2]][T.arp]
        if (s % 2 === 0) piano(t + human(), tones[pattern[s / 2]] + 12, vary(0.1))
        if (T.softBeat && drumsOn) {
          if (s === 0 || s === 10) kick(t, 0.32)
          if (s === 4 || s === 12) snare(t, 0.12, true)
          hat(t, vary(0.025))
        }
        playMelody((tt, m) => piano(tt, m + 12, vary(0.16)))
      }

      if (T.style === 'synthwave') {
        if (newChord) pad(t, chordTones(chordDeg, 0, 3), beat * 4 * chordBars - 0.1, 0.05)
        const b = deg(chordDeg, root - 24)
        const bassPattern = [[0, 0, 12, 0], [0, 12, 0, 12], [0, 0, 0, 7]][T.groove]
        if (s % 2 === 0) bassNote(t, b + bassPattern[(s / 2) % 4], stepDur * 1.6, 0.22)
        if (sec >= 4) {
          const tones = chordTones(chordDeg, 1, 4), up = [0, 1, 2, 3, 2, 1, 2, 3]
          const order = T.arp === 0 ? up : T.arp === 1 ? [0, 2, 1, 3, 2, 3, 1, 2] : [3, 2, 1, 0, 1, 2, 3, 2]
          const g = pluck(t, tones[order[s % 8]] + 12, 0.045, 0.18, 'square')
          send(g, 0.5, delay)
        }
        if (drumsOn) {
          if (s % 4 === 0) kick(t, 0.6)
          if (s === 4 || s === 12) snare(t, 0.4)
          if (s % 4 === 2) hat(t, 0.07)
        }
        playMelody((tt, m) => lead(tt, m, stepDur * 3, 0.06))
      }

      if (T.style === 'downtempo') {
        if (newChord) pad(t, chordTones(chordDeg, 0, 4), beat * 4 * chordBars - 0.1, 0.035)
        const stabs = [[0, 3, 6, 10], [0, 6, 10, 13], [2, 6, 10, 14]][T.groove]
        if (sec >= 4 && stabs.includes(s)) chordTones(chordDeg, 1, 3).forEach(m => pluck(t, m, 0.035, 0.28))
        if ([0, 7, 10].includes(s)) bassNote(t, deg(chordDeg, root - 24), beat * 0.9, 0.3, 'sine')
        if (drumsOn) {
          if (s === 0 || s === 10 || (T.groove === 2 && s === 6)) kick(t, 0.5)
          if (s === 4 || s === 12) snare(t, 0.22, T.groove !== 1)
          hat(t, vary(s % 2 === 0 ? 0.05 : 0.025))
        }
        playMelody((tt, m) => bell(tt, m + 12, vary(0.06)))
      }
    }

    const timer = setInterval(() => {
      while (nextTime < ctx.currentTime + 0.15) {
        scheduleStep(step, nextTime)
        step++
        nextTime += stepDur
      }
    }, 25)

    return { bus, timer, crackle, track: T, startedAt: ctx.currentTime }
  }

  function impulse(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5
    }
    return buf
  }
  let noiseBuf = null
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    return noiseBuf
  }
  function crackleBuffer() {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.006 + (Math.random() < 0.0006 ? (Math.random() - 0.5) * 0.5 : 0)
    return buf
  }

  return {
    play, stop,
    get playing() { return current?.track.id ?? null },
    get analyser() { return analyser },
    get elapsed() { return current ? ctx.currentTime - current.startedAt : 0 },
    setVolume(v, smoothing = 0.1) { volume = v; if (out) out.gain.setTargetAtTime(v, ctx.currentTime, smoothing) },
    // 0 = muffled, 1 = fully open.
    setTone(x) { if (tone) tone.frequency.setTargetAtTime(600 * 30 ** Math.min(1, Math.max(0, x)), ctx.currentTime, 0.8) },
    // For hosts that add their own layers into the same mix.
    get context() { return ctx },
    get output() { return out },
  }
}
