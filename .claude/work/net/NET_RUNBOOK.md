# Online play — the owner's runbook

What only a browser, Podman or the real server can prove. Everything else is
in `npm test` (see `NET_LOG.md`). Every command is one line; paste them
as they are. For the chat, match records, replays and Nakama 3.41 (added
later), the owner's steps are in `.claude/work/nakama-mm/LOG.md`.

Branch: `claude/dazzling-bohr-7l8xui`.

---

## 1. Get the branch

```sh
git fetch origin claude/dazzling-bohr-7l8xui
git switch claude/dazzling-bohr-7l8xui
cd game && npm ci
```

`npm ci` installs `ws`, the one new dependency.

## 2. Start Nakama

```sh
cd nakama && podman compose up -d
```

## 3. Start the game server

```sh
cd game && npm run server
```

It builds `dist-server/`, then listens on `:7360`. Nakama's local default key
(`defaultencryptionkey`) is the game server's default too. A JSON line
`"msg":"listening"` means it's up.

It accepts pages from `http://localhost:*` and `http://127.0.0.1:*`. If you
open the game from another address (another machine on your network), name
that page:

```sh
cd game && ALLOWED_ORIGINS=http://192.168.1.20:3000 npm run server
```

Health: `curl -s localhost:7360/health` prints `{"ok":true,...}`.

## 4. The game's dev server

The one on `:3000` is already running. It finds the game server at
`ws://<the page's host>:7360/match` by itself in development. Restart it only if
you changed `game/.env.local`.

## 5. Arena parity

Open each map in **Practice**, press **F3**, and read the `ARENA` line. It must
equal what the server's arena test prints for that map:

| Map | Digest |
|---|---|
| Scrapyard | `227c4ce7` |
| The City | `8913ad26` |

To print them yourself:

```sh
cd game && npx vitest run server/arenas.test.ts
```

Chromium is already checked: `node scripts/arena-parity.mjs` builds the
arenas in headless Chromium (SwiftShader WebGL2, the GPU bake included) and
compares them with `game/server/digests.json`. It needs Playwright installed
globally (`npm root -g` holding `playwright`, with its Chromium). Firefox and
Safari are still yours.

A different digest in a browser means that browser builds a different arena.
Online, that browser is refused with "Arena mismatch — reload the page". Note
which browser, and tell me.

## 6. Two players

Open one normal window and one private window. Two windows in one browser
profile share the stored session, so they would be the *same* guest, and the
second would take the first one's search over. In both: **Play**, the same
mode, then **Classic** (Find Match). Two searchers meet once the older has
waited 30 s; both get **Match found**: accept (Enter or Y) in both.

- [ ] The Classic button says "Finding players" and counts up; **Practice** still starts a match, and the search goes on over it (a line at the right edge).
- [ ] Match found shows over whatever is up, practice included, with a sound; its bar counts down 10 s; a decline in one sends the other back to searching ("your place kept").
- [ ] Reload a searching page: after the menu shows, it is searching again, the count where it was. A second tab of the same window taking Find Match: the first says "Searching in another tab now".
- [ ] Both accept: "Joining the match", the arena and "2 players"; the room waits ("Waiting for players") until both pages are in, then the countdown.
- [ ] Both are in the same match: both names are on the scoreboard (Tab).
- [ ] Both can drive, and each sees the other move.
- [ ] Both can shoot; hits show (tracers, sparks, the hit marker, the other's hull bar going down).
- [ ] A wreck: the kill line in both feeds, from each one's point of view ("You wrecked…", "…wrecked you").
- [ ] Respawn after the wait, whole.
- [ ] Esc opens **Match menu** (not "Paused"); the match goes on behind it; **Leave match** asks first.
- [ ] Close one window: in the other, that machine carries on as a bot (its name changes back).
- [ ] The results show "Next match in N s", then the next match starts by itself.
- [ ] F3 shows `ROOM`, `NET` (ping, snapshot age, unacked inputs) and `ARENA`.
- [ ] Stop the game server (Ctrl-C) mid-match: the page says **Connection lost** with the reason, and Back to garage works.
- [ ] Find Match with the game server stopped: "Can't reach the game server", and Find Match again works once it's started.
- [ ] Find Match with Nakama stopped and no stored session (a fresh private window): "Online play needs a sign-in — you're offline".
- [ ] A third window searching the same mode while the two play: offered their match (a match in progress, 3 players with them); accepted, it drops in on a bot's seat.

The same in headless Chromium, by script: two pages (two guests), Play →
Classic (Find Match, then accept the match found), one room, a car driven by one page seen moving on the other, and
the seat back to a bot when a page leaves. Screenshots go to the folder it
prints. It needs the same global Playwright:

```sh
node scripts/browser-match.mjs
```

It says nothing about how it feels: SwiftShader draws on the CPU, at 1 frame
a second.

## 7. Feel under latency

Restart the game server with 60 ms added each way (about 120 ms round trip),
and play again:

```sh
cd game && NET_LAG_MS=60 npm run server
```

- [ ] The local car answers the keys at once.
- [ ] The other machines move smoothly.
- [ ] Hits land on what you see.

## 7b. Through the site's dev server, and the smoke test

`scripts/run.sh` now starts the game server with the rest. The site's dev
server on `:8000` passes `/match` on to it, so the last game build at `/play`
plays online as it will on the server:

```sh
scripts/build.sh
```

Then open `http://localhost:8000/play` and pick **Classic**.

That page carries the build id of the sources it was built from. If you
changed the game after building it and restarted the game server, the
page is told "Game updated — reload the page": build again. Pages from the
dev server on `:3000` say `dev`, which a local game server lets in (a
server started with `TRUST_PROXY=1`, as in production, doesn't).

The match smoke test, locally: a Nakama guest takes a seat and leaves. It
needs Nakama and the game server up.

```sh
node scripts/match-smoke.mjs
```

It prints `ok  scrapyard: seated in room …, arena 227c4ce7 as expected, build …`, the same for `city`, and `ok  cleanup: the guest deleted`.

## 8. Deploy config

In `deploy/`, with dummy values for every setting the compose file needs:

```sh
cd deploy && env SITE_DOMAIN=site.test API_DOMAIN=api.site.test POSTGRES_PASSWORD=x NAKAMA_CLIENT_KEY=x NAKAMA_ENCRYPTION_KEY=x NAKAMA_REFRESH_ENCRYPTION_KEY=x NAKAMA_CONSOLE_USER=x NAKAMA_CONSOLE_PASSWORD=x NAKAMA_CONSOLE_SIGNING_KEY=x NAKAMA_HTTP_KEY=x podman compose config
```

Then the Caddyfile, from the repository root:

```sh
podman run --rm -e SITE_DOMAIN=site.test -e API_DOMAIN=api.site.test -e NAKAMA_HTTP_KEY=x -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" docker.io/library/caddy:2 caddy validate --config /etc/caddy/Caddyfile
```

In `deploy/.env` on the server, `NAKAMA_REFRESH_ENCRYPTION_KEY` must differ
from `NAKAMA_ENCRYPTION_KEY`, and the session key must not be Nakama's
default: `scripts/deploy.sh` stops before switching anything otherwise.

- [ ] `config` prints a `game` service with no published ports.
- [ ] `validate` says `Valid configuration`.

## 9. After merge and deploy

- [ ] The deploy workflow's smoke test passes. It now includes `scripts/match-smoke.mjs`: a guest takes a seat at `wss://<site>/match` on every arena, and each arena's digest must be the one `game/server/digests.json` expects.
- [ ] Two devices on the real site, as in step 6.
- [ ] On the server: `podman compose ps` shows `game` healthy; `podman compose logs game` shows JSON lines with user ids and no tokens.

If a release has to be rolled back, run this on the server with an earlier release's name (`ls ~/scrapyard/site/releases`):

```sh
scrapyard/scripts/deploy.sh <release>
```

The game server goes back with the site when that release's bundle differs
from the one running: the output says `switching to it and restarting it`,
and live online matches drop. A release older than this rule has no game
server kept; the output warns, and the game server stays as it is.
