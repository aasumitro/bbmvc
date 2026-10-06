// Team deathmatch tuning: every number the TDM rules, spawn choice and team
// AI read. Seconds are simulation time (fixed physics steps), so pause and
// frame rate never change them; distances are metres; hull is 100 points.
// "Elapsed" is match time since GO (0:00 up to 10:00); the HUD clock shows
// what remains. work/tdm/TDM_BALANCING.md explains each value.

export const TEAMS = ['Blue', 'Red'] as const // team 0 is the player's

export const TDM = {
  teamSize: 4, // per team: the player and three bots against four bots
  preMatch: 3, // countdown: no driving, firing or damage; the clock waits
  duration: 10 * 60, // the match clock; no kill limit
  finalMinute: 60, // remaining seconds announced as the final minute
  finalPush: 30, // remaining seconds where the clock turns urgent
  finalCountdown: 10, // remaining seconds counted down on screen
  overtimeCap: 5 * 60, // safety bound, not a rule: overtime still tied after this ends as a draw

  respawn: {
    // Wait, fixed by the share of the match clock gone at the moment of death
    // (as free for all); a match's settings scale it.
    phases: [
      { share: 0.3, delay: 5 },
      { share: 0.5, delay: 10 },
      { share: 0.8, delay: 15 },
      { share: Infinity, delay: 20 },
    ],
    overtime: 5, // deaths in overtime; longer waits carried into overtime are cut to this from its start
  },
  protection: { duration: 2, reduction: 0.8 }, // after a respawn: incoming damage x (1 - reduction); ends at once when the machine fires

  // Spawn choice: see scoreSpawn() in rules.ts.
  spawn: {
    occupied: 8, // any machine this close rules a start out...
    ramRange: 30, // ...and so does an enemy this close (unless that rules out every start)
    nearCap: 90, // distance to the nearest enemy stops adding safety past this
    averageCap: 150,
    averageWeight: 0.3,
    sightRange: 120, // enemies this close with a clear line to the start count as watching it...
    sightPenalty: 45, // ...each costing this much
    crowdRadius: 50,
    crowdPenalty: 25, // per enemy inside crowdRadius
    pressureRadius: 40, // wrecks this close to a start...
    pressureMemory: 20, // ...in the last this many seconds...
    pressurePenalty: 35, // ...cost this much each: the fight is (or just was) there
    supportRadius: 60, // teammates this close to a start...
    supportBonus: 12, // ...add this much each...
    supportCap: 3, // ...counting at most this many
    sideWeight: 25, // own half +25 at the base, enemy half down to -25
    recent: 15, // a start used this recently...
    recentPenalty: 60, // ...scores this much worse
  },

  // Statistics: the free-for-all semantics and values (see ../scoring.ts).
  assist: { window: 10, minDamage: 20 }, // a hit this recent, and this much damage on the victim's current life
  multiKill: { window: 7, titles: ['Double kill', 'Triple kill', 'Quad kill', 'Overkill'] }, // chains of 2, 3, 4, 5+
  streaks: [
    { kills: 3, title: 'Killing spree' },
    { kills: 5, title: 'Rampage' },
    { kills: 7, title: 'Unstoppable' },
    { kills: 10, title: 'Godlike' },
  ],
  shutdown: 3, // killing a machine on a streak this long is a shutdown
  // Combat score: decides MVP, never the team result. Items only when a match turns pickups on.
  score: { kill: 100, assist: 50, damage: 0.5, multiKill: 25, streak: 25, revenge: 25, item: 10 }, // damage: per hull point dealt; multiKill: per extra kill in the chain

  // Team AI (tactics.ts). Biases are metres an enemy counts as nearer when a bot picks a target.
  bots: {
    threatWindow: 3, // a hit this recent means the teammate is under attack...
    supportRadius: 70, // ...and teammates this close are worth defending
    defendBias: 45, // an enemy attacking a nearby teammate
    lowHull: 0.35, // share of hull at or below which an enemy can be finished...
    finishBias: 30, // ...and counts this much nearer
    isolation: 35, // no teammate this close: isolated (enemies and bots alike)
    isolatedBias: 15, // an isolated enemy
    flankGroup: 2, // the target has this many teammates within flankRadius: flank it...
    flankRadius: 30,
    flankMin: 45, // ...while farther from it than this...
    flankOffset: 35, // ...driving for a point this far off its side
    comebackGap: 4, // this many kills behind switches on the comeback weighting:
    comeback: { defend: 1.25, isolated: 1.5, leaderBias: 20, flankGroup: 1 }, // defend and isolated biases x; the enemy top scorer counts nearer; flank smaller groups; isolated bots regroup
  },
}
