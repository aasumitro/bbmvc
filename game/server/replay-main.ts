import { readFile } from 'node:fs/promises'
import { initPhysics } from '../src/sim/physics.ts'
import { replay, replayLines } from './replay.ts'
import type { MatchRecord } from './room.ts'

// A room's replay run again (replay.ts), and what happened in it printed:
// each match's result, its people and their fair-play counts. Given the
// match records the server kept (MATCH_DIR's matches-*.jsonl), it also says
// whether each match came out the same as recorded, and exits 1 if one
// didn't.
//   node dist-server/replay.js <room.ndjson.gz> [matches-YYYY-MM.jsonl ...]

const [file, ...kept] = process.argv.slice(2)
if (!file) {
  console.error('usage: node dist-server/replay.js <room.ndjson.gz> [matches-YYYY-MM.jsonl ...]')
  process.exit(2)
}

await initPhysics()
const started = performance.now()
const { header, records, steps } = await replay(replayLines(file))
console.log(
  `room ${header.room}: ${header.mode} on ${header.map}, build ${header.build}; ${steps} steps (${(steps / 3600).toFixed(1)} min) run again in ${((performance.now() - started) / 1000).toFixed(1)} s`,
)

const recorded = new Map<number, string>()
for (const path of kept) {
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (line && (JSON.parse(line) as MatchRecord).room === header.room) recorded.set((JSON.parse(line) as MatchRecord).match, line)
  }
}

let differ = 0
for (const r of records) {
  const people = r.seats.filter((s) => s.uid)
  console.log(
    `match ${r.match}: ${r.started} to ${r.ended} (${r.seconds} s), winner ${r.winner ?? 'none (a draw)'}, ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
  )
  for (const s of people) {
    const fair = s.fairplay
    console.log(
      `  seat ${s.seat} ${s.name} (${s.uid}), team ${s.team}: ${s.stats.kills} kills, ${s.stats.deaths} deaths, ${s.stats.damageDealt} dealt; fair play ${fair?.flags.length ? `FLAGGED ${fair.flags.join(', ')}` : 'no flags'} ${JSON.stringify(fair?.tally)}`,
    )
  }
  if (!kept.length) continue
  const same = recorded.get(r.match) === JSON.stringify(r)
  if (!same) differ++
  console.log(`  ${!recorded.has(r.match) ? 'no record kept for it' : same ? 'the same as recorded' : 'DIFFERENT from the record'}`)
}
process.exit(differ ? 1 : 0)
