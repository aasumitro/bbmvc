// Team deathmatch balance probe (dev only; the game never imports this file).
// Paste into the console of the dev build (:3000) with a Team Deathmatch
// match open, then:
//
//   await tdmMetrics.setup()                    // once per match screen
//   tdmMetrics.autopilot('even')                // who drives the player (below)
//   tdmMetrics.play({ matches: 40, label: 'even' })
//   tdmMetrics.status                           // progress; a few seconds a match
//   tdmMetrics.analyze('even')                  // summary of the finished runs
//
// autopilot(mode) — the player seat always drives on the bots' brain:
//   'even'   the bots' gun, the brain's own aim: eight equal machines, so Blue
//            and Red should split the wins
//   'gun'    the garage Minigun, the brain's own aim (weapon data only)
//   'assist' the bots' gun, aimed through the camera and its lock-on assist
//            (aim assist only)
//   'human'  the garage Minigun and the lock-on assist: a strong player
//   null     no input at all: Blue plays 3 v 4 with a parked car
//
// It wraps the live rules' damage / kill / fired / respawned / tick and
// samples state every step; it plays whole matches through match.frame() at
// the fixed 60 Hz step, so the simulation is the game's own. The questions it
// answers are in TDM_BALANCE_REPORT.md. Relies on internals (window.match,
// match.mode.rules, match.mode.tactics, match.chase): best effort.
window.tdmMetrics = (() => {
  const M = { runs: [], R: null, auto: null, status: null, t: performance.now() + 1e7 }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
  const BIN = 5 // metres per bin of the nearest-teammate histogram
  const LATE = 8 * 60 // elapsed where the 20 s waits start
  const FINAL = 9 * 60 // elapsed where the final minute starts

  M.setup = async () => {
    M.ai = await import('/src/sim/ai/brain.ts')
    M.combat = await import('/src/sim/combat.ts')
    M.weapons = await import('/src/content/weapons/weapons.ts')
    M.cfg = (await import('/src/modes/tdm/config.ts')).TDM
    const m = window.match
    const { combatants: C, chase: view, arena } = m
    const tdm = m.mode.kind === 'tdm' ? m.mode.rules : null
    if (!tdm) return 'open a Team Deathmatch match first'
    if (tdm.__metrics) return 'ready'
    tdm.__metrics = true
    const centre = (list) => ({ x: list.reduce((s, p) => s + p.position.x, 0) / list.length, z: list.reduce((s, p) => s + p.position.z, 0) / list.length })
    M.homes = arena.bases.map(centre)
    M.starts = [...arena.bases[0], ...arena.bases[1], ...arena.spawns].map((s) => s.position) // as tdm/mode.ts lists them
    const orig = { damage: tdm.damage, kill: tdm.kill, fired: tdm.fired, respawned: tdm.respawned, tick: tdm.tick, update: view.update }

    // the player's aim: the brain's own ('even', 'gun'), or the camera pointed at it with the lock-on doing the rest ('assist', 'human')
    M.stash = m.player.control.aim.clone()
    const assisted = () => M.auto?.mode === 'assist' || M.auto?.mode === 'human'
    view.update = function (...args) {
      const p = window.match.player
      const aim = assisted() && p.alive ? p.control.aim.clone() : null
      if (M.auto && !assisted()) M.stash.copy(p.control.aim)
      const out = orig.update.apply(this, args)
      if (aim) view.forward.copy(aim).sub(window.camera.position).normalize()
      return out
    }
    // Every frame lays the player's aim from the camera; the unassisted
    // autopilots get the brain's own aim back after each one — the page's
    // own rAF frames included, which run between the probe's slices whenever
    // the window is visible.
    const frame = m.frame
    m.frame = (time) => {
      frame(time)
      if (M.auto && !assisted()) window.match.player.control.aim.copy(M.stash)
    }

    tdm.damage = (a, v, amount) => {
      const R = M.R, now = tdm.now
      const shielded = tdm.contenders[v].life === 'protected' && now < tdm.contenders[v].protectedUntil
      const byProtected = tdm.contenders[a].life === 'protected'
      const hp = C[v].health
      const dealt = orig.damage(a, v, amount)
      if (!R || dealt <= 0) return dealt
      R.dmg.total += dealt
      if (byProtected) R.dmg.byProtected += dealt
      if (shielded) {
        R.dmg.absorbed += Math.min(hp, amount) - dealt
        R.protectedHits++
      }
      // a teammate of the victim is under attack: open (or refresh) the threat for the support-response measure
      const key = `${v}:${a}`
      const open = R.threats.get(key)
      if (open) open.last = now
      else R.threats.set(key, { v, a, start: now, last: now, nearby: C.some((c) => c.id !== v && c.alive && c.team === C[v].team && c.brain && dist(c.position, C[v].position) <= M.cfg.bots.supportRadius) })
      for (const i of [a, v]) {
        const s = R.life[i]
        if (s && !s.engaged) {
          s.engaged = true
          R.toEngage.push(now - s.at)
        }
      }
      return dealt
    }

    tdm.kill = (v, k) => {
      const R = M.R, now = tdm.now, cv = tdm.contenders[v]
      const ctx = R && {
        now, t: tdm.elapsed(), phase: tdm.phase, v, k, team: C[v].team, life: now - cv.spawnedAt, respawned: cv.spawn >= 0,
        protected: cv.life === 'protected', isolated: isolated(v), behind: k >= 0 && tdm.deficit(C[k].team) >= M.cfg.bots.comebackGap,
        revengeAge: k >= 0 && R.lastKill[v][k] > R.lastKill[k][v] ? now - R.lastKill[v][k] : null,
      }
      const ok = orig.kill(v, k)
      if (R && ok) {
        ctx.wait = cv.life === 'pending' ? cv.respawnAt - tdm.now : null
        ctx.credited = k >= 0 && C[k].team !== C[v].team
        if (ctx.credited) R.lastKill[k][v] = now
        R.deaths.push(ctx)
        R.life[v] = null
      }
      return ok
    }

    tdm.fired = (i) => {
      if (M.R && tdm.contenders[i].life === 'protected') M.R.firedProtected++
      return orig.fired(i)
    }

    tdm.respawned = (i, start) => {
      const due = tdm.contenders[i].respawnAt
      const ok = orig.respawned(i, start)
      const R = M.R
      if (R && ok) {
        const at = M.starts[start], team = C[i].team
        let nearest = Infinity, mate = Infinity, watching = 0
        for (const c of C) {
          if (c.id === i || !c.alive) continue
          const d = dist(c.position, at)
          if (c.team === team) mate = Math.min(mate, d)
          else {
            nearest = Math.min(nearest, d)
            if (d <= M.cfg.spawn.sightRange) watching++
          }
        }
        R.spawns.push({ now: tdm.now, t: tdm.elapsed(), i, team, start, late: tdm.now - due, nearest, mate, watching, kind: kind(team, start), same: R.lastStart[i] === start, threatened: false })
        R.lastStart[i] = start
        R.life[i] = { at: tdm.now, engaged: false, spawn: R.spawns.at(-1) }
      }
      return ok
    }

    let sampleIn = 0
    tdm.tick = (dt) => {
      orig.tick(dt)
      const R = M.R
      if (!R) return
      if (tdm.phase === 'active' || tdm.phase === 'overtime') sample(R, dt, (sampleIn -= dt) <= 0 && (sampleIn = 0.25) > 0)
      drain(R)
    }
    return 'ready'
  }

  // Where a start sits for `team`: its own base, the enemy's, or perimeter on either half.
  function kind(team, start) {
    if (start < 8) return (start < 4) === (team === 0) ? 'ownBase' : 'enemyBase'
    const at = M.starts[start]
    return dist(at, M.homes[team]) < dist(at, M.homes[1 - team]) ? 'ownHalf' : 'enemyHalf'
  }

  function nearestMate(i) {
    const C = window.match.combatants
    let best = Infinity
    for (const c of C) if (c.id !== i && c.alive && c.team === C[i].team) best = Math.min(best, dist(c.position, C[i].position))
    return best
  }
  const isolated = (i) => nearestMate(i) > M.cfg.bots.isolation

  // Why a bot holds the target it holds, by the tactics' priorities.
  function reason(b, T) {
    const { combatants: C, mode: { rules: tdm } } = window.match
    const cfg = M.cfg.bots
    if (b.brain.attacker === T && b.brain.grudge > 0) return 'grudge'
    for (const mate of C) {
      if (mate === b || !mate.alive || mate.team !== b.team) continue
      if (tdm.now - tdm.contenders[mate.id].hitAt[T.id] <= cfg.threatWindow && dist(mate.position, b.position) <= cfg.supportRadius) return 'defend'
    }
    if (T.health <= T.maxHealth * cfg.lowHull) return 'finish'
    if (isolated(T.id)) return 'isolated'
    return 'nearest'
  }

  // Per step: alive / dead / isolated / idle time, time behind, dead time in
  // the final minute, enemies reaching a fresh spawn; every 0.25 s: targets
  // and why, stances, spacing, focus, abandoned fights, support responses.
  function sample(R, dt, slow) {
    const { combatants: C, others: bots, mode: { rules: tdm, tactics } } = window.match
    const now = tdm.now, t = tdm.elapsed()
    for (const c of C) {
      if (!c.alive) {
        R.dead[c.id] += dt
        if (tdm.phase === 'active' && t >= FINAL) R.finalDead[c.id] += dt
        continue
      }
      R.alive[c.id] += dt
      if (isolated(c.id)) R.iso[c.id] += dt
      if (c.brain && !c.brain.target && Math.abs(c.speed) < 2) R.idle += dt
      const life = R.life[c.id]
      if (life && !life.spawn.threatened && now - life.at <= M.cfg.protection.duration) {
        for (const e of C) if (e.alive && e.team !== c.team && dist(e.position, c.position) < M.cfg.spawn.ramRange) life.spawn.threatened = true
      }
    }
    for (const team of [0, 1]) {
      const behind = tdm.deficit(team)
      if (behind >= M.cfg.bots.comebackGap) R.behind[team] += dt
      R.worst[team] = Math.max(R.worst[team], behind)
    }
    if (!slow) return
    for (const c of C) {
      if (!c.alive) continue
      const d = nearestMate(c.id)
      if (d < Infinity) R.mates[c.team][Math.min(Math.floor(d / BIN), R.mates[c.team].length - 1)]++
    }
    for (const team of [0, 1]) {
      const members = C.filter((c) => c.alive && c.team === team)
      R.teamSamples++
      if (members.some((c) => members.filter((o) => o !== c && dist(o.position, c.position) <= 12).length >= 2)) R.stacked++
      const counts = new Map()
      for (const b of bots) if (b.alive && b.team === team && b.brain?.target) counts.set(b.brain.target, (counts.get(b.brain.target) ?? 0) + 1)
      if (Math.max(0, ...counts.values()) >= 3) R.focused++
    }
    for (const b of bots) {
      if (!b.alive || !b.brain) {
        R.prev[b.id] = null
        continue
      }
      const T = b.brain.target
      const prev = R.prev[b.id]
      if (prev && prev.target !== T) {
        R.switches++
        if (prev.target.alive && prev.visible && prev.d < 38 && prev.target.health < prev.target.maxHealth / 2) {
          R.abandoned++
          if (T) R.abandonFor[reason(b, T)] = (R.abandonFor[reason(b, T)] ?? 0) + 1
        }
      }
      R.prev[b.id] = T ? { target: T, visible: b.brain.canSee, d: dist(T.position, b.position) } : null
      R.stances[tactics.stance(b.id, T ? T.id : -1)]++
      if (!T) {
        R.targets.none++
        continue
      }
      if (T.team === b.team) R.targets.teammate++
      if (tdm.contenders[T.id].life === 'protected') R.targets.protected++
      R.targets[reason(b, T)]++
    }
    for (const [key, th] of R.threats) {
      const victim = C[th.v], enemy = C[th.a]
      const helper = C.find((c) => c.id !== th.v && c.alive && c.team === victim.team && c.brain?.target === enemy)
      if (helper) {
        R.support.push({ time: now - th.start, nearby: th.nearby })
        R.threats.delete(key)
      } else if (!victim.alive || !enemy.alive || now - th.last > 5) {
        R.support.push({ time: null, nearby: th.nearby })
        R.threats.delete(key)
      }
    }
  }

  function drain(R) {
    const { rules: tdm } = window.match.mode
    for (const e of tdm.events) {
      if (e.__metrics) continue
      e.__metrics = true
      if (e.type === 'kill') {
        if (e.milestone) R.feedback.milestones[e.milestone] = (R.feedback.milestones[e.milestone] ?? 0) + 1
        if (e.multi >= 2) R.feedback.multi[e.multi] = (R.feedback.multi[e.multi] ?? 0) + 1
        R.feedback.revenge += +e.revenge
        R.feedback.shutdown += +!!e.shutdown
        R.feedback.assists += e.assists.length
        R.feedback.kills++
        R.feedback.tagged += +!!(e.revenge || e.multi >= 2 || e.milestone || e.shutdown)
      } else if (e.type === 'phase' && e.phase === 'overtime') R.overtimeAt = tdm.now
    }
  }

  M.autopilot = (mode) => {
    const m = window.match, p = m.player
    M.auto = mode ? { mode } : null
    p.brain = mode ? M.ai.createBrain(p.seed) : undefined // the simulation thinks for any machine with a brain
    const garage = mode === 'gun' || mode === 'human'
    p.weapon = M.combat.armWeapon(garage ? M.weapons.WEAPONS.minigun : m.others[0].weapon.spec)
  }

  function newRun(label) {
    const n = window.match.combatants.length
    const zeros = () => new Array(n).fill(0)
    M.R = {
      label, auto: M.auto?.mode ?? 'idle', deaths: [], spawns: [], alive: zeros(), dead: zeros(), iso: zeros(), finalDead: zeros(), behind: [0, 0], worst: [0, 0],
      mates: [new Array(60).fill(0), new Array(60).fill(0)], stances: { attack: 0, support: 0, flank: 0, defend: 0 },
      targets: { none: 0, grudge: 0, defend: 0, finish: 0, isolated: 0, nearest: 0, teammate: 0, protected: 0 },
      dmg: { total: 0, byProtected: 0, absorbed: 0 }, protectedHits: 0, firedProtected: 0, overtimeAt: null, idle: 0,
      threats: new Map(), support: [], prev: {}, switches: 0, abandoned: 0, abandonFor: {}, stacked: 0, focused: 0, teamSamples: 0,
      life: {}, toEngage: [], lastStart: {}, lastKill: Array.from({ length: n }, () => new Array(n).fill(-Infinity)),
      feedback: { milestones: {}, multi: {}, revenge: 0, shutdown: 0, assists: 0, kills: 0, tagged: 0 },
    }
    M.runs.push(M.R)
  }

  function finish() {
    const { combatants: C, mode: { rules: tdm } } = window.match
    drain(M.R)
    Object.assign(M.R, { final: C.map((c) => ({ team: c.team, ...c.stats })), score: [...tdm.score], winner: tdm.winner, draw: tdm.draw, mvp: tdm.mvp, end: tdm.now })
    delete M.R.threats
    delete M.R.prev
    delete M.R.life
  }

  // Plays `matches` whole matches in slices, yielding to the page between them.
  M.play = ({ matches = 1, label = 'run', slice = 20 } = {}) => {
    const ch = new MessageChannel()
    let left = matches
    M.status = { done: 0, matches, running: true }
    const begin = () => {
      window.match.restart()
      if (M.auto) M.autopilot(M.auto.mode)
      newRun(label)
    }
    begin()
    ch.port1.onmessage = () => {
      const m = window.match
      for (let k = 0; k < slice * 10 && m.phase !== 'victory' && m.phase !== 'defeat'; k++) m.frame((M.t += 100))
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
    const cfg = M.cfg
    const sum = (a) => a.reduce((s, x) => s + x, 0)
    const avg = (a) => (a.length ? sum(a) / a.length : NaN)
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN)
    const r1 = (x) => Math.round(x * 10) / 10
    const pct = (x) => `${Math.round(x * 1000) / 10}%`
    const share = (o) => { const total = sum(Object.values(o)); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pct(v / total)])) }
    const merge = (key) => runs.reduce((acc, r) => { for (const k in r[key]) acc[k] = (acc[k] ?? 0) + r[key][k]; return acc }, {})
    const deaths = runs.flatMap((r) => r.deaths)
    const kills = deaths.filter((d) => d.credited)
    const spawns = runs.flatMap((r) => r.spawns)
    const aliveSec = sum(runs.flatMap((r) => r.alive))
    const ot = runs.filter((r) => r.overtimeAt != null)
    const n = runs[0].final.length
    const schedule = (d) => (d.phase === 'overtime' ? cfg.respawn.overtime : cfg.respawn.phases.find((p) => d.t < p.share * cfg.duration).delay) // shares of the clock (Classic's length)
    const seat = (f) => runs[0].final.map((_, i) => r1(avg(runs.map((r) => f(r.final[i])))))

    // who scored, who helped, who was MVP and why
    const sorted = runs.map((r) => r.final.map((s) => s.kills).sort((a, b) => b - a))
    const teamTop = runs.flatMap((r) => [0, 1].map((team) => { const ks = r.final.filter((s) => s.team === team).map((s) => s.kills); return Math.max(...ks) / Math.max(1, sum(ks)) }))
    const mvp = runs.map((r) => {
      const m = r.final[r.mvp]
      const top = (key) => Math.max(...r.final.map((s) => s[key]))
      return { winner: !r.draw && m.team === r.winner, topKiller: m.kills === top('kills'), topDamage: m.damageDealt === top('damageDealt'), topAssists: m.assists === top('assists'), rank: 1 + r.final.filter((s) => s.kills > m.kills).length, seat: r.mvp, margin: m.combatScore - [...r.final].map((s) => s.combatScore).sort((a, b) => b - a)[1] }
    })

    // respawn and the late game
    const phases = [[0, 180, '0-3'], [180, 300, '3-5'], [300, 480, '5-8'], [480, 600, '8-10']]
    const byPhase = Object.fromEntries(phases.map(([a, b, name]) => {
      const ds = deaths.filter((d) => d.phase !== 'overtime' && d.t >= a && d.t < b)
      return [name, { killsPerMin: r1(ds.filter((d) => d.credited).length / ((N * (b - a)) / 60)), avgLife: r1(avg(ds.map((d) => d.life))), downtime: pct(sum(ds.map((d) => d.wait ?? 0)) / (N * (b - a) * n)) }]
    }))
    const late = deaths.filter((d) => d.phase === 'active' && d.t >= LATE)
    const waits = deaths.filter((d) => d.wait != null)
    const lateRespawns = spawns.filter((s) => s.t >= LATE)
    const reDied = sum(runs.map((r) => r.spawns.filter((s) => s.t >= LATE && r.deaths.some((d) => d.v === s.i && d.now > s.now && d.now - s.now <= 30)).length))
    let answered = 0, lateCredited = 0
    for (const r of runs) {
      const credited = r.deaths.filter((d) => d.credited)
      for (let k = 0; k < credited.length - 1; k++) {
        if (credited[k].phase !== 'active' || credited[k].t < LATE) continue
        lateCredited++
        if (1 - credited[k + 1].team !== 1 - credited[k].team) answered++ // the next kill went to the team that just lost a machine
      }
    }
    const finalDead = runs.flatMap((r) => r.finalDead)
    let alternation = 0
    for (const r of runs) {
      const seq = [...r.deaths.map((d) => [d.now, d.v, 'd']), ...r.spawns.map((s) => [s.now, s.i, 's'])].sort((a, b) => a[0] - b[0])
      const last = new Map()
      for (const [, who, k] of seq) {
        if ((last.get(who) ?? 's') === k) alternation++
        last.set(who, k)
      }
    }

    // spawns
    const quick = (s) => deaths.filter((d) => d.respawned && d.life <= s).length
    let backToBack = 0
    for (const r of runs) {
      const byMachine = new Map()
      for (const d of r.deaths) if (d.respawned) byMachine.set(d.v, [...(byMachine.get(d.v) ?? []), d.life])
      for (const lives of byMachine.values()) for (let k = 1; k < lives.length; k++) if (lives[k] <= 8 && lives[k - 1] <= 8) backToBack++
    }
    const startUse = (team) => { const counts = {}; for (const s of spawns) if (s.team === team) counts[s.start] = (counts[s.start] ?? 0) + 1; const v = Object.values(counts); return { used: v.length, top: pct(Math.max(...v) / sum(v)) } }
    const toEngage = runs.flatMap((r) => r.toEngage)

    // team play
    const mates = [0, 1].map((team) => runs.reduce((acc, r) => acc.map((x, i) => x + r.mates[team][i]), new Array(60).fill(0)))
    const binMedian = (h) => { const total = sum(h); let run = 0; for (let i = 0; i < h.length; i++) if ((run += h[i]) >= total / 2) return (i + 0.5) * BIN; return NaN }
    const teamAlive = (team) => sum(runs.flatMap((r) => r.alive.filter((_, i) => r.final[i].team === team)))
    const teamIso = (team) => sum(runs.flatMap((r) => r.iso.filter((_, i) => r.final[i].team === team)))
    const support = runs.flatMap((r) => r.support)
    const helped = support.filter((s) => s.time != null)
    const behindTime = sum(runs.flatMap((r) => r.behind))
    const killRate = kills.length / aliveSec
    const { teammate, protected: onProtected, none, ...reasons } = merge('targets')
    const playerDeaths = deaths.filter((d) => d.v === 0)
    const revenges = deaths.filter((d) => d.credited && d.revengeAge != null)

    return {
      matches: N,
      match: {
        length: r1(avg(runs.map((r) => r.end - cfg.preMatch))), overtime: `${ot.length}/${N}`, overtimeAvg: r1(avg(ot.map((r) => r.end - r.overtimeAt))), overtimeMax: r1(Math.max(0, ...ot.map((r) => r.end - r.overtimeAt))), draws: runs.filter((r) => r.draw).length,
        blueWins: runs.filter((r) => r.winner === 0).length, redWins: runs.filter((r) => r.winner === 1).length,
        teamKills: r1(avg(runs.flatMap((r) => r.score))), winnerKills: r1(avg(runs.filter((r) => !r.draw).map((r) => r.score[r.winner]))), loserKills: r1(avg(runs.filter((r) => !r.draw).map((r) => r.score[1 - r.winner]))), margin: r1(avg(runs.map((r) => Math.abs(r.score[0] - r.score[1])))),
        killsPerMatch: r1(kills.length / N), scoreIsKills: runs.every((r) => [0, 1].every((t) => r.score[t] === sum(r.final.filter((s) => s.team === t).map((s) => s.kills)))),
      },
      players: {
        killsBySlot: sorted[0].map((_, k) => r1(avg(sorted.map((s) => s[k])))), topShareOfTeamKills: pct(avg(teamTop)),
        killsPerSeat: seat((s) => s.kills), deathsPerSeat: seat((s) => s.deaths), assistsPerSeat: seat((s) => s.assists), scorePerSeat: seat((s) => s.combatScore).map(Math.round),
        assistsPerKill: r1(sum(runs.map((r) => r.feedback.assists)) / kills.length),
      },
      mvp: { onWinningTeam: pct(avg(mvp.map((x) => +x.winner))), topKiller: pct(avg(mvp.map((x) => +x.topKiller))), topDamage: pct(avg(mvp.map((x) => +x.topDamage))), topAssists: pct(avg(mvp.map((x) => +x.topAssists))), noneOfThose: mvp.filter((x) => !x.topKiller && !x.topDamage && !x.topAssists).length, avgKillRank: r1(avg(mvp.map((x) => x.rank))), playerSeat: mvp.filter((x) => x.seat === 0).length, avgMargin: Math.round(avg(mvp.map((x) => x.margin))) },
      respawn: {
        waitMismatches: deaths.filter((d) => d.wait != null && Math.abs(d.wait - schedule(d)) > 1e-6).length, alternationErrors: alternation, maxLate: `${r1(Math.max(0, ...spawns.map((s) => s.late)) * 1000)} ms`, byPhase,
        waitsOver10: pct(waits.filter((d) => d.wait > 10).length / waits.length), waitsOver15: pct(waits.filter((d) => d.wait > 15).length / waits.length),
      },
      late: {
        deathsPerMatch: r1(late.length / N), perMachine: r1(late.length / N / n), remainingAtDeath: r1(avg(late.map((d) => 600 - d.t))), backAfterBuzzer: pct(late.filter((d) => d.t + (d.wait ?? 0) >= 600).length / Math.max(1, late.length)),
        diedAgainWithin30s: pct(reDied / Math.max(1, lateRespawns.length)), nextKillToTheTeamThatLost: pct(answered / Math.max(1, lateCredited)),
        finalMinuteDeadOver20s: pct(finalDead.filter((x) => x > 20).length / finalDead.length), finalMinuteDeadOver30s: pct(finalDead.filter((x) => x > 30).length / finalDead.length), finalMinuteDeadMax: r1(Math.max(...finalDead)), playerFinalMinuteDead: r1(avg(runs.map((r) => r.finalDead[0]))),
      },
      spawns: {
        count: spawns.length, nearestMedian: r1(med(spawns.map((s) => s.nearest))), under30: pct(spawns.filter((s) => s.nearest < 30).length / spawns.length), under50: pct(spawns.filter((s) => s.nearest < 50).length / spawns.length), over150: pct(spawns.filter((s) => s.nearest > 150).length / spawns.length),
        mateMedian: r1(med(spawns.map((s) => s.mate).filter((d) => d < Infinity))), enemiesWithin120: r1(avg(spawns.map((s) => s.watching))), kinds: share(spawns.reduce((o, s) => ((o[s.kind] = (o[s.kind] ?? 0) + 1), o), {})),
        sameStartAsLastTime: pct(spawns.filter((s) => s.same).length / spawns.length), startsUsed: [startUse(0), startUse(1)], toFirstEngagementMedian: r1(med(toEngage)),
        diedWithin5s: pct(quick(5) / spawns.length), diedWithin8s: pct(quick(8) / spawns.length), backToBack, killedWhileProtected: deaths.filter((d) => d.protected).length,
        enemyWithin30mWhileProtected: spawns.filter((s) => s.threatened).length, hitsWhileProtected: sum(runs.map((r) => r.protectedHits)), absorbedPerMatch: r1(sum(runs.map((r) => r.dmg.absorbed)) / N), dealtWhileProtected: r1(sum(runs.map((r) => r.dmg.byProtected))), protectionEndedByFiringPerMatch: r1(sum(runs.map((r) => r.firedProtected)) / N),
      },
      bots: {
        targets: share(reasons), noTarget: pct(none / (none + sum(Object.values(reasons)))), idleShare: pct(sum(runs.map((r) => r.idle)) / aliveSec), teammateTargets: teammate, protectedTargets: onProtected, stances: share(merge('stances')),
        supportResponded: pct(helped.length / Math.max(1, support.length)), supportRespondedNearby: pct(helped.filter((s) => s.nearby).length / Math.max(1, support.filter((s) => s.nearby).length)), supportMedianSec: r1(med(helped.map((s) => s.time))), supportAlreadyEngaged: pct(helped.filter((s) => s.time < 0.3).length / Math.max(1, helped.length)),
        switches: sum(runs.map((r) => r.switches)), abandonedFights: pct(sum(runs.map((r) => r.abandoned)) / Math.max(1, sum(runs.map((r) => r.switches)))), abandonedFor: merge('abandonFor'),
        stackedOf3Within12m: pct(sum(runs.map((r) => r.stacked)) / sum(runs.map((r) => r.teamSamples))), focusOf3OnOne: pct(sum(runs.map((r) => r.focused)) / sum(runs.map((r) => r.teamSamples))),
      },
      clustering: {
        nearestTeammateMedian: [0, 1].map((t) => r1(binMedian(mates[t]))), isolatedShare: [0, 1].map((t) => pct(teamIso(t) / teamAlive(t))),
        playerIsolated: pct(sum(runs.map((r) => r.iso[0])) / sum(runs.map((r) => r.alive[0]))), playerDeathsIsolated: pct(playerDeaths.filter((d) => d.isolated).length / Math.max(1, playerDeaths.length)), deathsIsolated: pct(deaths.filter((d) => d.isolated).length / deaths.length),
      },
      comeback: {
        behindShare: pct(behindTime / sum(runs.map((r) => 2 * (r.end - cfg.preMatch)))), killRateBehind: r1(kills.filter((d) => d.behind).length / (behindTime * cfg.teamSize) / killRate),
        wentBehind: runs.filter((r) => Math.max(...r.worst) >= cfg.bots.comebackGap).length, recovered: runs.filter((r) => !r.draw && r.worst[r.winner] >= cfg.bots.comebackGap).length,
      },
      feedback: {
        milestonesPerMatch: Object.fromEntries(Object.entries(runs.reduce((o, r) => { for (const k in r.feedback.milestones) o[k] = (o[k] ?? 0) + r.feedback.milestones[k]; return o }, {})).map(([k, v]) => [k, r1(v / N)])), revengeShare: pct(sum(runs.map((r) => r.feedback.revenge)) / kills.length), shutdownsPerMatch: r1(sum(runs.map((r) => r.feedback.shutdown)) / N),
        taggedShare: pct(sum(runs.map((r) => r.feedback.tagged)) / sum(runs.map((r) => r.feedback.kills))), revengeAgeMedian: r1(med(revenges.map((d) => d.revengeAge))), revengeWithin60s: pct(revenges.filter((d) => d.revengeAge <= 60).length / Math.max(1, revenges.length)),
        revengeScoreShare: pct((revenges.length * cfg.score.revenge) / sum(runs.flatMap((r) => r.final.map((s) => s.combatScore)))),
      },
      player: { kills: r1(avg(runs.map((r) => r.final[0].kills))), deaths: r1(avg(runs.map((r) => r.final[0].deaths))), assists: r1(avg(runs.map((r) => r.final[0].assists))), score: Math.round(avg(runs.map((r) => r.final[0].combatScore))), blueWinRate: pct(runs.filter((r) => r.winner === 0).length / N) },
    }
  }

  return M
})()
