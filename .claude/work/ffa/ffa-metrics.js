// Free for all balance probe (dev only; the game never imports this file).
// Paste into the console of the dev build (:3000) with a Free for All match
// open, then:
//
//   await ffaMetrics.setup()                    // once per match screen
//   ffaMetrics.autopilot('even')                // who drives the player (below)
//   ffaMetrics.play({ matches: 30, label: 'even' })
//   ffaMetrics.status                           // progress; ~7 s per match
//   ffaMetrics.analyze('even')                  // summary of the finished runs
//
// autopilot(mode, style): 'even' = the bots' brain and gun, no aim assist
// (eight equal machines); 'human' = the bots' brain with the garage Minigun
// and the camera's lock-on assist; null = no input. style 'defensive' (hunts
// nobody, only hits back) or 'aggressive' (hunts twice as far).
//
// It wraps the live rules' damage / kill / respawned / tick and samples state
// every step; it plays whole matches through match.frame() at the fixed 60 Hz
// step, so the simulation is the game's own. Numbers in FFA_BALANCE_REPORT.md.
// Relies on internals (window.match, match.mode.rules, match.chase): best effort.
window.ffaMetrics = (() => {
  const M = { runs: [], R: null, auto: null, status: null, t: performance.now() + 1e7 }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
  const inside = (zone, p) => !!zone && dist(zone, p) <= zone.radius
  const fighting = (ffa) => ffa.phase === 'active' || ffa.phase === 'finalMinute' || ffa.phase === 'overtime'
  const effectsOn = (c, now) => ({ damage: c.effects.damage > now, armor: c.effects.armor > now, speed: c.effects.speed > now, repair: c.effects.repair > now })

  M.setup = async () => {
    M.ai = await import('/src/sim/ai/brain.ts')
    M.combat = await import('/src/sim/combat.ts')
    M.weapons = await import('/src/content/weapons/weapons.ts')
    M.cfg = (await import('/src/modes/ffa/config.ts')).FFA
    const m = window.match
    const { combatants: C, chase: view } = m
    const ffa = m.mode.kind === 'ffa' ? m.mode.rules : null
    if (!ffa) return 'open a Free for All match first'
    if (ffa.__metrics) return 'ready'
    ffa.__metrics = true
    const orig = { damage: ffa.damage, kill: ffa.kill, respawned: ffa.respawned, tick: ffa.tick, targetValue: ffa.targetValue, update: view.update }

    // the player's aim: 'even' keeps the brain's own, 'human' points the camera at it (the lock-on does the rest)
    M.stash = m.player.control.aim.clone()
    view.update = function (...args) {
      const p = window.match.player
      const aim = M.auto?.mode === 'human' && p.alive ? p.control.aim.clone() : null
      if (M.auto?.mode === 'even') M.stash.copy(p.control.aim)
      const out = orig.update.apply(this, args)
      if (aim) view.forward.copy(aim).sub(window.camera.position).normalize()
      return out
    }
    ffa.targetValue = (bot, rival, d) => {
      const v = orig.targetValue(bot, rival, d)
      if (bot !== 0 || !M.auto || v === Infinity) return v
      const brain = window.match.player.brain
      if (M.auto.style === 'defensive') return brain?.attacker?.id === rival && brain.grudge > 0 ? v : Infinity
      if (M.auto.style === 'aggressive') return v / 2
      return v
    }

    ffa.damage = (a, v, amount) => {
      const R = M.R, now = ffa.now, hit = ffa.contenders[v], hp = C[v].health
      const shield = hit.life === 'protected' && now < hit.protectedUntil ? M.cfg.protection.reduction : 0
      const armor = hit.effects.armor > now ? M.cfg.items.armor.reduction : 0
      const boost = ffa.contenders[a].effects.damage > now ? M.cfg.items.damage.factor : 1
      const byProtected = ffa.contenders[a].life === 'protected'
      const dealt = orig.damage(a, v, amount)
      if (!R || dealt <= 0) return dealt
      const d = R.dmg
      d.total += dealt
      if (byProtected) d.byProtected += dealt
      if (boost > 1) {
        d.boostBonus += dealt - Math.min(hp, amount * (1 - Math.max(shield, armor)))
        const w = R.boosts.findLast((w) => w.who === a && w.until > now)
        if (w) w.dealt += dealt
      }
      if (armor > shield) d.armorPrevented += Math.min(hp, amount * boost * (1 - shield)) - dealt
      if (shield > armor) d.protPrevented += Math.min(hp, amount * boost * (1 - armor)) - dealt
      return dealt
    }

    ffa.kill = (v, k) => {
      const R = M.R, now = ffa.now, cv = ffa.contenders[v], ck = k >= 0 ? ffa.contenders[k] : null
      const ctx = R && {
        now, t: ffa.elapsed(), phase: ffa.phase, v, k, life: now - cv.spawnedAt, vProt: cv.life === 'protected',
        vEff: effectsOn(cv, now), kEff: ck ? effectsOn(ck, now) : null, vZone: inside(ffa.zone, C[v].position),
        kTrail: k >= 0 && ffa.trailing(k), leader: ffa.soleLeader(),
      }
      const ok = orig.kill(v, k)
      if (R && ok) {
        ctx.wait = cv.life === 'pending' ? cv.respawnAt - ffa.now : null
        R.deaths.push(ctx)
        for (const w of [...R.boosts, ...R.armors]) {
          if (w.until <= now) continue
          if (w.who === k) w.kills++
          if (w.who === v) Object.assign(w, { died: true, until: now })
        }
      }
      return ok
    }

    ffa.respawned = (i, start) => {
      const due = ffa.contenders[i].respawnAt
      const ok = orig.respawned(i, start)
      if (M.R && ok) {
        const at = m.arena.spawns[start].position
        let nearest = Infinity
        for (const c of C) if (c.id !== i && c.alive) nearest = Math.min(nearest, dist(c.position, at))
        M.R.spawns.push({ now: ffa.now, t: ffa.elapsed(), i, start, late: ffa.now - due, nearest, zone: inside(ffa.zone, at) })
      }
      return ok
    }

    let sampleIn = 0
    ffa.tick = (dt) => {
      orig.tick(dt)
      const R = M.R
      if (!R) return
      if (fighting(ffa)) sample(R, dt, (sampleIn -= dt) <= 0 && (sampleIn = 0.25) > 0)
      for (const it of ffa.items) {
        if (R.seen.has(it.id)) continue
        R.seen.add(it.id)
        R.spawned.push({ type: it.type, rarity: it.rarity, hot: it.hot, trailingNear: C.some((c) => c.alive && ffa.trailing(c.id) && dist(c.position, it) <= M.cfg.comeback.radius) })
      }
      drain(R)
    }
    return 'ready'
  }

  // Per step: alive / dead / zone / trailing time and effect time; every 0.25 s:
  // who the bots target (the sole leader?) and how many chase the same item.
  function sample(R, dt, slow) {
    const { combatants: C, others: bots, mode: { rules: ffa } } = window.match
    const now = ffa.now
    for (const c of C) {
      const i = c.id, con = ffa.contenders[i]
      if (!c.alive) {
        R.dead[i] += dt
        continue
      }
      R.alive[i] += dt
      const zoned = inside(ffa.zone, c.position)
      if (zoned) R.zoneTime[i] += dt
      if (zoned && c.brain && !c.brain.target) R.zoneIdle += dt
      if (ffa.trailing(i)) R.trailTime[i] += dt
      for (const e of ['repair', 'speed', 'armor', 'damage']) if (con.effects[e] > now) R.eff[e] += dt
    }
    if (!slow) return
    const leader = ffa.soleLeader()
    if (leader >= 0 && C[leader].alive) {
      for (const b of bots) {
        if (!b.alive || b.id === leader || !b.brain?.target) continue
        R.targeting.samples++
        if (b.brain.target.id === leader) R.targeting.leader++
        R.targeting.expected += 1 / C.filter((c) => c.alive && c !== b).length
      }
    }
    const chasing = new Map()
    for (const b of bots) {
      if (!b.alive || !b.brain) continue
      const e = ffa.errand(b.id)
      if (!e || (b.brain.target && !e.urgent)) continue
      if (b.brain.target) R.urgentWithTarget += 0.25
      const item = ffa.items.find((it) => Math.abs(it.x - e.x) < 0.01 && Math.abs(it.z - e.z) < 0.01)
      if (item) chasing.set(item, (chasing.get(item) ?? 0) + 1)
    }
    for (const [item, count] of chasing) {
      R.chase[Math.min(count, 8)]++
      if (count >= 3) R.chaseTypes[item.type] = (R.chaseTypes[item.type] ?? 0) + 1
    }
    const p = window.match.player
    if (p.alive && window.match.phase === 'destroyed') R.stale++ // back in, still on the death screen
  }

  function drain(R) {
    const { combatants: C, mode: { rules: ffa } } = window.match
    for (const e of ffa.events) {
      if (e.__metrics) continue
      e.__metrics = true
      const E = R.events
      if (e.type === 'kill') {
        if (e.milestone) E.milestones[e.milestone] = (E.milestones[e.milestone] ?? 0) + 1
        if (e.multi >= 2) E.multi[e.multi] = (E.multi[e.multi] ?? 0) + 1
        E.revenge += +e.revenge
        E.shutdown += +!!e.shutdown
      } else if (e.type === 'nemesis') E.nemesis++
      else if (e.type === 'item') {
        const now = ffa.now
        R.collected.push({ who: e.who, type: e.item.type, trailing: ffa.trailing(e.who), zoned: inside(ffa.zone, C[e.who].position), age: now - e.item.born })
        const kind = e.item.type === 'damage' || e.item.type === 'armor' ? e.item.type : null
        if (!kind) continue
        const list = kind === 'damage' ? R.boosts : R.armors
        const until = ffa.contenders[e.who].effects[kind]
        const open = list.find((w) => w.who === e.who && w.until > now)
        if (open) open.until = until // a refresh extends the window
        else list.push({ who: e.who, until, kills: 0, dealt: 0, died: false })
      } else if (e.type === 'expired') R.expired.push({ type: e.item.type })
      else if (e.type === 'phase' && e.phase === 'overtime') R.overtimeAt = ffa.now
    }
  }

  M.autopilot = (mode, style = 'normal') => {
    const m = window.match, p = m.player
    M.auto = mode ? { mode, style } : null
    p.brain = mode ? M.ai.createBrain(p.seed) : undefined // the simulation thinks for any machine with a brain
    p.weapon = M.combat.armWeapon(mode === 'even' ? m.others[0].weapon.spec : M.weapons.WEAPONS.minigun)
  }

  function newRun(label) {
    const n = window.match.combatants.length
    const zeros = () => new Array(n).fill(0)
    M.R = {
      label, auto: M.auto ? `${M.auto.mode}/${M.auto.style}` : 'idle', seen: new Set(),
      deaths: [], spawns: [], spawned: [], collected: [], expired: [], boosts: [], armors: [],
      alive: zeros(), dead: zeros(), zoneTime: zeros(), trailTime: zeros(), zoneIdle: 0, urgentWithTarget: 0, stale: 0,
      eff: { repair: 0, speed: 0, armor: 0, damage: 0 },
      dmg: { total: 0, boostBonus: 0, armorPrevented: 0, protPrevented: 0, byProtected: 0 },
      targeting: { samples: 0, leader: 0, expected: 0 }, chase: new Array(9).fill(0), chaseTypes: {},
      events: { milestones: {}, multi: {}, revenge: 0, nemesis: 0, shutdown: 0 }, overtimeAt: null,
    }
    M.runs.push(M.R)
  }

  function finish() {
    const { combatants: C, mode: { rules: ffa } } = window.match
    const R = M.R
    drain(R)
    Object.assign(R, { final: C.map((c) => ({ ...c.stats })), order: [...ffa.standings()], winner: ffa.winner, draw: ffa.draw, end: ffa.now })
    delete R.seen
  }

  // Plays `matches` whole matches in slices, yielding to the page between them.
  M.play = ({ matches = 1, label = 'run', slice = 20 } = {}) => {
    const ch = new MessageChannel()
    let left = matches
    M.status = { done: 0, matches, running: true }
    const begin = () => {
      window.match.restart()
      if (M.auto) M.autopilot(M.auto.mode, M.auto.style)
      newRun(label)
    }
    begin()
    ch.port1.onmessage = () => {
      const m = window.match, p = m.player
      for (let k = 0; k < slice * 10 && m.phase !== 'victory' && m.phase !== 'defeat'; k++) {
        m.frame((M.t += 100))
        if (M.auto?.mode === 'even') p.control.aim.copy(M.stash)
      }
      if (m.phase === 'victory' || m.phase === 'defeat') {
        finish()
        M.status.done++
        if (--left <= 0) return (M.status.running = false)
        begin()
      }
      ch.port2.postMessage(0)
    }
    ch.port2.postMessage(0)
  }

  M.analyze = (label) => {
    const runs = M.runs.filter((r) => r.final && (!label || r.label === label))
    const N = runs.length
    if (!N) return 'no finished runs'
    const sum = (a) => a.reduce((s, x) => s + x, 0)
    const avg = (a) => (a.length ? sum(a) / a.length : NaN)
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    const r1 = (x) => Math.round(x * 10) / 10
    const pct = (x) => `${Math.round(x * 1000) / 10}%`
    const per = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => ((o[x[key]] = (o[x[key]] ?? 0) + 1), o), {})).map(([k, v]) => [k, r1(v / N)]))
    const deaths = runs.flatMap((r) => r.deaths)
    const kills = deaths.filter((d) => d.k >= 0 && d.k !== d.v)
    const aliveSec = sum(runs.flatMap((r) => r.alive))
    const killRate = kills.length / aliveSec
    const deathRate = deaths.length / aliveSec
    const ot = runs.filter((r) => r.overtimeAt != null)
    const phases = [[0, 180, '0-3'], [180, 300, '3-5'], [300, 480, '5-8'], [480, 600, '8-10']]
    const byPhase = Object.fromEntries(
      phases.map(([a, b, name]) => {
        const ds = deaths.filter((d) => d.phase !== 'overtime' && d.t >= a && d.t < b)
        return [name, { perMin: r1(ds.length / ((N * (b - a)) / 60)), avgLife: r1(avg(ds.map((d) => d.life))), wait: r1(avg(ds.map((d) => d.wait ?? 0))), downtime: pct(sum(ds.map((d) => d.wait ?? 0)) / (N * (b - a) * 8)) }]
      }),
    )
    const table = (d) => (d.phase === 'overtime' ? M.cfg.respawn.overtime : M.cfg.respawn.phases.find((p) => d.t < p.before).delay)
    const spawns = runs.flatMap((r) => r.spawns)
    const spawned = runs.flatMap((r) => r.spawned), collected = runs.flatMap((r) => r.collected), expired = runs.flatMap((r) => r.expired)
    const boosts = runs.flatMap((r) => r.boosts), armors = runs.flatMap((r) => r.armors)
    const eff = (e) => sum(runs.map((r) => r.eff[e]))
    const zoneTime = sum(runs.flatMap((r) => r.zoneTime))
    const zoneDeaths = deaths.filter((d) => d.vZone).length
    const openDeaths = deaths.filter((d) => d.t >= M.cfg.hotZone.first).length
    const trailTime = sum(runs.flatMap((r) => r.trailTime))
    const tg = runs.reduce((a, r) => ({ samples: a.samples + r.targeting.samples, leader: a.leader + r.targeting.leader, expected: a.expected + r.targeting.expected }), { samples: 0, leader: 0, expected: 0 })
    const chase = runs.reduce((a, r) => a.map((x, i) => x + r.chase[i]), new Array(9).fill(0))
    const player = (f) => r1(avg(runs.map(f)))
    let alternation = 0
    for (const r of runs) {
      const seq = [...r.deaths.map((d) => [d.now, d.v, 'd']), ...r.spawns.map((s) => [s.now, s.i, 's'])].sort((a, b) => a[0] - b[0])
      const last = new Map()
      for (const [, who, kind] of seq) {
        if ((last.get(who) ?? 's') === kind) alternation++
        last.set(who, kind)
      }
    }
    return {
      matches: N,
      match: { overtime: `${ot.length}/${N}`, overtimeDraws: ot.filter((r) => r.draw).length, overtimeAvg: r1(avg(ot.map((r) => r.end - r.overtimeAt))), killsPerMatch: r1(kills.length / N), winner: player((r) => r.final[r.order[0]].kills), second: player((r) => r.final[r.order[1]].kills), last: player((r) => r.final[r.order.at(-1)].kills) },
      phases: byPhase,
      respawn: { waitMismatches: deaths.filter((d) => d.wait != null && Math.abs(d.wait - table(d)) > 1e-6).length, alternationErrors: alternation, maxLate: r1(Math.max(0, ...spawns.map((s) => s.late)) * 1000) + ' ms', staleDeathScreen: sum(runs.map((r) => r.stale)) },
      spawns: { nearestMedian: r1(med(spawns.map((s) => s.nearest))), under50m: pct(spawns.filter((s) => s.nearest < 50).length / spawns.length), deathsWithin8s: pct(deaths.filter((d) => d.life <= 8 && d.t > d.life).length / deaths.length), whileProtected: deaths.filter((d) => d.vProt).length, protectionAbsorbedPerMatch: r1(sum(runs.map((r) => r.dmg.protPrevented)) / N), dealtWhileProtected: r1(sum(runs.map((r) => r.dmg.byProtected))) },
      items: { spawned: per(spawned, 'type'), collected: per(collected, 'type'), expired: per(expired, 'type'), rarity: per(spawned, 'rarity'), hot: pct(spawned.filter((s) => s.hot).length / spawned.length), secondsToPickup: r1(avg(collected.map((c) => c.age))), playerShare: pct(collected.filter((c) => c.who === 0).length / collected.length) },
      damageBoost: { perMatch: r1(boosts.length / N), killsPerPickup: r1(sum(boosts.map((w) => w.kills)) / boosts.length), killRate: r1(kills.filter((d) => d.kEff?.damage).length / eff('damage') / killRate), diedDuring: pct(boosts.filter((w) => w.died).length / boosts.length), dealtPerWindow: r1(avg(boosts.map((w) => w.dealt))), bonusShare: pct(sum(runs.map((r) => r.dmg.boostBonus)) / sum(runs.map((r) => r.dmg.total))) },
      armor: { perMatch: r1(armors.length / N), preventedPerPickup: r1(sum(runs.map((r) => r.dmg.armorPrevented)) / armors.length), deathRate: r1(deaths.filter((d) => d.vEff.armor).length / eff('armor') / deathRate) },
      speed: { secondsPerPickup: r1(eff('speed') / collected.filter((c) => c.type === 'speed').length) },
      hotZone: { timeShare: pct(zoneTime / aliveSec), killShare: pct(zoneDeaths / openDeaths), density: r1(zoneDeaths / zoneTime / ((openDeaths - zoneDeaths) / (aliveSec * 0.85 - zoneTime))), pickupsInside: pct(collected.filter((c) => c.zoned).length / collected.length), idleShare: pct(sum(runs.map((r) => r.zoneIdle)) / zoneTime) },
      comeback: { trailingPerMatch: r1(avg(runs.map((r) => r.trailTime.filter((x) => x > 0).length))), timeShare: pct(trailTime / aliveSec), killRate: r1(kills.filter((d) => d.kTrail).length / trailTime / killRate), pickupShare: pct(collected.filter((c) => c.trailing).length / collected.length), spawnsNear: pct(spawned.filter((s) => s.trailingNear).length / spawned.length) },
      bots: { leaderTargetRatio: r1(tg.leader / tg.expected), threePlusOnOneItem: pct(sum(chase.slice(3)) / sum(chase)), chaseHistogram: chase.slice(1), urgentWithTargetPerMatch: r1(sum(runs.map((r) => r.urgentWithTarget)) / N) },
      feedback: { milestones: per(runs.flatMap((r) => Object.entries(r.events.milestones).flatMap(([k, v]) => new Array(v).fill({ k }))), 'k'), revengeShare: pct(sum(runs.map((r) => r.events.revenge)) / kills.length), nemesisPerMatch: r1(sum(runs.map((r) => r.events.nemesis)) / N) },
      player: { kills: player((r) => r.final[0].kills), deaths: player((r) => r.final[0].deaths), items: player((r) => r.final[0].itemsCollected), place: player((r) => r.order.indexOf(0) + 1), wins: runs.filter((r) => r.winner === 0).length },
    }
  }

  return M
})()
