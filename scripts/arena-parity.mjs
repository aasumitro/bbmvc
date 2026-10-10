// Arena parity in a real browser: a tiny page that runs the game's own arena
// builders (the GPU bake included) and reads each arena's digest, built with
// Vite's build API (no dev server), served from a temporary folder and
// opened in headless Chromium. The digests must be the ones in
// game/server/digests.json — what the game server builds headless and the
// deploy's smoke test holds it to. Chromium only: Firefox and Safari are the
// owner's (NET_RUNBOOK.md step 5).
// Needs Playwright with its Chromium, installed globally: it isn't one of the
// game's dependencies (npm root -g must hold playwright).
//   node scripts/arena-parity.mjs
// Exits non-zero on a mismatch.
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const game = fileURLToPath(new URL('../game/', import.meta.url))
const expected = JSON.parse(readFileSync(join(game, 'server/digests.json'), 'utf8'))
const { build } = await import(pathToFileURL(createRequire(join(game, 'package.json')).resolve('vite')).href)
const { chromium } = createRequire(import.meta.url)(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'))

// The page: every arena built as the game builds it, its digest and collider count on window.
const dir = mkdtempSync(join(tmpdir(), 'arena-parity-'))
const from = (path) => JSON.stringify(join(game, path))
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>arena parity</title><script type="module" src="./main.js"></script>\n')
writeFileSync(
  join(dir, 'main.js'),
  `import { MAPS } from ${from('src/content/arenas/maps.ts')}
import { initPhysics } from ${from('src/sim/physics.ts')}
import { arenaDigest } from ${from('src/content/arenas/digest.ts')}
try {
  await initPhysics()
  const out = {}
  for (const id of Object.keys(MAPS)) {
    const started = performance.now()
    const arena = MAPS[id].build()
    out[id] = { digest: arenaDigest(arena), colliders: arena.colliders.length, ms: Math.round(performance.now() - started) }
  }
  window.digests = out
} catch (error) {
  window.failed = String(error?.stack ?? error)
}
`,
)

let server
let browser
let failed = false
try {
  await build({ root: dir, configFile: false, logLevel: 'warn', build: { outDir: join(dir, 'dist'), target: 'esnext', chunkSizeWarningLimit: 1e6 } })
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
  server = createServer((req, res) => {
    const path = join(dir, 'dist', new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'))
    try {
      res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path))
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.log(`page error: ${error.message}`))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl ? `WebGL2, ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}` : 'no WebGL2'
  })
  console.log(`Chromium ${browser.version()}, ${gpu}`)
  await page.waitForFunction(() => window.digests || window.failed, null, { timeout: 300_000 })
  const { digests, error } = await page.evaluate(() => ({ digests: window.digests, error: window.failed }))
  if (error) throw new Error(`the page failed: ${error}`)
  for (const [id, want] of Object.entries(expected)) {
    const got = digests[id]
    const same = got?.digest === want
    failed ||= !same
    console.log(`${same ? 'ok' : '!!'}  ${id.padEnd(9)} ${got?.digest ?? 'missing'} (expected ${want}), ${got?.colliders} colliders, built in ${got?.ms} ms`)
  }
  for (const id of Object.keys(digests)) if (!(id in expected)) (failed = true), console.log(`!!  ${id}: no expected digest in game/server/digests.json`)
} finally {
  await browser?.close()
  server?.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
