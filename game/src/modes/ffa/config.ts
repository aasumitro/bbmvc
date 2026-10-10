// Free for all tuning: every number the FFA rules, hot zones and bot errands
// read (the items' own: ../items/config.ts). Seconds are simulation time
// (fixed physics steps), so pause and frame rate never change them;
// distances are metres. "Elapsed" is match time since the start signal (0:00
// up to 10:00); the HUD clock shows what remains. work/ffa/FFA_BALANCING.md
// explains each value.

export const FFA = {
  grid: 8, // machines: the player and seven bots
  preMatch: 3, // countdown on the grid: no driving, firing or damage
  duration: 10 * 60, // the match clock
  finalMinute: 60, // remaining seconds that open the final minute
  finalPush: 30, // remaining seconds where the clock turns urgent
  finalCountdown: 10, // remaining seconds counted down on screen
  overtime: 60, // sudden death after a tie at the buzzer; nobody breaks it and it's a draw

  respawn: {
    // Wait, fixed by the share of the match clock gone at the moment of death
    // (3, 5 and 8 minutes of ten); a match's settings scale it (../matchSettings.ts).
    phases: [
      { share: 0.3, delay: 5 },
      { share: 0.5, delay: 10 },
      { share: 0.8, delay: 15 },
      { share: Infinity, delay: 20 },
    ],
    overtime: 5, // deaths in overtime; longer waits carried into overtime are cut to this from its start
  },
  protection: { duration: 2, reduction: 0.8 }, // after a respawn: incoming damage x (1 - reduction)

  // Spawn choice: see scoreSpawn() in rules.ts.
  spawn: {
    occupied: 8, // a live machine this close rules a start out
    nearCap: 120, // distance to the nearest rival stops adding safety past this
    averageCap: 160,
    averageWeight: 0.35,
    sightRange: 110, // rivals this close with a clear line to the start count as watching it...
    sightPenalty: 45, // ...each costing this much
    crowdRadius: 50,
    crowdPenalty: 25, // per rival inside crowdRadius
    recent: 15, // a start used this recently...
    recentPenalty: 60, // ...scores this much worse
    hotZonePenalty: 30, // starts inside the hot zone
    campWindow: 8, // dying this soon after spawning marks the start...
    campDeaths: 2, // ...this many marks within campMemory...
    campMemory: 60,
    cooldown: 30, // ...bench it for this long
  },

  assist: { window: 10, minDamage: 20 }, // a hit this recent, and this much damage on the victim's current life
  multiKill: { window: 7, titles: ['Double kill', 'Triple kill', 'Quad kill', 'Overkill'] }, // chains of 2, 3, 4, 5+
  streaks: [
    { kills: 3, title: 'Killing spree' },
    { kills: 5, title: 'Rampage' },
    { kills: 7, title: 'Unstoppable' },
    { kills: 10, title: 'Godlike' },
  ],
  shutdown: 3, // killing a machine on a streak this long is a shutdown
  nemesis: 3, // unanswered kills on you that make a rival your nemesis

  // Combat score: informational, never decides a placement above a kill.
  score: { kill: 100, assist: 50, damage: 0.5, multiKill: 25, streak: 25, revenge: 25, item: 10 }, // damage: per hull point dealt; multiKill: per extra kill in the chain

  hotZone: {
    first: 90, // elapsed
    duration: 2 * 60, // then the next zone takes over
    weight: 3, // item-spot weight inside the zone during waves
    bonusItems: 2, // extra wave items inside the zone
    drops: 1, // items dropped in the zone when it opens
    rarity: { common: 40, rare: 45, epic: 15 },
  },

  comeback: {
    gap: 4, // this many kills behind the leader counts as trailing
    radius: 70, // item spots this close to a trailing machine...
    weight: 1.75, // ...weigh this much more in waves
    zoneWeight: 0.5, // hot zone choice: added per trailing machine within 1.5 x radius
  },

  bots: {
    leaderBias: 15, // the sole leader counts as this much nearer when a bot picks a target
    trailingReach: 1.15, // trailing bots hunt and sense items this much further
    zoneInterest: 0.6, // share of bots that patrol the hot zone when idle (trailing bots always do)
    patrol: 10, // seconds before a patrolling bot moves on to the next spot in the zone...
    arrive: 8, // ...or once it's this close to the one it was heading for
  },
}

// What code outside this folder may know about free for all (../traits.ts).
export const FFA_TRAITS = {
  name: 'Free for all',
  teams: false,
  sizes: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  friendlyFire: false,
  classic: { size: FFA.grid, duration: FFA.duration, pickups: true },
}
