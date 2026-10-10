import type * as THREE from 'three'
import { onSettingsChange, settings } from './settings.ts'
import * as sounds from './sounds.ts'

// Gameplay audio on Web Audio. Every sound is synthesized (sounds.ts) into
// buffers once; one-shots and loops are placed around the camera with
// distance falloff, air muffling and stereo pan. Levels live in CUES/LOOPS;
// the player's master, music and effects volumes in settings.ts.

export type SoundCue =
  | 'shot'
  | 'launch'
  | 'hitMetal'
  | 'hitGround'
  | 'damage'
  | 'hitmarker'
  | 'kill'
  | 'explosion'
  | 'whiz'
  | 'crash'
  | 'reload'
  | 'ready'
  | 'ui'
  | 'destroyed'
  | 'victory'
  | 'pickup'
  | 'announce'
  | 'tick'
  | 'found'

interface CueSpec {
  make: () => Float32Array[] // variants, one picked at random
  gain: number
  reach?: number // metres at full volume when played in the world
  limit?: number // overlapping plays allowed
  pitch?: number // random playback-rate spread
  ui?: boolean // stays audible while the match is paused
  music?: boolean // a musical stinger: music volume, audible while paused
}

const CUES: Record<SoundCue, CueSpec> = {
  shot: { make: () => [1, 2, 3, 4].map(sounds.shot), gain: 0.5, reach: 10, limit: 16, pitch: 0.08 },
  launch: { make: () => [1, 2].map(sounds.launch), gain: 0.6, reach: 12, limit: 4, pitch: 0.1 },
  hitMetal: { make: () => [1, 2, 3].map(sounds.metal), gain: 0.45, reach: 8, limit: 10, pitch: 0.1 },
  hitGround: { make: () => [1, 2, 3].map(sounds.ground), gain: 0.35, reach: 8, limit: 10, pitch: 0.12 },
  damage: { make: () => [1, 2].map(sounds.damage), gain: 0.6, limit: 4, pitch: 0.06 },
  hitmarker: { make: () => [sounds.hitmarker()], gain: 0.22, limit: 3, pitch: 0.04 },
  kill: { make: () => [sounds.kill()], gain: 0.5 },
  explosion: { make: () => [1, 2].map(sounds.explosion), gain: 0.8, reach: 30, limit: 4, pitch: 0.1 },
  whiz: { make: () => [1, 2].map(sounds.whiz), gain: 0.5, reach: 6, limit: 2, pitch: 0.15 },
  crash: { make: () => [1, 2].map(sounds.crash), gain: 0.55, reach: 12, limit: 4, pitch: 0.1 },
  reload: { make: () => [sounds.reload()], gain: 0.45 },
  ready: { make: () => [sounds.ready()], gain: 0.45 },
  ui: { make: () => [sounds.ui()], gain: 0.3, ui: true },
  destroyed: { make: () => [sounds.destroyed()], gain: 0.5, music: true },
  victory: { make: () => [sounds.victory()], gain: 0.5, music: true },
  pickup: { make: () => [sounds.pickup()], gain: 0.45, reach: 10, limit: 4, pitch: 0.04 },
  announce: { make: () => [sounds.announce()], gain: 0.5, limit: 2 },
  tick: { make: () => [sounds.tick()], gain: 0.35, limit: 2 },
  found: { make: () => [sounds.announce()], gain: 0.6, limit: 1, ui: true }, // a match found (Classic's ready check): heard on any screen, paused or not
}

type LoopKind = 'engine' | 'spin' | 'skid' | 'fire' | 'ambience'
const LOOPS: Record<LoopKind, { make: () => Float32Array; gain: number; reach: number }> = {
  engine: { make: sounds.engine, gain: 0.45, reach: 10 },
  spin: { make: sounds.spin, gain: 0.18, reach: 6 },
  skid: { make: sounds.skid, gain: 0.35, reach: 8 },
  fire: { make: sounds.fire, gain: 0.5, reach: 6 },
  ambience: { make: sounds.ambience, gain: 0.12, reach: 1 },
}

let cues: Record<SoundCue, AudioBuffer[]> | undefined
let loops: Record<LoopKind, AudioBuffer> | undefined
let context: AudioContext | undefined
let master: GainNode
let effects: GainNode // every sound effect: the world and the interface
let music: GainNode
let game: GainNode // everything in the world; muted while paused
let menu: GainNode
const playing: Partial<Record<SoundCue, number>> = {}
const ear = { x: 0, y: 0, z: 0, rightX: -1, rightZ: 0 } // listener: camera position and its right vector

function toBuffer(data: Float32Array) {
  const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: sounds.RATE })
  buffer.getChannelData(0).set(data)
  return buffer
}

// Synthesizes every sound, once per session: a step of the first match's loading (runtime.ts), ~0.2 s.
export function prepareSounds() {
  if (cues || typeof AudioBuffer === 'undefined') return
  cues = Object.fromEntries(Object.entries(CUES).map(([cue, spec]) => [cue, spec.make().map(toBuffer)])) as Record<SoundCue, AudioBuffer[]>
  loops = Object.fromEntries(Object.entries(LOOPS).map(([kind, spec]) => [kind, toBuffer(spec.make())])) as Record<LoopKind, AudioBuffer>
}

// The context starts on first use; browsers let it run once the page has had a click or key press.
function audio() {
  if (!context) {
    try {
      context = new AudioContext()
    } catch {
      return undefined
    }
    // compressor glues the mix; a tanh soft-clip after it rounds off any peak it lets through
    const curve = new Float32Array(1025).map((_, i) => Math.tanh(((i - 512) / 512) * 2))
    master = new GainNode(context, { gain: settings.masterVolume })
    master
      .connect(new DynamicsCompressorNode(context, { threshold: -16, knee: 10, ratio: 6, attack: 0.002, release: 0.2 }))
      .connect(new GainNode(context, { gain: 0.5 })) // the curve spans ±2
      .connect(new WaveShaperNode(context, { curve, oversample: '2x' }))
      .connect(context.destination)
    effects = new GainNode(context, { gain: settings.effectsVolume })
    effects.connect(master)
    music = new GainNode(context, { gain: settings.musicVolume })
    music.connect(master)
    game = new GainNode(context)
    game.connect(effects)
    menu = new GainNode(context)
    menu.connect(effects)
  }
  return context
}

const wake = () => {
  if (context?.state === 'suspended' && !document.hidden) context.resume().catch(() => {})
}
window.addEventListener('pointerdown', wake)
window.addEventListener('keydown', wake)
document.addEventListener('visibilitychange', () => (document.hidden ? context?.suspend().catch(() => {}) : wake()))

onSettingsChange(() => {
  if (!context) return
  master.gain.setTargetAtTime(settings.masterVolume, context.currentTime, 0.03)
  effects.gain.setTargetAtTime(settings.effectsVolume, context.currentTime, 0.03)
  music.gain.setTargetAtTime(settings.musicVolume, context.currentTime, 0.03)
})

// Pause mutes the world; menu sounds and stingers keep playing.
export function setGameAudio(active: boolean) {
  if (context) game.gain.setTargetAtTime(active ? 1 : 0, context.currentTime, 0.05)
}

export function setListener(position: THREE.Vector3, forward: THREE.Vector3) {
  const length = Math.hypot(forward.x, forward.z) || 1
  ear.x = position.x
  ear.y = position.y
  ear.z = position.z
  ear.rightX = -forward.z / length
  ear.rightZ = forward.x / length
}

// Gain and stereo pan of a sound at `at`, heard from the listener.
function place(at: THREE.Vector3, reach: number) {
  const dx = at.x - ear.x
  const dz = at.z - ear.z
  const distance = Math.hypot(dx, at.y - ear.y, dz)
  return {
    distance,
    gain: distance <= reach ? 1 : (distance / reach) ** -1.3,
    pan: distance > 0.5 ? Math.max(-1, Math.min(1, (dx * ear.rightX + dz * ear.rightZ) / distance)) * 0.8 : 0,
  }
}

// One-shot. Without `at` it plays centred, as the player's own sound.
export function playSound(cue: SoundCue, at?: THREE.Vector3, level = 1) {
  const ctx = audio()
  const variants = cues?.[cue]
  const spec = CUES[cue]
  if (!ctx || ctx.state !== 'running' || !variants || (playing[cue] ?? 0) >= (spec.limit ?? 8)) return
  let gain = spec.gain * level
  const source = new AudioBufferSourceNode(ctx, {
    buffer: variants[Math.floor(Math.random() * variants.length)],
    playbackRate: 1 + (Math.random() - 0.5) * (spec.pitch ?? 0),
  })
  let tail: AudioNode = source
  if (at) {
    const { distance, gain: falloff, pan } = place(at, spec.reach ?? 8)
    gain *= falloff
    if (gain < 0.008) return
    const muffle = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700 + 19000 * Math.exp(-distance / 60) }) // air eats the highs
    tail = tail.connect(muffle).connect(new StereoPannerNode(ctx, { pan }))
  }
  const amp = new GainNode(ctx, { gain })
  tail.connect(amp).connect(spec.music ? music : spec.ui ? menu : game)
  playing[cue] = (playing[cue] ?? 0) + 1
  source.onended = () => {
    playing[cue] = (playing[cue] ?? 1) - 1
    amp.disconnect()
  }
  source.start()
}

export interface Loop {
  set(level: number, rate?: number, at?: THREE.Vector3): void // level 0..1; `at` places it in the world
  stop(): void
}
const SILENT: Loop = { set() {}, stop() {} }

export function startLoop(kind: Exclude<LoopKind, 'engine'>): Loop {
  const ctx = audio()
  const buffer = loops?.[kind]
  if (!ctx || !buffer) return SILENT
  const { gain: base, reach } = LOOPS[kind]
  const source = new AudioBufferSourceNode(ctx, { buffer, loop: true })
  const panner = new StereoPannerNode(ctx)
  const amp = new GainNode(ctx, { gain: 0 })
  source.connect(panner).connect(amp).connect(game)
  source.start(0, Math.random() * buffer.duration) // loops of the same kind don't play in phase
  return {
    set(level, rate, at) {
      const now = ctx.currentTime
      let gain = level * base
      if (at) {
        const placed = place(at, reach)
        gain *= placed.gain
        panner.pan.setTargetAtTime(placed.pan, now, 0.05)
      }
      amp.gain.setTargetAtTime(gain, now, 0.06)
      if (rate !== undefined) source.playbackRate.setTargetAtTime(rate, now, 0.08)
    },
    stop() {
      amp.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
      source.stop(ctx.currentTime + 0.25)
      source.onended = () => amp.disconnect()
    },
  }
}

interface Engine {
  // pace: speed as a fraction of top speed; throttle -1..1; dead engines wind down
  update(pace: number, throttle: number, running: boolean, dt: number, at?: THREE.Vector3): void
  stop(): void
}

// Engine note from speed through four virtual gears: revs climb within a
// gear and drop on the shift; throttle opens the filter and adds volume.
export function startEngine(): Engine {
  const ctx = audio()
  const buffer = loops?.engine
  if (!ctx || !buffer) return { update() {}, stop() {} }
  const { gain: base, reach } = LOOPS.engine
  const firing = new AudioBufferSourceNode(ctx, { buffer, loop: true })
  const rumble = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: 0.5 }) // an octave down for body
  const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 800, Q: 0.8 })
  const panner = new StereoPannerNode(ctx)
  const amp = new GainNode(ctx, { gain: 0 })
  firing.connect(filter)
  rumble.connect(new GainNode(ctx, { gain: 0.6 })).connect(filter)
  filter.connect(panner).connect(amp).connect(game)
  const offset = Math.random() * buffer.duration
  firing.start(0, offset)
  rumble.start(0, offset)
  let revs = 0
  let load = 0

  return {
    update(pace, throttle, running, dt, at) {
      const gear = Math.min(Math.floor(pace * 4), 3)
      const target = running ? Math.max(0.2 + 0.15 * Math.abs(throttle) * (1 - pace), 0.28 + 0.72 * (pace * 4 - gear)) : 0
      revs += (target - revs) * (1 - Math.exp(-dt * (target < revs ? 5 : 9)))
      load += ((running ? Math.abs(throttle) : 0) - load) * (1 - Math.exp(-dt * 6))
      const now = ctx.currentTime
      const rate = 0.7 + 1.9 * revs
      firing.playbackRate.setTargetAtTime(rate, now, 0.04)
      rumble.playbackRate.setTargetAtTime(rate * 0.5, now, 0.04)
      filter.frequency.setTargetAtTime(300 + 2600 * (0.3 + 0.7 * load) * (0.5 + 0.5 * revs), now, 0.05)
      let gain = revs > 0.02 ? (0.35 + 0.3 * load + 0.2 * revs) * base : 0
      if (at) {
        const placed = place(at, reach)
        gain *= placed.gain
        panner.pan.setTargetAtTime(placed.pan, now, 0.05)
      }
      amp.gain.setTargetAtTime(gain, now, 0.06)
    },
    stop() {
      amp.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
      firing.stop(ctx.currentTime + 0.25)
      rumble.stop(ctx.currentTime + 0.25)
      firing.onended = () => amp.disconnect()
    },
  }
}
