import { createRng } from '../shared/rng.ts'

// Procedural sound effects. Each recipe writes mono samples at RATE — noise,
// filters and decaying partials, no audio files. audio.ts turns them into
// buffers once per session; nothing here runs during play.

export const RATE = 44100
const TAU = Math.PI * 2

const samples = (seconds: number) => new Float32Array(Math.round(seconds * RATE))
const decay = (t: number, tau: number) => Math.exp(-t / tau)
const attack = (t: number, time: number) => Math.min(1, t / time)
const pole = (cutoff: number) => 1 - Math.exp((-TAU * cutoff) / RATE) // one-pole low-pass coefficient
const saw = (cycles: number) => 2 * (cycles % 1) - 1

// Soft-clips, then scales so the loudest sample sits at `peak`.
function finish(data: Float32Array, drive: number, peak: number) {
  let loudest = 0
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i] * drive)
    loudest = Math.max(loudest, Math.abs(data[i]))
  }
  if (loudest > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / loudest
  return data
}

// Crossfades the last `overlap` seconds into the start so the clip loops without a click.
function seamless(data: Float32Array, overlap: number) {
  const n = Math.round(overlap * RATE)
  const length = data.length - n
  for (let i = 0; i < n; i++) data[i] = data[i] * (i / n) + data[length + i] * (1 - i / n)
  return data.slice(0, length)
}

// Adds decaying sine partials [frequency, amplitude, decay seconds] from `start`.
function ring(data: Float32Array, partials: Array<[number, number, number]>, start = 0) {
  const from = Math.round(start * RATE)
  for (const [frequency, amplitude, tau] of partials) {
    const end = Math.min(data.length, from + Math.round(tau * 9 * RATE))
    for (let i = from; i < end; i++) {
      const t = (i - from) / RATE
      data[i] += Math.sin(TAU * frequency * t) * amplitude * decay(t, tau) * attack(t, 0.0008)
    }
  }
}

// Band-pass (RBJ, 0 dB peak) with a centre frequency that may move over time.
function bandpass(input: Float32Array, centre: (t: number) => number, q: number) {
  const out = new Float32Array(input.length)
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0,
    b0 = 0,
    a1 = 0,
    a2 = 0
  for (let i = 0; i < input.length; i++) {
    if (i % 16 === 0) {
      const w = (TAU * centre(i / RATE)) / RATE
      const alpha = Math.sin(w) / (2 * q)
      b0 = alpha / (1 + alpha)
      a1 = (-2 * Math.cos(w)) / (1 + alpha)
      a2 = (1 - alpha) / (1 + alpha)
    }
    const y = b0 * (input[i] - x2) - a1 * y1 - a2 * y2
    x2 = x1
    x1 = input[i]
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

function noise(seconds: number, rng: () => number) {
  const data = samples(seconds)
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1
  return data
}

// --- one-shots ---------------------------------------------------------------

// Minigun round: bright crack, noisy body, a thump that drops in pitch.
export function shot(seed: number) {
  const rng = createRng(seed)
  const data = samples(0.18)
  let body = 0,
    low = 0,
    phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    const n = rng() * 2 - 1
    body += pole(2600) * (n - body)
    low += pole(500) * (n - low)
    phase += (TAU * (55 + 120 * decay(t, 0.016))) / RATE
    data[i] = n * decay(t, 0.005) * 0.7 + body * decay(t, 0.03) * 1.6 + low * decay(t, 0.07) * 2.4 + Math.sin(phase) * decay(t, 0.05) * attack(t, 0.0015)
  }
  return finish(data, 1.6, 0.95)
}

// Round ringing off armour.
export function metal(seed: number) {
  const rng = createRng(seed)
  const data = samples(0.35)
  const f = 0.88 + rng() * 0.24
  ring(data, [
    [1780 * f, 1, 0.07],
    [2890 * f, 0.7, 0.05],
    [4230 * f, 0.45, 0.035],
    [6150 * f, 0.25, 0.02],
  ])
  for (let i = 0; i < 0.006 * RATE; i++) data[i] += (rng() * 2 - 1) * decay(i / RATE, 0.0012) * 0.9
  return finish(data, 1.2, 0.8)
}

// Round thudding into dirt, concrete or scrap.
export function ground(seed: number) {
  const rng = createRng(seed)
  const data = samples(0.22)
  let thud = 0,
    grit = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    const n = rng() * 2 - 1
    thud += pole(300 + 1500 * decay(t, 0.02)) * (n - thud)
    grit += pole(700) * (n - grit)
    data[i] = thud * decay(t, 0.03) * 2.2 + n * decay(t, 0.0015) * 0.5 + grit * decay(t, 0.08) * (rng() < 0.25 ? 2.5 : 0.6)
  }
  return finish(data, 1.3, 0.8)
}

// Heavy clang when the player's own hull is hit.
export function damage(seed: number) {
  const rng = createRng(seed)
  const data = samples(0.55)
  const f = 0.92 + rng() * 0.16
  ring(data, [
    [290 * f, 1, 0.22],
    [690 * f, 0.8, 0.16],
    [1210 * f, 0.6, 0.11],
    [1980 * f, 0.4, 0.07],
    [3100 * f, 0.25, 0.04],
  ])
  let phase = 0,
    hiss = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    hiss += pole(3000) * (rng() * 2 - 1 - hiss)
    phase += (TAU * (68 + 70 * decay(t, 0.02))) / RATE
    data[i] += Math.sin(phase) * decay(t, 0.08) * 1.4 + hiss * decay(t, 0.012) * 1.5
  }
  return finish(data, 1.4, 0.92)
}

// Hit confirmation tick.
export function hitmarker() {
  const data = samples(0.07)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] = (Math.sin(TAU * 2950 * t) + 0.35 * Math.sin(TAU * 4420 * t)) * attack(t, 0.0005) * decay(t, 0.013)
  }
  return finish(data, 1, 0.7)
}

// Kill confirmation: a low thunk under a bright fifth.
export function kill() {
  const data = samples(0.8)
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    phase += (TAU * (50 + 120 * decay(t, 0.03))) / RATE
    data[i] = Math.sin(phase) * decay(t, 0.09) * 1.1
  }
  ring(
    data,
    [
      [1046.5, 0.5, 0.25],
      [1568, 0.35, 0.22],
      [2093, 0.15, 0.15],
    ],
    0.025,
  )
  return finish(data, 1.1, 0.8)
}

// Fireball: a sub drop, roaring noise closing down, crackle in the tail.
export function explosion(seed: number) {
  const rng = createRng(seed)
  const data = samples(3)
  let a = 0,
    b = 0,
    phase = 0,
    pop = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    const k = pole(140 + 2400 * decay(t, 0.28))
    a += k * (rng() * 2 - 1 - a)
    b += k * (a - b)
    phase += (TAU * (26 + 64 * decay(t, 0.14))) / RATE
    if (rng() < 0.002 * decay(t, 0.9)) pop = rng() * 2 - 1
    pop *= 0.994
    data[i] = b * attack(t, 0.004) * (0.6 * decay(t, 0.45) + 0.4 * decay(t, 1.4)) * 5 + Math.sin(phase) * attack(t, 0.003) * decay(t, 0.55) * 1.2 + pop * 0.5
  }
  return finish(data, 1.3, 0.98)
}

// A round passing close: a zip that falls in pitch as it goes by.
export function whiz(seed: number) {
  const data = bandpass(noise(0.4, createRng(seed)), (t) => 1500 + 5000 * decay(t, 0.09), 4)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] *= t < 0.07 ? (t / 0.07) ** 2 : decay(t - 0.07, 0.05)
  }
  return finish(data, 1, 0.8)
}

// Rocket leaving its tube: a hard thump, then the motor's roar tearing away downrange.
export function launch(seed: number) {
  const rng = createRng(seed)
  const roar = bandpass(noise(0.9, rng), (t) => 700 + 2400 * decay(t, 0.2), 1.1)
  const data = samples(0.9)
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    phase += (TAU * (50 + 110 * decay(t, 0.025))) / RATE
    data[i] = Math.sin(phase) * decay(t, 0.08) * attack(t, 0.002) * 1.3 + roar[i] * attack(t, 0.012) * decay(t, 0.28) * 3.2
  }
  return finish(data, 1.4, 0.95)
}

// Car hitting something solid: body panels, a thump, loose junk rattling.
export function crash(seed: number) {
  const rng = createRng(seed)
  const data = samples(0.75)
  const f = 0.85 + rng() * 0.3
  ring(data, [
    [160 * f, 0.8, 0.26],
    [410 * f, 0.65, 0.18],
    [870 * f, 0.4, 0.12],
    [1530 * f, 0.25, 0.08],
  ])
  let crunch = 0,
    phase = 0,
    rattle = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    crunch += pole(250 + 2800 * decay(t, 0.06)) * (rng() * 2 - 1 - crunch)
    phase += (TAU * (48 + 45 * decay(t, 0.03))) / RATE
    if (t > 0.04 && t < 0.45 && rng() < 0.0012) rattle = rng() * 2 - 1
    rattle *= 0.992
    data[i] += crunch * decay(t, 0.12) * 2.2 + Math.sin(phase) * decay(t, 0.12) * 1.3 + rattle * 0.5
  }
  return finish(data, 1.5, 0.95)
}

function click(data: Float32Array, at: number, pitch: number, rng: () => number) {
  ring(
    data,
    [
      [pitch, 0.6, 0.008],
      [pitch * 1.6, 0.35, 0.005],
    ],
    at,
  )
  const from = Math.round(at * RATE)
  for (let i = 0; i < 0.006 * RATE; i++) data[from + i] += (rng() * 2 - 1) * decay(i / RATE, 0.0015) * 0.6
}

// Magazine out, slide, magazine in.
export function reload() {
  const rng = createRng(5)
  const data = samples(0.55)
  click(data, 0, 3100, rng)
  const slide = bandpass(noise(0.26, rng), () => 1500, 1.2)
  const from = Math.round(0.07 * RATE)
  for (let i = 0; i < slide.length; i++) data[from + i] += slide[i] * Math.sin((Math.PI * i) / slide.length) * 0.9
  click(data, 0.4, 2600, rng)
  return finish(data, 1, 0.75)
}

// Reload done: double click and a clunk.
export function ready() {
  const rng = createRng(6)
  const data = samples(0.25)
  click(data, 0, 3300, rng)
  click(data, 0.07, 2800, rng)
  ring(data, [[180, 0.8, 0.03]], 0.07)
  return finish(data, 1, 0.75)
}

export function ui() {
  const data = samples(0.06)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] = (Math.sin(TAU * 1350 * t) + 0.3 * Math.sin(TAU * 2700 * t)) * attack(t, 0.0003) * decay(t, 0.01)
  }
  return finish(data, 1, 0.6)
}

// Wrecked: a dark detuned chord sliding down an octave.
export function destroyed() {
  const data = samples(1.9)
  let p1 = 0,
    p2 = 0,
    p3 = 0,
    tone = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    const base = 98 * 2 ** (-t / 1.3)
    p1 += base / RATE
    p2 += (base * 1.19) / RATE
    p3 += (base * 0.5) / RATE
    tone += pole(150 + 1100 * decay(t, 0.5)) * (saw(p1) + 0.8 * saw(p2) + 0.9 * Math.sin(TAU * p3) - tone)
    data[i] = tone * attack(t, 0.01) * decay(t, 0.75)
  }
  return finish(data, 1.2, 0.75)
}

// Yard cleared: a rising major arpeggio over a low fifth.
export function victory() {
  const data = samples(2.3)
  for (const [f, at] of [
    [523.25, 0],
    [659.25, 0.11],
    [783.99, 0.22],
    [1046.5, 0.33],
  ]) {
    ring(
      data,
      [
        [f, 0.6, at > 0.3 ? 0.9 : 0.3],
        [f * 2, 0.15, 0.15],
        [f * 3, 0.1, 0.1],
      ],
      at,
    )
  }
  ring(
    data,
    [
      [130.81, 0.4, 1.1],
      [196, 0.3, 1],
    ],
    0.33,
  )
  return finish(data, 1.1, 0.75)
}

// Pickup: two quick rising chimes over a soft click.
export function pickup() {
  const data = samples(0.45)
  ring(data, [
    [1318.5, 0.5, 0.09],
    [2637, 0.12, 0.05],
  ])
  ring(
    data,
    [
      [1975.5, 0.6, 0.16],
      [3951, 0.15, 0.07],
    ],
    0.07,
  )
  for (let i = 0; i < 0.004 * RATE; i++) data[i] += Math.sin(TAU * 4200 * (i / RATE)) * decay(i / RATE, 0.001) * 0.3
  return finish(data, 1, 0.7)
}

// Callout stinger (multi-kills, streaks, revenge, the final minute): a
// punchy low hit under a bright, slightly detuned stab.
export function announce() {
  const data = samples(0.9)
  let phase = 0,
    stab = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    phase += (TAU * (60 + 90 * decay(t, 0.04))) / RATE
    const raw = saw(392 * t) + saw(393.8 * t) + 0.6 * saw(587.3 * t)
    stab += pole(900 + 3200 * decay(t, 0.12)) * (raw - stab)
    data[i] = Math.sin(phase) * decay(t, 0.12) * 1.2 + stab * attack(t, 0.004) * decay(t, 0.28) * 0.5
  }
  return finish(data, 1.3, 0.8)
}

// Final-countdown tick: a short, dry beep.
export function tick() {
  const data = samples(0.12)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] = (Math.sin(TAU * 1760 * t) + 0.25 * Math.sin(TAU * 3520 * t)) * attack(t, 0.001) * decay(t, 0.03)
  }
  return finish(data, 1, 0.65)
}

// --- loops (exactly periodic, so they repeat without a seam) ----------------------

// One second of engine at 40 firing pulses per second; playback rate sets the revs.
export function engine() {
  const rng = createRng(7)
  const data = samples(1)
  for (let p = 0; p < 40; p++) {
    const start = Math.round((p * RATE) / 40)
    const amplitude = 0.7 + rng() * 0.3 // uneven pulses give the lumpy idle
    const pitch = 140 + rng() * 40
    let rumble = 0
    for (let j = 0; j < 0.03 * RATE; j++) {
      const t = j / RATE
      rumble += pole(900) * (rng() * 2 - 1 - rumble)
      data[(start + j) % data.length] += amplitude * (Math.sin(TAU * pitch * t) * decay(t, 0.007) + rumble * decay(t, 0.004) * 1.5)
    }
  }
  for (let i = 0; i < data.length; i++) data[i] += 0.12 * Math.sin((TAU * 40 * i) / RATE) + 0.06 * Math.sin((TAU * 80 * i) / RATE)
  return finish(data, 1.3, 0.9)
}

// Minigun barrels spinning: motor whine with a rattle.
export function spin() {
  const rng = createRng(8)
  const data = samples(0.55)
  let tone = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    const rattle = 0.55 + 0.45 * Math.sign(Math.sin(TAU * 24 * t))
    const raw = (saw(200 * t) * 0.45 + Math.sin(TAU * 400 * t) * 0.3) * (0.8 + 0.2 * rattle) + (rng() * 2 - 1) * 0.25 * rattle
    tone += pole(3500) * (raw - tone)
    data[i] = tone
  }
  return seamless(finish(data, 1.2, 0.7), 0.05)
}

// Tyres sliding: hissing band of noise with a wavering squeal.
export function skid() {
  const data = bandpass(noise(1.1, createRng(9)), () => 1900, 2.2)
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    phase += (TAU * (1150 + 30 * Math.sin(TAU * 5 * t))) / RATE
    data[i] = data[i] * 1.2 + Math.sin(phase) * 0.25 * (0.5 + 0.5 * Math.sin(TAU * 3 * t)) ** 2
  }
  return seamless(finish(data, 1, 0.7), 0.1)
}

// Burning wreck: low roar and crackle.
export function fire() {
  const rng = createRng(10)
  const data = samples(2.1)
  let brown = 0,
    roar = 0,
    pop = 0
  for (let i = 0; i < data.length; i++) {
    brown = brown * 0.995 + (rng() * 2 - 1) * 0.1
    roar += pole(800) * (brown - roar)
    if (rng() < 0.0009) pop = (rng() * 2 - 1) * (0.5 + rng())
    pop *= 0.985
    data[i] = roar * 1.5 + pop * 0.8
  }
  return seamless(finish(data, 1.2, 0.7), 0.1)
}

// Yard ambience: gusting wind and a distant industrial hum.
export function ambience() {
  const rng = createRng(11)
  const data = samples(6.5)
  let brown = 0,
    wind = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    brown = brown * 0.997 + (rng() * 2 - 1) * 0.05
    wind += pole(380) * (brown - wind)
    data[i] = wind * (0.55 + 0.45 * Math.sin((TAU * t) / 6)) * 3 + Math.sin(TAU * 55 * t) * 0.05 + Math.sin(TAU * 110 * t) * 0.025
  }
  return seamless(finish(data, 1, 0.6), 0.5)
}
