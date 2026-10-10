# Module boundaries

Lint holds them. `game/.oxlintrc.json` is the source of truth: an override
per level bans what lies above it, and `npm run lint` (CI too) fails on a
break, naming the rule broken. This page says what the levels are; the
patterns live in the config only. Paths under `game/src/`.

## Levels

A module imports from its own level or a lower one, never higher.

| Level | Folders |
| --- | --- |
| 6 | `screens/`, `hud/`, `App.tsx`, `main.tsx`; a mode's React panels (`modes/**/*.tsx`, `modes/views.ts`) |
| 5 | `runtime/` |
| 4 | `view/`; the page's side of `net/` (`connection`, `client`, `prediction`, `snapshots`, `sessionSocket`, `matchmaking`, `lobbies`, `session`, `chat`, `chatCommand`); a mode's 3-D view (`modes/items/pickups.ts`, `modes/ffa/zone.ts`, `modes/scenery.ts`) |
| 3 | `modes/` (domain: rules, adapters, settings, roster); the wire, server-safe (`net/protocol.ts`, `events.ts`, `lobbyProtocol.ts`, `lobbyRules.ts`, `limits.ts`) |
| 2 | `sim/` |
| 1 | `content/` |
| 0 | `render/`, `shared/` |

- `game/server/` imports levels 0–3 and itself. `server/browser.ts` and the
  tests play pages on purpose.
- `sim/`, `shared/` and the modes' domain are pure: no React, no rendering,
  no `Math.random`, `Date.now` or `performance.now` (randomness comes from the
  match seed, time from the fixed step), no `window`, `document` or storage.
  They run headless, in the browser and on the game server alike.
- The screens and the HUD read the match, never the physics world: no Rapier,
  no `sim/physics.ts`, and `sim/simulation.ts` for its types only.
- Tests are exempt from the levels: they drive the layers from outside.
- No import cycle, types included, and every relative import names its
  file.
- What crosses a level today and a later refactor stage removes is an
  allowance in `.oxlintrc.json`, its comment naming that stage.
- One test runner: `game/repo.test.ts` fails if a `*.check.ts` comes back
  (every test is Vitest's).
- Code outside a mode learns about modes from `MODE_TRAITS`
  (`modes/traits.ts`), never by comparing ids: `game/repo.test.ts` fails on a
  `'tdm'`/`'ffa'` string literal outside the modes (`ids.ts`, `traits.ts`,
  `modes.ts`, the mode folders), the data that lists them (`maps.ts`,
  `App.tsx`'s first pick), the tests, and `server/browser.ts` /
  `load.ts`; and on a `mode.kind` comparison in `hud/` or `screens/`.

## Rules of thumb

- The simulation reports; the view presents. A headless run gives it a
  no-op `SimEvents` (`sim/simulation.test.ts` does exactly that).
- A mode is reached only through `MatchMode` (`sim/matchMode.ts`); the only
  places that ask which mode runs are its own folder (the adapter, its HUD
  and results panels) and the registries keyed by mode (`MODES`,
  `MODE_TRAITS`, `MODE_VIEWS`, `MODE_SCENERY`). `hud/` and `screens/` read
  a mode's detail through its panels (`modes/views.ts`).
- Registries are plain records keyed by id: `WEAPONS`, `VEHICLES` (+
  `MODELS`), `MAPS`, `MODES`. TypeScript's `Record<Id, …>` makes a missing
  entry a compile error; `sim/simulation.test.ts` checks the numbers.
