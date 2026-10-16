// A balance probe run headless (probe.test.ts), on this repo or any tree:
//
//   node .claude/work/content/probe.mjs <ffa|tdm> <map> [matches] [key=value ...]
//
// keys: vehicle, gun (the player's: ids; unsaid, the probe's 'even' defaults),
// seed (the first match is seed + 1; default 1), tree (a checkout whose game/
// has its node_modules; default this repo), out (the whole report as JSON).
// The player drives on the bots' brain ('even'). Copies the runner and the
// probe into the tree's game/ under names of their own, runs Vitest's unit
// project on them, deletes them, and prints what LOG.md quotes.
import { spawnSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const [kind, map, matches = '10', ...rest] = process.argv.slice(2)
if (!['ffa', 'tdm'].includes(kind) || !map) throw new Error('usage: probe.mjs <ffa|tdm> <map> [matches] [vehicle= gun= seed= tree= out=]')
const opt = Object.fromEntries(rest.map((pair) => pair.split('=')))
const game = join(resolve(opt.tree ?? repo), 'game')
const tag = `zz-probe-${process.pid}`
const runner = join(game, `${tag}.test.ts`)
const script = join(game, `${tag}-${kind}.js`)
const out = resolve(opt.out ?? join(tmpdir(), `${tag}.json`))
const seed = Number(opt.seed ?? 1)

copyFileSync(join(here, 'probe.test.ts'), runner)
copyFileSync(join(repo, `.claude/work/${kind}/${kind}-metrics.js`), script)
const started = performance.now()
try {
  const env = { ...process.env, PROBE_KIND: kind, PROBE_MAP: map, PROBE_MATCHES: matches, PROBE_SEED: String(seed), PROBE_VEHICLE: opt.vehicle ?? '', PROBE_GUN: opt.gun ?? '', PROBE_SCRIPT: `./${tag}-${kind}.js`, PROBE_OUT: out }
  const run = spawnSync('npx', ['vitest', 'run', `${tag}.test.ts`, '--project', 'unit'], { cwd: game, env, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`vitest failed (${run.status}):\n${run.stdout}\n${run.stderr}`)
} finally {
  rmSync(runner, { force: true })
  rmSync(script, { force: true })
}

const r = JSON.parse(readFileSync(out, 'utf8'))
const seats = (groups) =>
  Object.entries(groups)
    .map(([id, g]) => `${id} ${g.seats}: K ${g.kills} D ${g.deaths} K/D ${g.kd.toFixed(2)} dealt ${g.dealt} taken ${g.taken} alive ${g.alive} s`)
    .join('; ')
console.log(`${kind} ${map}, ${r.matches} matches (seeds ${seed + 1}-${seed + r.matches}), ${((performance.now() - started) / 1000).toFixed(0)} s`)
console.log(`  kills a match ${r.match.killsPerMatch}; overtime ${r.match.overtime}; respawn waitMismatches ${r.respawn.waitMismatches}, alternationErrors ${r.respawn.alternationErrors}`)
console.log(`  player ${r.player.fit}: kills ${r.player.kills}, deaths ${r.player.deaths}`)
console.log(`  by vehicle: ${seats(r.byVehicle)}`)
console.log(`  by gun: ${seats(r.byGun)}`)
console.log(`  report: ${out}`)
