# Stage 2 — Boundaries

**Goal:** the layers hold because lint fails otherwise, not by convention.
Configuration plus one small check: no production edits, except real leaks that
lint finds (each in its own behaviour-preserving commit).

**Before:** stage 1 done on `refactor/game` (its gates passed).

Checked on oxlint 1.85, 2026-10-08:

- `no-restricted-imports` with `overrides` works.
- `no-restricted-globals` and `no-restricted-properties` work (`Math.random`).
- `import/no-cycle` reports 0 with `ignoreTypes: true` and 43 counting types.
- `import/extensions` is in the schema; confirm it does what step 3 needs.
- Override globs are relative to the config file.

## Levels

A module imports from its own level or a lower one, never higher:

| Level | Folders |
|---|---|
| 6 | `screens/`, `hud/`, `modes/**/*.tsx`, `modes/views.ts` (React) |
| 5 | `runtime/` |
| 4 | `view/`; the rest of `net/` (`connection`, `client`, `prediction`, `snapshots`, `sessionSocket`, `matchmaking`, `lobbies`, `session`, `chat`, `chatCommand`); `modes/scenery.ts`, `modes/items/pickups.ts`, `modes/ffa/zone.ts` (mode 3-D) |
| 3 | `modes/` (domain); `net/{protocol,lobbyProtocol,lobbyRules,events}.ts` (the wire: server-safe) |
| 2 | `sim/` |
| 1 | `content/` |
| 0 | `render/`, `shared/` |

- `server/` imports levels 0–3 and itself. `server/browser.ts` and `*.check.ts`
  are exempt: they play pages on purpose.
- `modes/ids.ts` (stage 3) imports nothing and may be imported from anywhere.
- Server reachability needs no script. Each level bans what is above it, so the
  server's import closure stays clean by induction.

## Steps

1. **Import bans by folder.** In `.oxlintrc.json`, add `plugins: ["import"]` and
   one `overrides` entry per row of the levels table, with `no-restricted-imports`
   patterns on the specifier: `**/view/**`, `**/runtime/**`, `**/net/client*`,
   and so on. Also:
   - `sim/`, `modes/` (domain) and `shared/` ban `react`, `three/examples/**`
     and `**/render/**`;
   - `server/**` bans `react` and `@heroiclabs/nakama-js`;
   - `screens/**` and `hud/**` ban `@dimforge/rapier3d-compat` and
     `**/sim/physics*`. Find out whether oxlint's rule takes
     `allowTypeImports`. If it does, also ban `**/sim/simulation*` for values;
     if not, leave that out, since the HUD imports its types.
2. **Purity.** On `src/sim/**`, `src/shared/**` and the domain files of
   `src/modes/**`:
   - `no-restricted-properties`: `Math.random`, `Date.now`, `performance.now`;
   - `no-restricted-globals`: `window`, `document`, `localStorage`,
     `sessionStorage`.

   Gameplay randomness comes from the match seed only (game `AGENTS.md`).
3. **Conventions.**
   - `import/no-cycle` with `ignoreTypes: true`; stage 3 turns types on.
   - `import/extensions`: relative imports always name their file (stage 1's
     convention).
4. **Allowances.** Run lint with no allowances first. Every error is either:
   - a known allowance below: an `overrides` entry with a comment naming the
     stage that removes it; or
   - a real leak: fix it in its own commit, behaviour-preserving, or log why it
     waits.

   | Allowance | Removed in |
   |---|---|
   | `content/vehicles/vehicles.ts` → `sim/drive.ts` (types `Handling`, `Chassis`) | stage 4 |
   | `content/vehicles/models.ts` → `sim/combat.ts` (weapon type) | stage 4 |
   | `content/arenas/maps.ts` → `modes/modes.ts` (type `Mode`) | stage 3 |
   | `sim/matchMode.ts` → `modes/items/supply.ts` (type `Supply`) | stage 3 |
   | `sim/loadout.ts` reads `localStorage` | stage 4 |
   | `modes/modes.ts` → `modes/items/pickups.ts`, `modes/ffa/zone.ts` (scenery) | stage 7 |

   Legal by level, so not allowances, but on the list for stage 3: the wire
   (`net/protocol.ts` through `modes/matchSettings.ts`) and the lobby screens
   import `sim/ai.ts` only for `DIFFICULTIES`. That puts the bot AI, and Rapier
   with it, in the wire's import closure. `screens/Garage.tsx` → `sim/drive.ts`
   (`drivePerformance`, pure maths) stays: the UI ban targets Rapier and the
   world, not maths.
5. **Every check runs.** Add `game/repo.test.ts`, a Vitest test that
   `tsconfig.node.json` includes. Every `*.check.ts` under `src/`, `server/`
   and `game/` must be in the `check` script or in `vite.server.config.ts`
   `ENTRIES`.
   - The custom work's review found logged checks that never existed; this test
     makes the script, not a log, the evidence.
   - Vitest discovers `*.test.ts` by itself, so new tests can't be forgotten.
     This test only guards the scripts until stage 9 moves them.
   - Turn on oxlint's `vitest` plugin for `*.test.ts`.
6. **Invariants into existing checks** (no new files): assert
   `RATE.step * PHYSICS_STEP === 1` in `src/net/protocol.check.ts`.
7. **Docs.**
   - `.claude/work/arch/MODULE_BOUNDARIES.md`: `.oxlintrc.json` is the source of
     truth; quote the levels table, and don't restate the patterns.
   - Game `AGENTS.md`, engineering principles: one line saying lint holds the
     layers.

## Verify

- Gate A.
- Show in `LOG.md` that each of these makes lint (or `repo.test.ts`) fail with a
  clear message, then revert it:
  - `view/audio.ts` imported into `sim/simulation.ts`;
  - `Math.random()` in `modes/tdm/rules.ts`;
  - `window` in `sim/`;
  - `react` in `sim/`;
  - an extensionless import;
  - a check file dropped from `package.json`.

## Done when

- `npm run lint` enforces the levels on the code, with only the named
  allowances.
- `repo.test.ts` runs in `npm test`.
- CI fails on a layer break.

**Rollback:** revert. Config only.
