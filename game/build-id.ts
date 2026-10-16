import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The game's build id: one hash over the files both bundles are built from —
// the browser's (src/), the game server's (server/), tests aside,
// and the lockfile — so the page and the server built from one commit carry
// the same id, and a page left open across a deploy doesn't match the new
// server (which tells it "Game updated — reload the page"). Contents and
// relative paths only, sorted, hidden files (a Mac's .DS_Store) left out:
// the same on every machine. The site (www/)
// isn't in it: a change there leaves the id, and the game server, alone.
// Read by vite.config.ts and vite.server.config.ts (as __BUILD__) and by
// scripts/match-smoke.mjs.

const GAME = fileURLToPath(new URL('.', import.meta.url))

export function buildId(game = GAME) {
  const files = [...walk(join(game, 'src')), ...walk(join(game, 'server')), join(game, 'package-lock.json')]
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => ({ file, path: relative(game, file).split(sep).join('/') }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const hash = createHash('sha256')
  for (const { file, path } of files) hash.update(path).update('\0').update(readFileSync(file)).update('\0')
  return hash.digest('hex').slice(0, 12)
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
