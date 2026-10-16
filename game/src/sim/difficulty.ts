// How well bots play, by the difficulty picked on the arena screen: their
// gun (`damage` ×, at least `spread` radians, applied by match.ts) and their
// hands — how fast the aim catches up (1/s), its wobble (m), how much of a
// mover's travel it leads (0..1), the trigger's bursts and pauses (s), the
// weave while fighting (m either side), how hard it dodges when hit (0..1),
// how readily it takes cover out of sight when hurt or reloading (0..1, a
// chance each second) and lies in wait for a rival coming its way (0..1).
// Easy is the old bot.
export interface Skill {
  label: string
  damage: number
  spread: number
  aimRate: number
  scatter: number
  lead: number
  burst: [number, number]
  pause: [number, number]
  weave: number
  evade: number
  hide: number
  ambush: number
}
export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    damage: 0.4,
    spread: 0.05,
    aimRate: 3,
    scatter: 1.4,
    lead: 0.3,
    burst: [0.6, 1.4],
    pause: [0.8, 1.7],
    weave: 3,
    evade: 0.4,
    hide: 0,
    ambush: 0,
  },
  normal: {
    label: 'Normal',
    damage: 0.6,
    spread: 0.03,
    aimRate: 4.5,
    scatter: 1,
    lead: 0.7,
    burst: [0.7, 1.6],
    pause: [0.6, 1.2],
    weave: 5,
    evade: 0.75,
    hide: 0.35,
    ambush: 0.25,
  },
  hard: {
    label: 'Hard',
    damage: 0.85,
    spread: 0.016,
    aimRate: 7,
    scatter: 0.55,
    lead: 0.95,
    burst: [0.9, 2],
    pause: [0.35, 0.8],
    weave: 7,
    evade: 1,
    hide: 0.7,
    ambush: 0.45,
  },
} satisfies Record<string, Skill>
export type Difficulty = keyof typeof DIFFICULTIES
