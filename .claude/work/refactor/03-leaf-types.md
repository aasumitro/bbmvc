# Stage 3 — Leaf types and duplicates

**Goal:** put ids, shared helpers and the contract's types at the bottom of the
graph, leave no import cycle (types included), and give each duplicate one
definition. Type-level changes and moves of identical code: runtime behaviour is
unchanged.

**Before:** stage 2 done on `refactor/game` (its gates passed).

## Steps

One commit each.

1. **Mode ids.** Create `modes/ids.ts`, which imports nothing:
   `export const MODE_IDS = ['tdm', 'ffa'] as const` and
   `export type Mode = (typeof MODE_IDS)[number]`.
   - `modes/modes.ts` declares `MODES … satisfies Record<Mode, …>`.
   - Every `type Mode` import moves to `ids.ts`.
   - Keep `MODES`' key order: the screens list modes in it.
   - Remove the allowance `content/arenas/maps.ts` → `modes/modes.ts`. The import
     now goes to `ids.ts`, which anything may import.
2. **Difficulty.** Move `Skill`, `DIFFICULTIES` and `Difficulty` out of
   `sim/ai.ts` into `sim/difficulty.ts`, unchanged: same values, same key order.
   `CUSTOM.skills` and the wire validate by those keys.
   - Importers: `sim/ai.ts`, `modes/matchSettings.ts`, `modes/roster.ts`,
     `net/protocol.ts`, `server/room.ts`, `server/lobbies.ts`, the screens and
     the runtime.
   - The wire no longer imports the bot AI. It still reaches Rapier through
     `sim/combat.ts` until stage 4 splits the weapon data out.
3. **`shared/math.ts`.**
   - `wrap(angle)`: today five identical copies (`view/view.ts`,
     `view/camera.ts`, `sim/ai.ts`, `view/pilot.ts`, `hud/Hud.tsx`).
   - `Point {x, z}`: today three copies (`sim/matchMode.ts`,
     `modes/items/items.ts`, `modes/tdm/types.ts`).
   - `server/fairplay.ts`'s `Point` is 3-D `{x, y, z}`, another thing under the
     same name: rename it (`Spot`, or what reads best there).
   - The functions are the same, so the float operations are the same, and the
     pins hold.
4. **`shared/time.ts`.** Move `ms` (rounds seconds to the millisecond) and
   `clock` (formats `mm:ss`) out of `sim/matchMode.ts`. This removes the
   `modes/items/supply.ts` → `sim/matchMode.ts` value edge.
5. **`SupplyView`.** In `sim/matchMode.ts`, `supply?: Supply` becomes
   `supply?: SupplyView`: just the members the HUD, the minimap and the view
   read (find them by reading those three). `Supply` must satisfy it
   structurally, which `tsc` proves. Remove the allowance
   `sim/matchMode.ts` → `modes/items/supply.ts`.
6. **One `Seat`.** `net/protocol.ts`'s `Seat` becomes `SeatInfo` (type only;
   `sim/matchMode.ts` keeps `Seat`).
7. **The arena cache.** `loadArena`, the session cache whose only caller is
   `runtime/runtime.ts`, moves to the runtime. `content/arenas/maps.ts` keeps
   `MAPS`, `MapId` and `mapsFor`.
8. **Cycles counted with types.** Set `import/no-cycle` to `ignoreTypes: false`.
   It must report 0 (43 at baseline). If not, find the edge (analysis §3.4) and
   cut it in its own commit.
9. **Tests** (Vitest, beside their subjects):
   - `shared/math.test.ts`: `wrap` at 0, ±π and 3π, and on a value from each
     old caller;
   - `shared/time.test.ts`: `ms` and `clock` at 0, 59.9, 60 and 600 s;
   - `sim/difficulty.test.ts`: the keys in their order, which the wire and
     `CUSTOM.skills` rely on.

## Must not change

Pins, digests, fixtures, `PROTOCOL` 6, any value or key order, and any string a
person sees.

## Verify

- Gate A.
- `LOG.md`: the cycle count, and `wrap`/`Point` down to one each.
- Gate B items 1–4 once at the end (the helpers sit under the HUD, camera and
  pilot).

## Done when

- No import cycle, types included.
- One `wrap`, one `Point {x, z}`, one `Seat`.
- No stage-3 allowance is left in `.oxlintrc.json`.

**Rollback:** revert per commit.
