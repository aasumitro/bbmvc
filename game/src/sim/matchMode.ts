import type { Plan } from './ai/brain.ts'
import type { SpawnPoint } from '../content/arenas/arena.ts'
import type { Point } from '../shared/math.ts'
import type { Credit } from './scoring.ts'

// What the match runtime needs of a game mode. Each mode keeps its rules
// pure and to itself (modes/ffa/rules.ts, modes/tdm/rules.ts) and plugs them in through
// an adapter that fulfils MatchMode (modes/ffa/mode.ts, modes/tdm/mode.ts); the runtime
// never asks which mode is running. modes.ts lists the modes. Types only,
// plus the lives' allowed moves.

// The match clock's states as the modes' rules name them (a mode may skip some).
export type ModePhase = 'preMatch' | 'active' | 'finalMinute' | 'overtime' | 'complete'
// A machine's life cycle, the same in every mode's rules. Absent: an empty
// seat (a custom room's), out of play until someone takes it.
export type Life = 'alive' | 'protected' | 'destroyed' | 'pending' | 'respawning' | 'absent'
// Its allowed moves (work/ffa/FFA_STATE_MACHINE.md); anything else is refused.
export const LIVES: Record<Life, readonly Life[]> = {
  alive: ['destroyed', 'absent'],
  protected: ['alive', 'destroyed', 'absent'],
  destroyed: ['pending', 'absent'],
  pending: ['respawning', 'destroyed', 'absent'], // back to destroyed: cancelled by the end of the match
  respawning: ['protected', 'absent'],
  absent: ['pending'], // taken: due back in at once
}

// The rules as the simulation drives them, one fixed step at a time. Called
// through the object (never detached), so the dev probes can wrap them.
export interface ModeRules {
  readonly phase: ModePhase
  readonly now: number // match clock, pre-match included
  readonly contenders: ReadonlyArray<{ readonly life: Life; readonly respawnAt: number; readonly protectedUntil: number }>
  readonly events: unknown[] // what happened since the last report(), as plain data: report() drains it (online, the server sends it on and each browser's mirror takes it in)
  remaining(): number // seconds left on the match clock
  tick(dt: number): void
  damage(attacker: number, victim: number, amount: number): number // hull the hit actually takes
  kill(victim: number, killer: number): boolean // the victim's hull reached 0 (killer -1: nobody)
  respawnDue(i: number): boolean
  pickSpawn(i: number, sees: (rival: number, at: Point) => boolean): number // an index into MatchMode.starts
  respawned(i: number, start: number): boolean
  leave(i: number): boolean // the seat is empty: out of play where it stands, quietly (no death, no kill)
  enter(i: number): boolean // someone takes the empty seat: due back in at once, at the start the rules pick
}

// Countdown and clock marks, seconds.
export interface ModeTiming {
  preMatch: number
  finalMinute: number
  finalPush: number
  finalCountdown: number
}

// A seat in the line-up: the team it plays for and where it starts. Seat 0 is the local player's.
export interface Seat {
  team: number
  spawn: SpawnPoint
}

// How an adapter puts its rules' events in front of the local player
// (feed.ts): kill feed lines, callouts, the announcer.
export interface Feed {
  readonly me: number // the local player's machine
  name(id: number): string // 'you' for the local player
  kill(credit: Credit, titles: readonly string[], teams: boolean): void // teams: colour the names by team
  teamKill(killer: number, victim: number): void // a teammate wrecked (friendly fire): the killer's team lost a point
  death(victim: number, teams: boolean): void // wrecked with nobody to credit
  phase(phase: ModePhase): void // Go, Final minute, Overtime
  news(text: string, tag?: string): void // a line with no names in it
  callout(text: string, loud?: boolean): void // centre screen, with the announcer's sting when loud
  pickup(who: number, x: number, z: number, label: string, color: string): void // `who` took an item at (x, z)
}

// What the HUD and the minimap show of a mode's pickups (the pickups' own
// Supply, modes/items/supply.ts, is one): the items on the ground, and by
// machine each effect's expiry on the match clock.
export interface SupplyView {
  readonly items: ReadonlyArray<Point & { readonly type: string }>
  readonly effects: ReadonlyArray<Readonly<Record<string, number>>>
}

export interface MatchMode {
  readonly rules: ModeRules
  readonly timing: ModeTiming
  readonly starts: readonly SpawnPoint[] // respawn points: pickSpawn indexes them
  readonly plan: Plan // how its bots value targets and run errands (sim/ai/)
  readonly supply?: SupplyView // its pickups, when it has them
  outcome(): number | null | undefined // the winning team once the rules are complete; null for a draw; undefined while it runs
  speedFactor(i: number): number // engine boost for machine i this step; 1 for none
  fired(i: number): void // a round left machine i's gun
  report(feed?: Feed): void // drains the rules' events: into the feed, or just away (headless)
  debug(): string[] // lines for the F3 overlay
  restart(seed: number): void // a fresh match on the same machines; its randomness from `seed`
  dispose(): void
  // Online: the rules' state as the player sees it (clock, lives, scores,
  // standings...), plain data the game server sends; and taking such a state
  // into these rules' data fields, where a browser mirrors the server's
  // match (never ticked there: its rules only show what the server decided).
  // The clock (`now`) travels apart, every snapshot.
  share(): unknown
  mirror(state: unknown): void
}
