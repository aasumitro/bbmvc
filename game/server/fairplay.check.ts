// Self-check for the fair-play signals (fairplay.ts): a fair player — a
// smooth aim, lock-on onto hostiles in sight, the trigger held — is never
// flagged, not even aiming at a wall a hostile hides behind; aiming inside a
// hidden hostile, snapping onto hostiles, and a trigger that fires the step
// the aim arrives are counted and flagged. Plain node:
// node server/fairplay.check.ts
import { createFairPlay, FAIRPLAY, type Point, type Target } from './fairplay.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`fairplay: ${what}`)
  checks++
}

// A wall across x = 20 from z = -10 to 10, 6 m high: nothing sees through it.
const sees = (from: Point, to: Point) => {
  if ((from.x - 20) * (to.x - 20) >= 0) return true // both on one side
  const k = (20 - from.x) / (to.x - from.x)
  const z = from.z + (to.z - from.z) * k
  const y = from.y + (to.y - from.y) * k
  return Math.abs(z) > 10 || y > 6
}
const roof = { x: 0, y: 1.6, z: 0 }
const camera = { x: -8.5, y: 3.3, z: 0 }
const eyes = [roof, camera]
const inSight: Target = { id: 1, x: 10, y: 0, z: 30 } // off the wall's end: in plain view
const hidden: Target = { id: 2, x: 40, y: 0, z: 0 } // behind the wall
const centre = (t: Target) => ({ x: t.x, y: t.y + FAIRPLAY.lift, z: t.z })
const toward = (degrees: number, far = 50) => ({ x: Math.cos((degrees * Math.PI) / 180) * far, y: 1.6, z: Math.sin((degrees * Math.PI) / 180) * far })

// --- a fair player ------------------------------------------------------------------------------------

{
  const f = createFairPlay(4)
  let tick = 0
  // sweeping the view 2° a step, trigger held; lock-on pulls the aim onto the hostile in sight while it's in the window
  for (let a = -40; a <= 80; a += 2) {
    const locked = Math.abs(a - 71.6) < 3 // where the hostile in sight lies, seen from the car
    f.observe(0, ++tick, eyes, locked ? centre(inSight) : toward(a), true, [inSight, hidden], sees)
    if (locked && tick % 6 === 0) f.hit(0, inSight.id, tick)
  }
  // aiming at the wall right in front of the hidden hostile (the aim lies on the wall's face, 1.5 m short of it... and more)
  for (let k = 0; k < 120; k++) f.observe(0, ++tick, eyes, { x: 19.9, y: 1, z: 0 }, true, [inSight, hidden], sees)
  const { tally, flags } = f.summary(0)
  check(tally.steps === 61 + 120 && tally.onTarget > 0 && tally.hidden === 0, `a fair player's aim is on a hostile only in sight; a wall face near a hidden one isn't on it (${tally.onTarget} on target, ${tally.hidden} hidden)`)
  check(tally.snaps === 0 && tally.quick === 0 && flags.length === 0, 'a smooth sweep, lock-on and a held trigger: no snaps, no quick triggers, no flag')
}

// --- aim inside a hidden hostile ---------------------------------------------------------------------------------

{
  const f = createFairPlay(4)
  for (let tick = 1; tick <= FAIRPLAY.flags.hidden - 1; tick++) f.observe(1, tick, eyes, centre(hidden), true, [inSight, hidden], sees)
  check(f.summary(1).tally.hidden === FAIRPLAY.flags.hidden - 1 && f.summary(1).flags.length === 0, 'firing into a hidden hostile is counted, and a flag waits for its threshold')
  f.observe(1, FAIRPLAY.flags.hidden, eyes, centre(hidden), true, [inSight, hidden], sees)
  check(f.summary(1).flags.includes('hidden'), `${FAIRPLAY.flags.hidden} steps of it: flagged`)
  f.observe(1, 100, eyes, centre(hidden), false, [inSight, hidden], sees)
  check(f.summary(1).tally.hidden === FAIRPLAY.flags.hidden, 'the aim on it without firing is not counted')
  f.reset(1)
  check(f.summary(1).tally.hidden === 0 && f.summary(1).flags.length === 0, 'a new person in the seat starts clean')
}

// --- snaps -------------------------------------------------------------------------------------------------------

{
  const f = createFairPlay(4)
  let tick = 0
  for (let n = 0; n < FAIRPLAY.flags.snaps; n++) {
    for (let k = 0; k < 20; k++) f.observe(2, ++tick, eyes, toward(-90), false, [inSight], sees) // looking away
    f.observe(2, ++tick, eyes, centre(inSight), true, [inSight], sees) // onto it in one step
    f.hit(2, inSight.id, tick + 3)
  }
  check(f.summary(2).tally.snaps === FAIRPLAY.flags.snaps && f.summary(2).flags.includes('snaps'), `a swing of over ${FAIRPLAY.snap}° onto a hostile, then a hit on it: ${FAIRPLAY.flags.snaps} times flags`)
  const g = createFairPlay(4)
  tick = 0
  for (let k = 0; k < 20; k++) g.observe(2, ++tick, eyes, toward(-90), false, [inSight], sees)
  g.observe(2, ++tick, eyes, centre(inSight), true, [inSight], sees)
  g.hit(2, inSight.id, tick + FAIRPLAY.follow + 1)
  g.hit(2, 7, tick + 1)
  check(g.summary(2).tally.snaps === 0 && g.summary(2).tally.hits === 2, 'a snap without a hit on that hostile soon after is not one')
}

// --- a trigger that fires as the aim arrives ------------------------------------------------------------------------

{
  const f = createFairPlay(4)
  let tick = 0
  for (let n = 0; n < FAIRPLAY.flags.quick; n++) {
    for (let k = 0; k < 10; k++) f.observe(3, ++tick, eyes, toward(k * 2), false, [inSight], sees)
    f.observe(3, ++tick, eyes, centre(inSight), true, [inSight], sees) // arrives and fires, the same step
    for (let k = 0; k < 5; k++) f.observe(3, ++tick, eyes, centre(inSight), true, [inSight], sees)
  }
  const { tally, flags } = f.summary(3)
  check(tally.pulls === FAIRPLAY.flags.quick && tally.quick === FAIRPLAY.flags.quick && flags.includes('quick'), 'the trigger pulled the step the aim reaches a hostile, every time: flagged')
  const g = createFairPlay(4)
  tick = 0
  for (let n = 0; n < FAIRPLAY.flags.quick * 2; n++) {
    for (let k = 0; k < 10; k++) g.observe(3, ++tick, eyes, toward(k * 2), false, [inSight], sees)
    for (let k = 0; k < 15; k++) g.observe(3, ++tick, eyes, centre(inSight), k >= 12, [inSight], sees) // a human's 200 ms
  }
  check(g.summary(3).tally.quick === 0 && g.summary(3).flags.length === 0, 'pulling it 200 ms after the aim arrives: not quick')
}

console.log(`fairplay ok (${checks} checks)`)
