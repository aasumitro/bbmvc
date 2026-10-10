# Stage 10 — Content ready

**Goal:** the code is ready for the 2–4 vehicles, several weapons and 1–2 maps
planned after the refactor (D5). All of them are procedural code, like today's
(D6).

- A person plays the vehicle picked in the garage, in Classic and in a custom
  lobby. Today the server seats everyone in the roster's one machine.
- Bots can draw a vehicle.
- The garage pages through vehicles.
- A new map is held to every rule by tests.

The protocol changes on purpose (`PROTOCOL` 7). Play doesn't: with one vehicle,
every pin holds.

**Before:** stage 9 done on `refactor/game` (its gates passed). Until a real
second vehicle exists, a test-only spec proves each step.

## Steps

1. **Seats honour the vehicle.**
   - `server/room.ts`'s `join`, `leave` and `takeWheel` seat the chosen vehicle.
     The car body is replaced in place: free the old body, `createCar`,
     `placeCar` at the current pose.
   - A custom seat's vehicle comes from the seat plan (`SeatPlan` gains a
     vehicle).
   - Optional: a `vehicles` match setting (one vehicle for everyone, like
     `weapons`).
2. **The wire and the journal.**
   - `ro` carries the vehicle, and so does the journal's `join`.
   - `PROTOCOL` becomes 7. The fixtures are updated in that same commit, with
     the reason.
   - `net/client.ts` refits the roster and swaps the body; `view/view.ts`'s
     `refit` goes by vehicle.
3. **Bots' vehicles.** Drawn from a seeded stream of their own, so no existing
   draw moves. While `VEHICLES` has one entry, every pin holds.
4. **Tests.**
   - Replace the tripwire in `server/server.test.ts` (it fails on purpose if
     `VEHICLES` gets a second entry) with two-vehicle tests on a test-only spec:
     - a mid-match takeover with a different vehicle;
     - a custom room with mixed vehicles, replayed to the bit;
     - netplay with the second vehicle.
   - The arena test checks spawn clearance with every vehicle's shells.
5. **Garage.** A vehicle pager, like the weapon pager (it cycles over
   `VEHICLES`), with each vehicle's spec sheet and model on the turntable.
6. **The new-map checklist as tests.** For a new map, the arena tests already
   hold:
   - every mode it hosts, at the largest size (stage 0's check);
   - six starts a base;
   - at least 12 FFA spawns;
   - a nav graph in one piece;
   - item spots clear of starts;
   - a headless build;
   - a digest.

   Check the list is complete before the first new map; extend it if not.
7. **Docs.** `.claude/work/arch/ARCHITECTURE.md` gets "how to add a vehicle /
   weapon / map": the steps the content work follows, including what stage 4
   listed for a new weapon `kind`.

## Then the content (after the refactor, not this plan)

- **A vehicle** is a row in `content/vehicles/vehicles.ts` and a builder in
  `content/vehicles/models/<id>.ts`.
- **A weapon** is a row in `content/weapons/weapons.ts` and, if it is new, a
  turret builder in `content/weapons/turrets/<id>.ts`.
- **A map** is a builder file and a `MAPS` row, with its preview and digest.
- Bots draw from the registries, so each new vehicle or weapon changes how
  Classic's bots play. That change re-pins in a commit of its own, giving the
  reason and showing the old hashes still match without the new entry.
- The balance probes run.
- The site's copy follows the game (root `AGENTS.md`).

## Must not change

- With one vehicle: Classic and practice (the pins hold through this stage).
- Practice/online parity.
- Replay equality within a build.
- The rewind, which reads `chassis.shells` per machine.

## Risk

High. Replacing a Rapier body mid-match touches handles, colliders, the vehicle
controller and the prediction's state machine. Guards: the netplay test
(corrections and errors bounded), the server test's takeover and replay, and
gate B item 5 played with two different vehicles.

## Done when

- A person picks vehicle B (test-only or real) and plays it online, in Classic
  and in a custom lobby.
- Bots use both vehicles, and replays reproduce it.
- The garage pages through vehicles.
- The how-to docs exist.

**Rollback:** revert the stage's commits. `PROTOCOL` goes back to 6 with the
revert.
