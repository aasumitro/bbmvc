// Combat statistics shared by the scored modes (free for all, team
// deathmatch): per-life damage attribution, assists, kill streaks,
// multi-kills, revenge (and nemesis, where the mode has one) and the combat
// score. Pure, like the mode rules that own it: they decide whether a hit or
// a kill counts at all, this records what it earns, with numbers from the
// mode's config. (Imports carry .ts: the self-checks run under plain node.)

export interface Stats {
  kills: number
  deaths: number
  assists: number
  damageDealt: number // hull actually removed
  damageTaken: number
  combatScore: number
  streak: number // kills since the last death
  bestStreak: number
  multiKills: number // chains of two or more kills inside the window
  revengeKills: number
  nemesisDeaths: number // deaths to a rival who is (or just became) your nemesis
  itemsCollected: number
  teamKills: number // teammates wrecked (friendly fire on): shown, never scored
}

export const createStats = (): Stats => ({ kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0, combatScore: 0, streak: 0, bestStreak: 0, multiKills: 0, revengeKills: 0, nemesisDeaths: 0, itemsCollected: 0, teamKills: 0 })

// A machine's current life as the statistics see it: the damage it has taken
// from each rival, and its own kill chain. The modes keep one per machine.
export interface Tally {
  hitDamage: number[] // this life's damage from each rival...
  hitAt: number[] // ...and the time of its latest hit
  chain: number // kills in the current multi-kill chain
  chainUntil: number
}

export const createTally = (n: number): Tally => ({ hitDamage: new Array<number>(n).fill(0), hitAt: new Array<number>(n).fill(-Infinity), chain: 0, chainUntil: -Infinity })

// A new life (or the end of the match): nobody has hit it.
export function forget(t: Tally) {
  t.hitDamage.fill(0)
  t.hitAt.fill(-Infinity)
}

// The numbers the statistics read; each mode's config has these keys.
export interface ScoreRules {
  assist: { window: number; minDamage: number } // a hit this recent, and this much damage on the victim's current life
  multiKill: { window: number }
  streaks: ReadonlyArray<{ kills: number; title: string }>
  shutdown: number // ending a streak this long is a shutdown
  nemesis?: number // unanswered kills that make a rival your nemesis; no nemesis without it
  score: { kill: number; assist: number; damage: number; multiKill: number; streak: number; revenge: number } // damage: per hull point; multiKill: per extra kill in the chain
}

// What one kill earned.
export interface Credit {
  killer: number
  victim: number
  assists: number[]
  streak: number // the killer's, after this kill
  milestone: string // streak title reached with this kill, '' for none
  multi: number // kills in the killer's chain, this one included
  revenge: boolean
  nemesis: boolean // the victim was the killer's nemesis
  shutdown: number // the victim's streak this kill ended (0: none)
}

// 1 → '', 2 → titles[0] ... anything past the list → its last title.
export const chainTitle = (chain: number, titles: readonly string[]) => (chain < 2 ? '' : titles[Math.min(chain, titles.length + 1) - 2])

export function createScoring(people: readonly { stats: Stats }[], tallies: readonly Tally[], rules: ScoreRules) {
  const n = people.length
  // [k][v]: kills k made on v since v last killed k. Kept in place for the
  // life of the match (reset() zeroes it), so a mode's rules can show it.
  const feuds = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  // `dealt` hull, modifiers already applied, went from attacker to victim. A
  // teammate's (friendly fire) is the victim's damage taken, never the
  // shooter's damage, score or a share in an assist.
  function hit(attacker: number, victim: number, dealt: number, now: number, teammate = false) {
    people[victim].stats.damageTaken += dealt
    if (attacker === victim || teammate) return
    const a = people[attacker].stats
    a.damageDealt += dealt
    a.combatScore += dealt * rules.score.damage
    tallies[victim].hitDamage[attacker] += dealt
    tallies[victim].hitAt[attacker] = now
  }

  // The victim is wrecked: one more death, its streak and chain over.
  // Returns the streak it ended.
  function death(victim: number) {
    const v = people[victim].stats
    const ended = v.streak
    v.deaths++
    v.streak = 0
    tallies[victim].chain = 0
    tallies[victim].chainUntil = -Infinity
    return ended
  }

  // Kill, streak, multi-kill, revenge, nemesis and assists for one kill the
  // mode has decided to credit. `ended`: what death() returned.
  function credit(killer: number, victim: number, ended: number, now: number): Credit {
    const k = people[killer].stats
    const kc = tallies[killer]
    const points = rules.score
    k.kills++
    k.streak++
    k.bestStreak = Math.max(k.bestStreak, k.streak)
    k.combatScore += points.kill
    kc.chain = now <= kc.chainUntil ? kc.chain + 1 : 1
    kc.chainUntil = now + rules.multiKill.window
    if (kc.chain === 2) k.multiKills++
    if (kc.chain >= 2) k.combatScore += points.multiKill * (kc.chain - 1)
    const milestone = rules.streaks.find((m) => m.kills === k.streak)?.title ?? ''
    if (milestone) k.combatScore += points.streak
    const owed = feuds[victim][killer]
    if (owed > 0) {
      k.revengeKills++
      k.combatScore += points.revenge
    }
    feuds[victim][killer] = 0
    const against = ++feuds[killer][victim]
    if (rules.nemesis !== undefined && against >= rules.nemesis) people[victim].stats.nemesisDeaths++
    const assists: number[] = []
    const hit = tallies[victim]
    for (let a = 0; a < n; a++) {
      if (a === killer || a === victim || hit.hitDamage[a] < rules.assist.minDamage || now - hit.hitAt[a] > rules.assist.window) continue
      people[a].stats.assists++
      people[a].stats.combatScore += points.assist
      assists.push(a)
    }
    return { killer, victim, assists, streak: k.streak, milestone, multi: kc.chain, revenge: owed > 0, nemesis: rules.nemesis !== undefined && owed >= rules.nemesis, shutdown: ended >= rules.shutdown ? ended : 0 }
  }

  // Kills `killer` has made on `victim` since the victim last killed it.
  const against = (killer: number, victim: number) => feuds[killer][victim]

  // The rival with the most unanswered kills on `victim`, once that reaches
  // the nemesis threshold; -1 for none (always, for a mode without nemeses).
  function nemesisOf(victim: number) {
    if (rules.nemesis === undefined) return -1
    let nemesis = -1
    let most = rules.nemesis - 1
    for (let k = 0; k < n; k++) {
      if (feuds[k][victim] > most) {
        most = feuds[k][victim]
        nemesis = k
      }
    }
    return nemesis
  }

  // Relationships start over (statistics and tallies are the mode's to reset).
  function reset() {
    for (const row of feuds) row.fill(0)
  }

  return { hit, death, credit, against, nemesisOf, reset, feuds }
}
