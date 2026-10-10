# Game refactor — plan

**Status (2026-10-10): done.** Stages 0–11 passed their gates on
`refactor/game`, one local commit a step (`LOG.md`, with the before/after
numbers in 11.3). Push, the pull request and the merge wait for the owner.

The game's code (`game/src/`, `game/server/`) reorganised into layer folders,
made smaller where it repeats itself, tested with Vitest, and with the seams the
custom lobbies exposed closed. The aim is that the content planned next can be
added without editing the engine: 2–4 vehicles, several weapons, 1–2 maps.

**The game must not change while this happens.** Every stage leaves it playing
exactly as before. Stage 10, which makes seats honour the chosen vehicle online,
changes the protocol on purpose; it still plays the same while there is one
vehicle.

- **Analysis and evidence:** `.claude/work/BBMV_GAME_REFACTOR_PLAN.md`
  (revision 2, measured at `3b0943d`). This folder is that analysis split into
  stages that run in order. Where the two disagree, this folder wins.
- **Decisions** (2026-10-08, see the table below):
  - the folder reorganisation stays and runs early (stage 1);
  - Prettier is the formatter;
  - unused code is deleted;
  - Vitest becomes the test runner (stage 9);
  - layer rules are enforced by oxlint, not a custom checker;
  - no `index.ts` files;
  - three misleading names are fixed;
  - weapons get a firing `kind`;
  - everything stays on `refactor/game` until every stage is done and tested;
  - new content stays procedural code, like today's.
- **Branch:** `refactor/game`, made from `main` at `3b0943d` after the merged
  `feat/custom-game` was deleted (local and remote). All work happens on this
  one branch, this week. Nothing reaches `main`, and so nothing reaches the
  server, until every stage has passed its gates; then it merges once.
- **Commits:** local only, on `refactor/game`, one per step once its gate A is
  green (the owner's word, 2026-10-08). Push, PR and merge wait for the owner,
  each separately.
- **Progress:** `LOG.md` in this folder; stage 0 starts it. Every step ends
  with its `LOG.md` entry (what ran, what it printed), so a new chat resumes at
  the first step without one. The work spans several chats this week.

Paths are under `game/` unless noted.

## Stages

| # | File | What | Changes play? | Risk |
|---|---|---|---|---|
| 0 | `00-safety-net.md` | Pins for custom settings, wire fixtures, the flaky timing check made steady, Vitest set up, the baseline measured | no (checks and tooling) | low |
| 1 | `01-structure.md` | Prettier; unused code deleted; `src/game/` split into layer folders; misleading names fixed; one import convention; the code map rewritten | no (moves) | low per step, high churn |
| 2 | `02-boundaries.md` | Layer rules in `.oxlintrc.json`; a test that every check runs | no (lint only) | low |
| 3 | `03-leaf-types.md` | Mode ids, difficulty, `Point`, `wrap` and the time helpers at the bottom of the graph; no type cycle | no | low |
| 4 | `04-content.md` | Weapons as data (id, turret registry, HUD icon, firing `kind`); vehicle types and model files; one loadout parser | no | low–medium |
| 5 | `05-mode-traits.md` | What shared code may know about a mode, in one table; lobby rules written once for server and page | no | low–medium |
| 6 | `06-wire.md` | One codec for wire events; the lobby wire in its own module | no (bytes identical) | medium |
| 7 | `07-ui-seams.md` | Rendering out of the mode contract; per-mode HUD and results panels | no (looks identical) | medium |
| 8 | `08-module-splits.md` | `room.ts`, the page's two stores, `match.ts`, the big screens and `ai.ts` split by responsibility | no | medium |
| 9 | `09-tests.md` | The `.check.ts` scripts moved into Vitest with parity; one test runner | no | medium |
| 10 | `10-content-ready.md` | Vehicle choice online, the garage's vehicle pager, bots' vehicles, the new-map checklist as tests | protocol only (`PROTOCOL` 7) | high |
| 11 | `11-cleanup.md` | Docs final, public surface trimmed, before/after numbers, bundle weight (optional) | no | low |

Analysis phase → stage: 0 → 0, 6 → 1, 1 → 2, 2 → 3 and 4, 3 → 5, 4 → 6, 5 → 7,
7 → 8, 8 → 10, 9 → 11. Stage 9 is new.

Stages 0–2 are the foundation. Stage 0 makes the checks trustworthy, stage 1
moves code into its final folders, and stage 2 makes lint hold the layers. Every
later stage then lands in place, under enforced rules, without moving anything
twice.

**This week** (an estimate to steer by, not a deadline that beats the gates):

| Day | Stages |
|---|---|
| 1 | 0 |
| 2 | 1, 2 |
| 3 | 3, 4, 5 |
| 4 | 6, 7 |
| 5 | 8 |
| 6 | 9, 10 |
| 7 | 11, the final run (below), the merge |

Stop only at a stage boundary: the branch there plays exactly like `main`. A day
that runs over moves the plan, never the gates.

## The rule: the game never ships broken

"Behaviour-preserving" is measured, never claimed:

| What holds | Measured by |
|---|---|
| Same seed, same match | The golden pins: 2 in `src/game/simulation.check.ts` (test yard), 4 in `server/server.check.ts` (real arenas), plus stage 0's 2 custom-settings pins |
| Same arenas | `server/digests.json` (`227c4ce7` / `8913ad26`), checked by `arena.check` |
| Same bytes on the wire | `PROTOCOL` 6 and stage 0's wire fixtures |
| Same screens | The smoke list below; before/after screenshots for UI steps |

Gates:

- **A, every step:** in `game/`, these are all green:
  - `npm run lint` (0 warnings) and `npm run format:check` (from stage 1)
  - `npx tsc -b`
  - `npm run build`
  - `npm run check` (includes `server:check`)
  - `npm test` (Vitest, from stage 0)

  After every step, not only at a stage's end, so every step's commit is green
  and a series of moves can bisect.
- **B, every step that touches screens, HUD, view, runtime or the page's
  stores:**
  - the smoke list, in Chrome against the dev server on `:3000` (never start
    one yourself: root `AGENTS.md`);
  - `node scripts/browser-match.mjs` and `node scripts/browser-match.mjs custom`
    (global Playwright).
- **C, end of a stage:**
  - `node scripts/arena-parity.mjs` when arenas, physics or their paths changed;
  - one balance-probe run when `sim/` or `modes/` changed. The probes are
    `.claude/work/ffa/ffa-metrics.js` and `.claude/work/tdm/tdm-metrics.js`,
    loaded through a temporary copy in `game/public`.
- **D, end of a stage:** a `LOG.md` entry with what the commands printed (check
  and test counts, pin hashes, sizes, timings), not prose about them.

If a pin, digest or fixture moves when it shouldn't: **stop**, find the cause,
revert the step. Never re-pin to make a check pass.

**Smoke list** (analysis §17):

1. Startup to the main menu: no console errors.
2. Garage: swap weapons; the turret changes.
3. Practice TDM on the Scrapyard: countdown, fight, wrecked (death board),
   respawn, Tab board, pause and resume, a settings change, results, then Play
   again.
4. Practice FFA on The City: pickups, hot zone, effect chips, standings, results
   (placing, crown).
5. Classic online: a local server and two tabs. Find Match, ready check, match,
   chat; leave, and a bot takes the seat.
6. Custom lobby:
   - create one (TDM 6 v 6, friendly fire, pickups on);
   - join by code and by link, ready, start at 2 of 12;
   - in the match: the TK column, pickups in TDM;
   - Back to lobby, the tally, Edit with a mode change;
   - kick a member mid-match;
   - reload in the waiting room and in a match (back within 20 s).
7. Exit to the garage: `window.match` cleared; the renderer's geometry and
   texture counts as before.

## Keep as it is

Everything the analysis lists as a good decision (§1.4, and §22 "Do not change"),
among them:

- One simulation for practice, server and replay. `SimEvents` as direct calls.
  Controls as data. Pure rules behind `MatchMode`. `MatchSource`.
- The seeded streams and their draw order, Rapier's creation order, the fixed
  step, and the step order in `simulation.step` and `room.step`.
- The binary snapshot layout, `PROTOCOL`/`BUILD` discipline, and
  `net/protocol.ts` at its path (`scripts/match-smoke.mjs` reads it).
- Arena digests and headless builds. Session caches (library materials are
  never disposed). Imperative HUD writes; React stays out of the loop.
- `server/` kept flat, factory functions and plain `Record` registries.
- Until stage 9, the `.check.ts` scripts stay the guards. Stage 9 moves them
  into Vitest with every assertion kept.
- From the custom work:
  - the pure lobby service with hooks;
  - one settings validator;
  - settings in replay headers and records;
  - empty seats keeping per-seat arrays;
  - secrets never logged;
  - custom rooms invisible to Classic;
  - the socket hand-off (`aside`/`release`).

Never added, at any stage: ECS, an event bus, DI, a state library, a physics
abstraction, `RoomKind`, a merged session manager, a schema-driven settings
form, path aliases, workspaces (analysis §19).

## Conventions for moved and new code

- Every relative import names its file, extension included (`./rng.ts`,
  `./Hud.tsx`). At baseline 433 relative imports have no extension.
- No `index.ts`. Node can't import a folder, so it would only add a file named
  `index.ts` to every folder. A registry file is named after what it holds
  (`vehicles.ts` holds `VEHICLES`), and no file re-exports another's exports.
- Data tables together, builders apart. Each kind of content keeps its specs in
  one table, so balance is read side by side: `vehicles.ts`, `weapons.ts`,
  `maps.ts`. Each model, turret or arena builder lives in a file of its own.
- One name means one thing. No two modules whose names differ only in number
  or case (`vehicle.ts`/`vehicles.ts`); no two types of one name
  (`server/lobby.ts`'s `Lobby` and `server/custom.ts`'s `Lobby`).
- PascalCase components, camelCase modules (game `AGENTS.md`).
- `shared/` holds only what two or more layers use. It is not a drawer.
- Tests: Vitest, colocated `thing.test.ts`, following
  `.claude/codes/ts/testing.md`. Every module a stage creates or reshapes, from
  stage 3 on, comes with its test.
- A commit that moves code changes nothing else. Formatting has its own commit
  too.
- Docs: every step updates the living docs it makes wrong: the `AGENTS.md`
  files, `.claude/work/arch/`, the probes, `scripts/`. Logs and finished plans
  are history, so their paths stay as written.

## Working rules

- One stage at a time, steps in order. A stage starts when the one before it has
  passed its gates and its `LOG.md` entry is written. Stages follow on without
  waiting for a go (the owner's word, 2026-10-08). Stop and ask the owner when:
  - a pin, digest or fixture moves unexpectedly;
  - a gate fails without a clear cause;
  - a decision outside this plan is needed.
- Before a stage, read root `AGENTS.md`, game `AGENTS.md`, and
  `.claude/codes/ts/README.md` with `patterns.md` (and `testing.md` from stage 0
  on). The project's rules win over the guide.
- One branch (D3). Every stage happens on `refactor/game`. A stage is done when
  its gates pass; only then does the next start. Each green step is one local
  commit; nothing is pushed until the owner says.
- CI runs only on pull requests and pushes to `main` (`ci.yml`), so this week
  the local gates are the CI. If the owner wants GitHub's CI too, a draft PR
  from `refactor/game` to `main` runs it on every push without deploying.
  Pushing it is the owner's call.
- **The one merge into `main`**, at the end, after stage 11:
  - gates A–D on the final branch;
  - the whole smoke list;
  - both `browser-match.mjs` runs;
  - `npm run server` with two tabs, a Classic match and a custom match.

  That merge deploys once (`deploy.yml`). The build id changes, so the game
  server restarts and open pages reload: merge at a quiet hour.
- Feature freeze on `game/` until that merge.
- After mass moves Vite's module graph can go stale. If `:3000` fails to load
  after a move, ask the owner to restart the dev server.
- Until stage 0 fixes it, `netplay.check` fails often on a loaded machine.
  Rerun it before debugging.

## Decisions

| # | Question | Decision | Stage |
|---|---|---|---|
| D1 | A formatter? | **Yes.** Prettier 3 (oxfmt is still 0.x, with weekly releases), with the official Tailwind class-order plugin. One formatting commit, listed in `.git-blame-ignore-revs` | 1 |
| D2 | Unused code? | **Delete it:** the legacy generators (`VehicleGenerator.ts`, `ArenaGenerator.ts`, `proceduralTexture.ts`, 325 lines), `public/icons.svg` (referenced nowhere since the first commit), exported types nobody imports, and whatever the stage 1 sweep finds | 1 |
| D3 | Where does the work live? | **One branch, `refactor/game`,** all week. Nothing goes to `main` or the server until every stage is done and tested; then one merge | all |
| D4 | Vitest? | **Adopted** as the test runner: set up in stage 0, new tests from stage 3, the `.check.ts` scripts moved into it in stage 9 | 0, 9 |
| D5 | When does the second vehicle come? | **After the refactor:** 2–4 vehicles, several weapons and 1–2 maps. Stage 10 makes the code ready; the content follows in its own PRs | 10 |
| D6 | Procedural code or imported glTF for the new vehicles and maps? | **Procedural code, like today's.** No glTF loader, and no separate arena layout | 10 |

## After the refactor: adding content

What each addition should take once stage 10 is done; stage 11 writes these up
as the "how to add" docs:

| Add | Touches |
|---|---|
| A vehicle | One row in `content/vehicles/vehicles.ts` and a builder in `content/vehicles/models/<id>.ts`. The garage, the online seat, bots and replays follow |
| A weapon | One row in `content/weapons/weapons.ts` (id, numbers, turret, icon) and a turret file if new. A new firing **behaviour** (mines, homing) is sim work: one more `kind`, and the compiler lists every place that must handle it |
| A map | A builder file, one row in `content/arenas/maps.ts`, a preview image and a digest line. `arena.check` holds it to every mode it hosts at the largest size |
| A mode | Its folder (config with traits, rules, adapter, panels, test) and one line each in `ids.ts`, `traits.ts`, `modes.ts` and `views.ts` |

Bots draw their guns, and from stage 10 their vehicles, from the registries.
So a new weapon or vehicle changes how Classic's bots play. The content PR
re-pins in a commit of its own, with that reason. That is a change on purpose,
not a regression.

## Target tree (after stage 10)

```
game/
├── vitest.config.ts · .prettierrc · repo.test.ts (every check runs; no mode literal outside the modes)
├── server/                flat, as today
│   ├── main · server · auth · seating (was lobby) · matchmaker · lobbies (was custom) · room
│   ├── journal · inputs · netsim                                     (stage 8)
│   ├── recorder · rewind · fairplay · records · replay · replay-main
│   └── arenas · headless · load · browser · digests.json · *.test.ts
└── src/
    ├── main.tsx · App.tsx · analytics.ts · index.css
    ├── shared/     rng · math (wrap, Point) · time (ms, clock)
    ├── render/     renderer · environment · postprocessing · geometry · materials/
    ├── content/    parts
    │   ├── vehicles/   vehicles (VEHICLES) · models (MODELS) · types · models/<id>
    │   ├── weapons/    weapons (WEAPONS) · turrets (TURRETS) · turrets/<id>
    │   └── arenas/     maps (MAPS) · arena · digest · scrapyard · city · kit/{props,ground,buildings,street}
    ├── sim/        simulation · combat · physics · drive · scoring · matchMode · difficulty · loadout
    │   └── ai/         brain · perception · navigation · think                (stage 8)
    ├── modes/      ids · traits · matchSettings · modes (MODES) · roster · scenery · views
    │   ├── items/      config · items · supply · pickups (client)
    │   ├── ffa/        config · rules · mode · zone (client) · HudPanel · ResultsPanel (client)
    │   └── tdm/        config · types · rules · tactics · mode · HudPanel · ResultsPanel (client)
    ├── view/       view · feed · pilot · input · camera · effects · audio · sounds · settings · turntable
    ├── runtime/    runtime · match · practice · online · loading · stored
    ├── net/        protocol (stays here) · lobbyProtocol · lobbyRules · events
    │               connection · client · prediction · snapshots
    │               sessionSocket · matchmaking · lobbies · session · chat · chatCommand
    ├── screens/    MainMenu · Garage · MapSelect · Matchmaking · GameCanvas (+ PauseMenu, ExitConfirm,
    │               LoadingOverlay) · Results · hooks (was search) · …
    │   └── lobbies/    Custom · Lobbies · Lobby (+ SlotGrid, SettingsCard, InviteCard) · LobbyForm
    └── hud/        Hud · minimap · Chat
```

Tests sit beside their subject: `sim/simulation.test.ts`,
`modes/ffa/rules.test.ts`, `runtime/loading.test.ts`, and so on.
