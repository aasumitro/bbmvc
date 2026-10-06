# work/ — plans, logs and specs

Design notes and implementation logs, kept next to the code they describe. The root
`AGENTS.md` and each project's `AGENTS.md` point into these when a task needs them.

| Folder | What |
|---|---|
| `arch/` | The game's architecture: game loop, module boundaries, state ownership, loading |
| `ffa/`, `tdm/` | The two modes: gameplay spec, state machine, balancing, test plan, logs |
| `net/` | Online play: architecture, plan, log and runbook (prediction, interpolation, lag compensation) |
| `mm/` | Classic matchmaking: plan and log |
| `custom/` | Custom lobbies: plan and log (lobby list, invites, waiting room, match settings) |
| `nakama-mm/` | Online play with Nakama: what Nakama does, what the game server keeps; binary snapshots, match records, fair play, replays, in-match chat |
| `www/` | The site: plan and log |
| `active/` | Work in progress |

Logs are history: commit hashes in them refer to the repository they were written in.
