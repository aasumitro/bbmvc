// Signs of aim help, per person, for a person to review (NET_PLAN.md §7: the
// server's authority stops every other cheat; aim help and wallhacks are
// what it can't). Lock-on puts a fair page's aim on a hostile in plain view,
// so an aim on a target means nothing by itself. What a fair page can't do:
//   hidden  firing with the aim inside a hostile the shooter can't see (from
//           the car's roof or the chase camera, as the shooter's page drew it):
//           a fair page's aim lies on the first surface its ray meets, or on a
//           hostile in sight
//   snaps   the aim swinging further than any lock-on window in two steps
//           onto a hostile that is then hit
//   quick   firing that starts within a step of the aim reaching a hostile
// Each is counted over a person's time in a seat; past its threshold it
// flags them. Nothing acts on a flag: the match record and the replay are
// there for a person to look at. Pure: the room gives positions and a sight
// test (fairplay.test.ts).

export const FAIRPLAY = {
  body: 0.9, // metres: an aim point this close to where lock-on aims (1 m over the hostile's wheels) is on it
  lift: 1, // metres over a machine's position where lock-on aims
  snap: 40, // degrees the aim turns within two steps
  follow: 12, // steps: a hit on the hostile this soon after the snap counts it
  quick: 1, // steps from the aim reaching a hostile to the trigger
  flags: { hidden: 30, snaps: 8, quick: 10, quickShare: 0.6 }, // hidden: steps; quickShare: of the trigger pulls onto a hostile
}

export interface Vector {
  x: number
  y: number
  z: number
}

// A hostile as the shooter's page drew it (the tick it saw).
export interface Target extends Vector {
  id: number
}

export interface FairTally {
  steps: number // steps the person drove
  firing: number // of those, the trigger held
  onTarget: number // of those, the aim on a hostile
  hidden: number // of those, the hostile out of sight
  snaps: number
  pulls: number // trigger pulls with the aim on a hostile
  quick: number // of those, within FAIRPLAY.quick steps of the aim reaching it
  hits: number // times this person's fire hurt a hostile
}

export type FairFlag = 'hidden' | 'snaps' | 'quick'

const blank = (): FairTally => ({ steps: 0, firing: 0, onTarget: 0, hidden: 0, snaps: 0, pulls: 0, quick: 0, hits: 0 })

export function createFairPlay(seats: number) {
  const tallies = Array.from({ length: seats }, blank)
  const state = Array.from({ length: seats }, () => ({
    headings: [] as Vector[], // the aim's direction the last two steps, newest last
    target: -1, // the hostile the aim is on, -1 none
    since: 0, // the step the aim reached it
    firing: false,
    snap: null as { target: number; until: number } | null, // a snap waiting for its hit
  }))
  const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const unit = (from: Vector, to: Vector): Vector => {
    const d = distance(from, to) || 1
    return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d }
  }
  const degrees = (a: Vector, b: Vector) => (Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI

  return {
    // One step of a person's driving. `eyes`: where their page could see
    // from (the car's roof, the chase camera); `targets`: the hostiles as
    // their page drew them; `sees`: a clear line through the arena.
    observe(
      seat: number,
      tick: number,
      eyes: readonly Vector[],
      aim: Vector,
      fire: boolean,
      targets: readonly Target[],
      sees: (from: Vector, to: Vector) => boolean,
    ) {
      const t = tallies[seat]
      const s = state[seat]
      t.steps++
      if (fire) t.firing++
      let on = -1
      let at: Vector | null = null
      for (const target of targets) {
        const centre = { x: target.x, y: target.y + FAIRPLAY.lift, z: target.z }
        if (distance(aim, centre) > FAIRPLAY.body) continue
        on = target.id
        at = centre
        break
      }
      if (on !== s.target) {
        s.target = on
        s.since = tick
      }
      if (on >= 0 && fire) {
        t.onTarget++
        if (at && !eyes.some((eye) => sees(eye, at))) t.hidden++
      }
      if (fire && !s.firing && on >= 0) {
        t.pulls++
        if (tick - s.since <= FAIRPLAY.quick) t.quick++
      }
      s.firing = fire
      const heading = unit(eyes[0], aim)
      if (s.headings.length === 2 && on >= 0 && degrees(s.headings[0], heading) > FAIRPLAY.snap) s.snap = { target: on, until: tick + FAIRPLAY.follow }
      s.headings.push(heading)
      if (s.headings.length > 2) s.headings.shift()
      if (s.snap && tick > s.snap.until) s.snap = null
    },
    // `seat`'s fire hurt `victim` on step `tick`.
    hit(seat: number, victim: number, tick: number) {
      tallies[seat].hits++
      const s = state[seat]
      if (s.snap && s.snap.target === victim && tick <= s.snap.until) {
        tallies[seat].snaps++
        s.snap = null
      }
    },
    // A new person in the seat: nothing of the last one's counts.
    reset(seat: number) {
      tallies[seat] = blank()
      Object.assign(state[seat], { headings: [], target: -1, since: 0, firing: false, snap: null })
    },
    // The seat's counts, and what they flag.
    summary(seat: number): { tally: FairTally; flags: FairFlag[] } {
      const t = { ...tallies[seat] }
      const { flags: limit } = FAIRPLAY
      const flags: FairFlag[] = []
      if (t.hidden >= limit.hidden) flags.push('hidden')
      if (t.snaps >= limit.snaps) flags.push('snaps')
      if (t.quick >= limit.quick && t.quick >= limit.quickShare * t.pulls) flags.push('quick')
      return { tally: t, flags }
    },
  }
}
