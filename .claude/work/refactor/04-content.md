# Stage 4 — Content as data

**Goal:** get ready for the several weapons and 2–4 vehicles planned after the
refactor.

- A weapon is a row in one table, plus a turret file when it needs a new one.
- Its firing behaviour is a `kind` the compiler checks everywhere it matters.
- Identity goes by id everywhere.
- Each vehicle model is a file of its own.
- One function reads a loadout.

Behaviour unchanged: the same ids are sent as the same strings, so the wire's
bytes don't move, and every branch does what it did.

**Before:** stage 3 done on `refactor/game` (its gates passed).

## Steps

One commit each.

1. **Weapon identity.** Today `weaponId(spec)` (`net/protocol.ts`) finds a gun's
   id by matching its turret model. Two guns sharing a turret would be reported
   as one, on the wire, in records and in replays, and the lobby's one-gun
   setting goes through the same lookup.
   - Add `WeaponSpec.id`, equal to its key in `WEAPONS`.
   - `armBot`/`botGun`'s scaled copies keep the id.
   - `weaponId(spec)` returns `spec.id`. Callers: `server/room.ts` (6) and
     `net/client.ts` (1).
2. **Weapon data out of the mechanics.** Split `sim/combat.ts`:
   - `content/weapons/weapons.ts` (new): `WeaponSpec`, `WeaponId`, `WEAPONS`,
     one table so balance is read side by side. It imports neither Rapier nor
     Three.js.
   - `sim/combat.ts` keeps `WeaponState`, `armWeapon`, `pullTrigger`,
     `castRound` and `scatterAim`.
   - The garage (its pager already cycles over `WEAPONS`), the lobby form and
     `net/protocol.ts` import the data alone. The wire's import closure no
     longer holds Rapier; check it and log it.
3. **Firing `kind`.** Today the optional `rocket` field picks the behaviour in
   five places:
   - the simulation's fire (`spec.rocket ? launch : hitscan`);
   - the AI's tactics (`TACTICS.rocket : TACTICS.gun`);
   - its lead time and blast avoidance;
   - its alignment rule;
   - the view's sound (`'launch' : 'shot'`).

   The change:
   - `WeaponSpec` becomes a union on `kind: 'gun' | 'rocket'`, and only the
     rocket kind carries `rocket: { speed, blast }`.
   - Branches become exhaustive switches, or `Record<WeaponKind, …>` tables:
     `FIRE_CUE` in the view, `TACTICS` in the AI.
   - A new behaviour (mines, homing) is then one more `kind`, and the compiler
     lists each place that must handle it.
   - Same calls in the same order: the pins prove it. Bots' scaled copies keep
     their `kind`.
4. **Turret registry, a file per turret.**
   - `WeaponSpec.model` (the closed union `'minigun' | 'rocketPod'`) becomes
     `turret: TurretKey`, a union declared in `weapons.ts`.
   - New `content/weapons/turrets/{minigun,rocketPod}.ts`: the two builders,
     moved from `content/parts.ts`.
   - New `content/weapons/turrets.ts`:
     `TURRETS satisfies Record<TurretKey, () => THREE.Group>`.
   - The ternary in `content/vehicles/models.ts` (`weapon === 'rocketPod' ? … :
     …`) becomes `TURRETS[WEAPONS[weapon].turret]()`.
   - A missing turret is a compile error in both directions, and the weapon data
     never imports a builder.
5. **The HUD's weapon icon from data.**
   - Add `WeaponSpec.icon`: SVG path data.
   - `hud/Hud.tsx`'s two hard-coded inline SVGs become one path drawn from
     `spec.icon`.
   - Screenshots must match: the HUD weapon panel for each gun.
6. **Vehicles: types with vehicles, a file per model.**
   - `Handling` and `Chassis` move from `sim/drive.ts` to
     `content/vehicles/types.ts`.
   - The Razor's builder moves from `content/vehicles/models.ts` to
     `content/vehicles/models/razor.ts`. `models.ts` keeps `MODELS` (by vehicle
     id) and what every model shares: liveries, wrecks, wheels and the turret
     mount.
   - `content/vehicles/vehicles.ts` stays the one spec table.
   - Remove the allowances `content/vehicles/vehicles.ts` → `sim/drive.ts` and
     `content/vehicles/models.ts` → `sim/combat.ts` (step 2 removed the second
     one's reason).
   - `drivePerformance` stays in `sim/drive.ts`: it runs the drive's own force
     curve (`pull`).
7. **One loadout parser.**
   - Add `parseLoadout(raw: unknown): Loadout` in `sim/loadout.ts`: each field
     falls back to the default's when the registries don't have it, and a
     non-object gives the default.
   - Both of today's readers use it: `savedLoadout()` (`localStorage`) and the
     `pick()` that `net/protocol.ts`'s `parseClient` uses. Diff the two first.
     They agree today, per field; if a case differs, keep each caller's answer
     and share only the common part.
   - The storage read and write move to `runtime/stored.ts`. The key
     `scrapyard.loadout` is unchanged.
   - Remove the `sim/loadout.ts` purity allowance.
8. **Tests** (Vitest):
   - `content/weapons/weapons.test.ts`:
     - every `WEAPONS[k].id === k`;
     - every `turret` key is in `TURRETS`;
     - a bot's scaled copy keeps its `id` and `kind`.
   - `sim/loadout.test.ts`: `parseLoadout` over an `it.each` table:
     - valid;
     - an unknown vehicle, an unknown weapon;
     - `null`, a number, a string;
     - missing fields;
     - what today's stored value looks like.

## Must not change

- Pins, digests, fixtures, `PROTOCOL` 6.
- The garage's turret swap and spec sheet.
- The HUD's look.
- The lobby form's weapon list and its "one gun" label.
- A stored loadout from before the change still loads.

## Verify

- Gate A.
- Gate B items 2–4 and 6 (the one-gun setting), with screenshot pairs for the
  garage and the HUD weapon panel.
- A scratch third gun (a gun kind on the minigun turret, its own numbers and
  icon), tried on a scratch branch and not committed:
  - it touches only `weapons.ts`;
  - it reports its own id on the wire, in a match record, in a replay and under
    the lobby's one-gun setting.
- A scratch `kind: 'mine'` added to the union shows, through compile errors,
  every place a new behaviour needs. List them in `LOG.md`; the content work
  will need that list.

## Done when

- Identity is by `spec.id`, and behaviour by `spec.kind`.
- No ternary picks a turret, and no SVG in `Hud.tsx` names a weapon.
- No stage-4 allowance is left.
- One loadout parser, with its tests.

**Rollback:** revert per commit.
