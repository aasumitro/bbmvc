# Content phase — plan

**Status (2026-10-11): planned, not started.** It starts once `refactor/game`
is merged into `main`, which is the owner's call. This is the plan only:
nothing here is built yet.

The refactor (`.claude/work/refactor/`) made the game ready for new content
without engine edits. This phase adds that content, one piece at a time.
Everything stays procedural code, like today's (D6): no glTF.

Read first:
- `.claude/work/arch/ARCHITECTURE.md`, "How to add …" (a vehicle, a
  weapon, a map, a match setting);
- `.claude/work/net/NET_ARCHITECTURE.md`, "Adding content, online";
- `game/AGENTS.md` and the root `AGENTS.md` (the site's copy comes from
  the game's code, so the game changes first);
- `www/AGENTS.md` for the copy.

## Decisions (the owner, 2026-10-11)

| # | Question | Decision |
|---|---|---|
| C1 | Vehicles | Four beside the Razor: **Scout**, **Brute**, **Rammer**, **Buggy**. That is five in all; D5 said 2–4, and the owner chose four new ones |
| C2 | Weapons | Five beside the Minigun and the Rocket Pod: **Cannon**, **Shotgun**, **Laser**, **Homing missiles**, **Mines** |
| C3 | Maps | One beside the Scrapyard and The City: **Docks** |
| C4 | Order | The first vehicle, then a weapon that is only data, then the map, then the rest. New kinds and new mechanics come last |
| C5 | How it lands | Each addition is its own branch and pull request from `main`. The re-pin is a commit of its own (below) |

The numbers below are starting targets. The balance probes tune them
before each addition is registered.

| | Today | Target |
|---|---|---|
| **Razor** | 100 armour, 1,400 kg, 98 km/h and 0–80 in 4.2 s (as the garage quotes them, `drivePerformance`), 170 hp, 12.1 m turning circle | unchanged |
| **Brute** | — | ~150 armour, ~2,200 kg, ~85 km/h, 0–80 in ~5.5 s; wider, longer and taller than the Razor |
| **Scout** | — | ~70 armour, ~1,000 kg, ~120 km/h, 0–80 in ~3 s, a tighter turning circle |
| **Buggy** | — | ~85 armour, ~1,100 kg, ~110 km/h, big wheels, long suspension travel |
| **Rammer** | — | ~120 armour, ~1,800 kg, ~95 km/h, plus ram damage from its nose (a new mechanic) |
| **Minigun** | gun: 4 a round, 720 rpm, 60 rounds, 2.2 s reload, 160 m; 33 dmg/s sustained | unchanged |
| **Rocket Pod** | rocket: 38, 120 rpm, 6 rockets, 3.5 s, 220 m, 5 m blast; 35 dmg/s | unchanged |
| **Cannon** | — | gun: ~45 a round, 60 rpm, 4 rounds, 2.5 s reload, ~260 m, almost no spread; ~28 dmg/s |
| **Shotgun** | — | gun with pellets: 8 × ~4 a shot, 72 rpm, 6 shots, 2.5 s reload, ~45 m, wide spread; ~26 dmg/s up close |
| **Laser** | — | a beam: ~30 dmg/s while on target, ~120 m, ~4 s to overheat, ~2 s to cool (the kind is decided at its step) |
| **Homing missiles** | — | ~30 a missile, 3 m blast, ~70 m/s, turning ~2.5 rad/s, 4 a load, 4 s reload, a 0.8 s lock |
| **Mines** | — | ~60 damage, 6 m blast, armed after 1 s, set off within ~4 m, 3 down at most, 30 s life, 6 s reload |

## What moves when

Bots draw their vehicles (`modes/roster.ts`) and their guns (`armBot` over
`WEAPON_IDS`) from the registries as they stand. So a new vehicle or
weapon changes which machine and gun each seat gets in every match. That
moves every pin: the change is on purpose, not a regression.

| Addition | Pins | Digests | `PROTOCOL` and fixtures |
|---|---|---|---|
| A vehicle | All eight move: the yard's two (`sim/simulation.test.ts`), Classic's four and the two custom ones (`server/server.test.ts`). The two-vehicle tests' draws move too | none | none: ids are strings on the wire |
| A weapon of an existing kind | All eight move | none | none |
| A weapon of a new kind | All eight move | none | `PROTOCOL` goes up: its wire event (`net/events.ts`), and its fixture in `net/protocol.test.ts`, in that commit |
| A map | None of today's move. Two new Classic pins (team deathmatch and free for all on it) are added | a new line in `server/digests.json` | none |
| A new mechanic (ram damage) | Moves through the registry, as a vehicle does | none | a new event or field, if it needs one |

## The recipe: every addition

1. **Build it, unregistered.** One commit, or a few small ones. It holds
   the spec, the model or turret builder, the HUD icon and tests for
   what is new, with nothing yet in `VEHICLES`, `MODELS`, `WEAPONS` or
   `TURRETS`. Its gate A prints every pin as on `main`. That run is the
   proof that the old hashes still come out without the new entry.
2. **Tune it.** In a scratch worktree, register it and run the balance
   probes (step 0). Fold the final numbers into step 1's commit before
   the branch is pushed.
3. **Register it and re-pin**, in a commit of its own. That commit holds
   the registry rows and the new pins, nothing else. Its message gives
   the reason ("bots draw from the registries, so every seat's draw
   changed"). It lists each pin old → new, and names the step 1 commit
   whose gate printed the old ones. `LOG.md` gets the same.
4. **Check it.**
   - Gate B: the smoke list, as in `.claude/work/refactor/PLAN.md`, and
     both `scripts/browser-match.mjs` runs.
   - Gate C: `scripts/arena-parity.mjs` for a map, and the probes once
     more on the final tree.
   - A look in Chrome on a real GPU (`NET_RUNBOOK.md` step 7).
5. **Patch notes**, in a commit of their own: an entry in
   `screens/PatchNotesPanel.tsx` (the game's version, shown in the menu).
   Also `game/index.html`'s description, if it names the weapons.
6. **The site's copy**, after the game's pull request is merged: the
   guide (`garage.mdx` for vehicles and weapons, `arenas.mdx` for maps,
   and `how-to-play.mdx`, `index.mdx` and `faq.mdx` where they name
   them), `www/src/lib/site.ts` and the structured data. Facts come from
   the game's code. Then the site's gates: `npm run lint`, `npm run
   check`, `npm run build`.

Gates, the same as the refactor's:
- **A, every commit**, in `game/`: lint with 0 warnings, `format:check`,
  `npx tsc -b`, `npm run build`, `npm test`.
- **B** when a screen, the HUD, the view, the runtime or a store changes.
- **C** for maps (arena parity) and for anything that changes play (the
  probes).
- **D**: an entry in `.claude/work/content/LOG.md` with what the commands
  printed.

A pin, digest or fixture that moves where the table says it shouldn't
means stop, revert and find the cause. Never re-pin to make a check pass.

## Steps

### 0. Before the first addition

1. **Port the free for all probe.** `.claude/work/ffa/ffa-metrics.js`
   still reads `ffa.items`, `contender.effects` and `FFA.items`, which
   moved to the pickup supply (`rules.supply`, `SUPPLY`) before the
   refactor. Its run throws (refactor log, 0.1 and 1.1). The probes run
   after every addition, so this comes first.
2. **Probes by vehicle and gun.** Both probes get an option that puts the
   player in a given vehicle and gun (`changeVehicle` and `armWeapon` on
   `window.match`, in practice). They report kills, deaths, damage dealt
   and taken, and time alive per vehicle and per gun, for every seat,
   since bots draw them at random. Then the baselines on `main`: ten
   team deathmatches and ten free for alls on each map.
3. **A test for every model.** Coverage puts the vehicle and turret
   builders at 0 % (refactor log, 2.1). For each `MODELS` entry, build it
   headless (`server/headless.ts` fakes what Node lacks). Check:
   - the node names (`body`, `turret` > `gun`, `wheel_fl/fr/rl/rr`);
   - the wheels where the chassis puts them;
   - the turret ring at the spec's mount.

   Likewise each `TURRETS` builder has its `gun`. These are tests only:
   no pin moves. Each new model and turret is then held by them as soon
   as it is registered.

### 1. Brute: the first real vehicle, in place of the test-only hauler

`server/testVehicle.ts`'s hauler exists only until a real second vehicle
does, and the Brute is the one closest to it.
- **1a. Unregistered.** The Brute's spec and its body
  (`content/vehicles/models/brute.ts`), out of `ROSTER` and `MODELS`.
  `server/testVehicle.ts` adds the Brute's spec in place of the hauler's.
  The two-vehicle tests in `server.test.ts`, the netplay drive and the
  client test then run on the real numbers. Their expected values change
  in this commit: the bots' draws, the lift, the distance driven. No
  pin moves.
- **1b. Register and re-pin.**
  - The `ROSTER` and `MODELS` entries. `server/testVehicle.ts` and every
    `addHauler()` go; the tests name `'brute'` directly.
  - The re-pin.
  - `game/AGENTS.md`'s code map loses `testVehicle.ts` and gains
    `models/brute.ts`.
- **Check:**
  - the garage's vehicle pager, which shows for real now (←→ on
    Vehicle, the sheet, the turntable);
  - Classic in Chrome in each vehicle.
- **The takeover correction** (refactor log, 1.4b). When a person takes
  a seat in another vehicle than the bot's, `changeVehicle` lifts the new
  body 0.2 m. The page then corrects once while the body settles. With
  five vehicles that becomes common in Classic. Measure it with the
  Brute in Chrome. If it shows, settle the body before the welcome.
- Probes; patch notes; the site.

### 2. Cannon: a weapon that is only data

A `gun`: hitscan, rewound like the Minigun.
- **2a.** Its turret (`content/weapons/turrets/cannon.ts`) and HUD icon,
  unregistered.
- **2b.** The `WeaponId`, `TurretKey`, `WEAPONS` and `TURRETS` entries,
  and the re-pin.

The garage's weapon pager, the lobby's one-gun setting, the wire, the
record and the replay all follow by themselves. Bots use the `gun` tactics
(`sim/ai/think.ts` `TACTICS`), which close in. If the probes show them
throwing the Cannon's range away, a preferred range per weapon is the
fix, as a separate commit.

### 3. Docks: the map

A quay along one side, the water's edge solid (no water physics).
Container stacks make lanes, with two or three cranes, warehouses from
The City's building kit, bollards and forklifts. A team base at each end.
- **3a. Unlisted.** The builder (`content/arenas/docks.ts`) and any kit
  pieces, out of `MAPS`. Build it headless and look at it through a
  scratch capture.
- **3b. Listed.**
  - The `MAPS` row (modes hosted: both).
  - Its preview card, `public/maps/docks.jpg`, rendered from the game.
  - Its digest in `server/digests.json`.
  - Its two new Classic pins.

  The arena test then holds it to the checklist:
  - starts for 12 in free for all;
  - two bases of six;
  - hot zones;
  - a road graph in one piece;
  - starts clear for every vehicle's shells (the Brute's included,
    which is why the map comes after it);
  - room for a full drop of pickups;
  - every mode it hosts at its biggest.
- **Check:** `scripts/arena-parity.mjs`; `scripts/match-smoke.mjs` (it
  reads `digests.json`, so the Docks are in it); the probes on the Docks.
- Classic keeps a queue per mode and arena, so a third arena spreads
  searching players thinner. Watch the time to a match. "Any arena" is a
  separate change, if it is needed.

### 4. Scout, then Buggy: vehicles that are only data

The recipe as in step 1, without the hauler swap. The Buggy's long
suspension and big wheels are numbers in `Handling` and `Chassis`. Its
landings matter little on today's flat ground, with heaps only, so check
it in the probes on all three maps.

### 5. Shotgun: a gun with pellets

- A `pellets` field on guns, absent meaning 1. One shot casts that many
  rays. The spread is drawn from the match's stream, and with one pellet
  the draws stay exactly as today: 5a holds every pin with the code in
  and no shotgun registered.
- The `fired` event goes once a shot. Each ray is rewound for lag
  compensation.
- The garage's `kindSpecs` shows the pellets.
- Bots use the `gun` tactics, at its short range.

### 6. Laser: a new kind (decide the kind at its start)

A continuous beam: damage every step while it is on target, with heat in
place of a magazine. The recommendation is a new kind, `beam`. As a
fast-firing `gun` it would send a wire event every step (60 a second) and
draw 60 tracers.

The compiler lists the places that handle each kind:
- `fire` and the recorder's `fired`;
- `TACTICS` and `flightTime` (`sim/ai/think.ts`);
- `blastRadius` (`sim/ai/perception.ts`);
- `FIRE_CUE` and `SPINS`;
- the garage's `ROUND` and `kindSpecs`.

The rest it can't list:
- the beam's state on the machine (on or off, heat);
- its damage each step, rewound;
- its wire events (on, off, the target) and `PROTOCOL`;
- the view's beam and the HUD's heat bar;
- its sound;
- the bots' use of it.

The owner confirms the kind and the heat numbers first.

### 7. Homing missiles: a new kind

- **The lock.** The pilot's lock-on window (`view/pilot.ts`) already
  finds a hostile under the crosshair. The lock target joins the
  controls the page sends, which is a new input field and so a
  `PROTOCOL` bump. The server accepts a lock only on a hostile inside the
  cone and the range, and the fair-play watch notes locks.
- **The missile.** A projectile that turns toward its target at a
  limited rate and bursts as a rocket does, with its wire events and its
  view.
- **The bots** lock first, then fire.

### 8. Mines: a new kind

- **Laying.** Mines go down behind the machine, arm after a second and
  go off when a hostile machine comes near. Friendly fire follows the
  match's setting. At most three are down per machine, each for 30 s.
- **The wire.** Laid and gone off, as events, and a mine in the view
  (stage 4's scratch `mine` listed the places).
- **The bots** lay them when chased. Avoiding the mines they know of is
  a cost in `sim/ai/navigation.ts`, as a separate commit.

### 9. Rammer: a new mechanic

- **Ram damage belongs to a vehicle** (`ram`: hull points per m/s of
  closing speed, inside an arc around the nose). Only a machine that has
  it deals ram damage, so the Razor and the others play as before, and
  the pins move only through the registry.
- **The server finds the pair** that touched. Today a crash is only a
  jolt in one machine's speed (`CRASH_JOLT`, a view event); Rapier's
  contact pairs give both. It applies the damage, and a wreck it causes
  is a kill (scoring, and the feed's line).
- The page takes the server's word, as it does for any damage.
- The bots charge the target.
- Fair play: none needed, since the server decides the contact.

### 10. After the last addition

- Coverage, bundle weight and the probes measured again, against the
  numbers in the refactor's log (2.1 to 2.3).
- `ARCHITECTURE.md`'s how-tos rewritten with what the new kinds really
  touched.
- The site's copy, read once more against the game.

## Open points, settled at their step

- The Laser's kind and its heat (step 6): the owner's call.
- The Shotgun's hits on the wire: one damage event a pellet, or one a
  shot per machine hit (step 5).
- Classic's queues across three arenas (step 3).
- The takeover correction (step 1).
- The HUD's weapon panel and the garage's pagers at five vehicles and
  seven weapons: they page through the registries already. Look at
  them in Chrome at each step.
