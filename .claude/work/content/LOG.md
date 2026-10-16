# Content phase — log

The work of `PLAN.md`, step by step, on the local branch `feat/content`
(cut from `release/0.13.0`, `a6d2f71`). Each entry says what changed and
what the commands printed. Pins at the start: the yard's tdm
`3ec7416629c569b3` and ffa `d457463001e9f922`; Classic tdm scrapyard
`d9ee9ad8fa7017af`, tdm city `467400f8225aeea3`, ffa scrapyard
`3c2735848552d2b4`, ffa city `6c4c3343a80b5f99`; custom tdm scrapyard 12
seats `c6f185549c8774b2`, ffa city 2 seats `5e53e03454103914`; digests
`227c4ce7` (Scrapyard) and `8913ad26` (The City); `PROTOCOL` 7; `npm test`
1299.

## Step 0 — before any content

### Gate A hung: the record tests' dates (2026-10-15)

0.1's gate A never finished: after Classic's and the custom pins printed,
`npm test` sat at 0 % CPU for 25 minutes, and was stopped. The cause is in
`server/server.test.ts`, and on `release/0.13.0` as well, not in this step.
Its record-keeping rooms are dated 2026-09-29 ("what a room keeps") and
2026-09-30 ("a custom lobby's room"), with `createRecords({ days: 14 })`.
`records.ts` prunes replay folders by the real clock, at start: since
2026-10-14 the room's own `replays/2026-09-29/` was older than the cutoff,
so it went the moment it was made. The match record was on disk, the
`replays/` folder empty, and the replay the test then reads never came. The
two-vehicle rooms (2026-10-10) would have gone the same way from 2026-10-25.
Fixed in the test only: each of the three keeps its replays 14 days back
from its own fixed day, whenever it runs (`keptDays(created)`); the
`2000-01-01` folder it makes to be pruned still is. No pin moves.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 488.14 kB, gzip 143.37 kB); `npm test` 1299 passed (30 files) in
312.2 s (bots 7.8/13.8/17.8 kills a minute; the yard pins; Classic's
`d9ee9ad8fa7017af`, `467400f8225aeea3`, `3c2735848552d2b4`,
`6c4c3343a80b5f99`; custom `c6f185549c8774b2`, `5e53e03454103914`; digests
`227c4ce7`, `8913ad26`; journal 572 KB for 10.1 min; the hauler: 0
corrections on the grid, 3 in the drive after 2 late and 1 dropped). Build
id `5ebbbbccb797` (tests aren't in it).

### 0.1 The free for all probe, ported to the pickup supply (2026-10-15)

`.claude/work/ffa/ffa-metrics.js` read the pickups where they lived before
`3b0943d`. Now:
- the items on the ground are `rules.supply.items` (were `rules.items`);
- each machine's running effects are `rules.supply.effects[i]` (were
  `contender.effects`), read before the rules' `kill` clears them, as before;
- armor's reduction and the damage boost's factor come from `SUPPLY`
  (`modes/items/config.ts`; were `FFA.items`);
- `analyze`'s respawn table reads each phase's wait by its share of the
  clock (`share` × `duration`; was `before`), as the team deathmatch probe
  has since the refactor's stage 0.

Run once, in the browser: headless Chromium (global Playwright 1.63.0,
SwiftShader) against the dev server on `:3000`, the refactor's runner
(`refactor/shots/tools/probe.mjs ffa 5`, scratch): the probe copied into
`game/public` for the run and removed after; practice free for all on The
City, the player on autopilot `'even'`. In the match 23 s after load,
`setup: ready`, five matches in 31 s, no page error:
- 124.4 kills a match (winner 20.4, second 17.8, last 10), overtime in 2
  of 5 (13.1 s on average, no draw); the player 17.4 kills, 14.8 deaths,
  4.4 items, 3rd on average, 1 win;
- respawn `waitMismatches 0`, `alternationErrors 0`, `maxLate 16.7 ms`,
  `staleDeathScreen 0`.

Three more matches with the whole report printed: every section comes out
in numbers (the supply's among them): items spawned a match `health 11,
ammo 8.3, armor 6.3, speed 5.3, repair 3.7, damage 2.3`, collected `health
6, armor 5.3, speed 5.3, ammo 3.7, repair 2.7, damage 1.3`, 40.5 % hot, 18 s
to a pickup; damage boost 1.3 a match (0.5 kills a pickup); armor 5.3 a
match (29.8 hull kept a pickup); speed 6.4 s a pickup; hot zone 12.5 % of
the time alive, 29.4 % of the kills; comeback 33.2 % of the time; bots'
leader ratio 1.6.
Gate A: no file under `game/` changed since the record tests' fix (above),
whose gate ran on this tree: 1299 passed, every pin and both digests.

### 0.2 The probes by vehicle and gun; a headless runner; the baselines (2026-10-15)

Both probes (`ffa-metrics.js`, `tdm-metrics.js`):
- `autopilot` takes a fit, `{ vehicle, gun }` (ids): the player's vehicle,
  changed where it stands with `changeVehicle`, and the player's gun, carried
  as a bot carries it in the even modes. Free for all:
  `autopilot(mode, style, fit)`; team deathmatch: `autopilot(mode, fit)`.
- Every match of a run lines up as a new practice match on its seed would
  (`recruits`, `modes/roster.ts`): the bots' vehicles and guns are drawn
  again. Before, practice's Play again kept one draw for the whole run, so
  a run's per-gun numbers came from a single line-up (the refactor's stage
  4 note on the blue/red split).
- `analyze` gives every seat of every match by vehicle (`byVehicle`) and by
  gun (`byGun`): seat-matches, then kills, deaths, K/D, damage dealt and
  taken, and seconds alive, each a match; the player's line names its fit.
- `play` closes its channel when the run is done.

`window.match` gains `world` (`runtime/match.ts`: the match's physics
world), which `changeVehicle` needs. Checked in the page: a copy of the
Razor's spec registered as a second vehicle, the player changed into it
with `window.match.world`: a new body, the world's body count the same, the
car settled, the match playing, no page error; then changed back.

`.claude/work/content/probe.mjs` and `probe.test.ts`: the probes run
headless in Node, on any tree, a scratch worktree's too, with no page and
no dev server. The runner copies itself and the probe into the tree's
`game/` under names of its own, runs Vitest's unit project on them (the
arena builders need Vite), and deletes both. Its match is practice's
without the view, the sound and the keys: the same line-up, mode,
simulation and fixed steps, bots at Normal, the player on autopilot
`'even'`. Seeds count up from `seed` (default 1, so matches 2 to 11), and a
run comes out the same byte for byte (checked: two runs, one report). Ten
matches take about 50 s.
`node .claude/work/content/probe.mjs <ffa|tdm> <map> [matches] [vehicle=
gun= seed= tree= out=]`.

The browser and the runner agree. In the browser (headless Chromium
against `:3000`), three team deathmatches on The City with the new probe:
123 kills a match, 24 seat-matches (Minigun 18, Rocket Pod 6, the draws
varying by match), `waitMismatches 0`. The runner's ten on the same map:
125.8. The refactor's browser runs there: 124.7 to 131.2.

**The baselines**, this tree (one vehicle), the runner, ten matches each,
seeds 2 to 11, the player in the Razor with the first rival's gun:

| | Kills a match | Overtime | Razor (80 seat-matches): K / D / dealt / taken / alive | Minigun (39): K / D, K/D | Rocket Pod (41): K / D, K/D |
|---|---|---|---|---|---|
| tdm Scrapyard | 124.1 | 0/10 | 15.5 / 15.5 / 1,569 / 1,569 / 434 s | 13.2 / 16.6, 0.79 | 17.7 / 14.4, 1.23 |
| tdm The City | 125.8 | 1/10 | 15.7 / 15.7 / 1,590 / 1,590 / 433 s | 13.8 / 17.2, 0.80 | 17.6 / 14.4, 1.22 |
| ffa Scrapyard | 109.9 | 0/10 | 13.7 / 13.7 / 1,445 / 1,445 / 450 s | 12.6 / 14.6, 0.86 | 14.9 / 12.9, 1.15 |
| ffa The City | 126.4 | 2/10 | 15.8 / 15.8 / 1,639 / 1,639 / 433 s | 15.0 / 16.1, 0.93 | 16.5 / 15.5, 1.06 |

Respawn `waitMismatches 0` and `alternationErrors 0` in every run. Kills a
minute by phase (0–3, 3–5, 5–8, 8–10 minutes): tdm Scrapyard 16.0, 12.1,
10.9, 9.7; tdm The City 15.6, 13.8, 10.7, 9.5; ffa Scrapyard 13.0, 11.8,
9.9, 8.8; ffa The City 15.1, 13.3, 11.2, 9.9. Team deathmatch: blue won 3
and 2 of 10 (the split is noise, as the refactor found). In bots' hands the
Rocket Pod outscores the Minigun on every map (K/D 1.06 to 1.23 against
0.79 to 0.93); noted for the Cannon's step, not changed here.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 488.15 kB, gzip 143.37 kB); `npm test` 1299 passed (30 files) in
312.0 s (bots 7.8/13.8/17.8; every pin and both digests as at the start;
the hauler: 0 corrections on the grid, 0 in the drive). Build id
`ac39efa7f7b8` (`runtime/match.ts`).

### 0.3 A test for every model and turret (2026-10-15)

Coverage had the vehicle and turret builders at 0 % (refactor log, 2.1).
Two unit tests now build them headless, with `server/headless.ts` faking
the canvases their materials paint (the arenas' own way):
- `content/vehicles/models.test.ts`, for every `MODELS` entry: `body` and
  `turret` are children of the model and `gun` a child of `turret`, with a
  `wheel_<hub>` for each of the chassis' hubs and no other, where the view
  looks for them; each wheel at its hub (`x`, `wheelRadius`, `z`); the
  gun's trunnion (`gun`'s place in the model) at the spec's `turret.mount`,
  where rounds leave from, with every turret in `TURRETS`. The Razor: 7
  tests.
- `content/weapons/turrets.test.ts`, for every `TURRETS` builder: `gun` a
  child of the turret, with something to draw. 2 tests.

Checked to fail, in a scratch worktree: the Razor's turret ring 5 cm lower
(both trunnion tests fail), the wheels 1 % wider apart (all four hub
tests), `gun` named otherwise (every test that reads it). Tests only: no
pin moves. `game/AGENTS.md`'s test list and `ARCHITECTURE.md`'s how-tos (a
vehicle, step 5; a weapon, step 2) name them.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 488.15 kB, gzip 143.37 kB); `npm test` 1308 passed (32 files: 1299
and the 9 new) in 313.0 s (bots 7.8/13.8/17.8; every pin and both digests
as at the start; the hauler: 0 on the grid, 3 corrections in the drive
after 3 late and 4 dropped inputs). Build id `ac39efa7f7b8`.

## Step 1 — the Brute, in place of the test-only hauler

### 1a The Brute, unregistered (2026-10-15)

- `content/vehicles/vehicles.ts`: `BRUTE`, the Brute's spec, exported beside
  `VEHICLES` and outside `ROSTER`, so no draw sees it. Its numbers, as tuned
  below:
  - armour 135 (the Razor's 100); mass 2,200 kg (1,400);
  - engine 17,500 N, fading to nothing at 25.5 m/s, damping 0.05: 85 km/h,
    0–80 in 5.5 s and 230 hp as the garage quotes them (`drivePerformance`;
    the Razor 98 km/h, 4.2 s, 170 hp); reverse 9,500 N to 10 m/s;
  - brake 86, coast 4.5, handbrake 55: the Razor's per kilogram, so the
    bots' braking plan (9 m/s²) holds;
  - steering lock 0.55 rad (0.13 at speed), 2.8 rad/s: a 14.5 m turning
    circle (the Razor's 12.1 m);
  - downforce 4; suspension rest 0.34 m, travel 0.3 m, stiffness 30
    (Rapier scales it by the mass), compression 2.3, relaxation 2.8; grip
    the Razor's, drift grip 0.06;
  - wheels of 0.58 m radius at ±1.06 m and ±1.62 m: track 2.12 m,
    wheelbase 3.24 m (the Razor's 0.5 m, 1.88 m, 2.8 m);
  - three collision shells (the hull from the tail to the ram, the cab,
    the fighting compartment; the Razor has two), 2.0 × 1.48 × 5.24 m in
    all (the Razor's 1.9 × 1.39 × 4.4 m); inertia box 2.0 × 1.5 × 5.1 m;
  - the gun's trunnion at (0, 2.60, −0.7) (the Razor's (0, 2.41, −0.62)),
    0.6 m over the cab's roof, the barrel 1.15 m;
  - kind "Armoured hauler / Heavy", and its blurb.
- `content/vehicles/models/brute.ts`: its body. A cab over the front axle,
  its sloped windscreen behind a grate and visor slats, slit side windows;
  a fighting compartment behind it, taller than the cab, the turret ring on
  its roof in a collar, vents behind; slab armour over the doors and
  quarters (mismatched by the hull's seed) with the crest on the door
  slab, sill guards, rivets, arch flares with spikes; across the nose a
  plough: a rusty plate on struts, steel ribs up its face, a hazard-striped
  lip, spikes along the top; a bull bar, caged headlights on the glacis, a
  grille; a light bar on the cab's roof, two exhaust stacks in heat
  shields, jerry cans, a spare wheel on the back door, tail lights.
- `content/vehicles/models.test.ts`: the unregistered Brute's builder (its
  turret ring under the spec's mount, a body to draw); once registered,
  the `MODELS` tests hold it whole.
- `server/testVehicle.ts`: the Brute's spec in place of the hauler's
  (`BRUTE_ID`, `addBrute`). The two-vehicle tests in `server.test.ts`, the
  netplay drive and the client test run on it now, named for it.
- The first gate A failed one check, `its person drives it (3.3 m in 4
  s)`, which wanted more than 5 m. Looked at in a scratch test: the bots'
  draws are as with the hauler (a two-vehicle registry: brute razor brute
  razor brute razor razor razor), so seat 4's bot drives the second
  vehicle and the person takes the seat over in the Razor. The bot's 20 s
  in the Brute left the seat elsewhere than in the hauler, nose to a wall
  3 m ahead: the Razor, put down at rest, reached 6.8 m/s in 1 s, hit the
  wall and stopped. The distance measured where the seat stood, not the
  driving. The check now holds what its name says: no bot on the seat, and
  the car picking up more than 4 m/s in the 4 s under the person's
  throttle; it prints the distance too.
- Gate A, on the final body below: oxlint 0 warnings, 0 errors; format
  clean; tsc clean; build clean (`App` 488.15 kB, gzip 143.38 kB); `npm
  test` 1311 passed (32 files: the Brute's two tests, and `repo.test.ts`'s
  line for the new source file) in 313.6 s (bots 7.8/13.8/17.8; every pin
  and both digests as at the start; the Brute at 100 ms: 0 corrections on
  the grid, 0 in the drive, max error 0.008 m). Build id `e4404876ece1`.

### Tuning the Brute (2026-10-15)

A scratch worktree of `f5936c8` with 1a's files, the Brute registered as
1b will register it (`ROSTER`, `MODELS`); not committed.
- The model against its shells (a scratch test): the Brute's body spans
  x ±1.31 (the wheels), y 0.37 to 2.67, z −2.90 to 2.95; its shells x ±1.00,
  y 0.64 to 2.28, z −2.48 to 2.76. The ram's tip is 0.19 m past them, the
  spare wheel 0.42 m. (The Razor's plough is 0.92 m past its hull shell.)
- `server/arenas.test.ts`: 84 passed. Every start of both maps is clear
  for the Brute's shells; every mode each map hosts, at its biggest.
- `sim/simulation.test.ts`: 60 passed. The yard pins don't move with the
  Brute registered: the yard seats every machine in a Razor with a Minigun
  by hand, so its pins don't depend on the registries. PLAN.md's table
  says all eight move; six will, Classic's four and the two custom ones.
- The probes (the runner, ten matches each, seeds 2 to 11 as for the
  baselines), with the player in the Razor and then in the Brute; the
  bots draw from both. Kills a match, and the player's kills / deaths:

| | Baseline | 150 armour, player Razor | 150, player Brute | 135, Razor | 135, Brute | 120, Razor | 120, Brute |
|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 124.1 | 108.9; 12.4 / 15.0 | 107.1; 14.4 / 11.3 | 110.8; 12.7 / 15.3 | 109.5; 14.5 / 12.2 | 110.5; 13.1 / 16.4 | 118.7; 17.2 / 14.6 |
| tdm The City | 125.8 | 116.7; 13.4 / 15.8 | 112.0; 12.2 / 13.9 | 123.2; 13.8 / 16.6 | 116.1; 14.4 / 13.8 | 124.2; 15.6 / 16.9 | 119.4; 12.6 / 15.0 |
| ffa Scrapyard | 109.9 | 97.6; 12.0 / 13.3 | 93.7; 13.3 / 10.4 | 103.9; 12.3 / 14.4 | 101.5; 14.1 / 12.4 | 104.5; 11.0 / 14.1 | 99.6; 12.1 / 11.8 |
| ffa The City | 126.4 | 114.9; 14.4 / 14.8 | 115.8; 14.6 / 12.9 | 117.2; 12.8 / 14.0 | 115.6; 13.2 / 13.0 | 118.1; 15.6 / 14.5 | 117.2; 13.6 / 13.4 |

  Every seat of the eight runs of each variant (328 Brute and 312 Razor
  seat-matches), by vehicle:

| Brute | Brute K/D | Razor K/D | Brute dealt / taken a second alive | Razor dealt / taken | Brute alive / Razor alive (s a match) |
|---|---|---|---|---|---|
| 150 armour, 85 km/h | 1.16 | 0.87 | 3.77 / 3.97 | 3.74 / 3.52 | 470 / 439 |
| 135 armour, 85 km/h | 1.12 | 0.89 | 3.75 / 3.90 | 3.70 / 3.54 | 462 / 440 |
| 120 armour, 85 km/h | 1.09 | 0.92 | 3.53 / 3.61 | 3.66 / 3.58 | 456 / 437 |
| 150 armour, 70 km/h (engine 14,000 N to 21 m/s) | 1.17 | 0.86 | 3.56 / 3.72 | 3.62 / 3.44 | 477 / 442 |

  Respawn `waitMismatches 0` and `alternationErrors 0` in every run.
- What it says: in bots' hands the vehicles differ by their hull alone.
  A Brute deals and takes about what a Razor does each second it is alive;
  its size, its weight and its lower speed cost it nothing in a bot's
  fight. A slower Brute (70 km/h) scored as the 85 km/h one did. So any
  armour over the Razor's becomes a K/D lead, and the probes can't weigh
  the Razor's speed and turning against it. They can't settle the armour.
- The look, in the garage (the tuning tree built and served as static
  files, headless Chromium with SwiftShader; the Chrome extension wasn't
  connected): the first body hid the turret. Its cab roof stood at 2.28 m
  with a light bar on it, the gun's trunnion at 2.48 m, so from the
  garage's low camera neither gun showed, not even on the Loadout page.
  The ram, a solid wedge in hazard stripes, read as one striped block. Now
  the cab's roof is at 2.0 m and the fighting compartment at 2.12 m, the
  trunnion at 2.60 m, smaller lamps, and the ram the plough above. Both
  guns show over the cab. The shells followed (the cab's and the
  compartment's, lower); `server/arenas.test.ts` again: 84 passed.
- Again with the final body, armour 135, the eight runs: kills a match
  tdm Scrapyard 113.5 (player in the Razor) and 107.9 (in the Brute), tdm
  The City 121.3 and 119.4, ffa Scrapyard 96.9 and 96.9, ffa The City 116.8
  and 115.7; the player's kills / deaths in the Razor 11.1 / 16.2, 14.7 /
  16.4, 10.9 / 12.2, 13.6 / 14.7, in the Brute 12.9 / 13.6, 14.4 / 14.3,
  10.6 / 11.6, 14.2 / 13.0. Every seat: Brute K/D 1.13 (328 seat-matches,
  3.65 dealt and 3.80 taken a second alive, 464 s alive a match), Razor
  0.89 (312; 3.71, 3.55, 439 s). Respawn checks 0 and 0 in every run.
- Chosen: 135. It keeps the Brute four direct rockets from a wreck (the
  Razor three; anything from 115 to 152 does), is 35 % more hull for the
  Minigun, and trims the bots' lead a little. Matches with Brutes in them
  lose 5 to 11 % of their kills (more hull to get through). The rest as
  PLAN.md's targets: 2,200 kg, 85 km/h, 0–80 in 5.5 s.

### The checkpoint (2026-10-15)

Shown to the owner: the numbers, the probes against the baselines, the
garage. The owner left the balance to this reading, so armour 135 stays,
and asked what comes next: taken as the word for 1b.

### 1b The Brute registered; the re-pin (2026-10-15)

- `content/vehicles/vehicles.ts`: the Brute's spec in `ROSTER` (`brute`),
  after the Razor; `BRUTE` and its comment go. `content/vehicles/models.ts`:
  its `MODELS` entry. `models/brute.ts` reads `VEHICLES.brute`.
- `server/testVehicle.ts` is deleted, and every `addBrute()` with it (1a
  had renamed the hauler's `addHauler()`): the tests name `'brute'`
  directly. `models.test.ts`'s unregistered block goes; the `MODELS`
  tests hold the Brute whole now.
- `game/AGENTS.md`'s code map: `models/` lists `brute.ts`; `server/` no
  longer lists `testVehicle.ts`. `ARCHITECTURE.md`'s how-to: the
  two-vehicle tests run on the Razor and the Brute.
- **The re-pin.** Bots draw their vehicles from the registry (`recruits`,
  `modes/roster.ts`), so with two vehicles in it every bot seat's draw
  changed, and every whole match of bots plays differently. The old
  hashes came out in 1a's gate A (`ecbd304`, above), the Brute's code in
  and unregistered. `server/server.test.ts`, run alone with the Brute
  registered: exactly these six failed, and its other 175 checks passed.
  - Classic tdm Scrapyard `d9ee9ad8fa7017af` → `6dcb00e97e472e11`
  - Classic tdm The City `467400f8225aeea3` → `07ff153cab90cbe4`
  - Classic ffa Scrapyard `3c2735848552d2b4` → `300c98d63fbb114b`
  - Classic ffa The City `6c4c3343a80b5f99` → `46f9038cfb1c58fb`
  - custom tdm Scrapyard, 12 seats: `c6f185549c8774b2` (45 kills) →
    `be77d4c64410ff73` (42 kills)
  - custom ffa The City, 2 seats: `5e53e03454103914` (1 kill) →
    `e75f645ee97cb551` (3 kills)
  The yard's two pins (`3ec7416629c569b3`, `d457463001e9f922`) don't
  move: the yard seats every machine in a Razor with a Minigun by hand
  (tuning, above). The digests don't move; `PROTOCOL` stays 7 (vehicle
  ids are strings on the wire).
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 492.96 kB, gzip 145.09 kB: the Brute's builder is in the page
  now, 4.81 kB more, 1.71 kB gzipped); `npm test` 1317 passed (32 files:
  the Brute's seven model tests and two content checks, the unregistered
  block's two gone, `repo.test.ts` one file fewer) in 319.0 s (bots
  7.8/13.8/17.8; the yard pins as before; Classic's `6dcb00e97e472e11`,
  `07ff153cab90cbe4`, `300c98d63fbb114b`, `46f9038cfb1c58fb`; custom
  `be77d4c64410ff73`, `e75f645ee97cb551`; digests `227c4ce7`, `8913ad26`;
  journal 583 KB for 10.1 min; handover: the bot drove the seat 50 m; the
  Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `85df14842387`.

### Step 1's checks (2026-10-15)

The Chrome extension wasn't connected, so nothing ran on a real GPU: the
global Playwright's headless Chromium (1.63.0, Chromium 153, SwiftShader)
stands in, as the rules allow. SwiftShader draws 1 to 3 frames a second,
so a page's match clock runs at a fraction of real time and its inputs
reach the server in bursts.

**Gate B**
- `node scripts/browser-match.mjs`: every check ok, 133.1 s. One room,
  seats 0 and 4, two people. `a` held W 12 s and went 0.4 m (nose to a
  wall), then S: 7.6 m back on `b`'s screen (0.0 m with no key; one
  respawn jump left out). `a` drew 3 frames a second, its clock at 17 %.
  Its F3 line read `CORR 410 corrections, max 94.95 m`. The max fits the
  respawn during the S hold: at 3 frames a second the page can take the
  wreck and the respawn in one batch and count the jump as a correction.
  Not verified; `a` drove a Razor. `a` left, and seat 0 was "Sawtooth"
  again.
- `node scripts/browser-match.mjs custom`: every check ok, 89.3 s.
- Classic in each vehicle (a scratch copy of the script, each page's
  stored loadout set: `a` the Brute with the Rocket Pod, `b` the Razor
  with the Minigun): every check ok, 117.3 s. Each page played in its own
  vehicle and gun, and saw the other's (`b`'s page showed `a`'s seat as
  `brute/rocketPod`, hull 135, wheels 0.58 m). `a` held W 12 s: 23.5 m on
  `b`'s screen. `a` left, and seat 4 was "Hexbolt" again.
- The garage on `:3000` (a scratch script, by the keyboard): → on Vehicle
  shows the Brute ("2 / 2", its sheet, its model on the turntable) and
  stores `{"vehicle":"brute","weapon":"minigun"}`; ↓ to Loadout, → the
  Rocket Pod, stored; Play, then Practice: the player in the Brute with
  the Rocket Pod, hull 135; no page or console error. As the garage was
  then: Enter on Vehicle or Loadout went to the arena screen; Esc, Enter
  on Back and the Back item went to the main menu.

**The smoke list** (`.claude/work/refactor/PLAN.md`), against the dev
server on `:3000`:
- Items 1 to 4 and 7, `shots/capture.mjs` (scratch, as in the refactor):
  22 shots in 608 s, no page or console error: the menu; the garage (the
  vehicle page, each gun); practice team deathmatch on the Scrapyard (the
  HUD at GO, the board, the death board, the results, Play again, the
  pause menu's settings changed and saved, resumed with the clock
  running); practice free for all on The City (the HUD, the lock-on, the
  effect chips, the board, a loss, the crown); the weapon panel with each
  gun; the loading screen; the tokens and the hot zone (Downtown, radius
  34); Exit to garage: `window.match` undefined. The renderer in the
  match: 498 geometries and 193 textures. Every refactor run had 496 / 193:
  bots draw Brutes now, whose models merge into another number of meshes,
  so the count follows each match's draw. 488 / 194 out in the garage, 574
  / 196 in the next match. Bots in Brutes show in the matches, in their
  side's livery.
- Items 5 and 6 (Classic in two tabs, a custom lobby): the two
  `browser-match.mjs` runs above. The match chat needs Nakama, which wasn't
  running here: not checked.

**The takeover correction** (refactor log 1.4b). It was to be measured with
the Brute in Chrome, and no Chrome was connected. It was measured as 1.4b
found it, with the tests' own pages: a scratch test, 16 Classic rooms of
team deathmatch on the Scrapyard at 60 ms each way ±10. A page joined in
the Brute, then 16 more rooms in the Razor. For each room it counted
whether the seat's bot had drawn the other vehicle (then `changeVehicle`
replaced the body at the join, lifting it 0.2 m) and the page's
corrections from the seat to GO:
- In the Brute: 6 of 16 rooms swapped the body, and one correction came
  in 1 of those 6 (0.063 m, 0°, 1.00 m/s, 0.40 s into the countdown).
  None came in the 10 rooms without a swap.
- In the Razor: 8 of 16 swapped, and one correction came in 1 of those 8
  (0.006 m, 0.01 m/s). None came without a swap.

So the correction is rare (2 swaps in 14) and small. It comes while the
countdown holds the car, and the page eases it out over about 100 ms.
It doesn't show. The body isn't settled before the welcome.

**Gate C**: the probes once more on this tree (`13cfacf`), the eight runs of
the tuning: every report the same, byte for byte, as the tuning tree's
last eight (kills a match 113.5 and 107.9, 121.3 and 119.4, 96.9 and
96.9, 116.8 and 115.7; Brute K/D 1.13, Razor 0.89).

Gate A: no file under `game/` changed since 1b, whose gate ran on this
tree.

### The garage as an editor only (2026-10-15)

Outside PLAN.md: the owner asked for it after 1b, as a commit of its own.
Until now, Enter on Vehicle or Loadout, and the Select button ("Take it to
the arena"), took the player from the garage to the arena screen. Now the
garage only picks.
- `screens/Garage.tsx`:
  - Enter acts on Back alone; on Vehicle or Loadout it stays (still
    `preventDefault`, so no focused button takes the press).
  - Esc and the Back item return to the main menu, as before.
  - The Select button is gone, and with it `ActionButton` from the import
    (other screens still use it).
  - The hint bar loses Enter Select.
  - ←→ paging is as it was.
  - A comment says what the garage is.
- `App.tsx`: `onSelect` and its wiring go (nothing else used them); its
  comment on the screens' flow says the garage returns to the menu.
- The loadout is stored on every change (`changeLoadout` →
  `saveLoadout`, `runtime/stored.ts`), so nothing needs confirming.
- `ARCHITECTURE.md`: the flow in its diagram (the menu ⇄ the garage, the
  menu → the map select), and a line on what the garage does.

`node scripts/tailwind-classes.mjs`: "every class as Tailwind writes it
(230 files)" (classes were only taken out).

**Gate B for the garage**, in headless Chromium against `:3000` (scratch
scripts):
- Screenshots of the Vehicle and Loadout pages before and after: the
  Select button gone from both; the hint bar ↑↓ Choose, ←→ Vehicle or
  Weapon, Esc Back.
- By the keyboard, before: Enter on Vehicle went to the arena screen, and
  so did Enter on Loadout. After: both stay in the garage. Before and
  after, Esc, Enter on Back and a click on the Back item reach the main
  menu.
- → on Vehicle and on Loadout stored the Brute and the Rocket Pod
  (`{"vehicle":"brute","weapon":"rocketPod"}`). Then Play → the arena
  screen → Practice: the player in the Brute with the Rocket Pod, hull
  135. No page or console error.
- Classic: a scratch copy of `browser-match.mjs`. Page `a` picked the Brute
  and the Rocket Pod in the garage by the keyboard (Enter kept it there,
  Esc reached the menu), then Play, then Classic. Its match put it in the
  Brute with the Rocket Pod, and page `b` (which kept the Razor and the
  Minigun) saw `a`'s seat so (`brute/rocketPod`, hull 135).
- Found on the way, not caused by this change, not fixed. In that flow
  `a` searches about 8 s after `b` (its garage visit). In each of three
  runs, then once more with this change stashed, the Classic match then
  went wrong the same way:
  - `b` missed the room's 20 s load hold (the server's `load timeout`,
    `late: b`);
  - `b`'s `left` line showed no input queued (0 repeats, 0 drops, an empty
    queue), and `b` was let go about 70 s later;
  - `b`'s page showed "Connection lost";
  - so `a`'s drive measured 0 m on `b`'s frozen screen, and `b` still
    counted 2 people when `a` left.

  The page sends an input every step it runs (`client.ts` `step`), so `b`
  never ran its match on a live socket. The likeliest cause: under
  SwiftShader, its long load kept it from reading the socket, and the
  server dropped it as a page that stopped reading. Not verified. The
  stock runs, both pages searching at once, pass. Worth a look in the
  online work, on a real GPU first.

Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 492.69 kB, gzip 145.04 kB); `npm test` 1317 passed (32 files) in
313.1 s (bots 7.8/13.8/17.8; every pin and both digests as after 1b; the
Brute at 100 ms: 0 corrections on the grid, 1 in the drive after 1 late
input). Build id `9ed0cc68f59c`.

### 1, patch notes: the 0.13.0 entry (2026-10-15)

`screens/PatchNotesPanel.tsx` gains the `0.13.0` entry, the first of the
phase, with two lines: the Brute (the second machine; its hull, weight,
speed, 0–80, turning circle; four direct rockets; ←→ on Vehicle; bots drive
both), and the garage that only picks (each choice kept as it changes, Back
or Esc to the menu, Play into the arena, Enter no longer leaves, Select
gone). The facts are the game's: `VEHICLES`, the garage's sheet
(`drivePerformance`), the Rocket Pod's 38 a direct hit.
`game/index.html`'s description names the guns and "armoured cars", not
the machines: unchanged.
Checked on `:3000` (headless Chromium): the main menu's corner button reads
`Patch notes, v0.13.0`; N opens the drawer on v0.13.0 ("Latest") with its
two lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 493.31 kB, gzip 145.29 kB); `npm test` 1317 passed (32 files) in
312.8 s (bots 7.8/13.8/17.8; every pin and both digests as after 1b; the
Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`f4d2feb1f194`.

### The README (2026-10-15)

The owner rewrote `README.md` and asked for it to be committed; it went in
as written (`31ccadc`). Read against the repo: every link and file it
names exists, its badges' versions are the lockfile's (TypeScript 6.0,
React 19, three r186, Astro 7), and it has the Brute. Two things in it lag:
`.github/assets/garage.jpg` still shows the garage before this step (the
Razor alone, the Select button, "Enter Select"), and its site line says
"lint, typecheck, build", where `npm run check` is the session-rules
check and the typecheck runs inside `npm run build`. Offered; the owner
kept it as it is.

### 1, the site's copy (2026-10-15)

- `www/src/content/guide/garage.mdx`:
  - its description names both machines;
  - the opening says what the garage is now: ←→ change the machine on
    Vehicle and the gun on Loadout, each choice kept as it's made, Back
    or Esc to the menu, Play into the arena, in practice and Classic;
  - a Machines table, Razor beside Brute: class, hull, weight, top
    speed, 0–80, power, turning circle; then a line on each;
  - the Rocket Pod: three direct hits wreck a Razor, a Brute takes four.
- `how-to-play.mdx`: every bot drives a Razor or a Brute. You start in the
  Razor with the Minigun; the garage paragraph without Select (each
  choice kept, Back to the menu, Play into the next match).
- `controls.mdx`, Menus: ←→ change "the machine or the gun in the garage";
  Enter is "Select (in the garage, only Back: what you pick there is
  kept as you pick it)".
- `index.mdx`: the garage page's line names the Brute.
- `faq.mdx` names neither Select nor the garage's Enter: unchanged.

The facts come from the game's code:
- armour, mass and class from `VEHICLES`;
- top speed, 0–80 and power from `drivePerformance`, and the turning
  circle by the garage's own formula, as its sheet quotes them;
- four direct rockets: 38 × 3 = 114 < 135 ≤ 152 = 38 × 4;
- the start loadout from `DEFAULT_LOADOUT`;
- the bots' vehicles from `recruits`;
- each choice kept: `changeLoadout` → `saveLoadout`.

The site's gates:
- `npm run lint`: clean.
- `npm run check`: `nakama.check: ok`.
- `npm run build`: 0 errors, 0 warnings, 0 hints; 12 pages. The built
  `docs/garage.html` carries the table and its lines.

### The README's Deployment section, for self-hosters (2026-10-15)

Outside PLAN.md: the owner asked for it, as a commit of its own. The old
section (one paragraph on the CI deploy) becomes two:
- **Self-Hosting**:
  - the stack, and what Caddy routes where on its two names;
  - the build;
  - the server's layout;
  - `deploy/.env`'s variables;
  - the keys `deploy.sh` refuses;
  - start, update, roll back, look, check from outside;
  - the nightly backup.
- **Our CI Deploy**: the GCP paragraph, as the maintainers' setup; a
  fork's run fails without its variables and secrets, so delete or
  disable the workflow unless you copy that setup.

Read first, as asked: `deploy/compose.yml`, `deploy/Caddyfile`,
`deploy/.env.example`, `scripts/build.sh`, `scripts/deploy.sh`,
`scripts/backup.sh`, `.github/workflows/deploy.yml`, `nakama/AGENTS.md`
and the root `AGENTS.md`. The workflow was read past its header: its
build step names the build-time variables (`SITE_URL`, `VITE_NAKAMA_*`,
`PUBLIC_NAKAMA_*`), and its upload step the server's layout (`deploy/`,
`nakama/data`, `scripts/`, `site/incoming/`, `server/incoming/` under
`~/scrapyard/`). Also read: `game/.env.example`, `www/.env.example`, and
the three smoke scripts' variables.

Checked:
- Every path, command, port and variable in the text comes from those
  files.
- Every file and link it names exists (`load.js` included, in
  `game/dist-server`). Placeholders are `example.com`; there are no real
  names, addresses or secrets.
- Docker is left out. `deploy.sh` and `backup.sh` call `podman compose`
  (and `podman image prune`), and `compose.yml` leaves the
  `game_matches` volume to Podman to give to the `node` user. The files
  don't work with Docker unchanged.
- `--all` on the first deploy follows from `deploy.sh`. Without it, only
  `podman compose start` runs, which on a fresh server leaves Caddy,
  Nakama and Postgres never created. CI's first run gets `--all` because
  the compose file is a new upload.
- What the repo doesn't cover (DNS, the server's size, its firewall, the
  host's own Podman setup) is said in one line.
- The rest of `README.md` is as the owner wrote it.

### Step 1 in Chrome, on a real GPU (2026-10-15)

The owner asked for step 1's look in Chrome, with the extension connected.
Chrome 155, WebGL on "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)",
the dev server on `:3000`, the game server on `:7360` (build
`f4d2feb1f194`, the Brute in it), Nakama 3.41 up. The second Classic
player was a headless page (Playwright, SwiftShader) on the same dev
server, a guest of its own: `127.0.0.1:3000` doesn't answer, so there was
no second origin for a second Chrome tab.
- The main menu: "Playing as Guest", the corner `v0.13.0`. No console
  error, at load or after, all session.
- The garage, by the keyboard: the Brute's page (its sheet: 85 km/h,
  5.5 s, 230 hp, 2,200 kg, 14.5 m, 135 HP; "2 / 2"), its model on the
  turntable with the gun over the cab; ← to the Razor (1 / 2) and back;
  on Loadout the Minigun on the Brute's compartment; Enter on Loadout
  stayed in the garage; Esc reached the main menu. No Select button, and
  the hint bar shows ↑↓ Choose, ←→ Vehicle, Esc Back.
- Practice team deathmatch on the Scrapyard, in the Brute with the
  Minigun: hull 135 on the HUD, `ARENA 227c4ce7`, 71–74 FPS after the
  first frames. The bots drew two Brutes among seven. Held W: the Brute
  went 20.7 m in 4 s, then sat nose to something until the 4 s
  auto-recovery put it back on the road, and from there 10 and 24 km/h in
  1 s. Exit to garage (it asks first): `window.match` undefined.
- Classic, Chrome in the Brute (B, the headless page, in the Razor): the
  ready check, accepted; room `5572c6`, seat 4, 2 people, ping 1 ms.
  "Waiting for players" while B loaded. On the grid, before GO, the F3
  line went from 75 to 153 corrections, max 0.10 m, the car standing
  still and no jump on screen. From GO, held W: 14, 27, 39, 49 km/h in
  2 s, then a stop against something ahead (20.7 m). No new correction
  while driving. The match chat: "You: chrome check: brute in classic",
  back through Nakama. Leave match (it asks first): back in the garage,
  `window.match` undefined.
- Classic, Chrome in the Razor: "A match in progress · Scrapyard · 2
  players with you". Accepted with Y: seat 4 of `5572c6` again, mid-match
  at 13–15 and 7:27 left, in the Razor. The seat came with its bot's hull
  share (49, then 26 under fire), the Minigun at 55 of 60. 9 to 14
  corrections in 3 s (max 0.27 m) while rockets shoved it. Left again.
- Put back: the stored loadout as found (the Brute with the Rocket Pod);
  the tab closed.

What it says about the takeover correction: nothing showed on a real GPU,
on the grid or mid-match. The 75-to-153 count on the grid, with the car
still, is the wait for B's page. The Node measurement above isolates the
takeover's own: 2 small corrections in 14 swaps. Step 1 is checked; on
to step 2.

## Step 2 — the Cannon, a weapon that is only data

### 2a The Cannon's turret and icon, unregistered (2026-10-15)

- `content/weapons/turrets/cannon.ts`: the turret on the same yoke as the
  others (`buildTurret`): a breech block, a recoil sleeve, one heavy barrel
  to a slotted muzzle brake at 1.12–1.15 m (the vehicles' `barrel` is
  1.15 m), a counterweight behind, a sight on top.
- `content/weapons/weapons.ts`: `CANNON_ICON`, its HUD icon in the 64 × 28
  box (breech, sleeve, barrel, muzzle brake, mount, sight), outside
  `WEAPONS`; the row takes it in 2b.
- `content/weapons/turrets.test.ts`: the unregistered turret carries its
  `gun`, as each in `TURRETS` does; once registered, the `TURRETS` test and
  the models' trunnion test (every vehicle, every turret) hold it.
- Nothing in `WeaponId`, `TurretKey`, `WEAPONS` or `TURRETS`: no draw sees it.
- The first gate A: tests green, but oxlint 2 warnings
  (`vitest(expect-expect)`): the turret test's `it`s called a helper that
  held the `expect`s. Now each `it` asserts on what the helper returns.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 493.31 kB, gzip 145.29 kB); `npm test` 1319 passed (32
  files: the unregistered turret's test, and `repo.test.ts`'s line for
  `cannon.ts`) in 312.7 s (bots 7.8/13.8/17.8; every pin and both digests
  as after 1b; the Brute at 100 ms: 0 corrections on the grid, 0 in the
  drive). Build id `a739e5ca8c13`.

### Tuning the Cannon (2026-10-15)

A scratch worktree of `49c8be8` with 2a's files, the Cannon registered as
2b will (`WeaponId`, `TurretKey`, the `WEAPONS` row last, `TURRETS`):
`tsc` clean, the content tests 29 passed there (the Cannon's turret on
every vehicle's mount). The probes, ten matches each, seeds 2 to 11,
with the player carrying each gun in turn; the bots draw from all three.

PLAN.md's start: ~45 a round, 60 rpm, 4 a clip, 2.5 s reload, ~260 m,
almost no spread. Started at 44, not 45: three rounds wreck a Razor
either way, and 44 keeps the Brute a fourth (45 × 3 = 135). Every seat
of the twelve runs:

| Gun | Seat-matches | K/D | Kills a match | Dealt / taken a second alive |
|---|---|---|---|---|
| Cannon, 44 a round | 388 | 1.10 | 15.2 | 3.93 / 3.63 |
| Minigun | 340 | 0.77 | 12.1 | 3.45 / 4.06 |
| Rocket Pod | 232 | 1.21 | 16.2 | 3.96 / 3.61 |

On the four runs with the player in the Cannon (the same seeds, the same
draws), the Cannon's K/D at 44, 42 and 40 a round: 1.07, 1.06, 1.01. The
bots' spread floor (0.03 rad at Normal) hides the Cannon's precision,
which a person aims with: a player will get more of its 260 m than a
bot. So 40, and the twelve runs again:

| Gun | Seat-matches | K/D | Kills / deaths a match | Dealt / taken a second alive |
|---|---|---|---|---|
| Cannon, 40 a round | 388 | 1.00 | 13.7 / 13.7 | 3.66 / 3.61 |
| Minigun | 340 | 0.83 | 12.6 / 15.1 | 3.44 / 3.88 |
| Rocket Pod | 232 | 1.28 | 16.4 / 12.8 | 3.91 / 3.39 |

With the player in the Cannon, kills a match: tdm Scrapyard 104.5, The
City 120.4, ffa Scrapyard 100.6, The City 116.7 (step 1's final, two guns:
107.9–113.5, 119.4–121.3, 96.9, 115.7–116.8). The player's K/D in the
Cannon 0.93 to 0.98, in the Minigun 0.73 to 0.89, in the Rocket Pod 1.08
to 1.26. Respawn checks 0 and 0 in every run.

- Chosen: 40 a round, 60 rpm (1 a second), 4 a clip, 2.5 s reload,
  260 m, spread 0.002: 24.6 damage a second sustained. Three rounds wreck
  a Razor, four a Brute, as the Rocket Pod's direct hits do.
- The bots fight it as any `gun` (`TACTICS`: they close to 14–24 m and
  fire inside 55 m), and it comes out even there: the per-weapon
  preferred range PLAN.md offers as a fix isn't needed now.
- The Minigun is the weak gun in bots' hands (0.83), as before the Cannon
  (0.79 to 0.93 in the baselines). PLAN.md keeps the Minigun and the
  Rocket Pod as they are: noted, not changed.
- What a `gun` brings by its kind and not its data: the view plays the
  Minigun's shot sound for each round and its barrel-spin loop while the
  trigger is held (`FIRE_CUE`, `SPINS`). The Cannon would spin. It's a
  sound, not play; a per-weapon cue would be a change to the view, not
  data. Noted for the owner, not done here.

### 2b The Cannon registered; the re-pin (2026-10-15)

- `content/weapons/weapons.ts`: `'cannon'` in `WeaponId` and `TurretKey`;
  its `WEAPONS` row last (a `gun`: 40 a round, 1 a second, 4 a clip, 2.5 s
  reload, 260 m, spread 0.002; its name, blurb and icon, `CANNON_ICON`
  inline and the constant gone). `content/weapons/turrets.ts`: `cannon` in
  `TURRETS`. `turrets.test.ts`'s unregistered case goes: the `TURRETS` test
  holds it, and the models' test lays its trunnion on each vehicle's mount.
- What follows by itself, as PLAN.md says: the garage's weapon pager, the
  lobby's one-gun setting (`CUSTOM.weapons` reads `WEAPONS`), the wire and
  the stored loadout (`parseLoadout` takes any registered id), the
  record and the replay. No fixture names the guns: `PROTOCOL` stays 7.
- **The re-pin.** Bots draw their guns from the registry (`armBot` over
  `WEAPON_IDS`, in seat order), so with three in it every bot's gun changed,
  and the whole matches of bots play differently. The old hashes came out
  in 2a's gate A (`5831b21`, above), the Cannon's turret and icon in and
  unregistered. `server/server.test.ts`, run alone with the Cannon
  registered: exactly these six failed, its other 175 checks passed.
  - Classic tdm Scrapyard `6dcb00e97e472e11` → `f90c1d133397a3da`
  - Classic tdm The City `07ff153cab90cbe4` → `d417a15c916e063e`
  - Classic ffa Scrapyard `300c98d63fbb114b` → `e562e4c10f4751cc`
  - Classic ffa The City `46f9038cfb1c58fb` → `cb90be5845850b0e`
  - custom tdm Scrapyard, 12 seats: `be77d4c64410ff73` (42 kills) →
    `f345a411c025004e` (45 kills)
  - custom ffa The City, 2 seats: `e75f645ee97cb551` (3 kills) →
    `15c66a55c8dd8f1a` (5 kills)
  The yard's two pins don't move (Miniguns by hand); the digests don't.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 494.22 kB, gzip 145.59 kB); `npm test` 1326 passed (32 files:
  the Cannon in each table's tests, three in `weapons.test.ts`, two in
  the models' trunnion test, two content checks; the unregistered turret
  case gone) in 313.2 s (the new pins; the yard's and both digests as
  before; the Brute at 100 ms: 1 correction on the grid, 0 in the drive).
  Build id `e9d336941cf5`.
- One printed number moved besides the pins: `sim/bots.test.ts`'s kills a
  minute, easy 7.8 → 8.4, normal 13.8 → 14.9, hard 17.8 → 16.4. That test
  arms its bots through `armBot`, so the third gun is in their draws too.
  It isn't a pin; its checks (harder wrecks more, the guns pull their
  weight, nobody stuck) pass.

### Step 2's checks (2026-10-15)

**Gate C**: the probes once more, on this tree (`e2feddc`): the twelve runs
of the tuning (both modes on both arenas, the player in each gun in turn,
seeds 2 to 11). Every report is the same, byte for byte, as the tuning
worktree's twelve at 40 a round.

**Gate B** (the global Playwright's headless Chromium, SwiftShader), on
`e2feddc`:
- `node scripts/browser-match.mjs`: every check ok, 109.6 s. Room
  `c53cb6`, seats 0 and 4, two people. `a` held W 12 s: 110.4 m on `b`'s
  screen (0.0 m in 5 s with no key). `a` drew 3 frames a second, its clock
  at 18 %; its F3 line read 587 corrections, max 10.9 m. `a` left, and
  seat 0 was "Sawtooth" again.
- `node scripts/browser-match.mjs custom`: every check ok, 87.7 s.

**Chrome, on a real GPU** (Chrome 155, "ANGLE Metal Renderer: Apple M1
Pro", the dev server on `:3000` at `e2feddc`):
- The garage, by the keyboard: ↓ to Loadout, → to the Cannon: "3 / 3", its
  sheet 40 per round, 60 rpm, 4 rounds, 2.5 s, 260 m, 25 dmg/s, the turret
  on the Brute's compartment; ↑ and ← to the Razor: the turret on its
  roof. Stored `{"vehicle":"razor","weapon":"cannon"}`.
- Practice against Normal bots, in the Razor with the Cannon: the HUD's
  weapon panel showed the Cannon's icon, `4 / 4` and `CANNON · LMB`. The
  trigger held 6 s (a mousedown on the game's canvas): the clip, every
  half second, `3 3 2 2 1 1 0R 0R 0R 0R 0R 3` (R: reloading). A round a
  second, four of them, the 2.5 s reload, then firing again. The player's
  damage dealt rose 140. The seven bots drew four Cannons (one on a Brute)
  and three Miniguns.
- Then the extension dropped, on the way out of the match. Once it was
  back: the tab was out of the match (`window.match` undefined), and the
  stored loadout, the Razor with the Cannon, went back to the Brute with
  the Rocket Pod, as found. The tab closed.

**The Cannon online** (a scratch copy of `browser-match.mjs`, on this tree
with the patch notes below, build `8f07df0dce5b`): `a` the Brute with the
Cannon, `b` the Razor with the Minigun. Every check ok, 145.1 s. Room
`100b38`, seats 4 and 0, two people.
- Each page played in its own vehicle and gun and saw the other's: `b`'s
  page showed `a`'s seat as `brute/cannon`, hull 135, wheels 0.58 m.
- `a` held W nose to a wall (0.2 m), then S: 23.5 m back on `b`'s screen.
- `a` held the trigger 15 s. Its clip, each second: `3 2 2 1 0R 0R 3 2 2 1
  0R 0R 3 2 1`. That is a round a second and the 2.5 s reload in real
  time: the server repeats the page's last input between its bursts, while
  the page drew 1 frame a second (its own clock at 17 %). `a`'s damage
  dealt rose 53, and its feed read "You wrecked Grinder". Its HUD: the
  Cannon's icon, `1 / 4`, `CANNON · LMB`, hull 135.
- `a` left, and seat 4 was "Hexbolt" again; the server's log held no
  token.

**The lobby form** (headless, on `:3000`): Advanced's Weapons row reads
All, Minigun, Rocket Pod, Cannon. The Cannon picked, the line under it
reads "Everyone, bots too, drives with this gun". At 1280 × 720 the four
fill the drawer's width, so seven (PLAN.md's five guns beside the two)
won't fit one row. The row reads `WEAPONS`, as the garage's pager does:
the open point on the pagers covers it, looked at again at each step.

### 2, patch notes (2026-10-15)

`screens/PatchNotesPanel.tsx`: a third line in the `0.13.0` entry. A third
gun on Loadout, the Cannon: one heavy round a second, 40 damage each, four
to a clip and a 2.5 s reload, out to 260 m with almost no spread; three
rounds wreck a Razor, four a Brute; bots carry it, and a custom lobby can
make it everyone's one gun. The facts are the `WEAPONS` row's and the
hulls (40 × 3 = 120 ≥ 100; 40 × 3 < 135 ≤ 160 = 40 × 4).
`game/index.html`'s description names the guns: "a roof minigun, rocket
pod or cannon".
Checked on `:3000` (headless Chromium): the corner button reads `Patch
notes, v0.13.0`; N opens the drawer on v0.13.0 with its three lines; no
page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 494.48 kB, gzip 145.71 kB); `npm test` 1326 passed (32 files) in
315.0 s (bots 8.4/14.9/16.4; every pin and both digests as after 2b; the
Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`8f07df0dce5b`. `scripts/tailwind-classes.mjs`: every class as Tailwind
writes it.

### 2, the site's copy (2026-10-15)

- `www/src/content/guide/garage.mdx`: its description names the three
  guns; the Weapons table gains a Cannon column (40 a round, 1 round a
  second, 4 rounds, 2.5 s, 260 m, instant hit, about 25 a second); a
  `### Cannon` paragraph: one heavy barrel, each round an instant hit
  almost exactly where you point it out to 260 m, one a second and four
  to a clip; three rounds wreck a Razor, a Brute takes four; the longest
  reach of the three.
- `how-to-play.mdx`: every bot carries a Minigun, a Rocket Pod or a
  Cannon; the garage paragraph says "another machine or gun" instead of
  listing them (the list grows at every step); Aim and fire: the Cannon
  fires one heavy round a second, four to a clip.
- `modes.mdx`: each bot draws a Minigun, a Rocket Pod or a Cannon. "Rocket
  bots hold off at range" stays true: a Cannon bot fights as a `gun`
  (`TACTICS`), as a Minigun bot does.
- `index.mdx`: the garage page's line names the Cannon.
- `www/src/lib/site.ts`: the site's description, "a roof minigun, rocket
  pod or cannon", as `game/index.html`'s.
- `StructuredData.astro` describes the hero video (a roof minigun):
  unchanged. The owner's `README.md` names two guns; it stays as the
  owner wrote it.

The facts come from the game's code: the `WEAPONS` row, `sustainedDps`
(160 / (4 + 2.5) = 24.6, the garage's "25 dmg/s"), the hulls, `armBot`
(a bot's gun drawn from the whole roster), `TACTICS` by kind.

The site's gates:
- `npm run lint`: clean.
- `npm run check`: `nakama.check: ok`.
- `npm run build`: 0 errors, 0 warnings, 0 hints; 12 pages. The built
  `docs/garage.html` carries the Cannon's column and paragraph, and the
  home page's description the three guns.

### Step 2, the owner's follow-ups (2026-10-15)

The owner restarted the local game server on the Cannon's build and asked
for the Cannon online in Chrome and the three open items fixed: its sound,
the lobby form's gun row, the README.

**The Cannon online, in Chrome on a real GPU** (Chrome 155, the M1 Pro; the
server on `:7360` at `8f07df0dce5b`; Nakama up; the second player a
headless page, a guest of its own, in the Razor with the Cannon). Chrome
picked the Cannon on the Brute in the garage by the keyboard and searched
team deathmatch on the Scrapyard.
- The first pairing was missed: the scratch script for the second page
  accepts only its first ready check, and Chrome's first one expired
  unanswered. With the script started again, the next one paired them.
- Room `ea1441`: Chrome in seat 0 (Brute, Cannon), the other page in seat
  4 (Razor, Cannon), as each page saw the other. The HUD showed the
  Cannon's icon, `4 / 4`, `CANNON · LMB`, hull 135.
- The trigger held 8 s: the clip, every half second, `3 3 2 2 1 1 0R 0R 0R
  0R 0R 3 3 2 2 1`: a round a second, the 2.5 s reload, then firing
  again. Five rounds, damage dealt +200: each hit. F3: 146 corrections on
  the grid, max 0.10 m (the wait for the other page), 147 and max 0.25 m
  after.
- Leave match: back in the garage, `window.match` undefined, no console
  error. The other page stayed its 300 s and left. The stored loadout went
  back to the Brute with the Rocket Pod, and the tab closed.

**The Cannon's own sound.**
- `view/sounds.ts`: `cannon(seed)`, 1.1 s: a sharp crack over a deep thump,
  the blast's roar closing down into a rumble, then the breech clanking
  back. Its loudness, RMS by window (0–50 ms, 50–200, 200–500, 0.5–1 s):
  0.75–0.78, 0.52–0.57, 0.23, 0.05–0.06; the rocket's launch 0.67, 0.47,
  0.20, 0.05; the Minigun's round 0.59, 0.20, then nothing.
- `view/audio.ts`: the cue `cannon` (two variants, gain 0.7, full volume
  out to 14 m, six at once, ±6 % pitch).
- `view/view.ts`: `FIRE_CUE` and `SPINS`, by kind, became `GUN_SOUNDS`, by
  weapon: the cue, whether barrels spin while the trigger is held, the
  camera's kick on the player's own shot. Minigun `shot`, spins, no kick;
  Rocket Pod `launch`, 0.06, as before; Cannon `cannon`, no spin, 0.1. The
  compiler asks every new weapon for its row.
- In Chrome, practice with the Cannon, every buffer started counted by its
  length for 6 s of the trigger held: six of 1.1 s (the player's five
  rounds and a bot's), beside the bots' Minigun rounds (0.18 s) and
  rockets (0.9 s). No console error.

**The lobby form's gun row.** `screens/lobbies/LobbyForm.tsx`: the Weapons
choice is now chips that wrap (the Pickups row's chips, `CHIP` and
`CHIP_ON` shared), not one joined `Segmented` row; still a radiogroup of
radios. In Chrome: All, Minigun, Rocket Pod, Cannon in one row of the 429 px
drawer, the Cannon picked; with four more chips put in the page by hand
(Shotgun, Laser, Homing missiles, Mines), three rows, inside the drawer.

**The README**: the Guns line names the Cannon (one heavy round a second,
four to a clip, out to 260 m).

**The docs**: `ARCHITECTURE.md`'s weapon how-to gains its sound (a
`GUN_SOUNDS` row; a cue of its own in `sounds.ts` and `audio.ts`), and its
kind list loses `FIRE_CUE` and `SPINS`; PLAN.md's recipe and step 6's kind
list the same.

Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 495.21 kB, gzip 145.89 kB); `npm test` 1326 passed (32 files) in
316.1 s (bots 8.4/14.9/16.4; every pin and both digests as after 2b; the
Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`402af38b9b70`; one comment left the form after it (lint, format and tsc
clean again). `scripts/tailwind-classes.mjs`: every class as Tailwind
writes it.
Gate B on `402af38b9b70`: `browser-match.mjs` every check ok, 105.1 s
(room `973728`; `a` held W 12 s: 20.7 m on `b`'s screen); `custom` every
check ok, 86.4 s.

## Step 3 — the Docks, a map

### 3a The Docks, unlisted (2026-10-15)

- `content/arenas/docks.ts`: `buildDocks(seed)`, out of `MAPS`. A container
  terminal at dusk, 236 × 216 m to drive on (x ±118, z −112 to 104), the
  quay along the south edge.
  - The yard: twelve blocks between a grid of lanes (north–south at x
    −109 and 109, the end roads, and −50, 0, 50; east–west at z −104, the
    warehouse road, −46 and 8). Each block has a trade: rows of stacks
    (five blocks), a canyon of empties four and five high with a gap
    across, reefers on their power racks, a tank farm with a pipe rack
    over the warehouse road, customs (the inspection shed, a scanner
    portal, cabins, barriers), a stack fire (boxes knocked over and burnt,
    one still burning, a plume), a forklift yard, a transit shed (a brick
    building from the City's kit, its loading dock, trailers).
  - The apron (z 56 to 104): three ship-to-shore cranes on their rails,
    open below 8 m so cars drive through them either way; boxes staged
    under them, two straddle carriers, bollards along the edge.
  - The middle lane: the crews' starts just inside each end's gate, three
    rows of two; a straddle carrier parked where the main lane crosses it,
    and four boxes set down along it, so the bases don't see each other
    down it. Free for all: sixteen starts round the edges (the warehouse
    road, the apron's two roads, the end roads). Ten hot zones.
  - The bounds: warehouses wall the north side (the City's brick
    buildings), fences the ends, a gate in each, the quay's edge the
    south; an invisible wall behind each. Past them, scenery only: the
    moored ship and its deck cargo, the quay wall and the water, a
    breakwater with its light, the terminal running on with more cranes,
    the city to the north.
  - Bots' roads: every lane and road, the apron's two roads joined
    between the cranes, a ring of four round the carrier.
- `content/arenas/kit/port.ts`: the docks' pieces. `containerKit`:
  shipping containers by the hundred, instanced (one draw call per size
  for the bodies, each its own paint, one for the frames); `stsCrane`,
  `straddleCarrier`, `forklift`, `bollard`, `floodMast`, `fence`,
  `gatehouse`, `ship`.
- `render/materials/library.ts`: `water`.
- Built headless by a scratch test (not committed) that checks it as
  `arenas.test.ts` checks a map: 221 ms, 318 colliders (275 box, 43
  cylinder), 16 starts, bases 6+6, 10 zones, 63 nodes and 80 links in one
  piece, digest `0f3a67c2` build after build. Every start clear of
  anything solid for every vehicle; 37 item spots (16 needed); team
  deathmatch and free for all each seat 12. Every nav link swept with a
  2.8 m slab every metre: none blocked (the sweep does catch the carrier
  across the main lane, and passes the canyon's gap).
- A first look in Chrome (the Docks put in `MAPS` in the working tree for
  it, and taken out again): practice team deathmatch, the F3 line `ARENA
  0f3a67c2`, as headless. It showed one bug: the ship's deck cargo floated
  over the middle of the yard (its boxes went into the world-space kit in
  the ship's own frame). `ship()` now takes its berth; the second look:
  gone. Not looked at yet: the whole map from every side, the minimap, the
  ground paint, the frame rate.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 495.29 kB, gzip 145.92 kB); `npm test` 1328 passed (32
  files: `repo.test.ts`'s lines for the two new files) in 317.4 s (bots
  8.4/14.9/16.4; every pin and both digests as before: nothing draws the
  Docks yet; the Brute at 100 ms: 1 correction on the grid, 0 in the
  drive). Build id `599cd3580112`. `scripts/tailwind-classes.mjs`: every
  class as Tailwind writes it.

### 3a, the look in Chrome (2026-10-15)

The Docks put in `MAPS` in the working tree for the look ('The Docks',
'Pulling into the docks', both modes, `buildDocks(3)`, the City's card as a
stand-in), and taken out again before the commit. Chrome 155, "ANGLE Metal
Renderer: Apple M1 Pro", quality high, resolution scale 1, the page 1372 ×
882; practice team deathmatch, then free for all, against Normal bots. A
free camera put in the page's `match.frame` for the look (scratch, in the
console), so every side could be seen while the bots played.

- **Looked at:** both bases and their gates from outside the fences and
  down the middle lane; the apron along both roads and under the cranes;
  the ship, the quay's edge and the water, from the apron and from the
  harbour; the canyon; the stack fire; customs and its scanner; the reefer
  racks; the tank farm; the warehouse road; the forklift yard; the transit
  shed; the carrier on the main crossing; the whole map from above and
  from each corner; the minimap; the ground paint.
- **What looked wrong, and the fixes:**
  - The cranes and the straddle carriers wore `materials.paint`, the
    Scrapyard's welded plates in two colours, which on a 30 m crane reads
    as leopard print. They are painted steel now (`materials.bodywork`, the
    buses' and trucks' big smooth panels): the outer cranes red, the
    middle one and the carriers ochre, the spreaders ochre.
  - Every container was rust from end to end: the corrugated recipe's rust
    0.6, and each box's tint darkens its rust too, so the patches came out
    as black camouflage. `materials.corrugated` takes the rust now (0.6 by
    default, as the Scrapyard's and the City's boxes keep): the docks' boxes
    0.2, the crane houses and the carriers' cabs 0.3.
  - The transit shed's trailers stood nose to the dock. Their axles are at
    the dock end now, two landing legs down at the front.
- **Looked right:** the bases inside their gates, the boom and the jersey
  barriers past each; the middle lane's boxes and the carrier breaking the
  line of sight between the bases; the canyon, walls four and five high
  with its gap; the fire's charred boxes, its glow and plume; the CUSTOMS
  portal; the reefer racks and their lamps; the tanks; the brick warehouses
  along the north road with the city behind; the ship along the quay, its
  deck cargo, the bollards and the quay's yellow line; the light pools,
  the lane lines, the rails, the puddles. The minimap: the stacks, the
  tanks as circles, the lanes paler, the north side dark past the wall.
- **Frame rate**, the page's own requestAnimationFrame counted for 3 s at
  each of nine views a car's height up: the Docks 90 to 99 frames a second
  (the bases, the apron both ways, the yard north from the apron, the
  canyon, the fire, the quay toward the ship, the warehouse road); The
  City, the same way at nine of its own (both bases, downtown, the gas
  station, the bus depot, corner to corner, its east edge, the glass
  tower, the building site): 72 to 88. Live, driving the warehouse road:
  92.
- The digest after the fixes, headless (the scratch check): `0f3a67c2`, as
  before (meshes and materials play no part in it); 318 colliders, every
  start clear, 37 item spots, no nav link blocked, both modes seat 12.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 495.30 kB, gzip 145.92 kB); `npm test` 1328 passed (32 files) in
  313.3 s (bots 8.4/14.9/16.4; every pin and both digests as before; the
  Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `a8aa685daacd`.

### 3b The Docks listed; two new pins (2026-10-15)

- `content/arenas/maps.ts`: the `docks` row ('The Docks', its card, the
  arrival line 'Pulling into the docks', team deathmatch and free for all,
  `buildDocks(3)`). The arena screen, the lobby form's Arena row, the
  lobbies' filter, Classic's tickets and the server's arenas follow from
  `MAPS` (nothing else names a map outside the tests).
- `public/maps/docks.jpg`: the card, 1010 × 470, rendered from the game in
  Chrome on the M1 Pro (the window sized to the card's ratio, 1440 × 670,
  the free camera 26 m up over the east end of the yard, looking west
  along the quay into the sunset: the cranes over the ship, the transit
  shed, the fire, bots fighting); the canvas scaled to the card's size,
  JPEG at 80 %, 158 KB (the City's 151 KB).
- `server/digests.json`: `"docks": "0f3a67c2"`.
- **Two new Classic pins** (`server/server.test.ts`, `GOLDEN`): a whole
  match of bots on the Docks, hashed. `server.test.ts` run alone with the
  two rows pending: exactly those two failed, its other 188 checks passed,
  the six old pins as they were. Pinned as played:
  - Classic tdm The Docks `8ffc710e18cfe35f`
  - Classic ffa The Docks `0fac0bb9141d2937`
- `game/AGENTS.md`: the code map's `docks.ts` and `kit/port`; the tests'
  list: every arena built headless, Classic's six.
- **The nav-link sweep** (every road link swept with a car-wide slab every
  metre, as 3a's scratch check does) was tried on all three maps before
  putting it in `arenas.test.ts`. The Docks: 80 links, none blocked. The
  Scrapyard: the four chords of the ring round its centre cut through the
  centre piece (2.8 m and 2.0 m slabs both, at about 8 m from the middle).
  The City: one link, (56, 83) to (56, 110), grazes something at (56, 87)
  with the 2.8 m slab (clear at 2.0 m). Fixing those graphs would move
  both maps' digests and every pin played on them, so the sweep stays out
  of the test: noted for the owner.
- **Classic's time to a match with three arenas.** Tickets group only by
  mode and arena, so a third arena splits searching players six ways, not
  four. A scratch simulation on the real matcher (`createMatchmaker`):
  people arriving at random, each picking a mode and an arena, everyone
  accepting at once, matches 10 minutes, a search given up after 5
  minutes; ten hours a run. The median wait is 0 s throughout (most
  searches backfill a running room on their arena); the slow tail:

  | Searches a minute | Two arenas, p90 / gave up | Three arenas, p90 / gave up | Three, 60 % on the first arena |
  |---|---|---|---|
  | 0.5 | 173 s / 30 % | 174 s / 45 % | 186 s / 33 % |
  | 1 | 144 s / 13 % | 166 s / 23 % | 171 s / 21 % |
  | 2 | 83 s / 3 % | 132 s / 7 % | 98 s / 9 % |
  | 4 | 30 s / 0 % | 52 s / 1 % | 50 s / 1 % |
  | 8 or more | 30 s / 0 % | 30 s / 0 % | 30 s / 0 % |

  Below about four searches a minute the third arena costs: more people
  wait out the search alone. "Any arena" (PLAN.md step 3) is the fix if
  that's the traffic; it's a change of its own, the owner's call.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 515.85 kB, gzip 152.52 kB: the Docks' builder and kit, +20.6 kB,
  +6.6 kB gzipped); `npm test` 1379 passed (32 files: the Docks through
  the arena checklist, the server's per-arena checks, the two pins) in
  319.1 s (bots 8.4/14.9/16.4; Classic's six and the two custom pins as
  above; the digests `227c4ce7`, `8913ad26`, `0f3a67c2`; the Brute at
  100 ms: 0 corrections on the grid, 0 in the drive). The Docks headless
  in the arena test: built in 161 ms, 318 colliders, starts 16, bases 6+6,
  10 zones, 63 nodes and 80 links; both modes at 12. In a server room: 17.1
  KB/s down a player, snapshots 456 B on average, the room's step 0.079 ms
  on average. Build id `463c1989bb18`.

### Step 3's checks (2026-10-15)

On `2bc78f9`, build `463c1989bb18`.

**Gate C, arena parity**: `node scripts/arena-parity.mjs` (headless
Chromium 153, SwiftShader WebGL2): `ok scrapyard 227c4ce7`, `ok city
8913ad26`, `ok docks 0f3a67c2 (expected 0f3a67c2), 318 colliders, built in
2098 ms`; 19.5 s.

**The match smoke**: a game server of this build on `:7361` (`PORT=7361 npm
run server`: protocol 7, build `463c1989bb18`; the owner's on `:7360` left
as it was), Nakama on `:7350`. `SITE_URL=http://127.0.0.1:7361 node
scripts/match-smoke.mjs`: `ok scrapyard ... arena 227c4ce7 as expected`,
`ok city ... 8913ad26`, `ok docks: seated in room 949cb6, seat 0 of 8,
arena 0f3a67c2 as expected, build 463c1989bb18`, `ok cleanup: the guest
deleted`. `NET_RUNBOOK.md` steps 5 and 7b name the Docks now.

**Gate C, the probes on the Docks**, ten matches each, seeds 2 to 11, the
player in the Razor with each gun in turn, then in the Brute:

| Run | Kills a match | Overtime | Player K / D | Brute K/D, Razor K/D (every seat) | Minigun, Cannon, Rocket Pod K/D |
|---|---|---|---|---|---|
| tdm, Minigun | 113.6 | 0/10 | 12.6 / 15.8 | 1.11, 0.92 | 0.83, 1.08, 1.30 |
| tdm, Rocket Pod | 114.2 | 3/10 | 17.7 / 13.9 | 1.13, 0.91 | 0.71, 1.01, 1.32 |
| tdm, Cannon | 116.6 | 0/10 | 16.0 / 14.7 | 1.09, 0.93 | 0.79, 1.06, 1.24 |
| tdm, Brute | 112.3 | 1/10 | 15.1 / 13.6 | 1.12, 0.85 | 0.82, 1.01, 1.33 |
| ffa, Minigun | 113.2 | 1/10 | 12.8 / 15.0 | 1.19, 0.86 | 0.83, 1.06, 1.31 |
| ffa, Rocket Pod | 114.3 | 3/10 | 14.5 / 14.0 | 1.17, 0.88 | 0.88, 1.00, 1.13 |
| ffa, Cannon | 119.1 | 4/10 | 14.0 / 15.8 | 1.13, 0.91 | 0.92, 0.98, 1.19 |
| ffa, Brute | 114.4 | 4/10 | 15.5 / 13.5 | 1.15, 0.82 | 0.87, 1.03, 1.19 |

Respawn `waitMismatches 0` and `alternationErrors 0` in every run; 32 to 34
s a run. The Docks play between the other two: kills a match 112 to 119
(the Scrapyard 97 to 113, The City 116 to 121 at steps 1 and 2). By
vehicle and by gun they come out as on the other maps (the Brute 1.13 and
the Razor 0.89 at step 1; the Rocket Pod ahead in bots' hands, the
Minigun behind, the Cannon even at step 2): nothing on the map favours a
machine or a gun.

**Gate B** (the global Playwright's headless Chromium, SwiftShader), on
`2bc78f9`:
- `node scripts/browser-match.mjs`: every check ok, 125.8 s. Room
  `480c97`, seats 0 and 4, two people. `a` held W 12 s, then S 12 s: 1.0 m
  forward (nose to something) and 10.8 m back on `b`'s screen (0.2 m in
  5 s with no key). `a` drew 4 frames a second, its clock at 17 %; its F3
  line read 173 corrections, max 2.77 m. `a` left, and seat 0 was
  "Sawtooth" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 86.9 s.

**Chrome, on a real GPU** (Chrome 155, the M1 Pro), on `:3000`:
- The arena screen: Team Deathmatch pages Scrapyard, The City, The Docks
  ("ARENA 03 / 03", its card 1010 × 470 loaded); Free for All the same
  three.
- Custom: the lobbies' Arena filter reads All arenas, Scrapyard, The City,
  The Docks; at 1440 px the filter row now wraps its last group (Any, Open
  slots) onto a second line, as it is laid out to. The Create lobby
  drawer's Arena row: Scrapyard, The City, The Docks, 353 px of the
  drawer's 437, on one line.

**Classic on the Docks, online, in Chrome.** The owner's server on `:7360`
runs an older build, which doesn't know the Docks, so a server of this
build ran on `:7361` and the game was built for it (Vite's build API in
development mode, `VITE_GAME_SERVER` at `:7361`, as `browser-match.mjs`
builds it) and served on `:7363`; Nakama on `:7350`. Chrome, a guest, the
Brute with the Rocket Pod, searched team deathmatch on the Docks; a
headless page (scratch), another guest in the Razor with the Cannon,
searched the same.
- The server: `proposal created ... map docks ... waited 30014`, `room
  opened fd7ae2 ... docks, humans 2, bots 6`, Chrome in seat 0, the other
  page in seat 4.
- Chrome's F3: `ROOM fd7ae2 seat 0 2 people playing`, `ARENA 0f3a67c2`
  (the welcome's digest and the page's agree, or the page would have been
  refused). Hull 135, `ROCKET POD · LMB`, the other page's seat a
  `razor/cannon`.
- Chrome's tab was hidden throughout (the window behind others: no
  requestAnimationFrame), so its frames were stepped by hand, about 47 a
  second, from the console. The trigger held 5 s: the pod's six rockets
  away (`5 4 3 2 0`), reloaded to 6. The F3 line ended at 1,419
  corrections, max 0.71 m, most of them from before the hand-stepping,
  while the server repeated the page's last input (6,048 repeats in its
  `left` line). How it feels isn't measured this way: that's the owner's
  look with the window in front.
- Leave match: back in the garage, `window.match` undefined; the server
  logged `left ... seat 0, seconds 178`; no token in its log. Every
  scratch process stopped after (the `:7361` server, the build's server,
  the second page); the owner's `:7360` server was left as it was, and
  the owner's stored loadout on `:3000` wasn't touched (the check's lived
  on `:7363`).

### 3, patch notes (2026-10-15)

`screens/PatchNotesPanel.tsx`: a fourth line in the `0.13.0` entry. A third
arena, The Docks, a container terminal at dusk: lanes between twelve
blocks of containers, each with its own cover (stacks, a canyon of
empties, reefer racks, a tank farm, customs, a stack fire, a forklift
yard, a transit shed); three ship-to-shore cranes along the quay, open
below to drive under, over a moored ship; the crews start inside a gate at
each end of the middle lane; ten places for Free for All's hot zone; both
modes, in practice, Classic and custom lobbies. The facts are `docks.ts`'s
(`BLOCKS`, `CRANES`, `bases`, `zones`) and the `MAPS` row.
`game/index.html`'s description names no arena: unchanged.
Checked on `:3000` (headless Chromium): the corner button reads `Patch
notes, v0.13.0`; N opens the drawer on v0.13.0 with its four lines; no
page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 516.36 kB, gzip 152.76 kB); `npm test` 1379 passed (32 files) in
318.6 s (bots 8.4/14.9/16.4; Classic's six and the two custom pins, the
three digests as after 3b; the Brute at 100 ms: 0 corrections on the grid,
0 in the drive). Build id `d5781d7b8136`.

### 3, the site's copy (2026-10-15)

- `www/src/content/guide/arenas.mdx`: its description names the three
  arenas; "All three arenas host both modes"; a `## The Docks` section with
  its card (`src/assets/maps/docks.jpg`, the game's `docks.jpg`, as the
  other two cards are the game's): the lanes between twelve blocks and
  their cover (rows of stacks, the Canyon of empties four and five high,
  reefers on their power racks, a tank farm, customs with its scanner, a
  stack still burning, a forklift yard, a transit shed), the quay under
  three ship-to-shore cranes open below, the moored ship, the warehouses
  and the fences; Team Deathmatch: the crews inside the west and east gates
  at either end of the middle lane, under floodlights, the carrier and the
  boxes breaking the sight line between them; Free for All: the hot zone's
  ten places by name.
- `index.mdx`: its description, "the three arenas"; the Arenas line names
  the Scrapyard, The City and The Docks.
- `how-to-play.mdx`, `faq.mdx` and `modes.mdx` say "the arena" without
  naming them: unchanged. `www/src/lib/site.ts` names no arena;
  `StructuredData.astro` and `lib/hero.ts` describe the hero video (The
  City): unchanged.

The facts come from `docks.ts` (`BLOCKS` and the block builders, `CRANES`
and `stsCrane`, `bases`, the floodlights, the carrier and the boxes on the
middle lane, `zones`) and the `MAPS` row.

The site's gates:
- `npm run lint`: clean.
- `npm run check`: `nakama.check: ok`.
- `npm run build`: 0 errors, 0 warnings, 0 hints; 12 pages. The built
  `docs/arenas.html` carries the Docks' section and its card (AVIF, WebP
  and JPEG sizes); `docs/index.html` names the three arenas.
- `node scripts/tailwind-classes.mjs`: every class as Tailwind writes it
  (233 files).

**The README**: the Arenas list gains The Docks (a container terminal at
dusk: lanes between blocks of stacked containers, ship-to-shore cranes over
the quay, crew bases inside its gates).

## Step 4 — the Scout, then the Buggy

### 4a The Scout, unregistered (2026-10-15)

- `content/vehicles/vehicles.ts`: `SCOUT`, the Scout's spec, exported beside
  `VEHICLES` and outside `ROSTER`, so no draw sees it (as the Brute's was
  at 1a). Its numbers:
  - armour 70 (the Razor's 100, the Brute's 135); mass 1,000 kg;
  - engine 9,300 N, fading to nothing at 36.8 m/s, damping 0.05: 120 km/h,
    0–80 in 3.0 s and 177 hp as the garage quotes them
    (`drivePerformance`); reverse 4,600 N to 12 m/s;
  - brake 39, coast 2.1, handbrake 25: the Razor's per kilogram, so the
    bots' braking plan holds;
  - steering lock 0.62 rad (0.12 at speed), 3.6 rad/s: a 10.3 m turning
    circle (the Razor's 12.1 m, the Brute's 14.5 m);
  - downforce 2.2; suspension rest 0.28 m, travel 0.22 m, stiffness 30,
    compression 2.3, relaxation 2.8; grip the Razor's, drift grip 0.05;
    centre of mass 0.32 m up;
  - wheels of 0.44 m radius at ±0.86 m and ±1.25 m: track 1.72 m,
    wheelbase 2.5 m;
  - two collision shells (the hull from the tail to the nose, the cabin
    under the cage), 1.76 × 1.01 × 4.06 m in all; inertia box 1.76 × 1.02 ×
    4.06 m;
  - the gun's trunnion at (0, 1.90, −0.55), on the cabin's roof, the barrel
    1.15 m;
  - kind "Light raider / Fast", and its blurb.
- `content/vehicles/models/scout.ts`: its body. A stripped coupe, low and
  long in the nose: the bonnet falling to the nose with a scoop on its
  crown and pins at the front; a low greenhouse, the windscreen raked well
  back behind bars, meshed side windows; the cabin in a cage, the turret
  ring in a collar on its roof; mismatched plates over the doors with the
  crest, sill guards, riveted flares, spikes raked along the rear ones; a
  grille, two headlights, a skid plate under a nerf bar with two rally
  lamps and a spike at each end; a wing on uprights over the tail, the
  bumper, tail lights, twin pipes; a side pipe under each door in a
  perforated heat shield.
- `content/vehicles/models.test.ts`: the unregistered Scout's builder (its
  turret ring under the spec's mount, a body to draw); once registered,
  the `MODELS` tests hold it whole.

### Tuning the Scout (2026-10-15)

The Scout put in `ROSTER` and `MODELS` in the working tree for it, and
taken out again before the commit (nothing of it committed).
- The model against its shells (a scratch test): the body spans x ±1.03
  (the side pipes and the flares), y 0.29 (the skid plate) to 1.53 (the
  cage), z −2.24 to 2.38; its shells x ±0.88, y 0.42 to 1.43, z −2.01 to
  2.05. The nerf bar and its spikes are 0.33 m past them, the pipes 0.23
  m (the Razor's plough 0.92 m, the Brute's ram 0.19 m).
- Driven on flat ground, headless, each vehicle (a scratch test): flat
  out, then full lock at speed for 4 s, a slalom, a handbrake turn. The
  Scout reached 120 km/h (the Razor 98, the Brute 85); it leaned at most
  1.1° (the Razor 0.8°, the Brute 0.7°), never left the ground after its
  first settle, never went over. At walking pace on full lock its path
  ran 8.7 m across (the Razor 10.5 m, the Brute 13.0 m).
- In Chrome on a real GPU, the garage: "Scout, LIGHT RAIDER / FAST · 3 /
  3", its sheet 120 km/h, 3.0 s, 177 hp, 1,000 kg, 10.3 m, 70 HP, the model
  on the turntable from the side and the front, the Cannon on its roof.
  The owner's stored loadout, changed by the pager, put back after.
- `server/arenas.test.ts` with the Scout in: 126 passed (its shells clear
  of every start of the three maps). `sim/bots.test.ts`,
  `sim/simulation.test.ts` and the model tests: 111 passed; the bots' kills
  a minute 8.4/14.9/16.4 as before (that test seats Razors).
- The probes, ten matches each, seeds 2 to 11, the player in the Scout;
  the bots draw from all three vehicles:

| Run | Kills a match | Overtime | Player K / D | Scout K/D | Razor K/D | Brute K/D |
|---|---|---|---|---|---|---|
| tdm Scrapyard | 127.1 | 0/10 | 14.1 / 17.7 | 0.86 | 0.99 | 1.22 |
| tdm The City | 127.2 | 2/10 | 17.0 / 16.4 | 0.97 | 0.90 | 1.12 |
| tdm The Docks | 125.2 | 1/10 | 13.6 / 16.4 | 0.88 | 0.91 | 1.25 |
| ffa Scrapyard | 109.9 | 3/10 | 12.6 / 15.5 | 0.81 | 0.97 | 1.32 |
| ffa The City | 123.8 | 0/10 | 15.4 / 15.9 | 0.84 | 0.93 | 1.29 |
| ffa The Docks | 121.6 | 2/10 | 13.6 / 17.3 | 0.82 | 0.97 | 1.29 |

  Respawn `waitMismatches 0` and `alternationErrors 0` in every run. The
  Scout takes the least damage a match (about 1,200, the others 1,500 to
  1,900): it dies sooner, to less. By gun, as before: the Rocket Pod
  ahead, the Minigun behind, the Cannon even.
- Chosen: armour 70, PLAN.md's number. Two direct rockets (76) or two
  Cannon rounds (80) wreck it, one fewer of each than the Razor; it stays
  the machine that can't take the hits, which the garage's blurb says. In
  bots' hands it comes out at 0.81 to 0.97, about where the Razor sat
  beside the Brute at step 1 (0.89): the hull alone tells the vehicles
  apart in a bot's fight (step 1), and the Scout's speed and turning are
  the player's to use. Matches with Scouts in them have more kills: team
  deathmatch 125 to 127 a match (104 to 121 at steps 2 and 3), free for
  all 110 to 124 (97 to 119).
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 516.36 kB, gzip 152.76 kB: nothing of the Scout in the page yet);
  `npm test` 1382 passed (32 files: the Scout's two tests, `repo.test.ts`'s
  line for `scout.ts`) in 322.3 s (bots 8.4/14.9/16.4; every pin as after
  3b: Classic `f90c1d133397a3da`, `d417a15c916e063e`, `e562e4c10f4751cc`,
  `cb90be5845850b0e`, `8ffc710e18cfe35f`, `0fac0bb9141d2937`; custom
  `f345a411c025004e`, `15c66a55c8dd8f1a`; the three digests; the Brute at
  100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `2b8b5fba1459`. These are the old hashes the re-pin names.

### 4b, before the Scout's registration: two checks that leaned on the draws (2026-10-15)

The Scout registered as 4b would (`ROSTER`, `MODELS`), `server.test.ts`
run alone: the six Classic pins and the 12-seat custom pin failed, as
expected, the 2-seat one didn't move (its two seats draw the Brute out
of three as out of two: 4b below), and two checks failed that
aren't pins:
- "tdm on scrapyard, 12 seats: the match ends by itself, after the empty
  seat is taken back (6892 steps)". With Scouts drawn, the custom room's
  kill limit of 25 came at 114.9 s, inside the window its seat 11 stays
  empty (60 s to 120 s), so the match no longer ran past the seat's
  return, which is what the check is for.
- "a seat taken mid-match is the bot's until the page's first input: 8 s
  on it has driven 22 m and fired ...". Broken down in a scratch test:
  the bot on the seat drove 22 m, kept the newcomer's name and a bot's
  copy of their Minigun, but didn't fire: with the new draws nothing came
  into its range in those 8 s.

Both are the draws, not a fault, and both checks are kept to what they
say, in a commit of their own before the Scout goes in (the registration
then moves only what the registry moves):
- The handover check waits a second at a time until the bot has fired,
  8 s at least (the distance it drives), 15 s at most; the minute's
  checks after it keep their times (58 s from the join, then 62 s).
- The 12-seat custom room's seat 11 is empty from 30 s to 80 s (it was
  60 s to 120 s): the seat comes back well before the kill limit, which
  the content phase keeps bringing sooner.
- **The re-pin**, of that one pin, for the window alone (the registries
  as at 4a): custom tdm Scrapyard, 12 seats `f345a411c025004e` (45 kills,
  135.5 s) → `f2904e2b42df7d73` (47 kills, 128.8 s). `server.test.ts` run
  alone: that one failed, the other 189 checks passed; the handover's bot
  fired within the 8 s (34 m), as before.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 516.36 kB, gzip 152.76 kB); `npm test` 1382 passed (32 files) in
  318.8 s (bots 8.4/14.9/16.4; Classic's six as after 3b; custom
  `f2904e2b42df7d73` and `15c66a55c8dd8f1a`; the handover: 8 s, 34 m, fired;
  the Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `2b8b5fba1459` (tests aren't in it).

### 4b The Scout registered; the re-pin (2026-10-15)

- `content/vehicles/vehicles.ts`: the Scout's spec in `ROSTER` (`scout`),
  after the Brute; `SCOUT` and its comment go. `content/vehicles/models.ts`:
  its `MODELS` entry. `models/scout.ts` reads `VEHICLES.scout`.
  `models.test.ts`'s unregistered block goes; the `MODELS` tests hold the
  Scout whole now.
- `game/AGENTS.md`'s code map: `models/` lists `scout.ts`.
- **The re-pin.** Bots draw their vehicles from the registry (`recruits`,
  `modes/roster.ts`), so with three in it the bots' seats draw anew. The
  old hashes came out in 4a's gate A (`d501331`) and the prep's
  (`143b4ad`), the Scout's code in and unregistered. `server.test.ts`, run
  alone with the Scout registered: exactly these seven failed, its other
  183 checks passed (the handover's bot fired 11 s on, 18 m driven; the
  12-seat room ran to 112.1 s, past its empty seat's return at 80 s).
  - Classic tdm Scrapyard `f90c1d133397a3da` → `15e478f978a40703`
  - Classic tdm The City `d417a15c916e063e` → `5c3e4e490cfe077a`
  - Classic ffa Scrapyard `e562e4c10f4751cc` → `ec13a333c1f2e762`
  - Classic ffa The City `cb90be5845850b0e` → `16dbc038efcc375b`
  - Classic tdm The Docks `8ffc710e18cfe35f` → `b3006c4565b5aea2`
  - Classic ffa The Docks `0fac0bb9141d2937` → `c881bc364a7f3579`
  - custom tdm Scrapyard, 12 seats: `f2904e2b42df7d73` (47 kills) →
    `681bbad0a10aae59` (42 kills, 112.1 s)
  The custom ffa The City, 2 seats, stays `15c66a55c8dd8f1a`: its two
  seats' vehicle draws are 0.583 and 0.664 (`recruits`' stream, seed 1234),
  the Brute both, out of three as out of two (out of four they'd be the
  third vehicle's). The yard's two
  pins don't move (Razors by hand); the digests don't; `PROTOCOL` stays 7.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 520.67 kB, gzip 154.04 kB: the Scout's builder in the page, 4.31
  kB more, 1.28 kB gzipped); `npm test` 1390 passed (32 files: the Scout's
  eight model tests, the unregistered block's two gone) in 319.0 s (bots
  8.4/14.9/16.4; the new pins above; the yard's and the three digests as
  before; journal 572 KB for 10.1 min; the handover: 11 s, 18 m, fired;
  the Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `da6f0f2d046b`.

### The Scout's checks (2026-10-15)

On `536393b`, build `da6f0f2d046b`.

**Gate B** (headless Chromium, SwiftShader):
- `node scripts/browser-match.mjs`: every check ok, 106.6 s. Room `c6e0a7`,
  seats 0 and 4, two people. `a` held W 12 s: 20.7 m on `b`'s screen (0.0
  m in 5 s with no key). `a` drew 3 frames a second, its clock at 15 %;
  its F3 line read 417 corrections, max 5.56 m. `a` left, and seat 0 was
  "Sawtooth" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 90.2 s.

**Gate C**: the probes once more on this tree, the six runs of the tuning
(the player in the Scout, both modes on the three arenas, seeds 2 to 11):
every report line the same as the tuning's, byte for byte.

**Chrome, on a real GPU** (`:3000`; the tab behind other windows, its
frames stepped by hand from the console where a match ran):
- The garage's pager: Razor "1 / 3", Brute "2 / 3", Scout "3 / 3".
- Practice, team deathmatch on the Scrapyard, in the Scout with the
  Cannon: the player's machine a `scout`, hull 70. W held (a `keydown`
  with its `code`): 39 km/h in the first second, 21.5 m, then nose into
  the scrap. Exit to garage; the owner's stored loadout put back.

**Classic in the Scout, online** (a scratch copy of `browser-match.mjs`,
each page's stored loadout set: `a` the Scout with the Rocket Pod, `b` the
Brute with the Cannon), on this tree: every check ok, 128.3 s. Room
`ed5e7c`, seats 0 and 4, two people.
- Each page played in its own vehicle and gun and saw the other's: `b`'s
  page showed `a`'s seat as `scout/rocketPod`, hull 70, wheels 0.44 m; `a`'s
  showed `b`'s as `brute/cannon`, hull 135, wheels 0.58 m. At GO: 0
  corrections on either page.
- `a` held W 12 s: 24.1 m on `b`'s screen (0.0 m in 5 s with no key); 3
  frames a second, its clock at 17 %; 138 corrections, max 7.15 m.
- `a` held the trigger 15 s: the clip, each second, `5 4 3 2 2 1 0R 0R 0R
  0R 4 3 2 1 0R` (two rockets a second, the 3.5 s reload, in the page's
  slowed time); its HUD's panel `6 / 6 RELOAD` before.
- `a` left, and seat 0 was "Sawtooth" again; no token in the server's log.

### 4, the Scout's patch notes (2026-10-15)

`screens/PatchNotesPanel.tsx`: a fifth line in the `0.13.0` entry. A third
machine in the garage, the Scout, a light raider: 70 hull points and 1,000
kg; 120 km/h, 0–80 in 3.0 s and a 10.3 m turning circle, the quickest off
the line and the tightest in the turns, but two direct rockets or two
Cannon rounds wreck it; bots drive it too. The facts are the `ROSTER` row,
`drivePerformance` and the garage's turning circle (38 × 2 = 76 ≥ 70; 40 × 2
= 80 ≥ 70). `game/index.html` names no machine: unchanged.
Checked on `:3000` (headless Chromium): `Patch notes, v0.13.0`; N opens
the drawer on v0.13.0 with its five lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 520.95 kB, gzip 154.13 kB); `npm test` 1390 passed (32 files) in
320.0 s (bots 8.4/14.9/16.4; every pin as after 4b; the handover: 11 s;
the Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`ce91152dac68`.

### 4, the Scout on the site (2026-10-15)

- `www/src/content/guide/garage.mdx`: its description names the three
  machines; the Machines table gains a Scout column (light raider, fast;
  70 points; 1,000 kg; 120 km/h; 3.0 s; 177 hp; 10.3 m); "Bots drive all
  three"; a `### Scout` paragraph (a stripped coupe on a cage, low and long
  in the nose, the gun on the cabin's roof and a wing on the tail; the
  quickest off the line and the tightest in the turns; 30 points less hull
  than the Razor: two direct rockets or two Cannon rounds wreck it); the
  Rocket Pod's and the Cannon's paragraphs: two wreck a Scout, three a
  Razor, a Brute takes four.
- `how-to-play.mdx`: every bot drives a Razor, a Brute or a Scout.
- `index.mdx`: the garage page's line names the Scout.
- `www/src/lib/site.ts` and the structured data name no machine:
  unchanged.
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages, the built
  `docs/garage.html` with the Scout's column and paragraph;
  `scripts/tailwind-classes.mjs`: every class as Tailwind writes it (234
  files).
- **The README**: the Machines list gains the Scout (70 hull, 1,000 kg, 120
  km/h and the tightest turns; two rockets wreck it).

### 4c The Buggy, unregistered (2026-10-15)

- `content/vehicles/vehicles.ts`: `BUGGY`, the Buggy's spec, exported
  beside `VEHICLES` and outside `ROSTER`. Its numbers:
  - armour 85; mass 1,100 kg; centre of mass 0.42 m up;
  - engine 9,500 N, fading to nothing at 33.6 m/s, damping 0.05: 110 km/h,
    0–80 in 3.4 s and 165 hp as the garage quotes them; reverse 5,100 N to
    11 m/s;
  - brake 43, coast 2.4, handbrake 28: the Razor's per kilogram;
  - steering lock 0.6 rad (0.13 at speed), 3.3 rad/s: an 11.6 m turning
    circle;
  - downforce 2.2; the long suspension: rest 0.42 m (the Razor's 0.3),
    travel 0.45 m (0.25), stiffness 22 (30), compression 2.0, relaxation
    2.4; tyre grip 1.7 (1.6), side grip 1, drift grip 0.07;
  - big wheels, 0.56 m radius, standing out at ±1.02 m on ±1.35 m: track
    2.04 m, wheelbase 2.7 m;
  - two collision shells (the tub and its arms from the belly at 0.6 m to
    the rail, the cage over the seats), 1.44 × 1.28 × 3.6 m in all;
    inertia box 1.4 × 1.3 × 3.6 m;
  - the gun's trunnion at (0, 2.36, −0.2), on a plate on the cage's roof,
    the barrel 1.15 m;
  - kind "Dune buggy / Agile", and its blurb.
- `content/vehicles/models/buggy.ts`: its body. A narrow tub, a skid pan
  under it, plates on its flanks with the crest; a vented cowl over the
  nose; an open tube cage, its front hoop meshed, rails along its roof,
  braces, struts back over the engine, the turret's plate and collar on
  top; two seats and the wheel seen through it; a bar of four lamps on the
  front hoop, two in the nose, a bar round the nose with two spikes; the
  engine bare at the back (block, air filter, headers into two pipes, a
  grate between it and the seats), tail lights, the spare on the tail; at each wheel a
  wishbone from the tub to the hub and a red coilover up to the rail.
- `content/vehicles/models.test.ts`: the unregistered Buggy's builder (its
  turret ring under the spec's mount, a body to draw).

### Tuning the Buggy (2026-10-15)

The Buggy put in `ROSTER` and `MODELS` in the working tree for it, and
taken out again before the commit.
- The model against its shells (a scratch test): the body spans x ±0.91
  (the hubs and arms; the tyres stand out to ±1.24), y 0.45 to 2.06, z
  −2.02 to 2.38 (the spare, the nose bar); its shells x ±0.72, y 0.60 to
  1.88, z −1.62 to 1.98.
- Driven on flat ground, headless, every vehicle the same way (flat out,
  full lock at speed, a slalom, a handbrake turn, then lifted 2 m at speed
  and let land): the Buggy reached 109 km/h and leaned at most 1.5° (the
  others 2.5° to 3.1°), never went over; after the drop its body dipped
  0.35 m and came back with every wheel down (the others the same, 0.35
  to 0.39 m).
- In Chrome on a real GPU, the garage: "Buggy, DUNE BUGGY / AGILE · 4 / 4",
  its sheet 110 km/h, 3.4 s, 165 hp, 1,100 kg, 11.6 m, 85 HP, the model
  on the turntable from the side and the front, the Cannon on its cage.
  The owner's stored loadout put back after.
- `server/arenas.test.ts` with the Buggy in: 126 passed (its shells clear
  of every start of the three maps). `sim/simulation.test.ts` and the model
  tests: 100 passed.
- The probes, ten matches each, seeds 2 to 11, the player in the Buggy;
  the bots draw from all four vehicles:

| Run | Kills a match | Overtime | Player K / D | Buggy K/D | Razor K/D | Brute K/D | Scout K/D |
|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 113.7 | 0/10 | 12.9 / 14.9 | 0.99 | 0.91 | 1.17 | 0.98 |
| tdm The City | 128.9 | 2/10 | 15.6 / 15.6 | 1.04 | 0.95 | 1.19 | 0.90 |
| tdm The Docks | 123.6 | 1/10 | 15.3 / 15.6 | 0.99 | 1.06 | 1.08 | 0.93 |
| ffa Scrapyard | 116.2 | 4/10 | 13.8 / 14.1 | 1.02 | 1.01 | 1.26 | 0.85 |
| ffa The City | 127.5 | 2/10 | 15.2 / 15.3 | 0.99 | 1.04 | 1.25 | 0.84 |
| ffa The Docks | 123.6 | 2/10 | 15.0 / 15.7 | 0.96 | 0.97 | 1.26 | 0.92 |

  Respawn `waitMismatches 0` and `alternationErrors 0` in every run; 32 to
  46 s a run. By gun as before: the Rocket Pod ahead in bots' hands (0.97
  to 1.19), the Minigun behind (0.80 to 0.93), the Cannon between.
- Chosen: armour 85, PLAN.md's number. Two direct rockets (76) don't wreck
  it, three do; three Cannon rounds, as for the Razor. In bots' hands it
  comes out even, 0.96 to 1.04, beside the Razor's 0.91 to 1.06: its hull
  is 15 points thinner, but its narrow tub and cage (shells ±0.72 m, the
  Razor's ±0.95 m) are harder to hit, and the probes can't weigh what a
  player gets from its suspension on the heaps.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 520.95 kB, gzip 154.13 kB: nothing of the Buggy in the page yet);
  `npm test` 1393 passed (32 files: the Buggy's two tests, `repo.test.ts`'s
  line for `buggy.ts`) in 320.8 s (bots 8.4/14.9/16.4; every pin as after
  4b: Classic `15e478f978a40703`, `5c3e4e490cfe077a`, `ec13a333c1f2e762`,
  `16dbc038efcc375b`, `b3006c4565b5aea2`, `c881bc364a7f3579`; custom
  `681bbad0a10aae59`, `15c66a55c8dd8f1a`; the handover: 11 s; the Brute at
  100 ms: 0 corrections on the grid, 0 in the drive). Build id
  `cf8e8eaf740c`. These are the old hashes the Buggy's re-pin names.

### 4d The Buggy registered; the re-pin (2026-10-16)

- `content/vehicles/vehicles.ts`: the Buggy's spec in `ROSTER` (`buggy`),
  after the Scout; `BUGGY` and its comment go. `content/vehicles/models.ts`:
  its `MODELS` entry. `models/buggy.ts` reads `VEHICLES.buggy`.
  `models.test.ts`'s unregistered block goes.
- `game/AGENTS.md`'s code map: `models/` lists `buggy.ts`.
- **The re-pin.** Bots draw their vehicles from the registry, so with four
  in it every bot seat's draw changed. The old hashes came out in 4c's gate
  A (`3213f49`), the Buggy's code in and unregistered. `server.test.ts`,
  run alone with the Buggy registered: exactly these eight failed, its
  other 182 checks passed (the handover's bot fired within 8 s, 50 m
  driven; the 12-seat room ran to 141.5 s, past its empty seat's return).
  - Classic tdm Scrapyard `15e478f978a40703` → `83a621de0bc6dbcd`
  - Classic tdm The City `5c3e4e490cfe077a` → `9bb59523d375d4a2`
  - Classic ffa Scrapyard `ec13a333c1f2e762` → `bf4fee7262bfedb5`
  - Classic ffa The City `16dbc038efcc375b` → `5297d835ec3c74c6`
  - Classic tdm The Docks `b3006c4565b5aea2` → `01989573190d38ee`
  - Classic ffa The Docks `c881bc364a7f3579` → `cfe1bdefa5216e8a`
  - custom tdm Scrapyard, 12 seats: `681bbad0a10aae59` (42 kills) →
    `5095d4fb47d3c254` (45 kills, 141.5 s)
  - custom ffa The City, 2 seats: `15c66a55c8dd8f1a` (5 kills) →
    `a294b287c6969369` (7 kills, 352.6 s): its two draws, 0.583 and 0.664,
    are the Scout's out of four, as 4b worked out.
  The yard's two pins don't move; the digests don't; `PROTOCOL` stays 7.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 524.82 kB, gzip 155.33 kB: the Buggy's builder in the page, 3.87
  kB more, 1.20 kB gzipped); `npm test` 1401 passed (32 files: the Buggy's
  eight model tests, the unregistered block's two gone) in 319.6 s (bots
  8.4/14.9/16.4; the new pins above; the yard's and the three digests as
  before; journal 571 KB for 10.1 min; the handover: 8 s, 50 m, fired; the
  Brute at 100 ms: 0 corrections on the grid, 2 in the drive, max 0.25 m,
  after 2 inputs the server repeated and 1 dropped, timing on a loaded
  machine, as the netplay cases see now and then). Build id
  `1b563103b75d`.

### The Buggy's checks (2026-10-16)

On `cb8d71d`, build `1b563103b75d`.

**Gate B** (headless Chromium, SwiftShader):
- `node scripts/browser-match.mjs`: every check ok, 126.1 s. Room
  `65d072`, seats 0 and 4, two people. `a` held W 12 s (0.2 m, nose to
  something), then S 12 s: 25.2 m back on `b`'s screen (0.0 m in 5 s with
  no key). `a` drew 3 frames a second, its clock at 18 %; 452
  corrections. `a` left, and seat 0 was "Sawtooth" again; no token in the
  server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 87.1 s.

**Classic in the Buggy, online** (the scratch per-loadout copy: `a` the
Buggy with the Minigun, `b` the Scout with the Cannon): every check ok,
123.4 s. Room `24c87f`, seats 0 and 4. Each page played in its own
vehicle and gun and saw the other's: `b` saw `a`'s seat as
`buggy/minigun`, hull 85, wheels 0.56 m; `a` saw `b`'s as `scout/cannon`,
hull 70, wheels 0.44 m; 0 corrections at GO. `a` held W 12 s: 21.7 m on
`b`'s screen. `a` held the trigger 15 s: the belt, each second, `57 51 48
45 39 33 27 21 15 12 6 3 0R 0R 55`. `a` left, seat 0 "Sawtooth" again; no
token in the log.

**Chrome, on a real GPU** (`:3000`, the tab behind other windows, frames
stepped by hand in the match):
- The garage's pager: Razor "1 / 4", Brute "2 / 4", Scout "3 / 4", Buggy
  "4 / 4".
- Practice, free for all on the Docks, in the Buggy with the Cannon (the
  F3 line `ARENA 0f3a67c2`): hull 85; W held from the warehouse road's
  start: 34 km/h after a second, 58 after two, 75 on the screenshot, 37.7
  m. Exit to garage; the owner's stored loadout put back (the Razor with
  the Cannon).

**Gate C**: the probes once more on this tree, the six runs of the tuning
(the player in the Buggy, both modes on the three arenas, seeds 2 to 11):
every report line the same as the tuning's, byte for byte.

### 4, the Buggy's patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`: a sixth line in the `0.13.0` entry. A fourth
machine, the Buggy, a dune buggy: 85 hull points and 1,100 kg; 110 km/h,
0–80 in 3.4 s and an 11.6 m turning circle; big tyres on long-travel arms,
the longest suspension in the garage, so it soaks up the rough ground and
lands on its wheels; three direct rockets or three Cannon rounds wreck it,
as they do a Razor (38 × 2 = 76 < 85 ≤ 114 = 38 × 3; 40 × 2 = 80 < 85 ≤
120); bots drive it too. `game/index.html` names no machine: unchanged.
Checked on `:3000` (headless Chromium): `Patch notes, v0.13.0`; N opens
the drawer on v0.13.0 with its six lines; no page error.
- The first gate A on it (the line first said "three rockets") crawled:
  7,307 s, the machine asleep or throttled while the session waited (the
  six Classic pins took 2,495.8 s to play, 24 s as a rule). Every pin came
  out as after 4d, but `server/client.test.ts` and `server/netplay.test.ts`
  failed at their wall-clock wait, "timed out waiting for GO". Run again
  alone, after "direct rockets":
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 525.18 kB, gzip 155.47 kB); `npm test` 1401 passed (32 files) in
  334.5 s (bots 8.4/14.9/16.4; every pin as after 4d; the handover: 8 s;
  the Brute at 100 ms: 1 correction on the grid, 1 in the drive, max 0.26
  m, after 1 input the server repeated). Build id `9c6f8eedad49`.

### 4, the Buggy on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the four
  machines; the Machines table gains a Buggy column (dune buggy, agile; 85
  points; 1,100 kg; 110 km/h; 3.4 s; 165 hp; 11.6 m); "Bots drive all
  four"; a `### Buggy` paragraph (a tube cage on long-travel arms and four
  big tyres; a narrow tub, the seats in an open cage, the gun on its roof,
  the engine bare at the back; the longest suspension in the garage, so it
  soaks up the rough ground and lands on its wheels; quicker than the
  Razor and a little tighter in the turns, with 15 points less hull); the
  Rocket Pod's and the Cannon's paragraphs: two wreck a Scout, three a
  Razor or a Buggy, a Brute takes four.
- `how-to-play.mdx`: every bot drives a Razor, a Brute, a Scout or a Buggy.
- `index.mdx`: the garage page's line names the Buggy.
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages, the built
  `docs/garage.html` with the Buggy's column and paragraph and the guns'
  counts; `scripts/tailwind-classes.mjs`: every class as Tailwind writes
  it (235 files).
- **The README**: the Machines list gains the Buggy (85 hull, 1,100 kg, 110
  km/h, big tyres on long-travel arms; it soaks up the rough ground and
  lands on its wheels).

Step 4 is done. Every vehicle in the plan is in but the Rammer (step 9):
the Razor, the Brute, the Scout at 70 armour and the Buggy at 85.

## Step 5 — the Shotgun, a gun with pellets

### 5a Pellets, and the Shotgun unregistered (2026-10-16)

- `content/weapons/weapons.ts`: guns take `pellets` (absent, one): the rays
  a shot casts, each its own spread and its own `damage`. `pelletsOf(spec)`
  reads it (one for anything but a gun); `sustainedDps` counts every
  pellet landing. `SHOTGUN_ICON`, its HUD icon in the 64 × 28 box (the
  receiver, the barrel and the tube magazine under it, the pump, the choke,
  the mount), outside `WEAPONS` until 5b.
- `sim/simulation.ts`, `fire`: a gun casts a ray a pellet, each through
  the lag compensation's `castRound` hook (so the server rewinds each one)
  or the present-time cast, and reports each (`shot`, an `sh` on the wire,
  one tracer and impact each); then each machine struck takes the shot's
  pellets on it as one hit, their damage summed (one `hurt`, one hit for
  the fair-play watch, one provocation for a bot). The open point
  (PLAN.md): one damage event a shot per machine hit, not one a pellet. The
  `fired` event goes once a shot. With one pellet every call comes in the
  order it did, and every draw from the match's stream with it.
- `net/client.ts`: online a shot's pellets arrive as an `sh` each, so the
  page fires the gun (its flash, its sound) on the first of them only, the
  same shooter on the same tick being one shot. No gun fires twice in a
  step, so nothing changes for one pellet.
- `sim/ai/think.ts`: a bot fires, and counts a target as in sight, only
  inside its gun's range where that's shorter than its kind's firing
  distance (`TACTICS`: 55 m for a gun). Every gun reaches further than
  that so far; the Shotgun's 45 m doesn't.
- `screens/Garage.tsx`: a gun with pellets says its damage "per pellet",
  and `kindSpecs` gives it a Pellets row ("8 a shot").
- `content/weapons/turrets/shotgun.ts`: the turret on the same yoke: the
  receiver, one wide barrel in a perforated shroud to a choke at 1.07–1.15
  m, the tube magazine under it with the pump, a box of shells on the
  side, a counterweight behind. `turrets.test.ts`: the unregistered turret
  carries its `gun`.
- `view/sounds.ts`: `shotgun(seed)`, 0.7 s: a wide crack and a punchy boom
  over a short thump, then the pump racked back (0.36 s) and forward (0.48
  s). `view/audio.ts`: the cue `shotgun` (two variants, gain 0.65, full
  volume out to 12 m, six at once, ±6 % pitch). Its `GUN_SOUNDS` row comes
  with the registration (the compiler asks for it by `WeaponId`).
- Tests: `sim/simulation.test.ts`, a gun of eight pellets fired once at a
  car 20 m off: fired once, eight rays, all eight on the car, one hit of
  eight pellets' damage (32); `content/weapons/weapons.test.ts`: pellets
  count in `sustainedDps`, every registered weapon casts one.

### Tuning the Shotgun (2026-10-16)

The Shotgun put in `WeaponId`, `TurretKey`, `WEAPONS`, `TURRETS` and
`GUN_SOUNDS` in the working tree for it, and taken out again before the
commit. PLAN.md's start: 8 pellets of ~4, 72 rpm, 6 shots, 2.5 s reload,
~45 m, wide spread; ~26 a second up close.
- The garage (headless Chromium on `:3000`; the Chrome extension wasn't
  connected): Loadout "4 / 4", the Shotgun's sheet: damage 4 per pellet,
  72 rpm, 6 rounds, 2.5 s, 45 m, pellets 8 a shot, firepower 26 dmg/s;
  its turret on the Razor's roof.
- The probes, ten matches each, seeds 2 to 11, the player in the Razor
  with the Shotgun; the bots draw from all four guns. The Shotgun's K/D
  (every seat that carried it, 34 seat-matches a run), and the others':

| Run | Spread 0.05: Shotgun | Spread 0.035: Shotgun | Minigun | Cannon | Rocket Pod | Kills a match |
|---|---|---|---|---|---|---|
| tdm Scrapyard | 0.74 | 0.88 | 0.94 | 1.14 | 1.25 | 113.9 |
| tdm The City | 0.77 | 0.91 | 0.81 | 1.24 | 1.30 | 125.2 |
| tdm The Docks | 0.75 | 0.95 | 0.86 | 1.06 | 1.29 | 121.5 |
| ffa Scrapyard | 0.76 | 0.87 | 1.04 | 1.16 | 1.16 | 111.6 |
| ffa The City | 0.79 | 0.93 | 1.01 | 0.94 | 1.23 | 121.2 |
| ffa The Docks | 0.76 | 0.88 | 1.03 | 1.14 | 1.13 | 122.7 |

  (The other guns' and the kills at spread 0.035.) Respawn checks 0 and 0
  in every run.
- At 0.05 rad the pellets fan out ±1 m by 20 m, where bots circle (14 to
  24 m), and most go wide: the Shotgun dealt 1,100 to 1,280 a match to the
  others' 1,400 to 1,700. At 0.035 it deals 1,260 to 1,420 and comes out
  beside the Minigun, the other gun bots fire from their circle.
- Chosen: 8 pellets of 4, 72 rpm (1.2 a second), 6 to a load, 2.5 s
  reload, 45 m, spread 0.035 (the Minigun's 0.012, the Cannon's 0.002):
  32 a shot when every pellet lands, 25.6 a second sustained. Four full
  shots wreck a Razor, three a Scout or a Buggy, five a Brute; up close, where a
  player takes it, every pellet lands.
- Gate A, on 5a: oxlint 0 warnings, 0 errors; format clean; tsc clean;
  build clean (`App` 525.92 kB, gzip 155.71 kB); `npm test` 1406 passed
  (32 files: the two pellet checks, the `sustainedDps` test, the
  unregistered turret's, `repo.test.ts`'s line for `shotgun.ts`) in 326.3
  s (bots 8.4/14.9/16.4; every pin as after 4d: Classic
  `83a621de0bc6dbcd`, `9bb59523d375d4a2`, `bf4fee7262bfedb5`,
  `5297d835ec3c74c6`, `01989573190d38ee`, `cfe1bdefa5216e8a`; custom
  `5095d4fb47d3c254`, `a294b287c6969369`; the yard's and the three digests;
  the handover: 8 s; the Brute at 100 ms: 0 corrections on the grid, 0 in
  the drive). Build id `4d2d96fe79b4`. These are the old hashes the re-pin
  names: the pellet loop, the bots' reach and the page's one fire a shot
  change nothing for the guns there are.

### 5b The Shotgun registered; the re-pin (2026-10-16)

- `content/weapons/weapons.ts`: `'shotgun'` in `WeaponId` and `TurretKey`;
  its `WEAPONS` row last (a `gun`: 4 a pellet, 8 pellets, 1.2 shots a
  second, 6 to a load, 2.5 s reload, 45 m, spread 0.035; its name, blurb
  and icon, `SHOTGUN_ICON` inline and the constant gone).
  `content/weapons/turrets.ts`: `shotgun` in `TURRETS`; `turrets.test.ts`'s
  unregistered case goes. `view/view.ts`: its `GUN_SOUNDS` row (the cue
  `shotgun`, no spin, a 0.08 kick to the player's camera).
  `weapons.test.ts`: the Shotgun casts eight, every other weapon one.
- What follows by itself: the garage's weapon pager and sheet, the lobby
  form's gun chips and one-gun setting, the wire, the stored loadout, the
  record and the replay. No fixture names the guns: `PROTOCOL` stays 7.
- **The re-pin.** Bots draw their guns from the registry (`armBot` over
  `WEAPON_IDS`), so with four in it every bot's gun changed. The old hashes
  came out in 5a's gate A (`3da098c`), the Shotgun's code in and
  unregistered. `server.test.ts`, run alone with it registered: exactly
  these eight failed, its other 182 checks passed (the handover's bot
  fired within 8 s, 80 m driven).
  - Classic tdm Scrapyard `83a621de0bc6dbcd` → `d0d73fb8efc61035`
  - Classic tdm The City `9bb59523d375d4a2` → `72fa77e654f7e898`
  - Classic ffa Scrapyard `bf4fee7262bfedb5` → `e8c8e38df8e30425`
  - Classic ffa The City `5297d835ec3c74c6` → `9ec3f79b03aa963c`
  - Classic tdm The Docks `01989573190d38ee` → `f353cde11375f87a`
  - Classic ffa The Docks `cfe1bdefa5216e8a` → `cb08df5bd2efc683`
  - custom tdm Scrapyard, 12 seats: `5095d4fb47d3c254` (45 kills) →
    `391b870418332ac0` (49 kills, 167.3 s)
  - custom ffa The City, 2 seats: `a294b287c6969369` (7 kills) →
    `d7f0969b897322a7` (5 kills, 303.0 s)
  The yard's two pins don't move (Miniguns by hand); the digests don't.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
  (`App` 526.95 kB, gzip 156.06 kB); `npm test` 1415 passed (32 files: the
  Shotgun in each table's tests, the turret's unregistered case gone) in
  331.5 s (the new pins above; the yard's and the three digests as
  before; journal 576 KB for 10.1 min; the handover: 8 s; the Brute at 100
  ms: 0 corrections on the grid, 0 in the drive). Build id `5cb82ca54494`.
- One printed number moved besides the pins: `sim/bots.test.ts`'s kills a
  minute, easy 8.4 → 8.4, normal 14.9 → 14.2, hard 16.4 → 15.3 (its bots
  arm through `armBot`, so the Shotgun is in their draws). It isn't a pin;
  its checks pass.

### The Shotgun's checks (2026-10-16)

On `581dc7b`, build `5cb82ca54494`. The Chrome extension wasn't connected:
the browser checks ran in the global Playwright's headless Chromium
(SwiftShader).
- `node scripts/browser-match.mjs`: every check ok, 111.5 s. Room `4b33ec`,
  seats 0 and 4, two people. `a` held W 12 s: 15.2 m on `b`'s screen (0.0
  m in 5 s with no key). `a` drew 4 frames a second, its clock at 18 %; its
  F3 line read 372 corrections, max 36.70 m: the page loads slower than the
  server's 20 s hold under SwiftShader, so the seat's bot drives it until
  the page's first input, and the page then takes the server's word on
  where the car is (the Shotgun run below read 283 corrections, max 9.24 m,
  before GO for the same reason). `a` left, and seat 0 was "Sawtooth"
  again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 86.3 s.
- **Classic with the Shotgun, online** (the scratch per-loadout copy: `a`
  the Razor with the Shotgun, `b` the Brute with the Minigun): every check
  ok, 143.7 s. Room `6c92e9`. Each page played in its own vehicle and gun
  and saw the other's (`b` saw `a`'s seat as `razor/shotgun`, hull 100). `a`
  held W, then S: 24.3 m back on `b`'s screen. `a` held the trigger 15 s:
  its load, each second, `5 4 3 2 1 1 0R 0R 5 4 3 2 1 0R 0R` (a shot about
  a second in the page's slowed time, the 2.5 s reload); its HUD the
  Shotgun's icon and `6 / 6`. `a` left, seat 0 "Sawtooth" again; no token in
  the log.
- The garage (headless, on `:3000`, earlier with the Shotgun in the working
  tree; the same sheet now): Loadout "4 / 4", damage 4 per pellet, 72 rpm,
  6 rounds, 2.5 s, 45 m, pellets 8 a shot, firepower 26 dmg/s.

**Gate C**: the probes once more on this tree, the six runs of the tuning
at spread 0.035 (the player in the Razor with the Shotgun, both modes on
the three arenas, seeds 2 to 11): every report line the same as the
tuning's, byte for byte.

### 5, the Shotgun's patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`: a seventh line in the `0.13.0` entry. A
fourth gun on Loadout, the Shotgun: eight pellets of 4 a shot, 72 shots a
minute, six to a load and a 2.5 s reload, out to 45 m in a wide spread; up
close every pellet lands, 32 a shot, so four shots wreck a Razor, three a
Scout or a Buggy, five a Brute, and further off more of them miss; bots
carry it, and a custom lobby can make it everyone's one gun.
`game/index.html`'s description names the guns: "a roof minigun, rocket
pod, cannon or shotgun". Checked on `:3000` (headless Chromium): the drawer
opens on v0.13.0 with its seven lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 527.31 kB, gzip 156.17 kB); `npm test` 1415 passed (32 files) in
317.0 s (bots 8.4/14.2/15.3; every pin as after 5b; the handover: 8 s; the
Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`a032834d3252`.

### 5, the Shotgun on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the four guns;
  the Weapons table gains a Shotgun column (4 a pellet, 8 pellets a shot;
  1.2 shots a second; 6 shots; 2.5 s; 45 m; 8 pellets, instant hits, a wide
  spread; about 26 a second if every pellet lands); a `### Shotgun`
  paragraph (a pump-action scattergun; eight pellets a shot, 32 when they
  all land: up close they do, and four shots wreck a Razor, three a Scout
  or a Buggy, five a Brute; past 20 m more of them go wide, nothing beyond
  45 m; six shots to a load, a 2.5 s reload).
- `how-to-play.mdx`: every bot carries a Minigun, a Rocket Pod, a Cannon or
  a Shotgun; Aim and fire: the Shotgun throws eight pellets a shot that
  only tell up close.
- `modes.mdx`: each bot draws one of the four.
- `index.mdx`: the garage page's line names the Shotgun.
- `www/src/lib/site.ts`: the site's description, "a roof minigun, rocket
  pod, cannon or shotgun", as `game/index.html`'s; and "in a walled
  scrapyard, a burning city or a container port": the Docks were missed
  there at step 3 (it named two arenas).
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages; the built
  `docs/garage.html` with the Shotgun's column, the home page's
  description with the four guns and the three arenas;
  `scripts/tailwind-classes.mjs`: every class as Tailwind writes it (236
  files).
- **The README**: the Guns line names the Shotgun (eight pellets a shot,
  six shots a load, out to 45 m).

Step 5 is done.

## Step 6 — the Laser, a new kind: `beam`

The owner's call (2026-10-16): a new kind, `beam`, on PLAN.md's numbers
(about 30 a second on target, 120 m, about 4 s of fire to overheat, about
2 s to cool), tuned from there with the probes.

### 6a The beam kind, and the Laser unregistered (2026-10-16)

How it's built: a beam fires pulses, ten a second while the trigger is
held, each pulse a hitscan ray as a gun's round is (cast through the
server's rewind for a person, so each is lag-compensated; written as an
`sh` each). The heat is the weapon's ammo and reload: `magazine` pulses
take it from cold to overheated (its ammo, the heat left to spend, runs
out), overheated it can't fire until it has cooled whole (`reloadTime`, as
a gun reloads), and with the trigger off it cools a pulse at a time,
`reloadTime` from hot to cold. Ten `sh` a second is what the Minigun sends
(twelve), and the snapshot's ammo and reload already carry the heat to the
player's page: no wire event or field changes shape, so `PROTOCOL` stays
7 and no fixture moves. (PLAN.md sketched on, off and target events and a
bump; pulses on the gun's wire need neither.)

- `content/weapons/weapons.ts`: the kind `beam` (`BeamSpec`, its fields
  read as above); `LASER_ICON`, its HUD icon (the power pack, the tube in
  its fins, the lens housing, the mount), outside `WEAPONS` until 6b.
- What the compiler listed, each now handling `beam`: the simulation's
  `fire` (a beam's pulse is a gun's round with one pellet), the recorder's
  `fired` (written whole by `sh`), `TACTICS` (a beam holds the middle
  distance: engage 50 m, circle 20 to 32 m, keep 22 m, fire from 100 m)
  and `flightTime` (none) in `sim/ai/think.ts`, `blastRadius` (none) in
  `sim/ai/perception.ts`, the garage's `ROUND` and `kindSpecs`.
- What it couldn't list:
  - `sim/combat.ts`, `pullTrigger`: the heat (a beam let go cools a pulse
    every `reloadTime / magazine` seconds).
  - `view/effects.ts`: `beam(from, to)`, a pool of sixteen thin glowing
    tubes, each held 0.13 s (a pulse every 0.1 s draws a held beam
    unbroken), and `glint(at)`, the emitter lit as it pulses;
    `view/view.ts` draws a beam's pulse as a beam, not a tracer, lights the
    emitter instead of a muzzle flash and smoke, and no beam whizzes past.
  - `hud/Hud.tsx`: a beam's weapon panel shows its heat, "63% HEAT", the
    bar under it filling with the heat, OVERHEAT (where a gun says RELOAD)
    while it cools whole.
  - `screens/Garage.tsx`: a beam's sheet: damage a second, range, overheats
    after (seconds of fire), cools in, firepower.
  - `view/sounds.ts`: `zap(seed)`, 0.12 s of buzzing tone with a bright
    edge, so ten pulses a second run into a hum; `view/audio.ts`: the cue
    `zap` (three variants, gain 0.35, 10 m, eight at once, ±3 % pitch).
  - `content/weapons/turrets/laser.ts`: a beam projector on the same yoke
    (the power pack, the emitter tube in a stack of cooling fins, the lens
    housing at 1.0–1.14 m with its lens lit, cables, a counterweight).
- Tests: `sim/combat.test.ts` (new): a gun's magazine and reload; a beam
  overheating after 40 pulses, cooling whole and firing again; a beam let
  go cooling a pulse at a time. `sim/simulation.test.ts`: a beam held on a
  car for a second, ten pulses, ten hits, 30 dealt. `turrets.test.ts`: the
  unregistered turret carries its `gun`.

### Tuning the Laser (2026-10-16)

The Laser put in `WeaponId`, `TurretKey`, `WEAPONS`, `TURRETS` and
`GUN_SOUNDS` (the cue `zap`, no spin, no kick) in the working tree for it,
and taken out again before the commit.
- The garage (headless Chromium on `:3000`; the Chrome extension wasn't
  connected): Loadout "5 / 5", the Laser's sheet: damage 30 a second, range
  120 m, overheats after 4.0 s of fire, cools in 2.0 s, firepower 20
  dmg/s; its projector on the Razor's roof, the lens lit.
- Practice (headless), the trigger held: the panel read 3 %, 13 %, 20 %,
  38 % ... 90 % HEAT as the pulses went (its charge 38 down to 4), the bar
  under it filling; let go, 53 % three seconds later. The beam drew as a
  thin bright line from the projector to the crosshair.
- The probes, ten matches each, seeds 2 to 11, the player in the Razor
  with the Laser; the bots draw from all five guns. The Laser's K/D (every
  seat that carried it, 32 seat-matches a run):

| Run | 3 a pulse (30 a second): Laser | 4 a pulse (40 a second): Laser | Minigun | Cannon | Rocket Pod | Shotgun | Kills a match |
|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 0.69 | 0.92 | 0.87 | 0.99 | 1.51 | 0.86 | 117.6 |
| tdm The City | 0.69 | 0.81 | 0.93 | 1.15 | 1.46 | 0.98 | 121.3 |
| tdm The Docks | 0.66 | 0.84 | 0.90 | 1.03 | 1.50 | 1.09 | 121.0 |
| ffa Scrapyard | 0.63 | 0.81 | 1.10 | 1.12 | 1.36 | 0.91 | 108.3 |
| ffa The City | 0.70 | 0.83 | 1.10 | 1.10 | 1.25 | 0.98 | 124.1 |
| ffa The Docks | 0.69 | 0.84 | 1.09 | 1.17 | 1.03 | 1.18 | 119.7 |

  (The other guns' and the kills at 4 a pulse.) Respawn checks 0 and 0 in
  every run.
- At PLAN.md's 30 a second the Laser deals 20 a second over its heat (4 s
  on, 2 s to cool), the least of any gun (the Minigun 33, the Rocket Pod
  35, the Cannon 25, the Shotgun 26), and in bots' hands, whose aim wobbles
  each pulse off the target, it dealt 1,050 to 1,200 a match. At 4 a pulse
  it deals 1,300 to 1,430 and comes out beside the Minigun and the
  Shotgun.
- Chosen: 4 a pulse, 10 pulses a second (40 a second on target), 40
  pulses to overheat (4 s), 2 s to cool, 120 m, spread 0.001: 26.7 a second
  sustained. On target 25 pulses wreck a Razor (2.4 s from the first),
  18 a Scout, 22 a Buggy, 34 a Brute: all inside one heat.
- Gate A, on 6a: oxlint 0 warnings, 0 errors; format clean; tsc clean;
  build clean (`App` 529.13 kB, gzip 156.80 kB); `npm test` 1421 passed
  (33 files: `sim/combat.test.ts`'s three, the beam's simulation check, the
  unregistered turret's, `repo.test.ts`'s lines for `laser.ts` and
  `combat.test.ts`) in 316.4 s (bots 8.4/14.2/15.3; every pin as after
  5b: Classic `d0d73fb8efc61035`, `72fa77e654f7e898`, `e8c8e38df8e30425`,
  `9ec3f79b03aa963c`, `f353cde11375f87a`, `cb08df5bd2efc683`; custom
  `391b870418332ac0`, `d7f0969b897322a7`; the yard's and the three digests;
  the handover: 8 s; the Brute at 100 ms: 0 corrections on the grid, 0 in
  the drive). Build id `aac5a979c246`. `scripts/tailwind-classes.mjs`:
  every class as Tailwind writes it. These are the old hashes the re-pin
  names: nothing that fires a beam is in a match yet.

### 6b The Laser registered; the re-pin (2026-10-16)

- `content/weapons/weapons.ts`: `'laser'` in `WeaponId` and `TurretKey`;
  its `WEAPONS` row last (a `beam`: 4 a pulse, 10 pulses a second, 40 to
  overheat, 2 s to cool, 120 m, spread 0.001; its name, blurb and icon,
  `LASER_ICON` inline and the constant gone). `content/weapons/turrets.ts`:
  `laser` in `TURRETS`; `turrets.test.ts`'s unregistered case goes.
  `view/view.ts`: its `GUN_SOUNDS` row (the cue `zap`, no spin, no kick).
  `weapons.test.ts`: the Laser casts one ray a pulse.
- **The re-pin.** Bots draw their guns from the registry, so with five in
  it every bot's gun changed. The old hashes came out in 6a's gate A
  (`4aa2b96`), the beam and the Laser's code in and unregistered.
  `server.test.ts`, run alone with it registered: exactly these eight
  failed, its other 182 checks passed (the handover's bot fired 12 s on,
  22 m driven).
  - Classic tdm Scrapyard `d0d73fb8efc61035` → `8ce12b1c9f7624ba`
  - Classic tdm The City `72fa77e654f7e898` → `da5c4d7cff7a6cee`
  - Classic ffa Scrapyard `e8c8e38df8e30425` → `f898624a2a069d3d`
  - Classic ffa The City `9ec3f79b03aa963c` → `c935111e440651c0`
  - Classic tdm The Docks `f353cde11375f87a` → `79e5a6598227a1b6`
  - Classic ffa The Docks `cb08df5bd2efc683` → `95384beed237eb59`
  - custom tdm Scrapyard, 12 seats: `391b870418332ac0` (49 kills) →
    `f76cdbf281c035e7` (45 kills, 142.9 s)
  - custom ffa The City, 2 seats: `d7f0969b897322a7` (5 kills) →
    `79545fe017b076d2` (5 kills, 303.0 s)
  The yard's two pins don't move; the digests don't; `PROTOCOL` stays 7.
- The first gate A on 6b failed three tests, none a pin:
  - `sim/loadout.test.ts`, "parseLoadout: an unknown weapon", and
    `net/protocol.test.ts`, "every field out of range or of the wrong type
    named, each once": both used `'laser'` as their example of a weapon id
    that doesn't exist. It does now; they use `'flamethrower'`.
  - `server/netplay.test.ts`, "150 ms: aimed where it's drawn, a round at a
    target crossing at 25 m/s hits with compensation": its target is the
    first hostile seat, which drives whatever vehicle that seat drew, and
    the crossing's aim (the car's centre, a metre up) and speed (25 m/s,
    then full throttle) were written for a Razor. Since step 4 that seat
    had drawn a Scout (32.4 m/s, its hull top at 1.0 m) or a Brute (23.6
    m/s), and with the Laser's draws the one round missed the Scout. The
    test now puts that seat in a Razor (`changeVehicle`) before the
    crossing, as it was written: target at 27.1 m/s, hit with
    compensation, missed without. (Its 300 ms line has always missed: the
    target drawn 218 ms back is past the 200 ms rewind.)
- Gate A, again: oxlint 0 warnings, 0 errors; format clean; tsc clean;
  build clean (`App` 530.14 kB, gzip 157.16 kB); `npm test` 1430 passed
  (33 files: the Laser in each table's tests, the turret's unregistered case
  gone) in 317.7 s (the new pins above; the yard's and the three digests as
  before; journal 578 KB for 10.1 min; the handover: 12 s; the crossing at
  150 ms: hit with compensation; the Brute at 100 ms: 0 corrections on the
  grid, 0 in the drive). Build id `29b2c61081a7`.
- `sim/bots.test.ts`'s kills a minute moved with the Laser in the draws:
  easy 8.4 → 7.8, normal 14.2 → 12.7, hard 15.3 → 17.1. Not a pin; its
  checks pass (harder wrecks more).

### The Laser's checks (2026-10-16)

On `e69d993`, build `29b2c61081a7`; headless Chromium (the Chrome
extension wasn't connected).
- `node scripts/browser-match.mjs`: every check ok, 104.7 s. Room `ef524f`,
  seats 0 and 4. `a` held W 12 s: 21.4 m on `b`'s screen (0.0 m in 5 s with
  no key); 3 frames a second, its clock at 16 %; 111 corrections, max 6.26
  m. `a` left, seat 0 "Sawtooth" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 87.3 s.
- **Classic with the Laser, online** (the scratch per-loadout copy: `a` the
  Scout with the Laser, `b` the Buggy with the Shotgun): every check ok,
  122.9 s. Room `362c25`. Each page played in its own vehicle and gun and
  saw the other's (`b` saw `a`'s seat as `scout/laser`, hull 70, wheels
  0.44 m; `a` saw `b`'s as `buggy/shotgun`, hull 85); 0 corrections at GO.
  `a` held W 12 s: 21.6 m on `b`'s screen. `a` held the trigger 15 s: its
  charge each second `37 37 40 40 37 37 ...`, three pulses a burst and
  cooled back between: the page drew 1 frame a second, and the server
  repeats a page's last input for 250 ms of a gap, not longer, so the beam
  fired a quarter second of each second and cooled the rest (a page in
  real time sends an input every step). Its HUD: the Laser's icon, "0%
  HEAT". `a` left, seat 0 "Sawtooth" again; no token in the log.

### 6, the Laser's patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`: an eighth line in the `0.13.0` entry. A
fifth gun on Loadout, the Laser, a beam: held on a target it burns 40 a
second, dead straight out to 120 m; four seconds of fire overheat it and it
can't fire again until it has cooled, two seconds from hot, and let go
sooner it cools as you wait; the weapon panel shows its heat; bots carry
it, and a custom lobby can make it everyone's one gun. `game/index.html`:
"a roof minigun, rocket pod, cannon, shotgun or laser". Checked on
`:3000` (headless Chromium): the drawer opens on v0.13.0 with its eight
lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 530.50 kB, gzip 157.28 kB); `npm test` 1430 passed (33 files) in
318.0 s (bots 7.8/12.7/17.1; every pin as after 6b; the handover: 12 s;
the Brute at 100 ms: 1 correction on the grid, 0 in the drive). Build id
`bbf14eb41704`.

### 6, the Laser on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the five guns;
  the Weapons table gains a Laser column (40 a second on target; a beam,
  10 pulses a second; 4 s of fire, then it overheats; 2 s to cool from
  hot; 120 m; a beam, instant, dead straight; about 27 a second,
  overheating and cooling); a `### Laser` paragraph (held on a car it
  wrecks a Scout in under two seconds, a Razor in about two and a half, a
  Brute in under three and a half; four seconds overheat it, then it can't
  fire until it has cooled, two seconds from hot; let go sooner and it
  cools as you wait; the HUD shows its heat).
- `how-to-play.mdx`: every bot carries one of the five; Aim and fire: the
  Laser burns for as long as it's held on a target, until it overheats.
- `modes.mdx` and `index.mdx` name it; `www/src/lib/site.ts`: "a roof
  minigun, rocket pod, cannon, shotgun or laser".
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages; the built
  garage page with the Laser's column; `scripts/tailwind-classes.mjs`:
  every class as Tailwind writes it (238 files).
- **The README**: the Guns line names the Laser.

**Gate C**: the probes once more on the final tree (`280502c`), the six
runs of the tuning at 4 a pulse (the player in the Razor with the Laser,
both modes on the three arenas, seeds 2 to 11): every report line the same
as the tuning's, byte for byte.

Step 6 is done.

## Step 7 — Homing missiles, a new kind: `missile`

PLAN.md's numbers: about 30 a missile, a 3 m blast, about 70 m/s, turning
about 2.5 rad/s, 4 a load, 4 s to reload, a 0.8 s lock.

### 7a The missile kind, the lock on the wire, and the missiles unregistered (2026-10-16)

How it's built: a missile is a rocket that may carry a target. The lock
is the simulation's: each step, before the trigger, it keeps the machine
the controls name (`Control.lock`, a seat or -1) while that machine is
alive, in the match, hostile, inside the gun's range, within 0.2 rad
(`LOCK_CONE`) of the gun's aim from the muzzle and in sight from it (a ray
from the muzzle); the time it's been held counts up to `missile.lock`, and
anything else, or another machine named, starts it over (`holdLock`,
`sim/simulation.ts`; `WeaponState.lock` and `locked(weapon)`,
`sim/combat.ts`). A missile fired with the lock on carries its target and
each step turns toward it (0.9 m above its body's origin) by at most
`missile.turn × dt`; fired without one, or once its target is wrecked or
gone, it flies straight. It flies, bursts and goes on the wire as a rocket
does (`ln`, `rk`, `bu`): no new wire event. The server runs the same
`holdLock` on what the page names, so a page can't lock on a teammate, out
of range, outside the window or through a wall.

- **The wire, `PROTOCOL` 7 -> 8.** The input gains `lk`, the seat the
  missile is to lock on (-1 none; left out, -1; anything but an integer
  from -1 to 11 is refused, `bad lock`); the player's own row gains the
  lock's target and how long it's been held, in ms (`ME_BYTES` 40 -> 48),
  so the page's HUD shows the server's lock. The replay's `in` row gains
  the lock last (a replay from before reads -1). Fixtures moved on purpose
  in `net/protocol.test.ts`: the snapshot's bytes (the player's row ends
  `ffffffff00000000`, no lock), its size `14 + 2 × 44 + 40` -> `+ 48`, the
  welcome's `"v":7` -> `"v":8`, the input's JSON gains `"lk":3`, and a
  parsed input's keys gain `lock`.
- **Fair play**: the tally gains `locks`, each time a person's lock takes
  hold (`server/room.ts` counts the step it comes on), for review: aim help
  would lock on everything.
- **The pilot** (`view/pilot.ts`) names the hostile its lock-on window
  already finds under the crosshair, for a missile gun. **The HUD**:
  between reloads the weapon panel's bar fills as the lock takes hold, and
  LOCKED shows once it's on.
- **The bots**: `TACTICS.missile` (engage 60 m, circle 24 to 36 m, keep
  30 m, fire from 150 m); a bot names its target whenever it sees it and
  pulls the trigger only once the lock is on. It lays the gun on the
  target, not ahead of it (`flightTime` 0 for a missile): the window is
  round the aim, and leading a crossing car would hold it outside.
- What the compiler listed, each now handling `missile`: the simulation's
  `fire`, the recorder's `fired` (`ln`, as a rocket), `TACTICS` and
  `flightTime`, `blastRadius`, the garage's `ROUND` and `kindSpecs`
  (missile speed, blast radius, turns in degrees a second, lock in
  seconds on target).
- `content/weapons/turrets/missiles.ts`: a four-cell missile box on the
  same yoke, a red nose in each cell, strap bands, a seeker on top;
  `MISSILE_ICON`, outside `WEAPONS` until 7b.
- Tests: `sim/simulation.test.ts`: the lock takes its time (held at 0.5 s,
  on by 0.85 s); fired locked, a missile turns after a car crossing at
  14 m/s 30 m off and hits it; fired without, it flies past; the lock is
  gone the step its target leaves the window; a teammate in the window is
  never locked on. `net/protocol.test.ts`: `lk` read (a seat, -1, left
  out) and refused (12, -2, 1.5, '3', null). `server/server.test.ts`: over
  the socket, a lock named on a hostile in the window is held and its page
  hears it; named on a teammate, never (the duel's stretch of road is
  `faceOff` now, for both). `turrets.test.ts`: the unregistered turret
  carries its `gun`. Tests that wrote a `WeaponState` by hand use
  `armWeapon`.
- A limit, for later: the lock is checked against where the server has
  the target now, not rewound to what the person saw as hitscan is; at
  100 ms a car crossing at 20 m/s sits about 0.11 rad off a person's aim
  at 30 m (inside the window), 0.33 rad at 10 m (outside: up close a fast
  crossing car is hard to lock).

### Tuning the missiles (2026-10-16)

The missiles put in `WeaponId`, `TurretKey`, `WEAPONS` (PLAN.md's
numbers: 30 a missile, 120 rpm, 4 a load, 4 s to reload, 200 m, spread
0.004, 70 m/s, a 3 m blast, 2.5 rad/s, a 0.8 s lock; named Homing
Missiles), `TURRETS` and `GUN_SOUNDS` (the cue `launch`, no spin, kick
0.05) in the working tree for it, and taken out again before the commit.
- The garage (headless Chromium on `:3000`): Loadout "6 / 6", the sheet:
  damage 30 per missile, 120 rpm, 4 missiles, reload 4.0 s, range 200 m,
  missile speed 70 m/s, blast radius 3 m, turns 143° a second, lock 0.8 s
  on target, firepower 20 dmg/s; the missile box on the Razor's roof.
- Practice (headless, the Brute), the trigger held: 4, 3, 2, 1, 0, then
  the reload bar filling; the HUD's label "HOMING MISSILES · LMB" fits. A
  bot crossing the crosshair: the lock on seat 5, held 0.10 s, then gone.
- The probes, ten matches each, seeds 2 to 11, the player in the Razor
  with the missiles; the bots draw from all six guns. K/D of every seat
  that carried each gun (the missiles 30 seat-matches a run):

| Run | Missiles | Rocket Pod | Minigun | Cannon | Shotgun | Laser | Kills a match |
|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 1.07 | 1.38 | 0.78 | 1.15 | 0.68 | 0.82 | 114.9 |
| tdm The City | 1.04 | 1.43 | 0.85 | 0.97 | 0.85 | 0.70 | 122.2 |
| tdm The Docks | 0.97 | 1.39 | 1.06 | 0.88 | 0.71 | 0.86 | 118.3 |
| ffa Scrapyard | 0.98 | 1.16 | 1.06 | 1.15 | 0.74 | 0.87 | 110.0 |
| ffa The City | 1.00 | 1.21 | 0.96 | 1.10 | 0.88 | 0.82 | 124.4 |
| ffa The Docks | 0.98 | 1.22 | 1.00 | 1.13 | 0.92 | 0.75 | 118.3 |

  Respawn checks 0 and 0 in every run; the player (Razor, missiles) 16.3,
  15.8, 13.9, 14.1, 15.7, 12.9 kills to 13.6, 14.7, 14.0, 12.3, 14.9,
  14.3 deaths.
- The missiles come out even (0.97 to 1.07) on PLAN.md's numbers, in the
  middle of the six: they deal 20 a second over whole loads, the least on
  paper, but nearly all of it lands. PLAN.md's numbers stand.

Gate A on 7a (the missiles out of the registry again): oxlint 0 warnings,
0 errors; format clean (the first run found four files Prettier would
rewrap; rewrapped, and the gate run again whole); tsc clean; build clean
(`App` 532.75 kB, gzip 158.13 kB); `npm test` 1441 passed (33 files) in
330.8 s (bots 7.8/12.7/17.1; every pin as after 6b: Classic
`8ce12b1c9f7624ba`, `da5c4d7cff7a6cee`, `f898624a2a069d3d`,
`c935111e440651c0`, `79e5a6598227a1b6`, `95384beed237eb59`; custom
`f76cdbf281c035e7`, `79545fe017b076d2`; the yard's and the three digests;
the handover: 12 s; the Brute at 100 ms: 0 corrections on the grid, 1 in
the drive). Build id `c7436eac9978`. `scripts/tailwind-classes.mjs`: every
class as Tailwind writes it (239 files). These are the old hashes the
re-pin names: nothing that fires a missile is in a match yet.

### 7b The Homing Missiles registered; the re-pin (2026-10-16)

- `content/weapons/weapons.ts`: `'missiles'` in `WeaponId` and
  `TurretKey`; its `WEAPONS` row last (a `missile`: 30 a missile, 120 rpm,
  4 a load, 4 s to reload, 200 m, spread 0.004, 70 m/s, a 3 m blast,
  2.5 rad/s, a 0.8 s lock; named Homing Missiles, its blurb, and its icon,
  `MISSILE_ICON` inline and the constant gone).
  `content/weapons/turrets.ts`: `missiles` in `TURRETS`;
  `turrets.test.ts`'s unregistered case goes. `view/view.ts`: its
  `GUN_SOUNDS` row (the cue `launch`, no spin, kick 0.05).
  `weapons.test.ts`: the missiles cast one ray. The missile checks in
  `simulation.test.ts` and `server.test.ts` arm `WEAPONS.missiles` in
  place of the stand-in spec they built.
- **The re-pin.** Bots draw their guns from the registry, so with six in
  it every bot's gun changed. The old hashes came out in 7a's gate A
  (`9a3a19a`), the missile kind and the lock in and the missiles
  unregistered. `server.test.ts`, run alone with them registered: exactly
  these eight failed, its other 184 checks passed (the handover's bot
  fired 9 s on, 41 m driven).
  - Classic tdm Scrapyard `8ce12b1c9f7624ba` → `f142bb44a4203735`
  - Classic tdm The City `da5c4d7cff7a6cee` → `1e98d12252713b59`
  - Classic ffa Scrapyard `f898624a2a069d3d` → `6b7b1ed21f9ae0df`
  - Classic ffa The City `c935111e440651c0` → `1216342c267158e1`
  - Classic tdm The Docks `79e5a6598227a1b6` → `6d644d056856a502`
  - Classic ffa The Docks `95384beed237eb59` → `a6ce94d06e0448b2`
  - custom tdm Scrapyard, 12 seats: `f76cdbf281c035e7` (45 kills) →
    `f399760aee48919d` (44 kills, 152.9 s)
  - custom ffa The City, 2 seats: `79545fe017b076d2` (5 kills) →
    `d92ee2d8758f827f` (5 kills, 303.0 s)
  The yard's two pins don't move; the digests don't; `PROTOCOL` stays 8.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 533.79 kB, gzip 158.45 kB); `npm test` 1450 passed (33
  files: the missiles in each table's tests, the turret's unregistered
  case gone) in 333.0 s, first run (the new pins above; the yard's and the
  three digests as before; journal 581 KB for 10.1 min; the handover: 9 s;
  the Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build
  id `b2b5d5add0a1`.
- `sim/bots.test.ts`'s kills a minute moved with the missiles in the
  draws: easy 7.8 → 8.2, normal 12.7 → 13.6, hard 17.1 → 17.1. Not a pin;
  its checks pass (harder wrecks more).

### The Homing Missiles' checks (2026-10-16)

On `45fa5f2`, build `b2b5d5add0a1`; headless Chromium (the Chrome
extension wasn't connected).
- `node scripts/browser-match.mjs`: every check ok, 120.9 s. Room `1bb04b`,
  seats 0 and 4. `a` held W 12 s: 16.8 m on `b`'s screen (0.0 m in 5 s with
  no key); 1 frame a second, its clock at 16 %; 232 corrections, max 5.54
  m. `a` left, seat 4 "Hexbolt" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 96.2 s.
- **Classic with the missiles, online** (the scratch per-loadout copy: `a`
  the Brute with the Homing Missiles, `b` the Razor with the Cannon):
  every check ok, 138.8 s. Room `4ab39f`. Each page played in its own
  vehicle and gun and saw the other's (`b` saw `a`'s seat as
  `brute/missiles`, hull 135, wheels 0.58 m; `a` saw `b`'s as
  `razor/cannon`, hull 100). At GO `a`'s page had 0 corrections, `b`'s 379
  (the last 15.07 m): `b`'s page was slow to load under SwiftShader and its
  seat's bot drove the car until its first input (an earlier per-loadout
  run had 283 on `a` the same way). `a` held W 12 s: 17.6 m on `b`'s screen.
  `a` held the trigger 15 s: its clip each second `3 1 0R 0R 0R 0R 3 1 0R
  ...`, four missiles a load and the 4 s reload (no lock: nothing under its
  crosshair, so they flew straight; damage dealt +0). Its HUD: the
  missiles' icon. `a` left, seat 0 "Sawtooth" again; no token in the log.
  The lock over the wire is `server.test.ts`'s (7a); a page here can't put
  a rival under its crosshair on purpose.

### 7, the Homing Missiles' patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`, 0.13.0 gains a ninth line: a sixth gun on
Loadout, the Homing Missiles; keep a rival under the crosshair for 0.8 s
and the lock takes (the bar fills, LOCKED shows), and every missile fired
then turns after that machine, 70 m/s with a 3 m blast, 30 on a direct
hit; fired without a lock they fly straight; four to a load, a 4 s
reload, out to 200 m: three wreck a Scout or a Buggy, four a Razor, five
a Brute; bots lock on before they fire, and a custom lobby can make them
everyone's one gun. `game/index.html`: "a roof minigun, rocket pod,
cannon, shotgun, laser or homing missiles". Checked on `:3000` (headless
Chromium): the drawer opens on v0.13.0 with its nine lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 534.28 kB, gzip 158.62 kB); `npm test` 1450 passed (33 files) in
331.0 s (bots 8.2/13.6/17.1; every pin as after 7b; the handover: 9 s;
the Brute at 100 ms: 0 corrections on the grid, 0 in the drive). Build id
`196626134b69`.

### 7, the Homing Missiles on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the six guns;
  the Weapons table gains a Homing Missiles column (30 on a direct hit,
  less towards the blast's edge; 2 missiles a second; 4 missiles; 4 s;
  200 m; a missile at 70 m/s, a 3 m blast, locked on it turns after its
  target; 20 a second, if every missile lands); a `### Homing Missiles`
  paragraph (keep a rival under the crosshair and in sight for 0.8 s and
  the lock takes, the bar fills and LOCKED shows; every missile fired then
  turns after it, up to 143° a second; without a lock it flies straight;
  three wreck a Scout or a Buggy, four a Razor, five a Brute; four to a
  load, a 4 s reload).
- `how-to-play.mdx`: every bot carries one of the six; Aim and fire: the
  missiles lock on a rival kept under the crosshair and, fired once LOCKED
  shows, turn after it. `modes.mdx`: each bot draws one of the six, and
  missile bots hold off and fire only once their lock is on. `index.mdx`
  names them; `www/src/lib/site.ts`: "a roof minigun, rocket pod, cannon,
  shotgun, laser or homing missiles".
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages; the built
  garage page with the missiles' column; `scripts/tailwind-classes.mjs`:
  every class as Tailwind writes it (239 files).
- **The README**: the Guns line names the Homing Missiles.

**Gate C**: the probes once more on the final tree (`95b0e6f`), the six
runs of the tuning (the player in the Razor with the Homing Missiles, both
modes on the three arenas, seeds 2 to 11): every report line the same as
the tuning's, byte for byte.

Step 7 is done.

## Step 8 — Mines, a new kind: `mine`

PLAN.md's numbers: about 60 damage, a 6 m blast, armed after 1 s, set off
within about 4 m, 3 down at most, 30 s each, a 6 s reload.

### 8a The mine kind, its wire, and the Mines unregistered (2026-10-16)

How it's built: a mine isn't fired but laid. A mine weapon's trigger lays
one a metre behind the machine's tail, on whatever is under it (a ray
down, past the cars), at the gun's rate, from its magazine, reloading as
a gun does. Each lies for `mine.life` seconds; after `mine.arm` it goes off
under the first hostile machine (in seat order) whose hull (0.9 m above
its body's origin, as a blast measures) is within `mine.trigger` metres.
The machine that set it off takes the whole of `damage`; everything else
inside `mine.blast` takes less towards the edge and is shoved, as by a
rocket (the rules say who is hurt: never its layer, a teammate as the
friendly-fire setting says). A teammate never sets one off. Lay one past
`mine.down` of a machine's and its oldest is cleared. A restart clears them
all. (`sim/simulation.ts`: `lay`, `tendMines` after the rockets fly, the
`Mine` list; `detonate` now takes the shooter, the spec and the point, so
rockets, missiles and mines share it; `blastOf(spec)` in
`content/weapons/weapons.ts` is the one blast radius, which
`sim/ai/perception.ts`'s own copy gave way to.)

- **The wire, `PROTOCOL` 8 -> 9.** Two events: `ml`, a mine laid (its id,
  its layer's seat, where it lies, in centimetres) and `mg`, a mine gone
  (its id: gone off, its burst following as a `bu`, lain out its life, or
  cleared for another). The page holds them for the drawing as it holds
  the others' events, but they change what's there, not only what's
  seen: they're played in a catch-up too, and a catch-up now plays the
  events it was still holding (for what they change, not their effects)
  where it used to drop them. A page joining while mines lie hears of
  them in its welcome (`mines`, their `ml` events): the welcome's fixture
  in `net/protocol.test.ts` moved on purpose (`"v":9`, `"mines":[...]`).
- **The view** (`view/view.ts`): a mine drawn where it lies, a copy of one
  model (`content/parts.ts`, `buildMine`: a squat steel drum, a pressure
  cap, four prongs and a red light), the light blinking once it's armed;
  a thud (`hitGround`) as it goes down; gone with `mg`, all gone at a
  restart.
- **The bots**: `TACTICS.mine` (engage 30 m, circle 10 to 18 m, keep 8 m,
  sight 40 m): with nothing to shoot, a mine-layer runs tight circles round
  its target, and lays a mine whenever a rival is on its tail (`chased`,
  `sim/ai/perception.ts`: a live rival within 30 m behind, inside 0.9 rad
  of its tail; `AI.tail`).
- What the compiler listed, each now handling `mine`: the recorder's
  `fired` (a mine is never fired), `TACTICS` and `flightTime`, the
  garage's `ROUND` and `kindSpecs` (blast radius, goes off within, arms
  after, lies for, down at once; and no Range row: a mine goes nowhere),
  and every `SimEvents` (`laid`, `gone`): the view's, the recorder's, the
  tests' page's, the tests' own.
- `content/weapons/turrets/mines.ts`: a mine rack on the same yoke (three
  mines stacked between side plates, the feed chute down the back, a red
  band); `MINE_ICON`, outside `WEAPONS` until 8b.
- Tests: `sim/simulation.test.ts`: a mine goes down behind the machine on
  the ground (0.00, 0.00, -3.20 from a Razor at the origin facing south);
  not before its second, then a hostile on it sets it off, the whole 60 to
  it and nothing to its layer; a teammate on an armed mine never sets it
  off; three of a machine's lie at most, a fourth clearing its oldest; a
  mine lies 30 s at most; a restart clears them. `net/events.test.ts`:
  `ml` and `mg` round trips and the seats they name. `server/server.test.ts`
  (a stand-in mine spec on `a`'s machine): a mine laid goes on the wire
  where it lies; a page that joins while it lies hears of it in its
  welcome; a machine on it sets it off, gone on the wire, its burst heard,
  60 to the machine. `turrets.test.ts`: the unregistered rack carries its
  `gun`.

Gate A on 8a (the Mines out of the registry): oxlint 0 warnings, 0
errors; format clean (the first run found two files Prettier would
rewrap; rewrapped, and the gate run again whole); tsc clean; build clean
(`App` 536.83 kB, gzip 159.66 kB); `npm test` 1466 passed (33 files) in
333.3 s (bots 8.2/13.6/17.1; every pin as after 7b; the yard's and the
three digests; the handover: 9 s; the Brute at 100 ms: 0 corrections on
the grid, 1 in the drive). Build id `209ea6b70a8b`.
`scripts/tailwind-classes.mjs`: every class as Tailwind writes it (239
files).

### 8a2 Bots route round the mines they know of (2026-10-16)

PLAN.md asks for this as a commit of its own. A bot knows of every hostile
mine within its detection range (70 m), as it knows of every rival there,
seen or not; when it replans a route, a leg of the nav graph passing
within 7 m of one costs 150 m more for each (`AI.berth`;
`sim/ai/navigation.ts`, `routesTo` and `travel`; `think` takes the mines
down, the simulation hands it its list). Driving straight at a target in
sight, circling or weaving, it doesn't look for them. With the Mines
still out of the registry no bot meets a mine in any pinned match, so no
pin moves.
- Tests: `sim/ai/navigation.test.ts`: a mine known on the 100 m square's
  diagonal sends the route round the square instead (200 m); a mine off
  every road costs nothing.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 537.20 kB, gzip 159.77 kB); `npm test` 1468 passed (33
  files) in 333.7 s (bots 8.2/13.6/17.1; every pin as after 7b; the
  handover: 9 s; the Brute at 100 ms: 1 correction on the grid, 1 in the
  drive). Build id `8c0850caf060`.

### Tuning the Mines (2026-10-16)

The Mines put in `WeaponId`, `TurretKey`, `WEAPONS`, `TURRETS` and
`GUN_SOUNDS` (the cue `hitGround`, no spin, no kick) in the working tree
for it, and taken out again before the commits.
- The first probes stalled: the probe harness (`probe.test.ts`) builds its
  own `SimEvents`, which the compiler doesn't see, and it lacked `laid` and
  `gone`; the first mine laid threw inside the step. Fixed (`10bde46`).
- The garage (headless Chromium on `:3000`): Loadout "7 / 7", the sheet:
  damage per mine, 60 rpm, 3 mines, reload 6.0 s, blast radius, goes off
  within, arms after 1.0 s, lies for 30 s, down at once 3, firepower; no
  Range row; the rack on the Razor's roof.
- Practice (headless, the Razor), the trigger held: the clip 3, 2, 1, 0,
  then the reload; the mines in the scene 1, 2, 3 as it went; the HUD's
  label "MINES · LMB" fits.
- The probes (ten matches each, seeds 2 to 11, the player in the Razor with
  the Mines, the bots drawing from all seven) at PLAN.md's numbers (60 a
  mine, set off within 4 m, a 6 m blast) and the bots circling their
  target at 10 to 18 m, laying when chased: the Mines' K/D 0.22 to 0.28;
  the others' 0.91 to 2.13. A scratch run (half the seats with Mines, four
  team deathmatches on The City and the Scrapyard, never committed) said
  why: the mine-layers laid 5 to 7 a minute but were chased 12 to 15 % of
  the time, and of what they laid about 29 % went off, 30 % lay out their
  life and 37 % were cleared for a newer one; they dealt about a quarter
  of what the guns' seats dealt.
- What was tried, in order (scratch runs unless "probes"):
  - also laying when a rival's path runs over the spot behind it within 1
    to 3 s (`crossing`): little change at first; keeping three down near
    any rival: little change.
  - set off within 6 m, a 7 m blast, 80 a mine: probes 0.40 to 0.57.
  - five down for 45 s each: little change. Holding off at 30 to 42 m, so
    the guns close in over the mines: worse. Circling at 6 to 12 m: the
    same.
  - 100 a mine: probes 0.43 to 0.65 (damage helps less and less: a kill
    still needs the mine under the car).
  - cutting across the target's bow (driving for where it will be in 1.5 s)
    with `crossing` laying the mines in its way: the mine seats' kills went
    from about half the guns' seats' to about two thirds (without
    `crossing`, back to half). Probes 0.50 to 0.73.
- The final tactics (the bow's goal in the engage branch, backing off in
  tight streets as every bot does; `AI.bow` 1.5 s, `AI.crossing` 1 to 3 s,
  3 m, the spot 3.2 m behind): K/D of every seat that carried each gun,
  the Mines 28 seat-matches a run:

| Run | Mines | Homing Missiles | Rocket Pod | Minigun | Cannon | Shotgun | Laser | Kills a match |
|---|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 0.64 | 1.51 | 1.30 | 1.09 | 1.32 | 0.90 | 1.39 | 104.7 |
| tdm The City | 0.68 | 1.37 | 1.48 | 1.09 | 1.35 | 0.90 | 0.83 | 110.2 |
| tdm The Docks | 0.78 | 1.32 | 1.49 | 0.94 | 1.36 | 0.86 | 0.93 | 107.1 |
| ffa Scrapyard | 0.57 | 1.29 | 1.50 | 1.29 | 1.29 | 1.16 | 1.02 | 98.6 |
| ffa The City | 0.56 | 1.39 | 1.59 | 1.34 | 1.18 | 1.01 | 1.12 | 114.2 |
| ffa The Docks | 0.63 | 1.26 | 1.48 | 1.24 | 1.21 | 1.09 | 0.97 | 113.7 |

  Respawn checks 0 and 0 in every run; the player (Razor, Mines) 8.5, 10,
  11.2, 8.7, 8.5, 10 kills to 13.7, 14.7, 13.8, 13.5, 14.9, 14.9 deaths.
- The numbers kept: 100 a mine (the machine that sets it off takes it
  whole; one wrecks a Scout, a Buggy or a Razor from full, a Brute keeps
  35), set off within 6 m of the hull's centre, a 7 m blast, armed after
  1 s, three down at most, 30 s each, three a load, one a second, a 6 s
  reload. PLAN.md's damage, trigger and blast were raised; the rest kept.
- The Mines stay the weakest in bots' hands (0.56 to 0.78): a mine-layer
  has nothing to shoot back with, and a mine lands only where a rival
  drives. Past this, damage buys little and a bigger trigger would set
  them off from further than a car's length away. People will use them
  better than bots, and drive round them better too: bots don't look for
  mines in a fight, only on their routes (8a2). For the owner to judge.

### 8a3 The mine-layers' tactics, as tuned (2026-10-16)

What the tuning above settled, still with the Mines out of the registry:
a mine-layer in a fight drives for where its target will be in 1.5 s
(`AI.bow`), across its bow, and lays a mine when a rival is on its tail
(`chased`) or due over the spot behind it in 1 to 3 s (`crossing`,
`sim/ai/perception.ts`; `AI.crossing`). Gate A: oxlint 0 warnings, 0
errors; format clean; tsc clean; build clean (`App` 537.59 kB, gzip
159.90 kB); `npm test` 1468 passed (33 files) in 333.4 s (bots
8.2/13.6/17.1; every pin as after 7b; the handover: 9 s; the Brute at
100 ms: 1 correction on the grid, 0 in the drive). Build id
`d849a9cb281a`.

### 8b The Mines registered; the re-pin (2026-10-16)

- `content/weapons/weapons.ts`: `'mines'` in `WeaponId` and `TurretKey`;
  its `WEAPONS` row last (a `mine`: 100 a mine, one a second, three a
  load, a 6 s reload, set off within 6 m, a 7 m blast, armed after 1 s,
  three down at most, 30 s each; `range` 30, how far off the crosshair
  marks a rival; named Mines, its blurb, and its icon, `MINE_ICON` inline
  and the constant gone). `content/weapons/turrets.ts`: `mines` in
  `TURRETS`; `turrets.test.ts`'s unregistered case goes. `view/view.ts`:
  its `GUN_SOUNDS` row (the cue `hitGround`, no spin, no kick).
  `weapons.test.ts`: `pelletsOf` gives the Mines one, as it does
  anything that isn't a gun. The mine checks in `simulation.test.ts` and `server.test.ts` keep
  their own stand-in spec (60 a mine, set off within 4 m): they hold the
  mechanism, not the numbers.
- `server/events.test.ts` holds the codec to what the page read by
  position before it; with bots carrying Mines its room now lays them, and
  `ml` and `mg` were never read that way: it compares only the codes that
  were (the new ones' round trips are `src/net/events.test.ts`'s).
- **The re-pin.** With seven guns in the registry every bot's gun changed.
  The old hashes came out in 8a3's gate A (`4c8e735`). `server.test.ts`,
  run alone with the Mines registered: exactly these eight failed, its
  other 188 checks passed (the handover's bot fired 14 s on, 59 m driven:
  that room is stepped by hand on its own seed, so it's the same every
  run, inside its 15 s).
  - Classic tdm Scrapyard `f142bb44a4203735` → `fbfd94c55db9e3da`
  - Classic tdm The City `1e98d12252713b59` → `96c83bc1e1ec02b3`
  - Classic ffa Scrapyard `6b7b1ed21f9ae0df` → `4166719cf3ec5e70`
  - Classic ffa The City `1216342c267158e1` → `346efd0b2a969c6c`
  - Classic tdm The Docks `6d644d056856a502` → `cb91a2e4286e9992`
  - Classic ffa The Docks `a6ce94d06e0448b2` → `efd1771dba5ba5bb`
  - custom tdm Scrapyard, 12 seats: `f399760aee48919d` (44 kills) →
    `094b139b9913125c` (46 kills, 119.3 s)
  - custom ffa The City, 2 seats: `d92ee2d8758f827f` (5 kills) →
    `1ed214ce8eccf3ef` (7 kills, 303.0 s)
  The yard's two pins don't move; the digests don't; `PROTOCOL` stays 9.
- Gate A: the first run's `oxlint` warned once (`no-conditional-expect`,
  the events test's new filter written inside the loop); the rows are
  filtered first now, and the gate run again whole: oxlint 0 warnings, 0
  errors; format clean; tsc clean; build clean (`App` 538.52 kB, gzip
  160.26 kB); `npm test` 1477 passed (33 files) in 335.6 s (the new pins
  above; the yard's and the three digests as before; journal 578 KB for
  10.1 min; the handover: 14 s; the Brute at 100 ms: 1 correction on the
  grid, 0 in the drive). Build id `2986f6aac0b7`.
- `sim/bots.test.ts`'s kills a minute moved with the Mines in the draws:
  easy 8.2 → 8.9, normal 13.6 → 11.8, hard 17.1 → 16.7. Not a pin; its
  checks pass (harder wrecks more).

### The Mines' checks (2026-10-16)

On `2154dfa`, build `2986f6aac0b7`; headless Chromium (the Chrome
extension wasn't connected).
- `node scripts/browser-match.mjs`: every check ok, 122.3 s. Room `ee04a6`,
  seats 0 and 4. `a` held W 12 s: 7.7 m on `b`'s screen (0.0 m in 5 s with
  no key); 3 frames a second, its clock at 17 %; 221 corrections, max 4.52
  m. `a` left, seat 0 "Sawtooth" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 96.8 s.
- **Classic with the Mines, online** (the scratch per-loadout copy: `a` the
  Buggy with the Mines, `b` the Scout with the Laser): every check ok,
  136.0 s. Room `1dc626`. Each page played in its own vehicle and gun and
  saw the other's (`b` saw `a`'s seat as `buggy/mines`, hull 85, wheels
  0.56 m; `a` saw `b`'s as `scout/laser`, hull 70). At GO `a`'s page had 0
  corrections, `b`'s 446 (the last 1.80 m): slow to load under
  SwiftShader, its seat's bot drove the car until its first input, as in
  the earlier per-loadout runs. `a` held W 12 s: 21.6 m on `b`'s screen.
  `a` held the trigger 15 s: its clip each second `2 2 1 0R 0R 0R 0R 0R 0R
  2 1 0R ...`, three a load and the 6 s reload; the mines lying on each
  page's scene then: 6 on `a`'s, 5 on `b`'s (the bots' among them). Its
  HUD: the Mines' icon. `a` left, seat 0 "Sawtooth" again; no token in the
  log.
- A mine close up (headless practice, the camera parked over the first
  one laid): the drum, its cap and prongs, on the ground.

### 8, the Mines' patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`, 0.13.0 gains a tenth line: a seventh gun
on Loadout, the Mines; the trigger drops one a metre behind your tail, a
second later its light blinks, armed, and the first rival within 6 m sets
it off, that car taking the whole 100 (from full, it wrecks a Scout, a
Buggy or a Razor), anything else within 7 m less; three to a load, a 6 s
reload; three lie at once, each for 30 s; they never hurt you and a
teammate never sets one off; bots cut across your path to lay them in
your way and route round the mines they know of; a custom lobby can make
them everyone's one gun. `game/index.html`: "a roof minigun, rocket pod,
cannon, shotgun, laser, homing missiles or mines". Checked on `:3000`
(headless Chromium): the drawer opens on v0.13.0 with its ten lines; no
page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 539.11 kB, gzip 160.49 kB); `npm test` 1477 passed (33 files) in
332.6 s (bots 8.9/11.8/16.7; every pin as after 8b; the handover: 14 s;
the Brute at 100 ms: 0 corrections on the grid, 1 in the drive). Build id
`a330a52db637`.

### 8, the Mines on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the seven
  guns; the Weapons table gains a Mines column (100 to the car that sets
  it off, less towards the blast's edge; 1 mine a second; 3 mines; 6 s;
  no range, laid behind you; armed after 1 s, set off by a rival within
  6 m, a 7 m blast, 3 down at most, 30 s each; about 33 a second, if every
  mine goes off); a `### Mines` paragraph (dropped a metre behind your
  tail, the light blinking once armed; the whole 100 to the car that sets
  it off, which from full wrecks a Scout, a Buggy or a Razor and leaves a
  Brute 35; less inside 7 m; never your own, never set off by a teammate,
  though a blast hurts a teammate beside it with friendly fire on; three a
  load, a 6 s reload, three lying at most for 30 s each).
- `how-to-play.mdx`: every bot carries one of the seven; Aim and fire:
  mines drop behind you, lay them when someone is on your tail.
  `modes.mdx`: each bot draws one of the seven; mine-layers cut across
  your path and drop their mines in your way, or behind them when you give
  chase; bots plan their routes round the mines they know of. `index.mdx`
  names them; `www/src/lib/site.ts`: "a roof minigun, rocket pod, cannon,
  shotgun, laser, homing missiles or mines".
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages; the built
  garage page with the Mines' column and section;
  `scripts/tailwind-classes.mjs`: every class as Tailwind writes it (240
  files).
- **The README**: the Guns line names the Mines.

**Gate C**: the probes once more on the final tree (`8d5e341`), the six
runs of the final tuning
(the player in the Razor with the Mines, both modes on the three arenas,
seeds 2 to 11): every report line the same as the tuning's, byte for
byte.

Step 8 is done.

## Step 9 — the Rammer, and a new mechanic: ram damage

PLAN.md's numbers: about 120 armour, about 1,800 kg, about 95 km/h, and
ram damage from its nose.

### 9a Ram damage, and the Rammer unregistered (2026-10-16)

How it's built: ram damage belongs to a vehicle (`VehicleSpec.ram`:
hull points per m/s of closing speed, and the arc round the nose it
strikes in). After each physics step the simulation asks Rapier which
machines each machine with a ram touched (`contactPairsWith`, then
`contactPair`'s manifolds with a contact point in them), takes those
inside the ram's arc of its nose, and deals `ram.damage` a m/s it was
closing on each before they touched (the step's starting velocities),
past 4 m/s (`RAM.least`), the same pair again only 0.6 s on
(`RAM.again`). It goes through `damage()` like any hit: the rules say who
is hurt (a teammate only with friendly fire on), a wreck it causes is
the rammer's kill in the score and the feed, and it goes on the wire as
any hit does (`hu`, the hull in the snapshot): no new event, `PROTOCOL`
stays 9. Machines with no ram (all of today's) skip it, so nothing they do
changes. The struck machines are taken in seat order, not Rapier's.
- **The bots**: a machine with a ram charges its target in a fight
  (drives for where it will be in 0.3 s, `AI.charge`, and doesn't back off
  in tight streets); the mine-layers' bow stays as it was. `Agent` carries
  its `vehicle` for this.
- **The garage**: a vehicle with a ram shows its blow flat out into a car
  standing still ("Ram 66 HP flat out" for the Rammer).
- **The Rammer** (`RAMMER`, outside `ROSTER`: no draw sees it): 120
  armour, 1,800 kg, 95 km/h, 0–80 km/h in 4.3 s, 213 hp, a 13.3 m turning
  circle; the ram 2.5 a m/s inside 0.6 rad of its nose. Its body
  (`models/rammer.ts`): a low steel wedge, the cabin set back on it with
  the turret on its roof and a grated windscreen laid well back, a
  V-plough of two plates across the nose on struts, a hazard-striped lip,
  spikes along its top and a beak at its point; its physics shells the
  wedge, the cabin and the plough.
- Tests: `sim/simulation.test.ts` (the Brute wears the Rammer's ram for
  the block, taken off after): a ram strikes the car on its nose by how
  fast it was closing (31.6 at 12.7 m/s); pushing on, not again within
  0.6 s; a car striking its flank, outside the arc, takes nothing and
  deals nothing; a wreck the ram causes is its kill. `models.test.ts`: the
  unregistered Rammer rings its turret at the spec's mount and has a body
  on tyres.

### Tuning the Rammer (2026-10-16)

The Rammer put in `ROSTER` and `MODELS` in the working tree for it, and
taken out again before the commit.
- Driven on flat ground, headless, every vehicle the same way (a scratch
  test: flat out, full lock at speed, a slalom, a handbrake turn, then
  lifted 2 m and let land): the Rammer reached 95 km/h and leaned at most
  0.8° (the others 0.7° to 1.5°), never went over; after the drop, every
  wheel down.
- `server/arenas.test.ts` with the Rammer in: 126 passed (its shells
  clear of every start of the three maps; the digests as before).
- The garage (headless Chromium on `:3000`): "Rammer, BATTERING RAM /
  HEAVY · 5 / 5", its sheet 95 km/h, 4.3 s, 213 hp, 1,800 kg, 13.3 m,
  120 HP; the wedge, the plough and the turret on the turntable.
- The probes, ten matches each, seeds 2 to 11, the player in the Rammer
  (the guns as the even fit hands them out), the bots drawing from all
  five vehicles. K/D of every seat in each vehicle, the Rammer 21
  seat-matches a run:

| Run | Rammer | Razor | Brute | Scout | Buggy | Kills a match |
|---|---|---|---|---|---|---|
| tdm Scrapyard | 1.27 | 1.04 | 1.19 | 0.77 | 0.96 | 99.6 |
| tdm The City | 1.31 | 1.10 | 1.48 | 0.70 | 0.93 | 115.0 |
| tdm The Docks | 1.21 | 1.15 | 1.05 | 0.78 | 0.90 | 113.3 |
| ffa Scrapyard | 1.30 | 1.03 | 1.41 | 0.75 | 0.97 | 104.3 |
| ffa The City | 1.33 | 1.10 | 1.28 | 0.72 | 0.92 | 121.2 |
| ffa The Docks | 1.27 | 0.97 | 1.29 | 0.79 | 1.00 | 119.7 |

  Respawn checks 0 and 0 in every run.
- What the ram adds (a scratch run, half the seats in Rammers, four team
  deathmatches on The City and the Scrapyard): 1 to 3.5 strikes a Rammer a
  match, 45 to 165 hull by ram, a few in a hundred of what it deals; its
  K/D comes mostly from its hull (the probes see hull, as they always
  have: 120, between the Razor's 100 and the Brute's 135, and its K/D
  with theirs) and from fighting up close as it charges. The numbers stay
  as PLAN.md has them, the ram at 2.5 a m/s: flat out into a car standing
  still, 66; a head-on charge at speed more.

Gate A on 9a (the Rammer out of the registries): oxlint 0 warnings, 0
errors; format clean; tsc clean; build clean (`App` 540.05 kB, gzip
160.86 kB); `npm test` 1484 passed (33 files) in 335.3 s (bots
8.9/11.8/16.7; every pin as after 8b; the yard's and the three digests;
the handover: 14 s; the Brute at 100 ms: 0 corrections on the grid, 0 in
the drive). Build id `e649718d185a`. `scripts/tailwind-classes.mjs`: no
class changed.

### 9b The Rammer registered; the re-pin (2026-10-16)

- `content/vehicles/vehicles.ts`: the Rammer in `ROSTER`, last (`RAMMER`
  gone); `content/vehicles/models.ts`: `rammer` in `MODELS`;
  `models/rammer.ts` reads its chassis from `VEHICLES`; `models.test.ts`'s
  unregistered case goes (the Rammer is in every model check now: its
  nodes, its wheels on their hubs, all seven guns' trunnions at its
  mount). `sim/simulation.test.ts`'s ram checks drive a real Rammer; the
  content checks there take it in too (armour, mass, four wheels; it
  drives: 26.5 m/s). `game/AGENTS.md`'s code map names `models/rammer.ts`.
- **The re-pin.** Bots draw their vehicles from the registry, so with five
  in it every bot's machine changed. The old hashes came out in 9a's gate A
  (`4b229fa`). `server.test.ts`, run alone with the Rammer registered:
  exactly these eight failed, its other 188 checks passed (the handover's
  bot fired 8 s on, 28 m driven).
  - Classic tdm Scrapyard `fbfd94c55db9e3da` → `b142c3a67b2a49f8`
  - Classic tdm The City `96c83bc1e1ec02b3` → `84be43aaa53a8c43`
  - Classic ffa Scrapyard `4166719cf3ec5e70` → `e6a8bf0887283b4d`
  - Classic ffa The City `346efd0b2a969c6c` → `2b3cf1c08ee4b018`
  - Classic tdm The Docks `cb91a2e4286e9992` → `5ef4c1879400c88b`
  - Classic ffa The Docks `efd1771dba5ba5bb` → `8a570d110f3122da`
  - custom tdm Scrapyard, 12 seats: `094b139b9913125c` (46 kills) →
    `0a501685aeee6fc1` (44 kills, 118.3 s)
  - custom ffa The City, 2 seats: `1ed214ce8eccf3ef` (7 kills) →
    `4f82b968d0e37db6` (5 kills, 303.0 s)
  The yard's two pins don't move (the yard seats Razors with Miniguns by
  hand); the digests don't; `PROTOCOL` stays 9.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 543.37 kB, gzip 161.81 kB); `npm test` 1496 passed (33
  files: the Rammer in each table's tests) in 333.6 s (the new pins above;
  the yard's and the three digests as before; journal 585 KB for 10.1 min;
  the handover: 8 s; the Brute at 100 ms: 1 correction on the grid, 0 in
  the drive; bots 8.9/11.8/16.7, as before: that test seats Razors). Build
  id `a5baab19b389`.

### The Rammer's checks (2026-10-16)

On `ed18a32`, build `a5baab19b389`; headless Chromium (the Chrome
extension wasn't connected).
- `node scripts/browser-match.mjs`: every check ok, 120.7 s. Room `7893a3`,
  seats 0 and 4. `a` held W 12 s: 13.5 m on `b`'s screen (0.3 m in 5 s
  with no key); 3 frames a second, its clock at 17 %; 114 corrections, max
  4.16 m. `a` left, seat 4 "Hexbolt" again; no token in the server's log.
- `node scripts/browser-match.mjs custom`: every check ok, 96.6 s.
- **Classic with the Rammer, online** (the scratch per-loadout copy: `a`
  the Rammer with the Cannon, `b` the Buggy with the Minigun): every check
  ok, 145.0 s. Room `399752`. Each page played in its own vehicle and gun
  and saw the other's (`b` saw `a`'s seat as `rammer/cannon`, hull 120,
  wheels 0.54 m; `a` saw `b`'s as `buggy/minigun`, hull 85). At GO `a`'s
  page had 356 corrections (the last 0.00 m, the worst 57.22 m): slow to
  load under SwiftShader, its seat's bot drove the Rammer until its first
  input, as in the earlier per-loadout runs. `a` held W 12 s: 121.7 m on
  `b`'s screen. `a` held the trigger 15 s: its clip each second `3 2 2 1
  0R 0R 2 2 1 ...`. `a` left, seat 0 "Sawtooth" again; no token in the
  log.

### 9, the Rammer's patch notes (2026-10-16)

`screens/PatchNotesPanel.tsx`, 0.13.0 gains an eleventh line: a fifth
machine in the garage, the Rammer, a battering ram; 120 hull points and
1,800 kg, 95 km/h, 0–80 in 4.3 s, a 13.3 m turning circle; its V-plough a
weapon, the first on any machine: a car it's driven into takes 2.5 hull
points for every m/s it was closing, 66 flat out into a car standing
still, more head-on; a scrape along its flank deals nothing, the same car
again only after a moment, and a wreck it causes is the driver's kill;
bots drive it and charge in it. (`game/index.html`'s description names no
vehicle.) Checked on `:3000` (headless Chromium): the drawer opens on
v0.13.0 with its eleven lines; no page error.
Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build clean
(`App` 543.88 kB, gzip 162.05 kB); `npm test` 1496 passed (33 files) in
333.2 s (bots 8.9/11.8/16.7; every pin as after 9b; the handover: 8 s;
the Brute at 100 ms: 1 correction on the grid, 1 in the drive). Build id
`e632de6cd11b`.

### 9, the Rammer on the site (2026-10-16)

- `www/src/content/guide/garage.mdx`: its description names the five
  machines; the Machines table gains a Rammer column (battering ram,
  heavy; 120 points; 1,800 kg; 95 km/h; 4.3 s; 213 hp; 13.3 m) and a Ram
  row (none for the others; the Rammer's 2.5 a m/s it closes, 66 flat
  out); "Bots drive all five"; a `### Rammer` paragraph (the plough a
  weapon: 2.5 hull a m/s of closing speed, 66 flat out into a car standing
  still, more head-on; nothing from a scrape along the flank; the same car
  again only after a moment; a wreck it causes is the driver's kill; 20
  points more hull than the Razor; bots in one charge). Every gun's
  paragraph that counts the hits to a wreck counts the Rammer's too
  (rockets four, Cannon rounds three, Shotgun shots four, the Laser about
  three seconds, missiles four; a mine leaves it 20).
- `how-to-play.mdx`: every bot drives one of the five. `modes.mdx`: bots
  in a Rammer charge you. `index.mdx` names it.
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages; the built
  garage page with the Rammer's column and section;
  `scripts/tailwind-classes.mjs`: every class as Tailwind writes it (241
  files).
- **The README**: the Machines list gains the Rammer.

**Gate C**: the probes once more on the final tree (`9a8b44a`), the six runs of
the tuning (the player in the Rammer, both modes on the three arenas,
seeds 2 to 11): every report line the same as the tuning's, byte for byte.

Step 9 is done.

## Step 10 — after the last addition (2026-10-16)

### Coverage, against the refactor's (its 2.1)

`npm run test:coverage` on `61574e6`: 1496 passed in 368.5 s (the
refactor's: 1299 in 334 s). Vitest's text reporter leaves out every file
at 100 %, so a folder missing below is fully covered.

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| All | 66.59 % (8,257 / 12,398), was 61.47 | 56.41 % (3,423 / 6,067), was 54.76 | 56.47 % (1,273 / 2,254), was 52.75 | 66.77 % (6,905 / 10,341), was 61.54 |
| `server/` | 90.59 (90.61) | 85.37 (85.45) | 91.68 (91.62) | 92.46 (92.50) |
| `src/sim/` | 97.68 (96.82) | 92.47 (90.51) | 97.40 (96.82) | 98.40 (97.98) |
| `src/sim/ai/` | 100 (100) | 99.38 (99.64) | 100 (100) | 100 (100) |
| `src/modes/`, `ffa/`, `tdm/`, `items/` | as before | as before | as before | as before |
| `src/net/` | 72.21 (72.38) | 65.63 (65.84) | 63.45 (63.45) | 73.83 (73.98) |
| `src/content/` (`parts.ts`) | 86.25 (13.04) | 100 (60.00) | 90.00 (33.33) | 86.11 (14.51) |
| `src/content/arenas/` | 95.34 (95.71) | 95.66 (95.51) | 91.50 (91.50) | 94.94 (95.47) |
| `src/content/arenas/kit/` | 99.37 (99.33) | 98.51 (99.13) | 98.91 (98.63) | 99.51 (99.38) |
| `src/content/vehicles/`, `models/`, `weapons/`, `turrets/` | 100 (9.09, 0, 75.00, 0) | 100 | 100 | 100 |
| `src/render/` | 54.59 (54.59) | 72.91 | 60.00 | 52.94 |
| `src/render/materials/` | 91.64 (90.39) | 93.24 (93.15) | 94.73 (90.32) | 90.87 (89.54) |
| `src/runtime/` | 5.51 (5.51) | 4.31 | 4.93 | 5.41 |
| the screens, the HUD, the view, `src/` | 0 | 0 | 0 | 0 |

What moved: every vehicle model and turret is now built by a test (step
0.3), so what the refactor counted at 0 % is whole; the simulation's new
kinds and the ram are held as the rest of it is. What draws (the view,
the HUD, the screens) and the browser's half of a match are still the
browser scripts' and the smoke list's.

### Bundle weight, against the refactor's (its 2.2 and 2.3)

`npm run build` (the build's base `/play/`), every file in `dist/assets`
raw, gzip -9 and brotli 11, kB:

| File | Raw | gzip | br | At the refactor's end |
|---|---|---|---|---|
| `index` (the entry) | 4.0 | 1.9 | 1.7 | 4.0 / 1.9 |
| `react` | 218.9 | 67.4 | 58.0 | 218.9 / 67.4 |
| `App` (the game's own code) | 543.9 | 160.5 | 136.6 | 488.3 / 142.2 |
| `engine` (three, Rapier's JS) | 812.0 | 190.6 | 155.7 | 812.0 / 190.6 / 155.6 |
| Rapier's WASM | 2,021.2 | 765.8 | 558.1 | the same |
| the CSS | 67.2 | 11.3 | 9.4 | 66.4 / 11.2 |
| **the game** (all of it) | 3,667.2 | 1,197.5 | 919.5 | 3,610.8 / 1,179.1 / 904.5 |
| **without a mouse** (index, react, CSS) | 290.1 | 80.6 | 69.1 | 80.5 gzip |

The content phase added 55.6 kB raw, 18.3 gzipped, to `App` (a third
arena, three vehicles, five guns, three new kinds and the ram), 1.6 % of
the game's first download gzipped; the libraries and the phone's path
are as they were. Outside the bundle, the Docks' preview card
(`public/maps/docks.jpg`) is 157.7 kB.

### The probes, against the baselines (step 0.2)

The default fit (the player in the Razor, the guns as the even fit hands
them out; the bots drawing from all five vehicles and seven guns), ten
matches each, seeds 2 to 11, on `61574e6`. K/D of every seat in each
vehicle and with each gun:

| Run | Kills a match (step 0.2) | Razor | Brute | Scout | Buggy | Rammer | Minigun | Rocket Pod | Cannon | Shotgun | Laser | Missiles | Mines |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 115.0 (124.1) | 1.08 | 1.45 | 0.78 | 1.00 | 1.19 | 0.94 | 1.45 | 1.22 | 0.97 | 1.27 | 1.14 | 0.62 |
| tdm The City | 116.1 (125.8) | 1.00 | 2.03 | 0.79 | 1.09 | 1.17 | 0.85 | 1.47 | 1.29 | 0.87 | 1.16 | 1.41 | 0.65 |
| tdm The Docks | 114.6 | 1.10 | 1.50 | 0.73 | 1.06 | 1.13 | 0.94 | 1.61 | 1.12 | 0.96 | 1.12 | 1.01 | 0.70 |
| ffa Scrapyard | 102.6 (109.9) | 1.12 | 1.37 | 0.73 | 0.97 | 1.37 | 1.07 | 1.44 | 1.15 | 1.02 | 1.02 | 1.26 | 0.56 |
| ffa The City | 120.2 (126.4) | 1.14 | 1.44 | 0.72 | 1.02 | 1.20 | 1.15 | 1.42 | 1.25 | 1.04 | 1.14 | 1.08 | 0.56 |
| ffa The Docks | 114.7 | 1.04 | 1.62 | 0.79 | 0.95 | 1.33 | 1.14 | 1.39 | 0.92 | 1.07 | 0.94 | 1.24 | 0.61 |

Respawn checks 0 and 0 in every run. A match has 6 to 9 % fewer kills
than with the Razor and two guns: the Mines' seats kill least, and the
heavier machines take longer to wreck. In bots' hands, where hull is
what counts: the Brute leads the machines (1.37 to 2.03) and the Scout
trails (0.72 to 0.79), as their hulls say; the Rocket Pod still leads the
guns (1.39 to 1.61; it led the Minigun at step 0.2 too, noted then and
not changed) and the Mines trail (0.56 to 0.70, tuning the Mines). For
the owner to judge with people's play: the Rocket Pod, the Mines, the
Brute on The City.

### The docs

- `.claude/work/arch/ARCHITECTURE.md`: who implements `SimEvents` (the
  probe harness's among them, which the compiler doesn't see); "A
  vehicle": how the content phase built each unregistered first, and the
  ram as the shape of a new mechanic; "A weapon": the five kinds and the
  one reader for each kind's numbers (`pelletsOf`, `blastOf`,
  `sustainedDps`), and for a new kind what the compiler lists and what the
  four new kinds needed beyond it (pellets, a trigger of its own, aim the
  server checks, something left in the world, the bots' use of it), and
  the tests they added.
- `GAME_LOOP.md`: the step with the lock, the mine laid, the rams'
  strikes, the missiles' turn and the mines' tending; the `SimEvents`
  list. `STATE_OWNERSHIP.md`: a beam's heat and a missile's lock, missiles
  in flight, the mines down, the rams' last strikes, the lock control.
- `game/AGENTS.md`: the code map (the kinds, `blastOf`, the mine part, the
  ram, missiles, mines and rams in the simulation, the bots' mines and
  charges, the view's mines) and the Tests list (every weapon kind and the
  ram in `simulation.test.ts`; the lock and a mine over the socket).

### The site's copy, read once more against the game

- `how-to-play.mdx`: "Your hull has 100 points" said so for every
  machine since the Brute; it's the Razor's, 70 to 135 in the others, with
  a link to the garage.
- `faq.mdx`: online, the machine you picked comes with you as well as the
  gun (since step 1).
- The README: what the bots do with the new kinds (lock first, lay mines in
  your way and route round yours, charge in a Rammer).
- Everything else read true: the garage's tables and paragraphs (every
  number from the registries, every hits-to-a-wreck count against the
  hulls), the arenas, the modes, the controls, the home page's line.
- The site's gates: `npm run lint` clean; `npm run check`: `nakama.check:
  ok`; `npm run build`: 0 errors, 0 warnings, 0 hints, 12 pages;
  `scripts/tailwind-classes.mjs`: every class as Tailwind writes it (241
  files).
- Gate A on the docs: oxlint 0 warnings, 0 errors; format clean; tsc
  clean; build clean (`App` 543.88 kB, gzip 162.05 kB); `npm test` 1496
  passed (33 files) in 334.1 s (every pin as after 9b). Build id
  `e632de6cd11b`, as before: nothing under it changed.

Step 10 is done, and with it the content phase (PLAN.md): one map, four
vehicles, five guns, three new kinds and a new mechanic, all registered
and re-pinned, on `feat/content`, never pushed. It waits for the owner's
word to be squashed into `release/0.13.0`.

## Balance — the owner's calls (2026-10-16)

The owner chose from step 10's open points (PLAN.md, step 11): the Mines
at 80 a mine within 5 m and bots dodging mines in a fight; the Rocket
Pod's blast at 4 m; the Brute's 135 kept, its "ram" copy reworded; the
missiles' lock rewound online.

### B1 The Brute's copy: a dozer blade, not a ram

Only the Rammer deals ram damage, so the Brute's garage blurb, its line
in the site's garage guide and the README call its nose plate a dozer
blade; its builder's comments and constants say blade
(`BLADE_PROFILE`, `BLADE_FACE`; the model the same). Gate A: oxlint 0
warnings, 0 errors; format clean; tsc clean; build clean (`App` 543.89
kB, gzip 162.05 kB); `npm test` 1496 passed (33 files) in 321.8 s (every
pin as after 9b). Build id `bae36c5a3171`. The site's gates: lint clean,
`nakama.check: ok`, build 0 errors, 0 warnings, 0 hints, 12 pages.

### B2 A person's missile lock, judged where their page drew the target

The simulation takes an optional `seen(c, target, out)` beside
`castRound`: where machine `c`'s page drew `target`. The game server's
room gives it from its rewind (`rewind.where` at the person's view tick,
as hitscan's `castRound` does, when compensation is on); practice and
bots don't have one, so their locks are judged in the present as before.
Judged as drawn, only the arena blocks the view (the other machines have
moved on since). `server/rewind.ts`'s header and the room's `flags` say
so.
- Test: `sim/simulation.test.ts`: online, a lock is judged where the page
  drew the target, held on a car that was in the window as drawn though it
  has left it, and not on one in the window now that wasn't as drawn.
- Measured across the wire (a scratch run on the netplay yard, 75 ms each
  way ±10, never committed): a car crossing at 23.7 m/s, 12 m in front,
  the page aiming at it as drawn and naming it: the server's lock on for
  100 % of the pass within 12 m of dead ahead with the rewind, 3 % without
  it; at 25 m, 100 % and 46 %.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 543.96 kB, gzip 162.13 kB); `npm test` 1497 passed (33
  files) in 323.5 s (every pin as after 9b: no bots-only match has a
  person in it). Build id `9e3f98e44656`.

### B3, measured first: what the Rocket Pod's lead is made of

The owner chose a 4 m blast, on my reading that bots' wobbly aim leans
on the splash. The probes (ten matches each, seeds 2 to 11, the player in
the Razor with the Rocket Pod, 20 seat-matches of it a run; scratch trees,
never committed) say otherwise. The Rocket Pod's K/D:

| Run | 38, 5 m | 38, 4 m | 38, 3 m | 34, 5 m | 30, 5 m | 38, 5 m, rocket bots closer |
|---|---|---|---|---|---|---|
| tdm Scrapyard | 1.35 | 1.37 | 1.35 | 1.28 | 1.29 | 1.59 |
| tdm The City | 1.37 | 1.42 | 1.45 | 1.50 | 1.23 | 1.30 |
| tdm The Docks | 1.36 | 1.47 | 1.35 | 1.29 | 1.23 | 1.26 |
| ffa Scrapyard | 1.43 | 1.36 | 1.41 | 1.22 | 1.06 | 1.52 |
| ffa The City | 1.36 | 1.40 | 1.38 | 1.25 | 1.13 | 1.50 |
| ffa The Docks | 1.40 | 1.42 | 1.32 | 1.41 | 1.13 | 1.38 |

The blast's size does nothing (3 to 5 m, within the noise), and neither
does making rocket bots fight closer (engage 45 m, circle 16 to 26 m, keep
20 m, fire from 70 m): their range isn't the edge. Only the damage per
rocket moves it. Asked again, the owner chose 34 a rocket, the blast
staying 5 m: still three direct hits for a Razor and four for a Brute; a
Scout takes three, not two. Done after B4.

### B4 The Mines at 80 within 5 m; bots dodge mines in a fight

- `content/weapons/weapons.ts`: the Mines 80 a mine (was 100), set off
  within 5 m (was 6); the blast stays 7 m. Its blurb says five metres.
- The bots (`sim/ai/perception.ts`, `dodge`; `AI.dodge`; `think.ts`): with
  the wall feelers, a bot steers round the nearest hostile mine it knows
  of within 20 m ahead and 7 m either side of its path, harder the nearer
  it is; on its routes it still keeps clear of them (8a2). Its own side's
  mines it doesn't mind. Test: `sim/ai/navigation.test.ts`: a mine just
  left of its path 10 m ahead, it steers right (-0.50); just right, left
  (+0.50); behind it, off to the side or its own side's, nothing.
- What the dodging does (the scratch harness, half the seats with Mines,
  four team deathmatches on The City and the Scrapyard, both at 80 within
  5 m): mines going off under 44 % of those laid without it (87 of 200,
  132 of 270, 86 of 186, 100 of 256), 27 % with it (62 of 227, 68 of 251,
  55 of 210, 70 of 239).
- The probes (the player in the Razor with the Mines): the Mines' K/D
  0.31, 0.40, 0.43, 0.31, 0.29, 0.35 on tdm Scrapyard, The City, The Docks,
  ffa Scrapyard, The City, The Docks (0.64, 0.68, 0.78, 0.57, 0.56, 0.63
  before); kills a match 94.7 to 110.0. As the owner's choice said: bots do
  less with mines, and a person's mines can't farm bots.
- An unexpected failure, found and fixed: `server.test.ts`'s two-vehicle
  room ("its person drives it, no bot: up to 2.7 m/s in 4 s") takes a
  bot's seat at 20 s and measures the person's drive. With bots' play
  changed, that seat's bot had 10 hull left when the person took it, and a
  Laser bot 8.6 m away wrecked it in 0.4 s. Making it whole in the test
  broke the room's replay to the bit (a change the journal doesn't hold),
  so the test now steps on, journaled, until the seat's bot is whole, then
  the person takes it; the drive and the replay pass.
- **The re-pin.** `server.test.ts` alone: exactly these eight failed, its
  other 188 checks passed (the drive one after the fix above):
  - Classic tdm Scrapyard `b142c3a67b2a49f8` → `450dde96b6228833`
  - Classic tdm The City `84be43aaa53a8c43` → `6883cf2a770e305a`
  - Classic ffa Scrapyard `e6a8bf0887283b4d` → `963dbb4ef6205a85`
  - Classic ffa The City `2b3cf1c08ee4b018` → `2fbaafe0012fb713`
  - Classic tdm The Docks `5ef4c1879400c88b` → `af2f2b35608a6339`
  - Classic ffa The Docks `8a570d110f3122da` → `3224249a2929ad43`
  - custom tdm Scrapyard, 12 seats: `0a501685aeee6fc1` (44 kills) →
    `2652746c42955007` (39 kills, 111.5 s)
  - custom ffa The City, 2 seats: `4f82b968d0e37db6` (5 kills) →
    `8814d9f16b75b25d` (6 kills, 303.0 s)
  The yard's two pins and the digests don't move.
- The copy: the patch notes' Mines line (5 m, the whole 80: a Scout
  wrecked from full, a Razor left 20; bots steer round the mines they know
  of, on their routes and in a fight); the site's garage guide (the
  table's 80, 5 m and about 27 a second; the paragraph: a Scout wrecked
  from full, a Buggy left 5, a Razor 20, a Rammer 40, a Brute 55) and
  modes page; the README's bots line.
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 544.29 kB, gzip 162.26 kB); `npm test` 1498 passed (33
  files) in 321.7 s (the new pins above; journal 579 KB; the handover: 8
  s; the Brute at 100 ms: 1 correction on the grid, 0 in the drive). Build
  id `c9b9baf14bc1`. `sim/bots.test.ts`'s kills a minute moved: easy 8.9,
  normal 11.8 → 13.3, hard 16.7 → 14.9 (not a pin; its checks pass). The
  site's gates: lint clean, `nakama.check: ok`, build 0 errors, 0
  warnings, 0 hints. `scripts/tailwind-classes.mjs`: every class as
  Tailwind writes it.

### B3 The Rocket Pod at 34 a rocket

- `content/weapons/weapons.ts`: the Rocket Pod 34 a rocket (was 38); the
  blast stays 5 m (the owner's second call, after the measurements in "B3,
  measured first" above). Three direct hits still wreck a Razor or a Buggy
  and four a Brute or a Rammer; a Scout now takes three, not two.
- The probes at 34 (the player in the Razor with the Rocket Pod, as in
  that table): K/D 1.28, 1.50, 1.29, 1.22, 1.25, 1.41 (was 1.35 to 1.43).
- The copy: a patch-notes line for it, the Scout's line (three direct
  rockets); the site's garage guide (34 on a direct hit; about 31 a
  second; three direct hits for a Scout, a Razor or a Buggy, four for a
  Brute or a Rammer; the Scout's paragraph); the README's Scout line.
- **The re-pin.** `server.test.ts` alone: exactly these seven failed, its
  other 189 checks passed; the 2-seat custom room's two bots carry no
  Rocket Pod, and its hash holds.
  - Classic tdm Scrapyard `450dde96b6228833` → `7adc3513051f0c33`
  - Classic tdm The City `6883cf2a770e305a` → `5388f4dc1fb7aa50`
  - Classic ffa Scrapyard `963dbb4ef6205a85` → `ca5d5572baa961c7`
  - Classic ffa The City `2fbaafe0012fb713` → `33c774551030df62`
  - Classic tdm The Docks `af2f2b35608a6339` → `1b3f1007a8688679`
  - Classic ffa The Docks `3224249a2929ad43` → `6ff7d495717a622c`
  - custom tdm Scrapyard, 12 seats: `2652746c42955007` (39 kills) →
    `da25c148e6bc6b4f` (40 kills, 141.3 s)
- Gate A: oxlint 0 warnings, 0 errors; format clean; tsc clean; build
  clean (`App` 544.45 kB, gzip 162.30 kB); `npm test` 1498 passed (33
  files) in 321.8 s (the new pins above; journal 568 KB; the handover: 8
  s; the Brute at 100 ms: 0 corrections on the grid, 0 in the drive).
  Build id `a5c2f65f23a4`. Bots' kills a minute: easy 8.9, normal 12.2,
  hard 15.8. The site's gates: lint clean, `nakama.check: ok`, build 0
  errors, 0 warnings, 0 hints.

### The balance, measured on the finished tree

On `802b08d`: the default fit (the player in the Razor, the guns as the
even fit hands them out, the bots drawing from all five machines and
seven guns), ten matches each, seeds 2 to 11. K/D of every seat in each
machine and with each gun; kills a match with step 10's in brackets:

| Run | Kills a match | Razor | Brute | Scout | Buggy | Rammer | Minigun | Rocket Pod | Cannon | Shotgun | Laser | Missiles | Mines |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tdm Scrapyard | 97.5 (115.0) | 1.05 | 1.38 | 0.81 | 0.94 | 1.34 | 0.96 | 1.54 | 1.24 | 1.03 | 1.15 | 1.48 | 0.35 |
| tdm The City | 107.1 (116.1) | 1.05 | 1.69 | 0.75 | 1.07 | 1.21 | 1.04 | 1.70 | 1.30 | 1.08 | 0.87 | 1.37 | 0.34 |
| tdm The Docks | 103.8 (114.6) | 1.02 | 1.56 | 0.82 | 0.97 | 1.24 | 1.09 | 1.45 | 1.41 | 1.10 | 1.21 | 1.18 | 0.42 |
| ffa Scrapyard | 98.5 (102.6) | 1.17 | 1.12 | 0.74 | 0.93 | 1.33 | 1.15 | 1.48 | 1.21 | 1.13 | 1.47 | 1.32 | 0.32 |
| ffa The City | 115.6 (120.2) | 1.09 | 1.24 | 0.68 | 1.06 | 1.51 | 1.23 | 1.58 | 1.37 | 1.08 | 1.16 | 1.28 | 0.32 |
| ffa The Docks | 110.7 (114.7) | 1.03 | 1.38 | 0.77 | 1.02 | 1.39 | 1.09 | 1.47 | 1.39 | 1.21 | 1.16 | 1.21 | 0.38 |

Respawn checks 0 and 0 in every run. The Mines now kill least by far
(0.32 to 0.42), and a K/D is relative: what the Mines' seats give away,
every other gun's seats take, so the rest of the table rose with them.
In that mix the Rocket Pod at 34 still leads (1.45 to 1.70); its cut
shows against the same mix (1.35–1.43 at 38, 1.22–1.50 at 34, in "B3,
measured first"), not against this one. For the owner.

Gate B on `802b08d` (headless Chromium): `node scripts/browser-match.mjs`
every check ok, 111.6 s (room `f88697`; `a` held W 12 s: 11.1 m on
`b`'s screen; `a` left, seat 4 "Hexbolt" again; no token in the log);
`node scripts/browser-match.mjs custom` every check ok, 88.8 s; Classic
with the missiles online (the scratch per-loadout copy, `a` the Brute
with the Homing Missiles, `b` the Razor with the Cannon) every check ok,
132.3 s, `a` holding the trigger 15 s: clip `3 1 0R 0R 0R 0R 3 1 ...`,
damage dealt +50.

On a real GPU (Chrome, the extension connected, `:3000`): the garage's
Rammer (95 km/h, 4.3 s, 213 hp, 1,800 kg, 13.3 m, 120 HP, "Ram 66 HP flat
out"; the wedge, the plough, the turret), the Mines' rack and the Laser's
projector on it; in practice, the missiles' panel with LOCKED in amber and
the bar full on a hostile held 25 m ahead, a mine laid on the ground (the
drum, its prongs, the red light lit), the Laser's beam to a car 30 m off
and its panel at "45% HEAT". The owner's stored loadout (the Razor with the
Homing Missiles) put back after.
