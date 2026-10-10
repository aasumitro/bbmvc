import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { NavGraph } from '../../content/arenas/arena.ts'
import { distance as flat, wrap } from '../../shared/math.ts'
import type { WeaponKind, WeaponSpec } from '../../content/weapons/weapons.ts'
import type { Skill } from '../difficulty.ts'
import { AI, type Agent, type Brain, type Plan } from './brain.ts'
import { travel } from './navigation.ts'
import { canSee, clearOfMates, feel, open, pickHideout } from './perception.ts'

// A bot's step (sim/ai/): its target, where it goes, how it drives, where it
// aims and when it fires, written into its controls. Its scratch vectors are
// its own; every random draw comes from the match's stream, in order.

// How each kind of weapon wants to fight: in sight and closer than `engage`,
// it circles the target at a radius drawn from `circle`, or keeps about
// `keep` off it where there's no room to circle; it fires from `fire` in. A
// rocket pod holds off, where its splash lands and a rocket has time to be
// led, and lets a rocket go only with the gun on the lead (`onLead`).
const TACTICS = {
  gun: { engage: 38, circle: [14, 24], keep: 16, fire: 55, onLead: false },
  rocket: { engage: 60, circle: [24, 36], keep: 30, fire: 110, onLead: true },
} satisfies Record<WeaponKind, unknown>

// Seconds a round takes to fly `distance`: a gun's is there at once.
function flightTime(spec: WeaponSpec, distance: number): number {
  switch (spec.kind) {
    case 'gun':
      return 0
    case 'rocket':
      return distance / spec.rocket.speed
  }
}

const between = (range: number[], random: () => number) => range[0] + random() * (range[1] - range[0])
const goal = new THREE.Vector3()
const circling = new THREE.Vector3() // the next point of its circle round the target
const weaving = new THREE.Vector3() // where it heads fighting in tight streets: its distance kept, off to one side
const lead = new THREE.Vector3() // where the target will be when the shot gets there
const aimAt = new THREE.Vector3()

// Whoever shot it recently, else the nearest live rival within detection
// range — nearest as the plan sees it, when there is one.
export function pickTarget(bot: Agent, brain: Brain, everyone: readonly Agent[], plan?: Plan) {
  const attacker = brain.attacker
  if (attacker?.alive && brain.grudge > 0 && (!plan || plan.value(bot, attacker, 0) < Infinity)) return attacker
  let best: Agent | null = null
  let nearest = AI.detectRange
  for (const rival of everyone) {
    if (!rival.alive || rival.team === bot.team) continue
    const distance = plan ? plan.value(bot, rival, flat(rival.position, bot.position)) : flat(rival.position, bot.position)
    if (distance < nearest) {
      nearest = distance
      best = rival
    }
  }
  return best
}

const errandAt = new THREE.Vector3()
const toAim = new THREE.Vector3()
const toLead = new THREE.Vector3()

// Where to lay the gun on `target`: its hull, moved on by as much as the
// skill leads of where it goes while the aim catches up and, for a rocket,
// while the rocket flies (worked out twice, the second time from there).
export function leadTarget(bot: Agent, target: Agent, skill: Skill, out: THREE.Vector3) {
  const { spec } = bot.weapon
  out.copy(target.position)
  for (let pass = 0; pass < 2; pass++) {
    const seconds = 1 / skill.aimRate + flightTime(spec, out.distanceTo(bot.position))
    out.copy(target.position).addScaledVector(target.velocity, Math.min(seconds, 2) * skill.lead)
  }
  return out.setY(out.y + 1.1)
}

// Writes the bot's controls for this physics step. `random`: the match's
// seeded stream (0..1), so a match replays the same from the same seed.
export function think(bot: Agent, everyone: readonly Agent[], world: RAPIER.World, nav: NavGraph, dt: number, random: () => number, plan?: Plan) {
  const brain = bot.brain!
  const { skill } = brain
  const control = bot.control
  const q = bot.rotation
  const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
  const style = TACTICS[bot.weapon.spec.kind]
  const hurt = bot.health < bot.maxHealth * AI.hurt

  brain.grudge -= dt
  brain.retarget -= dt
  brain.jink -= dt
  brain.change -= dt
  if (brain.retarget <= 0 || !brain.target?.alive) {
    const target = pickTarget(bot, brain, everyone, plan)
    if (target !== brain.target) {
      brain.replan = 0
      brain.canSee = false
      brain.radius = between(style.circle, random)
    }
    brain.target = target
    brain.retarget = 0.5
  }
  // Now and then, on a whim, it circles or weaves the other way: no two passes alike.
  if (brain.change <= 0) {
    brain.change = between([2, 5], random)
    if (random() < 0.4) brain.orbit = -brain.orbit
    if (random() < 0.6) brain.side = -brain.side
  }
  const target = brain.target
  const distance = target ? flat(target.position, bot.position) : Infinity
  const keep = style.keep * (hurt ? 1.5 : 1) // hurt, it stays further off
  let limit = Infinity // speed to hold
  let backOff = false // too close to keep its distance: reverse away, still firing

  if (target) {
    const radius = brain.radius * (hurt ? 1.3 : 1)
    const around = Math.atan2(bot.position.x - target.position.x, bot.position.z - target.position.z) + brain.orbit * 0.9
    circling.set(target.position.x + Math.sin(around) * radius, 0, target.position.z + Math.cos(around) * radius)
    // In tight streets: toward (or away from) the target to hold its distance, off to one side of the line of fire.
    const ux = (target.position.x - bot.position.x) / Math.max(distance, 0.01)
    const uz = (target.position.z - bot.position.z) / Math.max(distance, 0.01)
    const along = THREE.MathUtils.clamp(distance - keep, -10, 25)
    const swing = skill.weave * brain.side * (brain.jink > 0 || hurt ? 1.6 : 1)
    weaving.set(bot.position.x + ux * along - uz * swing, 0, bot.position.z + uz * along + ux * swing)
  }
  // An errand from the plan: taken when there's no one to hunt, or at once if urgent.
  const errand = plan?.errand(bot) ?? null
  const urgent = !!errand?.urgent
  if (errand) {
    errandAt.set(errand.x, 0, errand.z)
    if (flat(errandAt, brain.errand) > 1) brain.replan = 0 // somewhere new: route there now
    brain.errand.copy(errandAt)
  }
  // Hiding: in a fight, hurt or reloading, it may take cover; with a rival
  // coming its way unseen it may lie in wait for it — at the nearest spot round it
  // the rival can't see. Out again when the time's up or the target's gone;
  // lying in wait, the moment the rival shows (it opens up at once: the
  // surprise); taking cover, if the rival can see it there after all.
  brain.hide -= dt
  brain.decide -= dt
  const atHideout = flat(brain.hideout, bot.position) < 3
  if (brain.hide > 0 && (!target || urgent || (brain.canSee && distance < style.fire && (brain.lurking || atHideout)))) {
    if (brain.lurking && brain.canSee) brain.burst = Math.max(brain.burst, between(skill.burst, random))
    brain.hide = 0
    brain.replan = 0
  }
  if (brain.hide <= 0 && brain.decide <= 0 && target && !urgent) {
    brain.decide = 1
    const reloading = bot.weapon.reload > 0
    const closing = target.velocity.x * (bot.position.x - target.position.x) + target.velocity.z * (bot.position.z - target.position.z) > 4 * distance // coming at over 4 m/s
    const cover = brain.canSee && (hurt || reloading) && random() < skill.hide
    const lurk = !cover && !brain.canSee && closing && distance > AI.lurk[0] && distance < AI.lurk[1] && random() < skill.ambush
    if ((cover || lurk) && pickHideout(world, bot, target, brain.hideout)) {
      brain.lurking = lurk
      brain.hide = cover ? (reloading ? bot.weapon.reload + 0.4 : between([3, 5], random)) : between([5, 9], random)
      brain.replan = 0
    }
  }
  let hold = false // waiting in its hideout
  if (brain.hide > 0) {
    goal.copy(atHideout ? target!.position : brain.hideout) // open road to it: straight there
    hold = atHideout
  } else if (target && brain.canSee && brain.direct && !urgent && distance < style.engage) {
    // circling where there's room; hemmed in by buildings, it weaves at its range instead of parking
    goal.copy(brain.room && brain.jink <= 0 ? circling : weaving)
    backOff = !brain.room && distance < keep * 0.6
    brain.replan = 0
  } else if (target && brain.canSee && brain.direct && !urgent) {
    goal.copy(weaving) // closing in, weaving
    brain.replan = 0
  } else if (errand && (urgent || !target)) {
    limit = travel(bot, brain, world, nav, errandAt, dt, goal)
  } else if (target) {
    limit = travel(bot, brain, world, nav, target.position, dt, goal)
  } else {
    const roam = nav.nodes[brain.roam % nav.nodes.length]
    if (flat(roam, bot.position) < AI.arrive) {
      brain.roam = Math.floor(random() * nav.nodes.length)
      brain.replan = 0
    }
    limit = travel(bot, brain, world, nav, roam, dt, goal)
  }

  const error = wrap(Math.atan2(goal.x - bot.position.x, goal.z - bot.position.z) - heading)
  let steer = THREE.MathUtils.clamp(error * 2.2, -1, 1)
  let throttle = Math.abs(error) > 1.8 ? 0.45 : 1
  limit = Math.min(limit, Math.abs(error) > 1.2 ? AI.cornering[2] : Math.abs(error) > 0.6 ? AI.cornering[1] : Infinity) // mid-turn: no flooring it wide
  if (bot.speed > limit)
    throttle = -1 // brakes (driveCar brakes on reverse throttle while rolling forward)
  else if (bot.speed > limit * 0.9) throttle = 0
  if (hold) throttle = bot.speed > 0.5 ? -1 : 0
  // turn round in a few moves: back up with the wheels turned the other way, if there's room behind;
  // or too close to the target in a tight street: back away from it, swinging the tail to its weave side
  const roomBehind = (Math.abs(error) > 2.2 && bot.speed < 4) || backOff ? feel(world, bot, heading + Math.PI, 0, 5) > 0.8 : false
  const behind = roomBehind && Math.abs(error) > 2.2 && bot.speed < 4
  const reversing = behind || (roomBehind && backOff)
  if (behind) {
    throttle = -1
    steer = -Math.sign(error)
  } else if (reversing) {
    throttle = -1
    steer = brain.side
  }

  // Feelers steer around walls and junk; a blocked nose turns toward open space.
  const reach = 5 + Math.abs(bot.speed) * 0.5
  const left = feel(world, bot, heading, 0.45, reach)
  const right = feel(world, bot, heading, -0.45, reach)
  const ahead = feel(world, bot, heading, 0, reach * 1.2)
  if (!reversing) {
    steer += (left - right) * 1.5
    if (ahead < 0.6) {
      throttle = Math.min(throttle, 0.5)
      steer += (left >= right ? 1 : -1) * (1 - ahead) * 2
    }
  }
  steer = THREE.MathUtils.clamp(steer, -1, 1)

  if (brain.reverse > 0) {
    brain.reverse -= dt
    throttle = -1
    steer = brain.escape
  } else {
    const pressing = throttle > 0.3
    brain.stuck = pressing && Math.abs(bot.speed) < 1 ? brain.stuck + dt : Math.max(0, brain.stuck - dt)
    brain.blocked = pressing && ahead < 0.25 && Math.abs(bot.speed) < 3 ? brain.blocked + dt : 0
    if (brain.stuck > 1.2 || brain.blocked > AI.blocked) {
      // back out, the tail swinging toward whichever side behind is clearer (in reverse
      // the tail goes the way the wheels point); when that's even, the other way from last time
      const tailLeft = feel(world, bot, heading + Math.PI, -0.45, 6)
      const tailRight = feel(world, bot, heading + Math.PI, 0.45, 6)
      brain.escape = Math.abs(tailLeft - tailRight) > 0.15 ? (tailLeft > tailRight ? 1 : -1) : -brain.escape
      brain.reverse = 1.3
      brain.stuck = 0
      brain.blocked = 0
      brain.replan = 0
    }
  }
  control.throttle = throttle
  control.steer = steer
  control.handbrake = false

  // Aim leads the target by as much as the skill manages, with some wobble; fire in bursts when it is in sight.
  if (target) {
    leadTarget(bot, target, skill, lead)
    aimAt.set(lead.x + (random() - 0.5) * skill.scatter, lead.y + (random() - 0.5) * skill.scatter, lead.z + (random() - 0.5) * skill.scatter)
  } else {
    aimAt.set(bot.position.x + Math.sin(heading) * 20, bot.position.y + 1.5, bot.position.z + Math.cos(heading) * 20)
  }
  control.aim.lerp(aimAt, 1 - Math.exp(-skill.aimRate * dt))

  brain.sight -= dt
  if (brain.sight <= 0) {
    brain.sight = 0.2
    brain.canSee = !!target && distance < style.fire && canSee(world, bot, target)
    brain.clear = !plan?.careful || clearOfMates(bot, everyone)
    brain.direct = brain.canSee && open(world, bot.position, target!.position)
    brain.room = brain.direct && open(world, bot.position, circling)
    if (brain.direct && !brain.room) brain.orbit = -brain.orbit // blocked that way round: try the other next time
    if (brain.direct && !open(world, bot.position, weaving)) brain.side = -brain.side // a wall on that side: weave the other way
  }
  if (brain.burst > 0) {
    brain.burst -= dt
    if (brain.burst <= 0) brain.burst = -between(skill.pause, random)
  } else {
    brain.burst += dt
    if (brain.burst >= 0) brain.burst = brain.canSee ? between(skill.burst, random) : -0.3
  }
  let fire = brain.canSee && brain.clear && brain.burst > 0
  // a rocket leaves only with the gun on the lead (or the target on top of it): there are six, slow to reload
  if (fire && target && style.onLead && distance > 12)
    fire = toAim.subVectors(control.aim, bot.position).angleTo(toLead.subVectors(lead, bot.position)) < AI.aligned
  control.fire = fire
}
