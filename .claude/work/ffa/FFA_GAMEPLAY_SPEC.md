# Free For All — gameplay spec

The implementation contract for FFA. Rules: `src/game/ffa/rules.ts`, with
the pickups every mode shares in `src/game/items/` (`items.ts`,
`supply.ts`); numbers: `FFA` in `src/game/ffa/config.ts`, the items' in
`SUPPLY` (`src/game/items/config.ts`) (FFA_BALANCING.md).

**Time.** *Elapsed* = match time since the start signal (0:00 → 10:00). The HUD
clock shows *remaining* (10:00 → 0:00). Every timer runs on the simulation
clock (fixed 60 Hz steps): pause stops it, frame rate never changes it.

## Match start

- Eight machines: the player and Rustjaw, Widowmaker, Grinder, Hexbolt,
  Carrion, Buzzkill, Tetanus, on the arena's perimeter-road starts.
- **Pre-match**: 3 s countdown ("3 · 2 · 1", then "GO"). Everyone is held on
  the grid: no driving, no firing, no damage (the player can look around).
  The clock reads 10:00.

## Clock

- Counts 10:00 down to 00:00, shown rounded up (00:00 appears at expiry).
- **Final minute** at 01:00 remaining: banner "FINAL MINUTE", clock red.
- 00:30: the clock pulses. 00:10: countdown digits and a tick each second.

## Kills and deaths

- A machine is destroyed when its hull reaches 0. The owner of the hit that
  took it to 0 is the killer: `killer.kills + 1`, `victim.deaths + 1`.
- The combat model has no self or environmental damage. A death nobody can be
  credited for (self, environment, killer already destroyed) counts the death
  only.
- Damage needs a live attacker: rounds and rockets from a machine already
  destroyed do no damage (no posthumous kills).
- One death per life; kill handling is idempotent.
- No damage during pre-match or after the match completes.

## Respawn

- The wait is fixed at the moment of death by elapsed time:
  0:00–3:00 → 5 s, 3:00–5:00 → 10 s, 5:00–8:00 → 15 s, 8:00–10:00 → 20 s.
  A death at 2:59 waits 5 s even though it respawns after 3:00.
- Deaths in overtime wait 5 s. A wait carried from before the buzzer into
  overtime is cut to end at most 5 s after overtime starts (the only case where
  a scheduled respawn changes, and only sooner).
- Everyone, the player included, is back in the moment the wait ends.
- The player's death screen is the scoreboard (see Leaderboard), headed
  "Destroyed · Wrecked by X" and "Back in N", no buttons. The match goes on,
  the mouse stays captured, and Esc pauses (Exit to garage is in the pause
  menu).
- A completed match cancels pending respawns.

## Spawn selection

Every start is scored; the highest wins (ties: lowest index).

- Out: a live machine within 8 m (occupied); a start benched for spawn camping.
  If that rules out every start, the filter is dropped.
- `score = min(nearest rival, 120) + 0.35 × min(average rival distance, 160)
  − 45 × rivals within 110 m with a clear line to the start
  − 25 × rivals within 50 m
  − 60 if the start was used in the last 15 s
  − 30 if the start is inside the hot zone`
- Every start (City and Scrapyard) is on the perimeter road, so road access holds by construction.

## Spawn protection

- 2 s after respawning: incoming damage × 0.2. Firing does not end it.
- It doesn't stack with Armor: the stronger reduction applies.
- Bots don't pick protected rivals as targets. The HUD shows a SHIELD chip for
  the player and dims markers over protected rivals.

## Spawn camping

A death within 8 s of spawning marks that start; 2 marks within 60 s bench it
for 30 s.

## Damage contribution and assists

- Each victim keeps, for its current life, each rival's damage total and the
  time of its last hit. Cleared on respawn (and on death, after the kill is
  scored).
- `damageDealt` / `damageTaken` count hull actually removed (after modifiers,
  capped at the hull left).
- **Assist**: every rival other than the killer with at least 20 damage on the
  victim's current life and a hit within the 10 s before the kill.

## Combat score (informational)

kill +100 · assist +50 · 0.5 per hull point dealt · multi-kill +25 per extra
kill in the chain · streak milestone +25 · revenge +25 · item +10.
It orders ties below first place; it never decides the winner.

## Kill streak

Kills since the last death. Milestones, announced once each: 3 Killing spree,
5 Rampage, 7 Unstoppable, 10 Godlike. Death resets the streak. Killing a
machine on a streak of 3+ earns a "Shutdown" feed tag.

## Multi-kill

A kill within 7 s of your previous kill extends the chain: 2 Double kill,
3 Triple kill, 4 Quad kill, 5+ Overkill. The chain resets when the window
lapses or you die. Streaks and multi-kills are separate.

## Revenge and nemesis

`unanswered[k][v]` = kills k made on v since v last killed k.

- **Revenge**: k kills v while `unanswered[v][k] > 0`; `unanswered[v][k]` resets.
- **Nemesis**: v's nemesis is the rival with the most unanswered kills on v,
  once that reaches 3 ("RUSTJAW IS YOUR NEMESIS"). `nemesisDeaths` counts
  deaths to your nemesis. Killing your nemesis is a revenge kill and ends it.
- Feedback and +25 score only; no combat bonus.

## Leaderboard

Kills descending; ties by combat score descending, then deaths ascending, then
grid order (display only). Updated the step a kill lands. Player status:
`YOU LEAD +n` / `TIED FOR THE LEAD` / `RUSTJAW +n`.

**Scoreboard** (hold Tab, while playing or down; every mode — and in free for
all on its own while the player waits to respawn): place, machine,
kills, deaths; free for all adds assists, current streak, damage dealt and
combat score, a crown on the sole leader and a tag on your nemesis. Wrecks are
dimmed. Team deathmatch lists your crew, then the enemy's, each ranked.
Holding Tab never moves focus out of the page (which would pause the game).

## Comeback

*Trailing*: leader's kills − yours ≥ 4. The leader is never trailing.

- Item spots within 70 m of a trailing machine weigh × 1.75 in waves.
- Hot zone choice: + 0.5 weight per trailing machine within 105 m of a zone.
- Trailing bots hunt and sense items 15 % further and always patrol the hot zone.

No damage, hull or score boosts; winner rules untouched; never guaranteed.

## Hot zone

- Named areas from the arena (City: Downtown, Gas Station, Parking Lot, The
  Park, Glass Tower, The Ruin, Warehouse, Courtyard, Building Site, Panel
  Blocks, Bus Depot; Scrapyard: The Crest, Crane Yard, The Stacks, Tank Farm,
  Tyre Fire, Crash Site, Bus Graveyard, Scrap Mountain, The Crusher).
- First at 1:30 elapsed; each lasts 2:00, then the next takes over (never the
  same twice running). Chosen by seeded weighted random (comeback tilt).
- Shown in the HUD ("HOT ZONE · DOWNTOWN · 240 m"), on the minimap and as a
  ring on the streets; announced in the feed.
- Opening drops 1 item in the zone. In waves, spots inside weigh × 3, 2 extra
  items land inside, and zone items use the hot rarity table.
- No damage or hull buffs.

## Items

| Type | Rarity | Effect |
|---|---|---|
| Health | Common | +40 hull at once (≤ max) |
| Repair | Common | +10 hull/s for 6 s (≤ max) |
| Ammo | Common | +1 magazine (≤ full magazine), reload cancelled |
| Speed boost | Rare | × 1.3 engine pull and top speed for 8 s |
| Armor | Rare | − 35 % incoming damage for 12 s |
| Damage boost | Epic | × 1.5 outgoing damage for 10 s |

- Rarity weights: waves 70 / 25 / 5, hot zone 40 / 45 / 15; type uniform within a rarity.
- **Waves** at 2:00, 4:00, 6:00, 8:00 elapsed: 6 items + 2 in the hot zone.
  None in overtime. At most 16 items live at once.
- **Spots**: the arena's nav nodes (drivable, reachable), kept only if nothing
  solid is within 1.8 m and no start within 25 m. One item per spot; a wave
  keeps items 30 m apart when it can; never within 15 m of a live machine.
- **TTL** 45–60 s: spawned → expired → removed.
- **Pickup**: drive within 3.5 m. Health and Repair need a damaged hull, Ammo
  a magazine that isn't full; boosts are always taken. First machine in grid
  order within a step takes it: spawned → consumed → removed, once.
- **Timed effects** (Repair, Speed, Armor, Damage) refresh, never stack: a
  second pickup restarts the timer; strengths never add. Removed on death.
  Base stats never change: modifiers apply when used.

## Overtime

- At 00:00: one leader → match complete. A tie for most kills → **OVERTIME ·
  FIRST KILL WINS**.
- Kills still count. The match ends at the first kill after which one machine
  alone has the most kills; it wins. So a kill by a machine outside the tie
  can't end it; a tied leader's kill does.
- 60 s without a deciding kill → **DRAW**.
- Respawns 5 s; no waves; items live out their TTL; the hot zone stays.

## Match result

- Placement follows the leaderboard order; in a draw, the tied leaders share 1st.
- Player: **VICTORY** (winner), **DRAW** (draw, tied for first), **DEFEAT** otherwise.
- Results screen: result, "Nth OF 8", kills, deaths, assists, damage dealt,
  damage taken, combat score, longest streak, multi-kills, revenge kills,
  items collected, nemesis; final standings.

## Match end

Bots stand down; no more damage, kills, items or respawns; items and the hot
zone are removed; effects, protection and damage attribution cleared. Wrecks
stay where they fell. Play again (results screen) or a new match starts from
zero. There is no mid-match restart.

## Bots

Existing behaviour kept: grudge on the last attacker (6 s), else the nearest
rival within 70 m; route when out of sight; burst fire in sight within 55 m;
circle when there's road room, else stand off at 14 m; roam when alone.

Added:

- Protected rivals are skipped as targets.
- The sole leader counts as 15 m nearer when choosing a target.
- Items: a bot knows items within 75 m (what the player's minimap shows);
  heads for useful ones when not engaged, and for Health/Repair even mid-fight
  below 40 % hull.
- Hot zone: 60 % of bots, and every trailing bot, patrol its streets when
  idle, moving to the next spot every 10 s or on reaching one.
- Same rules as the player: pickup radius, effects, respawn waits, protection.
