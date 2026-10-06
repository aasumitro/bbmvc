# Custom lobbies — plan

Player-hosted lobbies on the arena screen's Custom entry: a list of public
lobbies, a lobby made from a drawer, invite links, a waiting room where
people ready up, and matches the owner starts with their own settings.

- The brief: `.claude/work/BBMV_Custom_Lobby_Browser_Create_Lobby_Drawer.md`,
  the owner's three mockups (lobby list, empty list, waiting room), and the
  decisions agreed in conversation on 2026-09-30 (section 2). Where the brief
  and section 2 disagree, section 2 wins.
- Branch `feat/custom-game`. Nothing is committed, pushed or opened as a PR
  until the owner says so, each step separately.
- Progress, phase by phase: `LOG.md` (same folder), started with phase 0.

Paths are under `game/` unless noted.

---

## 1. What Custom is

```
Owner: Custom -> Create lobby (drawer) -> waiting room -> invite (link / code)
                                                       -> or wait for joins (public)
Players: Custom -> list -> Join (password if set)  --\
         invite link / code (no password)          ---> waiting room -> Ready
Owner: enough people, all ready -> Start -> match -> results -> back in the waiting room -> Start again ...
```

Custom is not Classic. Classic finds strangers for you; Custom is people
choosing a lobby or being invited into one.

| | Classic | Custom |
|---|---|---|
| Who plays | the matchmaker groups tickets (`server/matchmaker.ts`) | people pick a lobby, or come by invite |
| Bots | fill every seat nobody has, take over from leavers | none unless the owner adds them; an empty seat stays empty |
| Settings | fixed: 8 machines, 10 minutes, the mode's config | the owner's: size, duration, respawn, friendly fire, pickups, weapons, kill limit |
| Start | a ready check, then the room starts by itself | the owner starts once everyone is ready, full or not |
| After a match | the room starts the next match by itself | everyone goes back to the waiting room |
| Joining mid-match | backfill offers a bot's seat to searchers | the owner's "join in progress" toggle |

What the two share is the match itself: `server/room.ts` (the simulation,
snapshots, lag compensation, records, replays, fair play, the chat channel)
and the page's match (`game/online.ts`, `net/client.ts`). `game/AGENTS.md`
asks for one implementation of the game, so the match is reused; the flow
around it is new and never touches the matchmaker.

## 2. Decisions (agreed 2026-09-30)

**Lobby**
- Public lobbies are listed; private ones are not, and are reached only by
  their invite link or code.
- Every lobby has an invite code from the moment it's made; there is no
  toggle for it. The owner and every member can copy the link. The owner can
  reset the code, which kills the old link.
- The invite link and the code skip the password. The password guards only
  joins from the public list, so the form offers it only for public lobbies.
- The owner can kick (the kicked user is banned from that lobby, link
  included), hand the lobby to another member, add and remove bots, and edit
  the settings while the lobby waits.
- The owner leaving a lobby with no other person in it gets a dialog: the
  lobby will be deleted. With others in it, the dialog names who becomes the
  owner (the member who has been there longest).

**Players and bots**
- 2 to 12 machines. Free for all takes any size; team deathmatch takes even
  sizes (1v1 to 6v6).
- No bots unless the owner adds them, each at its own difficulty (the
  existing Easy / Normal / Hard). A bot takes a slot and counts toward the
  size.
- The lobby never has to be full: 4 / 12, 6 / 12 and 12 / 12 can all
  start. Start needs at least 2 people (bots don't count), every person but
  the owner ready and connected, and in team deathmatch someone (a person or
  a bot) on each side; uneven sides are fine. The size is the most the match
  takes, not a number to wait for, and the waiting room says it that way: an
  empty slot reads "Open slot", never "Waiting for player…", and Start's hint
  names who isn't ready, never how many slots are empty.
- Teams (TDM): a player picks or changes side by clicking any open slot
  while the lobby waits. Ready stays as it was; two claims on one slot, the
  server takes the first. A newcomer lands on the side with fewer players.
  In free for all the slots are only a list: nothing to click.
- "Join in progress" is the owner's toggle: on, someone joining a running
  match goes straight in; off, they wait in the waiting room for the next one.

**Waiting room**
- Match settings are read-only for members, marked with a lock; the owner
  sees Edit, which opens the same drawer filled in. An edit unreadies
  everyone and puts a line in the lobby chat.
- The lobby tally, kept for the lobby's life only: team deathmatch counts
  wins by side ("Blue 2 — 1 Red"), free for all by player (by user id, so
  moving slots keeps it; a bot's wins under its slot while it stays). Draws
  and abandoned matches don't count; switching the mode starts it over.

**Match options**
- Match duration (5–30 minutes), respawn speed, friendly fire (team
  deathmatch only), Health / Ammo / Power-ups pickups (both modes), a weapon
  restriction, a kill limit. Each is enforced by the game server; the form
  never shows a setting the server doesn't enforce.
- Friendly fire, when on: teammates' bullets and rockets hurt; a team kill
  takes one point off the killer's team and nothing else (no personal
  penalty). The scoreboard shows team kills as information, never as a
  score. Your own rockets never hurt you.
- Pickups in team deathmatch come from refactoring free for all's item
  system into a shared module any mode plugs in (section 5.3).

**After the match**
- Results, then everyone is back in the waiting room, unready, the settings
  as they were; the owner can change them and start again.

**The list**
- Columns: lobby (name, host), mode, map, players, time, ping, action. Search
  (lobby and host name), filters for mode, map and players (Any / Open
  slots). No region filter or field, no pagination.
- Ping is the page's measured round trip to the game server (`ping`/`pong`).
  With one server it is the same on every row; it tells servers apart once
  there are several.
- Avatars are generated from the user id.

**Capacity**
- `MAX_LOBBIES = 24` (new) and `MAX_ROOMS = 12` (as today), both set from
  the environment. Custom matches and Classic share the rooms; nothing is
  raised or reserved until real usage is measured (7.5).

**Where it lives**
- On the game server, in memory, next to Classic's matchmaking: one server
  today. When there are several, the list moves to Nakama with matchmaking
  (`.claude/work/nakama-mm/PLAN.md`, stage 2).

**Only two arenas**: Scrapyard and The City. The mockups' other map names
are illustrations.

### Defaults (the owner may change any of these)

| | Default | Why |
|---|---|---|
| Sizes | FFA 2–12, TDM 2, 4 … 12 | even teams |
| Durations | 5, 10, 15, 20, 30 min | the rules' clock takes any value; these read well |
| Respawn | Fast ×0.5, Normal ×1, Slow ×1.5 of the waits | Normal is Classic's |
| Kill limit | none, 10, 25, 50 (TDM: team kills; FFA: one machine's) | a standard custom option |
| Weapons | All, Machine gun only, Rockets only | the two guns in `combat.ts` |
| Pickups | Health (health + repair), Ammo, Power-ups (speed, armor, damage) | the six item types, grouped (decided) |
| Pickups in a new lobby | FFA all on, TDM all off | as Classic plays |
| Lobby name | 3–32 characters, default "‹name›'s lobby" | the list stays readable |
| Password | 4–32 characters, public lobbies only | see above |
| Invite code | 8 characters, Crockford base32 (40 random bits), shown `ABCD-EFGH` | typed by voice; unguessable behind the door's strikes |
| A dropped member | kept 20 s (their slot and, in a match, their seat) | a reload gets back in |
| Idle lobby | closed after 30 min waiting with no action | lobbies don't pile up |
| Abandoned match | no person seated for 10 s: the match ends without a result | nobody watches bots |
| Results before the waiting room | 15 s (the room's `results`) | as Classic |
| Lobbies at once | `MAX_LOBBIES`, 24 | decided; a waiting lobby costs no room |
| Rooms | `MAX_ROOMS`, 12 | decided; not raised until real usage is measured (the headroom is there: 96 rooms × 8 ran at 52 % of a core, nakama-mm V17) |

## 3. The map (what exists, what changes)

| What | Where | Today | Change |
|---|---|---|---|
| Arena screen | `src/screens/MapSelect.tsx:25` | Custom is a disabled entry, "coming soon" | enabled; its right side is the Custom screen |
| Drawer | `src/screens/Drawer.tsx` | right side, Esc and backdrop close, footer slot (Settings, Patch Notes) | reused for create / edit |
| Confirm dialog | `src/screens/GameCanvas.tsx:267` (`Confirm`) | local to the gameplay screen | moved to `screens/Confirm.tsx`, reused |
| Chat | `src/net/chat.ts`, `src/hud/Chat.tsx`, `nakama/data/modules/chat.lua` | a room's channel named by the server (`sy-` + 24 hex), told only to its seats | the lobby's own channel, same pattern; no Lua change |
| Modes | `src/game/modes.ts`, `mode.ts` | fixed line-ups (`FFA.grid` 8, `TDM.teamSize` 4), config constants | line-up by size, settings passed in |
| Items | `src/game/ffa/items.ts`, `ffa/rules.ts` (waves, collect, effects), `ffa/pickups.ts` (view) | FFA only | a shared module (5.3) |
| Who can be hurt | `src/game/simulation.ts:186,281,329`, `tdm/rules.ts:153` | the simulation and the TDM rules both filter teammates | the rules alone decide (5.4) |
| Seats | `server/room.ts` `freeSeat` / `join` / `leave` | every seat a bot or a person | a seat can be empty (5.5) |
| Bases | `src/game/arena/scrapyard.ts:418`, `city.ts:104` | 4 starts per team | 6 per team (6.1) |
| Rooms and sessions | `server/lobby.ts`, `server/server.ts` | Classic sessions, direct seats | custom lobbies wired in (7) |
| The page's online store | `src/net/matchmaking.ts` | Classic's store owns the socket until the welcome | a second store, `net/custom.ts` (9.1) |
| HUD pools | `src/hud/Hud.tsx:28,44` | `MARKERS = 8`, `SCORE_ROWS = 8` | 12 |
| Bot names | `src/game/roster.ts:15` | 8 names | 12 |
| Records, replays | `server/room.ts` (`MatchRecord`, `ReplayLine`), `server/replay.ts` | mode, map, seed | plus settings and the seat plan |

---

## 4. Match settings

One typed object says how a match is played. Classic and practice pass
Classic's values, so they play as they do today; a custom room passes the
lobby's.

```ts
// src/game/matchSettings.ts (new)
export interface MatchSettings {
  size: number                // machines in the line-up: 2..12 (TDM even)
  duration: number            // seconds on the match clock
  respawn: 'fast' | 'normal' | 'slow'
  friendlyFire: boolean       // team deathmatch only
  items: { health: boolean; ammo: boolean; powerups: boolean }
  weapons: 'all' | WeaponId   // 'minigun' | 'rocketPod' restricts everyone, bots too
  killLimit: number           // 0: none
}
export function classic(mode: Mode): MatchSettings // size 8, 600 s, normal, off, FFA all items / TDM none, all, 0
export const CUSTOM = { ... }                        // the ranges and choices of section 2
export function checkSettings(mode: Mode, input: unknown): { ok: true; settings: MatchSettings } | { ok: false; errors: Partial<Record<keyof MatchSettings, string>> }
```

- `checkSettings` is the one validator: the drawer shows its errors inline;
  the server runs it again and trusts nothing else. It checks every field's
  type and range, TDM sizes even, friendly fire off in FFA.
- Mode and arena stay outside the object (the room already has them).
- Lobby-level options (name, public / private, password, join in progress)
  are the lobby's, not the match's: section 7.
- The arena screen's Classic cards keep reading `FFA` / `TDM` config, so
  their tags don't change.

## 5. The refactor (plug and play, Classic unchanged)

Phase 1. Moves and seams only: after it, every Classic and practice match
plays bit for bit as before, which phase 0's golden checks prove.

### 5.1 Settings through the match

- `MODES[kind].create({ combatants, arena, world, seed, scene, settings })`
  and the rules constructors (`createFreeForAll`, `createTeamDeathmatch`)
  take the settings. The rules read `settings.duration` where they read
  `FFA.duration` / `TDM.duration` today, and the respawn waits through
  `settings.respawn` (6.2).
- Callers: `match.ts` (practice: `classic(mode)`), `server/room.ts` (an
  option, `classic(mode)` by default), `net/client.ts` `seatOnline` (the
  welcome's settings, 8.2).

### 5.2 Line-up by size

- `MODES[kind].lineUp(arena, size)`: FFA seats `size` machines on
  `arena.spawns[i % spawns.length]` (16 on each arena); TDM puts `size / 2`
  a side, seats `0 .. size/2 − 1` blue, the rest red (the order the waiting
  room shows).
- `recruits()` (`roster.ts`) and `seatOnline()` pass the size along.

### 5.3 Items as a shared module

Today the item system lives inside free for all: the catalogue and wave
helpers in `ffa/items.ts`; the items on the ground, waves, expiry, pickup,
effects (repair over time, speed, armor, damage boost) inside
`ffa/rules.ts`; the tokens and the hot zone's posts in `ffa/pickups.ts`; the
numbers in `FFA.items`. The mode contract already has the two hooks effects
need: `rules.damage()` and `MatchMode.speedFactor()`.

After the move:

| File | Holds | From |
|---|---|---|
| `src/game/items/items.ts` | catalogue (`ITEMS`), rarities, `rollType` (only the enabled types, rarities reweighted), `wants`, `placeWave`, `chooseErrand` | `ffa/items.ts` |
| `src/game/items/config.ts` | the item numbers (waves, lifetimes, radius, effects, rarity table) | `FFA.items`, same values |
| `src/game/items/supply.ts` | a supply: items on the ground, the next wave, effects per machine; `tick`, `collect`, `apply`, `damageFactor(attacker)`, `shield(victim)`, `speedFactor(i)`, `errand(bot)`, `share()` / `mirror()`, `reset(seed)`; hooks for a mode to weight spots and rarities; events (`item`, `expired`, `wave`) | `ffa/rules.ts` |
| `src/game/items/pickups.ts` | the tokens on the ground (the view) | `ffa/pickups.ts` |
| `src/game/ffa/zone.ts` | the hot zone's posts (the view) | `ffa/pickups.ts` |

- Free for all keeps what is its own: hot zones (their choice, bonus items,
  the zone rarity table) and the comeback weighting, plugged in through the
  supply's hooks. Its item events and scoring stay as they are.
- Team deathmatch plugs a supply in when any pickup is on: spots off the
  road graph, clear of every start (bases included), waves on the same
  clock, no zones. Its bots take the supply's errand when it is urgent (low
  hull, health nearby) and their tactics' errand otherwise. Items earn
  combat score (`score.item`, 10, as FFA).
- `MatchMode` gains `supply?: Supply`: the HUD's effect badges
  (`Hud.tsx:565`), the minimap's items (`Hud.tsx:470`, `minimap.ts`) and the
  view read it instead of asking whether the mode is FFA.
- Share / mirror: each mode's `share()` carries `supply: supply.share()`,
  and `mirror()` hands it back, as FFA does with its items today.

### 5.4 One place decides who can be hurt

- Today `simulation.ts` passes a hit to `rules.damage()` only when the
  victim is on another team (`hostile`, lines 281 and 329), and the TDM rules
  refuse teammates again (`tdm/rules.ts:153`). A rocket's blast skips its
  own shooter the same way.
- After: the simulation hands every hit to `rules.damage()` (the shove
  still applies to every car). The rules refuse the attacker's own machine
  in both modes, and teammates in team deathmatch unless friendly fire is on.
  With the defaults nothing changes.
- A bot is provoked (`ai.ts` `provoke`) only by a hostile, and the room's
  fair-play watch counts only hostile hits, so a teammate's stray round never
  turns a bot or feeds the fair-play signals.

### 5.5 Seats that can be empty

A custom match has seats nobody holds and no bot drives. The machine exists
(every per-seat array keeps its length: snapshots, rewind, fair play,
statistics) but is out of play:

- `Combatant.present` (new, true by default). An absent machine's body is
  disabled (`RigidBody.setEnabled(false)`, Rapier 0.20: its colliders leave
  the world, so rays, blasts and cars pass through), it doesn't drive, fire,
  think or get recovered, and nothing draws it.
- The rules' life cycle (`Life`: `mode.ts`, `ffa/rules.ts`, `tdm/types.ts`) gains `absent`: never due to
  respawn, left out of standings, spawn scoring, targets and the leader.
  Entering: `absent -> pending` due at once, so the simulation respawns it at
  the start the rules pick, protected. Leaving: any life -> `absent`, quietly
  (no death, no kill).
- The wire: the car row's flags gain `present` (`protocol.ts` `FLAGS`), a
  welcome seat and an `ro` message say whether the seat is present, and the
  page hides absent machines everywhere: view, HUD markers, minimap,
  scoreboard, results.
- Classic never makes an absent seat.

### 5.6 Proof Classic doesn't move

- Phase 0 adds golden checks to `simulation.check.ts`: fixed-seed bots-only
  matches, each mode on each arena, run for two minutes of match time; the
  final statistics rows and machine poses hashed, the hashes written into
  the check before any change. After the refactor the hashes must match.
- `server.check.ts`'s replay of a room must still come out the same, and
  `server/digests.json` must not change in phase 1.

## 6. Gameplay options

Phase 2. Each is pure game code with a headless check; none needs the lobby.

### 6.1 Sizes and bases

- Both arenas get 6 starts per team base (today 4): Scrapyard's gate
  aprons gain a pair beside the row (`scrapyard.ts:423`), The City's bases a
  third row of two (`city.ts:109`). `arena.check.ts` asks for 6 and holds
  every start clear of anything solid (it does today); `server/digests.json`
  takes the new digests, and `scripts/match-smoke.mjs` /
  `scripts/arena-parity.mjs` follow it.
- `BOT_NAMES` grows to 12; `MARKERS` and `SCORE_ROWS` in `Hud.tsx` to 12.
- `FFA.items.perWave` and `maxActive` stay; balance for 12 is a follow-up
  once people play it.

### 6.2 Duration and respawn

- The rules read the clock length from the settings.
- The respawn waits (5 / 10 / 15 / 20 s, by how far the match has gone)
  keep their thresholds as shares of the match: 30, 50 and 80 % (180, 300,
  480 s of Classic's 600, so Classic is unchanged). Fast halves every wait,
  Slow adds half; overtime's wait scales the same.

### 6.3 Friendly fire and team kills (team deathmatch)

- On: teammates take damage from bullets and rockets (5.4); spawn
  protection still applies.
- A teammate's hit counts as damage taken for the victim, never as damage
  dealt, combat score or an assist for the shooter (`scoring.ts` `hit`
  gets a teammate path).
- A team kill: the killer's team loses one point (`tdm.score[team]--`) and a
  new `teamkill` event puts a line in the feed. Nothing else: no personal
  penalty; the killer's kills, deaths and combat score don't change (it
  isn't a kill). The victim's death counts, as any wreck does. A team score
  can go below zero; the HUD and results show it as it is.
- `Stats.teamKills` (new) is information only: the scoreboard and the
  results show it so the owner can spot a griefer to kick; no score reads it.
- Overtime ends on the first kill that separates the scores; a team kill in
  overtime does, so the other team wins. The existing check after every kill
  (`tdm/rules.ts`, `score[0] !== score[1]`) already does this once the point
  is taken off first; `tdm.check.ts` holds it.
- Bots (only with friendly fire on; checked with the sight check every
  0.2 s) hold fire while a teammate is within 3 m of their line of fire, and
  hold a rocket while a teammate is inside its blast radius at the aim point.
- Lock-on stays enemies only (`pilot.ts`).

### 6.4 Pickups

- The supply rolls only enabled types: Health = `health` and `repair`, Ammo
  = `ammo`, Power-ups = `speed`, `armor`, `damage`. All off: no waves, and in
  FFA no hot zones (they exist for their items).
- Team deathmatch with any pickup on plugs the supply in (5.3).

### 6.5 Weapons

- `all`, or one gun for everyone. The server fits people's machines with
  the allowed gun whatever their loadout says; bots draw only from the
  allowed roster (`ai.ts` `armBot` takes the list). The welcome's line-up
  already tells each page its gun.

### 6.6 Kill limit

- FFA: the first machine to the limit wins at once; TDM: the first team.
  0 is none. The clock still ends the match if nobody gets there.

### 6.7 Bots

- A custom room creates bots only in the slots the owner filled, each with
  its own difficulty (`DIFFICULTIES[d]`, today online bots are all Normal).
- A person leaving a custom match leaves an empty seat, never a bot.

---

## 7. The server

Phase 3.

### 7.1 `server/custom.ts` (new, pure)

The lobbies and their rules, like `matchmaker.ts`: no sockets, no rooms,
the clock injected, hooks for what it can't do itself (tell a person, open a
room, seat a person in a room, take one out). Checked by
`server/custom.check.ts` under plain node.

```ts
interface Lobby {
  id: string                 // public: the list and a join name it (8 hex digits)
  code: string               // secret: the invite (Crockford base32, 8 characters)
  name: string
  owner: string              // uid
  open: boolean              // listed
  password: { salt: Buffer; hash: Buffer } | null
  mode: Mode; map: MapId
  settings: MatchSettings
  joinInProgress: boolean
  slots: Slot[]              // settings.size of them
  members: Map<string, Member>
  banned: Set<string>
  phase: 'waiting' | 'playing'
  room: string | null
  chat: string               // the lobby's Nakama channel (sy- + 24 hex)
  tally: Map<string, number> // this lobby's wins: TDM by side ('0', '1'); FFA by user id (a bot: 'bot:' + slot, dropped with the bot); reset on a mode change
  heard: number              // the last action (idle close)
}
type Slot = { kind: 'empty' } | { kind: 'person'; uid: string } | { kind: 'bot'; skill: Difficulty }
interface Member { uid: string; name: string; joined: number; ready: boolean; slot: number; playing: boolean; away: number /* ms dropped at, -1 connected */ }
```

### 7.2 What a lobby allows

| Action | Who | Rules |
|---|---|---|
| create | anyone not in a lobby | name, settings, password checked; under `MAX_LOBBIES`; the creator is owner, in slot 0 |
| list | anyone with a session | public lobbies only; never a code, a password or a uid |
| join (from the list) | anyone not in it | public; not banned; a free slot; the password when set (5 wrong a minute, then refused for a minute) |
| code (link or typed) | anyone | the code matches; not banned; a free slot; no password |
| back | a member away within the grace | the same slot (and seat, if the match still runs) |
| leave | a member | the slot empties; the owner leaving hands the lobby on, or deletes it when no other person is in it |
| ready / unready | a member, not the owner | waiting only |
| slot | a member | TDM, waiting only: moves to the open slot they clicked (either side, so it picks the team); ready stays; of two claims on one slot the first wins |
| start | the owner | waiting; ≥ 2 people; every other person ready and connected; TDM: someone (person or bot) on each side; a room free (`MAX_ROOMS`) |
| edit | the owner | waiting; settings checked; the size never below the filled slots; everyone unready; a mode change regroups the slots and restarts the tally |
| kick | the owner | a member (not self): out, banned from this lobby; out of the match too |
| owner | the owner | another member becomes owner |
| bot / unbot | the owner | waiting; a bot at a difficulty into a free slot / out of its slot |
| reset | the owner | a new code; the old one stops working |

- A new member takes the first free slot (TDM: on the side with fewer
  filled slots, as `freeSeat` evens teams).
- A slot is taken by a person or a bot; "full" means no empty slot.
- One lobby per user, and one live connection per user (as today).
- The tally: a result adds a win to the winning side (TDM) or the winning
  machine's user id or bot slot (FFA); draws and abandoned matches add none.

### 7.3 A lobby's match

- **Start**: `lobby.ts` opens a room with the lobby's mode, arena, settings
  and seat plan (slot i = seat i: a person's uid, a bot and its difficulty,
  or empty), seats every connected person in their slot's seat, and each
  page gets its `welcome` on its socket. The room holds its first match
  until every page has loaded (`hold`, as a matchmade room), then the mode's
  own 3 s countdown runs.
- **Joining a running match**: with join in progress on, a new member is
  seated in their slot's seat at once (an empty seat comes into play, 5.5);
  off, they wait in the waiting room. A member who went back to the waiting
  room mid-match (9.3) can rejoin the same way.
- **Leaving a running match**: the seat goes empty; the member stays in the
  lobby (the page's "Back to lobby") unless they left the lobby.
- **Nobody left**: no person seated for 10 s ends the match without a result.
- **The end**: the room's results run (`results`, 15 s); then, instead of
  `restart()`, the room tells the lobby it is over: the lobby is waiting
  again, everyone unready, the tally updated, the room closed (its replay
  ends). Each match is its own room and its own replay file.
- Classic never sees a custom room: `open()` says no to the matcher's
  openings and to a direct seat (`lobby.ts` `join`), and custom rooms don't
  count as searchable.

### 7.4 Sessions and sockets

- A hello with no mode and no map opens a session, as Classic's does
  (`server.ts` `greet`); a session may search Classic (`mm`) or use custom
  lobbies (`lb`), not both: joining a lobby cancels a ticket, a ticket is
  refused while in a lobby.
- `lobby.ts`'s idle rule (a session without a ticket is let go after a
  minute) exempts sessions watching the list or in a lobby.
- Once the match starts, the socket is that seat's (as Classic); the match
  over, the lobby's word goes out on it again.
- A socket that closes: its member is away for the grace (20 s), their slot
  kept and, in a match, their seat held empty for them; `back` within it
  restores both; after it they have left.

### 7.5 Caps, limits, logs

- `MAX_LOBBIES` (env, default 24) next to `MAX_ROOMS` (env, default 12 as
  today); a waiting lobby holds no room and no physics. Custom matches and
  Classic share the rooms: `/health` and the room logs count them by kind
  (classic, custom), so real usage shows whether Classic ever needs rooms
  kept for it. Nothing is reserved or raised until it does.
- Idle close: a waiting lobby with no action for 30 min is closed; its
  members hear why.
- The list goes out whole to watchers on a change, at most twice a second.
- Logs name lobbies by id and people by uid, never the code or the password
  (`server.check.ts` holds this, as it does for tokens).

### 7.6 Records and replays

- `MatchRecord` gains `custom: { lobby, settings }`; custom matches are kept
  with the rest (`MATCH_DIR`) for fair-play review, and stay out of any
  future stats or leaderboard (the owner controls bots and settings).
- The replay header gains the settings and the seat plan; a `join` line is
  seated in the seat it names; `replay.ts` builds the room the same way, so a
  custom room replays to the bit like any other (`server.check.ts`).

### 7.7 Security

- The password: `scrypt` (`node:crypto`) with a random salt, compared with
  `timingSafeEqual`; never sent back, never logged, gone with the lobby.
- The code: 40 random bits; sent only to members; a wrong code is a strike
  (10 close the socket; 8 sockets an address), so guessing is out of reach.
- Every owner action checks the sender is the owner; a member's action
  checks membership; everything a page sends passes `parseClient` first.
- Names: trimmed, inner spaces collapsed, no control characters; React
  escapes what it shows.
- The chat channel's name is told only to members, like a room's.

## 8. Protocol

`PROTOCOL` 5 -> 6. JSON, as every non-snapshot message.

### 8.1 Page -> server: `{ t: 'lb', do, ... }`

| do | Fields | |
|---|---|---|
| `watch` / `unwatch` | | the list, now and on every change |
| `create` | `name`, `open`, `password`, `mode`, `map`, `settings`, `jip` | |
| `join` | `id`, `password` | from the list |
| `code` | `code` | a link or a typed code |
| `back` | `id` | after a drop or a reload |
| `leave` | | |
| `ready` | `on` | |
| `slot` | `slot` | TDM: claim an open slot (picks the side) |
| `start` | | |
| `edit` | `name`, `open`, `password`, `mode`, `map`, `settings`, `jip` | |
| `kick` / `owner` | `uid` | |
| `bot` | `slot`, `skill` | |
| `unbot` | `slot` | |
| `reset` | | |
| `play` / `wait` | | into the running match (join in progress) / back to the waiting room |

`parseClient` checks each: size (`LIMITS.input`), every string's length
(`LIMITS` gains `lobby: 32`, `password: 32`, `code: 8`), enums, whole
numbers in range, `checkSettings` for settings. Anything else is a strike.

### 8.2 Server -> page

| Message | When |
|---|---|
| `{ t: 'lbs', list: LobbyRow[] }` | watching: on `watch` and every change |
| `{ t: 'lb', lobby: LobbyView \| null, note? }` | a member: every change to their lobby; `null` with a note when they're out of one |
| `welcome` (+ `settings`, `lobby`) | the match starts, or they're seated in a running one |
| `st`, `s`, `ro` (+ `present`) | the match, as today |

- `LobbyRow`: id, name, host, mode, map, people, bots, size, duration,
  locked, phase, seconds left (playing), join in progress.
- `LobbyView`: the row plus the code, open, every setting, the slots (name,
  uid, ready, away, bot and difficulty, owner), the chat channel, the tally,
  the member's own slot and whether they are playing.
- Notes (in the player's words on the page): `gone`, `full`, `password`,
  `slow` (too many wrong passwords), `banned`, `kicked`, `deleted` (the owner
  left), `closed` (idle), `busy` (no room free at start), `cap` (too many
  lobbies), `taken` (already in a lobby).

## 9. The page

Phase 4 (screens) and 5 (links, reconnect).

### 9.1 `src/net/custom.ts` (new store)

The pattern of `net/matchmaking.ts`: one module store the screens read
through `useSyncExternalStore`, DOM-free but for one sessionStorage entry.

```ts
type Custom =
  | { phase: 'off' }
  | { phase: 'connecting' }
  | { phase: 'browsing'; list: LobbyRow[] | null; error: string; note: string; rtt: number }  // null: loading
  | { phase: 'lobby'; lobby: LobbyView; note: string; rtt: number }                          // waiting, or a match on without us
  | { phase: 'seated'; link: Link; lobby: LobbyView }                                        // in the match
```

- The Custom screen opens the socket (`freshSession()` first: a guest when
  signed out) and watches the list; leaving the screen closes it unless the
  page is in a lobby.
- Actions send `lb` messages; the store changes only on the server's word
  (nothing optimistic: a lobby exists when the server says so).
- A welcome turns the socket into the match's `Link`, as Classic's does; the
  match over, the store takes the socket back (9.2).
- Refused while Classic is searching: the screen offers to cancel the search
  first.

### 9.2 The socket between lobby and match

- `connection.ts` `link()` gains a way to hand messages that aren't the
  match's (`lb`) to the store while the match runs, and `release()`: stop
  reading for the match and give the socket back without closing it.
- On the lobby's word that the match is over (after the results), the
  store releases the link and goes back to `lobby`; `App` leaves the gameplay
  screen for the arena screen's Custom entry. The match's own dispose then
  finds the link released and leaves the socket alone.

### 9.3 Screens

- **`screens/MapSelect.tsx`**: Custom enabled; with it chosen, the right side
  is `<Custom />` and the keys go there.
- **`screens/Custom.tsx`**: the list or the waiting room, by the store's phase.
- **`screens/Lobbies.tsx`** (mockups 1 and 2): header ("Custom Lobbies",
  search, refresh, Create lobby), filters, rows, and the four states kept
  apart: loading (skeleton rows, never "No lobbies yet"), error (Retry), empty
  (the invitation, Create lobby), rows. A row: map thumbnail
  (`MAPS[map].image`), name and host, a lock when there is a password, mode,
  map, players `n / size`, time (or time left in a match), ping, Join / Full /
  In match. Sorted joinable first, then running matches that take joiners,
  then full ones. A "Join by code" field. A locked row asks for the password
  in a small dialog.
- **`screens/LobbyForm.tsx`**: the create and edit form in the existing
  `Drawer`, fields in section 2 order; Advanced collapsed; fields that don't
  apply hidden (friendly fire in FFA, password on private); `checkSettings`
  errors inline; the footer's Create (or Save) disabled while sending; the
  server's refusal shown in the drawer, which stays open for a retry.
- **`screens/Lobby.tsx`** (mockup 3):
  - The lobby name, host with a crown, Leave lobby.
  - Players `n / size` in two columns of up to six slots (TDM: Blue left,
    Red right). A slot shows the avatar, name, Host / Bot tags, Ready or Not
    ready. An open slot reads "Open slot"; in TDM clicking it moves you
    there (that side); its "+" gives the owner Add bot (Easy / Normal /
    Hard) and everyone Copy invite link. The owner's menu on a member: Kick,
    Make owner; on a bot: Remove.
  - The bar: Ready / Not ready for members; Start for the owner, enabled
    from 2 people all ready whatever the count (4 / 12 starts), its hint
    naming who isn't ready ("Waiting for Alex99") or a TDM side with nobody
    on it, never the empty slots.
  - Match settings: read-only for members, with a lock; Edit for the owner
    (the drawer, filled in). Lines: the map and its image, the mode,
    players (the size), duration, respawn, friendly fire (TDM), pickups
    (Off, All, or which), weapons, kill limit, join in progress.
  - The invite (code, Copy link; Reset for the owner), the tally, the lobby
    chat.
  - While a match runs without this member: its time left, and Join match
    when join in progress is on.
- **`screens/Confirm.tsx`**: the dialog moved out of `GameCanvas.tsx`; used
  for leaving the lobby ("The lobby will be deleted" / "‹name› becomes the
  owner") and leaving the match.
- **`screens/Avatar.tsx`**: an SVG drawn from a hash of the user id (a
  helmet shape, colours and a pattern from the hash; no files); a bot gets
  the robot glyph.
- **Results / GameCanvas**: in a custom match the results say "Back to the
  lobby in N s" with a Back to lobby button, and the tally; the Esc menu's
  leave is "Back to lobby" (the seat empties, the member stays); a lost
  connection tries to come back within the grace.

### 9.4 Keys

The arena screen keeps its own keys and its left-hand mode list.
- List: ↑↓ rows, Enter join, C create, / search, Esc back to the modes.
- Waiting room: Enter ready (the owner: start), T chat, Esc leave (asks
  first).
- The drawer and dialogs take Esc before the screen does (today both the
  drawer and the screen listen on `window`: the screen skips its keys while
  one is open, as `GameCanvas` does).

### 9.5 Lobby chat

`createChat({ all: lobby.chat, team: '' }, roster)` with the members as the
roster; `hud/Chat.tsx`'s box in the waiting room. The store adds notes for
what the lobby says (joined, left, kicked, the owner changed the map, the
settings changed). The same channel carries on as the match's `all`
channel, so the talk goes on into the match and back.

### 9.6 Invite link and code

- The link: `location.origin + BASE_URL + '?join=' + code` (on the site,
  `/play/?join=ABCDEFGH`). Copy uses the Clipboard API.
- A page opened with `?join=`: after loading and signing in (a guest when
  signed out), `App` opens the arena screen on Custom and sends `code`; the
  parameter leaves the address bar (`history.replaceState`), so a reload
  resumes the lobby (9.7) instead of joining again.

### 9.7 Coming back

- The store keeps the lobby id in sessionStorage (`scrapyard.lobby`); after a
  drop or a reload it opens a socket and sends `back` within the server's 20 s
  (retries as `matchmaking.ts`'s `comeBack`). In a match, `back` brings a
  fresh welcome for the held seat.

---

## 10. Checks

| Check | New cases |
|---|---|
| `src/game/simulation.check.ts` | golden Classic hashes (phase 0); sizes 2 and 12 in both modes; duration; respawn scale; friendly fire on and off; pickups by type in both modes; weapons; kill limit; an absent seat entering and leaving |
| `src/game/tdm/tdm.check.ts` | a team kill: −1 to the team, the killer's kills, deaths and score unchanged, `teamKills` counted, the feed event; negative score; a team kill in overtime ends it for the other side; teammate damage attribution; bots holding fire and rockets near teammates |
| `src/game/ffa/ffa.check.ts` | still green after the move; item toggles; no zones without items |
| `server/custom.check.ts` (new, plain node) | every row of 7.2 and its refusals; start from 2 of 12; TDM start refused with an empty side; slot claims (first of two wins, ready kept); owner hand-off and deletion; grace and back; idle close; caps; codes and resets; bans; the tally (sides, players, bots, draws, abandoned, mode change); list contents (no private lobbies, no secrets) |
| `src/net/protocol.check.ts` | every `lb` message's parse rules; `present` in car rows; the settings validator |
| `server/server.check.ts` | real sockets: create, list, join by list with a password, by code without, ready, start, play, back to the lobby, start again; join in progress; kick in a match; drop and back; a custom room's replay the same; no code or password in logs; Classic never offered a custom room; rooms counted by kind |
| `server/client.check.ts` | the page's store headless: lobby -> seated -> lobby on one socket |
| `server/arena.check.ts` | 6 starts per team, clear; new digests |
| `scripts/browser-match.mjs` | a custom lobby between two pages: create, copy code, join, ready, start, both in one room, back to the lobby |

`game/AGENTS.md`'s check list gains `server/custom.check.ts`.

## 11. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Baseline | golden Classic hashes in `simulation.check.ts`; note digests; `load.js` baseline | checks green, numbers in `LOG.md` |
| 1. Refactor | 5.1–5.5, `Confirm.tsx` moved | `npm run check` and `server:check` green; golden hashes and digests unchanged; Classic in two tabs as before |
| 2. Options | 6.1–6.7 | the new check cases green; digests updated on purpose |
| 3. Server | 7, 8 (the tally included) | `custom.check`, `protocol.check`, `server.check`, `client.check` green |
| 4. Screens | 9.1–9.5, 9.6's copy button | two windows at :3000: create, join, ready, start at 2 of 12, play, back, start again |
| 5. Links and coming back | 9.6, 9.7 | a link opened signed out joins as a guest; a reload in the waiting room and in a match gets back |
| 6. Measure and polish | 12 machines on a real GPU; `load.js` with 12-seat rooms (`SEATS`); arena preloaded in the waiting room if it doesn't stall the screen (~0.7 s build) | numbers in `LOG.md`; room use by kind watched after release before `MAX_ROOMS` changes |
| 7. Docs and copy | section 12 | the site's guide and patch notes match the code |

Each phase is logged in `LOG.md`; nothing is committed without the owner's
word.

## 12. Docs and copy

- Root `AGENTS.md`: Custom lobbies in the project summary and the repo
  layout's `game/` line.
- `game/AGENTS.md`: the code map (`matchSettings.ts`, `items/`, `server/custom.ts`,
  `net/custom.ts`, the screens), the networking model (custom rooms), the checks.
- `.claude/work/README.md`: the `custom/` folder.
- `.claude/work/arch/ARCHITECTURE.md`: how a mode plugs in the supply; seats
  that can be empty.
- `www/src/content/guide/` (how-to-play, controls, faq): Custom, every fact
  from the code (root `AGENTS.md`).
- `src/screens/PatchNotesPanel.tsx`: an entry.
- `deploy/.env.example`: `MAX_LOBBIES=24` and `MAX_ROOMS=12`.

## 13. Risks and limits

- Empty seats reach many readers (view, HUD, minimap, scoreboard, results,
  bots, spawn scoring); a missed one shows a ghost car or counts a machine
  that isn't there. The checks walk an absent seat through each.
- The items move is the riskiest part for Classic; the golden hashes come
  first so any change shows.
- Twelve machines in the browser are unmeasured (the server side is small:
  about 29 KB/s down a player against 23 today).
- The link is the key: whoever holds it gets in, password or not. Reset and
  kick are the owner's answers.
- Custom matches and Classic share `MAX_ROOMS`: busy custom lobbies could
  leave Classic with "no room free". Counted by kind from day one; a reserve
  only if the numbers ask for it.
- A deploy that restarts the game server ends every lobby (in memory), as it
  ends Classic rooms today; pages hear "Server updated".
- Lobby names are public; there is no filter or report yet. The owner's kick
  and the idle close are the only tools.

## 14. Not in this work

Regions and several game servers, pagination, spectators, registered-only
lobbies (the server can't tell a guest from a token), invites to Nakama
friends, the list in Nakama, stats and leaderboards, map voting, profanity
filtering.

## 15. Open points

None. Settled on 2026-09-30:
1. Pickups: Health, Ammo and Power-ups toggles, in both modes.
2. A team kill: −1 team point only, no personal penalty.
3. Capacity: `MAX_LOBBIES` 24, `MAX_ROOMS` 12, both from the environment;
   nothing raised until real usage is measured.
4. The lobby tally: kept for the lobby's life; TDM by side, FFA by player.
5. Start from 2 people all ready, full or not; TDM needs someone on each side.
6. Match settings read-only for members (lock), Edit for the owner.
7. TDM: a player takes any open slot to pick or change side.
