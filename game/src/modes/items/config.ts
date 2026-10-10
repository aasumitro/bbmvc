// Pickups tuning: every number the supply (supply.ts) reads, in whichever
// mode plugs it in — the waves, where items land, how long they last, what
// each does — and a bot's errand for one. Seconds are simulation time;
// "elapsed" is match time since the start signal; distances are metres.
// Free for all's values, as they were (work/ffa/FFA_BALANCING.md).

export const SUPPLY = {
  firstWave: 2 * 60, // elapsed
  waveInterval: 2 * 60,
  perWave: 6,
  maxActive: 16,
  ttl: [45, 60],
  pickupRadius: 3.5,
  senseRange: 75, // what the minimap shows the player, and all a bot knows about
  spacing: 30, // between items of one wave, when the map allows
  clearOfCars: 15, // no item appears this close to a live machine
  clearOfStarts: 25, // item spots stay this far from the starts
  clearance: 1.8, // item spots need this much room from anything solid
  rarity: { common: 70, rare: 25, epic: 5 },
  health: { amount: 40 },
  repair: { rate: 10, duration: 6 }, // hull per second
  speed: { factor: 1.3, duration: 8 }, // engine pull and top speed
  armor: { reduction: 0.35, duration: 12 },
  damage: { factor: 1.5, duration: 10 },
  ammo: { magazines: 1 }, // added, capped at a full magazine
  lowHealth: 0.4, // below this share of hull, a bot heads for health it knows about even mid-fight
}
