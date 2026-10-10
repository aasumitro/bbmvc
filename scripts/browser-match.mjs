// Two pages in one online match, in headless Chromium: the game built the
// way the site serves it (Vite's build API, development mode so window.match
// is there; no dev server), the game server's own bundle, and Nakama answered
// by each page's routes with sessions signed the way Nakama signs them. Each
// page is its own browser context — its own storage, so its own guest. Both
// go Play → Classic (Find Match) and accept the match found (they meet once
// the older search has waited 30 s); the script checks both leave the loading overlay into
// one room with two people, that a car one page drives with its keys moves on
// the other page's screen, and that when a page leaves, a bot takes its seat
// back. Screenshots of both pages, the F3 overlay on, go to SHOTS (default: a
// new temporary folder, printed).
// With `custom`, a custom lobby instead (.claude/work/custom/PLAN.md): one
// page makes a lobby for 6 v 6, the other joins by its invite code and
// readies, the owner starts at 2 of 12, both play in one room, go back to
// the waiting room, and start again; a reload in the waiting room gets
// back in; a third page, signed out, opens the invite link and lands in
// the lobby; screenshots of the list, the drawer, the waiting rooms and the
// match, at a desktop's size. Not a reload in a match: a page reloaded cold
// under SwiftShader takes minutes to load the match again, past the
// server's minute without input (server/client.test.ts holds coming back to a seat).
// SwiftShader draws on the CPU: 1–2 frames a second here, so a page steps a
// fraction of real time and its inputs reach the server in bursts, with gaps
// past the server's 250 ms (the car coasts between them); the prediction
// corrects often. Nothing here says how online play feels (NET_RUNBOOK.md
// step 7: a person, a real GPU).
// Needs Playwright with its Chromium, installed globally: it isn't one of the
// game's dependencies (npm root -g must hold playwright).
//   node scripts/browser-match.mjs [custom]
// Exits non-zero when a check fails.
import { execSync, spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const game = fileURLToPath(new URL('../game/', import.meta.url))
const KEY = 'browser-match-key' // the game server's session key, and the one the pages' stand-in Nakama signs with
const PORT = Number(process.env.GAME_PORT ?? 7362)
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), 'browser-match-shots-'))
mkdirSync(shots, { recursive: true })
const { build } = await import(pathToFileURL(createRequire(join(game, 'package.json')).resolve('vite')).href)
const { chromium } = createRequire(import.meta.url)(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'))

const started = performance.now()
const say = (text) => console.log(`${((performance.now() - started) / 1000).toFixed(1).padStart(6)} s  ${text}`)
let failures = 0
const check = (ok, what) => {
  say(`${ok ? 'ok' : '!!'}  ${what}`)
  if (!ok) failures++
}

// --- the game, built; the game server, from the same sources ------------------------------------------------

const out = mkdtempSync(join(tmpdir(), 'browser-match-'))
process.env.VITE_GAME_SERVER = `ws://127.0.0.1:${PORT}/match`
process.env.NODE_ENV = 'development' // Vite's build keeps production otherwise, and window.match is for development builds
await build({ root: game, configFile: join(game, 'vite.config.ts'), mode: 'development', logLevel: 'warn', build: { outDir: out, emptyOutDir: true } })
execSync('npm run server:build', { cwd: game, stdio: 'ignore' })
say('built: the game (development mode) and the game server')

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' }
const site = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  const file = join(out, extname(path) ? path : 'index.html')
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${site.address().port}`

const logs = []
const server = spawn('node', ['dist-server/main.js'], { cwd: game, env: { ...process.env, PORT: String(PORT), NAKAMA_ENCRYPTION_KEY: KEY, ALLOWED_ORIGINS: origin }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve) =>
  server.stdout.on('data', (data) => {
    for (const line of String(data).split('\n').filter(Boolean)) logs.push(JSON.parse(line))
    if (logs.some((line) => line.msg === 'listening')) resolve()
  }),
)
say(`the game server on :${PORT} (build ${logs.find((line) => line.msg === 'listening').build}), the game at ${origin}`)

// --- two pages, each its own guest ----------------------------------------------------------------------------

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const minted = []
const jwt = (claims) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`
  minted.push(`${body}.${createHmac('sha256', KEY).update(body).digest('base64url')}`)
  return minted.at(-1)
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
say(`Chromium ${browser.version()}`)

// A page of its own guest, past the main menu's Play: the arena screen (`link`: a page opened at a link instead, as it lands).
async function newPage(name, viewport = { width: 640, height: 360 }, link = '/') {
  const uid = randomUUID()
  const context = await browser.newContext({ viewport })
  // low quality, half resolution, the F3 overlay on: SwiftShader draws on the CPU
  await context.addInitScript(() => localStorage.getItem('scrapyard.settings') || localStorage.setItem('scrapyard.settings', JSON.stringify({ quality: 'low', resolutionScale: 0.5, debug: true })))
  // Nakama, as far as the game asks it: a guest's sign-in (and a refresh), the account
  await context.route('**/v2/**', (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = new URL(request.url()).pathname
    const now = Math.floor(Date.now() / 1000)
    const claims = (life) => ({ tid: randomUUID(), uid, usn: name, exp: now + life, iat: now })
    if (path.startsWith('/v2/account/authenticate/') || path === '/v2/account/session/refresh') return route.fulfill({ headers: cors, json: { created: true, token: jwt(claims(7200)), refresh_token: jwt(claims(30 * 86400)) } })
    if (path === '/v2/account') return route.fulfill({ headers: cors, json: { user: { id: uid, username: name, display_name: name } } })
    return route.fulfill({ headers: cors, json: {} })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => say(`${name}: page error: ${error.message}`))
  await page.goto(`${origin}${link}`)
  if (link === '/') await page.getByText('Play', { exact: true }).first().click({ timeout: 180_000 })
  return { name, uid, context, page }
}
const inMatch = (p) => p.page.waitForFunction(() => window.match?.online && window.match.phase === 'playing' && !document.body.innerText.includes('Compiling'), null, { timeout: 400_000 })

async function open(name) {
  const from = performance.now()
  const p = await newPage(name)
  await p.page.getByText('Classic', { exact: true }).click({ timeout: 60_000 }) // Find Match: two searchers meet once the older has waited 30 s
  await p.page.getByRole('alertdialog').getByText('Match found', { exact: true }).waitFor({ timeout: 90_000 }) // the ready check's, not the arena screen's Classic button
  await p.page.keyboard.press('KeyY') // accept
  await inMatch(p)
  say(`${name}: in the match, ${((performance.now() - from) / 1000).toFixed(0)} s after opening the page`)
  return p
}

const room = async (p) => {
  const line = await p.page.evaluate(() => window.match.debug().find((text) => text.startsWith('ROOM')))
  const [, id, seat, people] = /ROOM\s+(\S+)\s+seat (\d+)\s+(\d+) people/.exec(line) ?? []
  return { id, seat: Number(seat), people: Number(people), line }
}
const shot = async (p, what) => {
  const path = join(shots, `${p.name}-${what}.png`)
  await p.page.screenshot({ path })
  return path
}

// --- a custom lobby between two pages ----------------------------------------------------------------------------

// Out of the match into the lobby's waiting room: the match menu's Back to lobby, confirmed.
async function backToLobby(p) {
  await p.page.keyboard.press('Escape')
  await p.page.getByText('Back to lobby', { exact: true }).first().click({ timeout: 30_000 })
  await p.page.getByRole('dialog').getByText('Back to lobby', { exact: true }).click({ timeout: 30_000 })
  await p.page.getByText('Leave lobby', { exact: true }).waitFor({ timeout: 60_000 })
}
const startable = (p) => p.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Start match' && !b.disabled), null, { timeout: 60_000 })

async function customLobby() {
  const WIDE = { width: 1280, height: 720 }
  const [c, d] = await Promise.all([newPage('c', WIDE), newPage('d', WIDE)])
  for (const p of [c, d]) await p.page.getByText('Custom', { exact: true }).click({ timeout: 60_000 })
  await c.page.getByText('No lobbies yet', { exact: true }).waitFor({ timeout: 30_000 })
  say(`screenshot: ${await shot(c, 'lobbies-empty')}`)
  await c.page.getByRole('button', { name: '+ Create lobby' }).first().click()
  await c.page.getByLabel('Lobby name').fill('Browser lobby')
  for (let i = 0; i < 2; i++) await c.page.getByRole('button', { name: 'More players' }).click()
  await c.page.getByText('6 v 6', { exact: true }).waitFor({ timeout: 5000 })
  say(`screenshot: ${await shot(c, 'create-drawer')}`)
  await c.page.getByRole('button', { name: 'Advanced' }).click()
  await c.page.getByText('Kill limit', { exact: true }).scrollIntoViewIfNeeded()
  say(`screenshot: ${await shot(c, 'create-advanced')}`)
  await c.page.getByRole('button', { name: 'Create lobby', exact: true }).click()
  await c.page.getByText('Leave lobby', { exact: true }).waitFor({ timeout: 30_000 })
  const code = (await c.page.locator('p.font-mono').textContent()).trim().replace('-', '')
  check(/^[0-9A-Z]{8}$/.test(code), 'c made a lobby for 6 v 6 and is in its waiting room, the invite code shown')
  await d.page.getByText('Browser lobby', { exact: true }).waitFor({ timeout: 10_000 })
  say(`screenshot: ${await shot(d, 'lobbies-listed')}`)
  check(true, 'd’s list shows the lobby, live')
  await d.page.getByLabel('Invite code').fill(code.toLowerCase())
  await d.page.getByLabel('Invite code').press('Enter')
  await d.page.getByRole('button', { name: 'Ready', exact: true }).click({ timeout: 30_000 })
  await startable(c)
  say(`screenshots: ${await shot(c, 'waiting-owner')}, ${await shot(d, 'waiting-member')}`)
  check(true, 'd joined by the code (typed in lower case) and readied: c’s Start is on at 2 of 12')

  for (const round of [1, 2]) {
    const from = performance.now()
    await c.page.getByRole('button', { name: 'Start match' }).click()
    await Promise.all([inMatch(c), inMatch(d)])
    await d.page.waitForFunction(() => /2 people/.test(window.match.debug().find((text) => text.startsWith('ROOM'))), null, { timeout: 30_000 }).catch(() => {})
    const [rc, rd] = [await room(c), await room(d)]
    const seats = await c.page.evaluate(() => [window.match.combatants.length, window.match.combatants.filter((m) => m.present).length])
    check(!!rc.id && rc.id === rd.id && rc.people === 2 && rd.people === 2 && seats[0] === 12 && seats[1] === 2, `match ${round}: both pages in one room, ${((performance.now() - from) / 1000).toFixed(0)} s after Start; ${seats[0]} seats, ${seats[1]} in play (${rc.line.trim()})`)
    say(`screenshot: ${await shot(d, `match-${round}`)}`)
    await backToLobby(d)
    const running = await d.page.getByText('Match in progress').isVisible()
    check(running, `match ${round}: d went back to the waiting room while the match runs on`)
    say(`screenshot: ${await shot(d, `back-${round}`)}`)
    await backToLobby(c)
    if (round === 2) break
    // nobody left in it: the match ends after 10 s, and the lobby waits again
    await d.page.getByRole('button', { name: 'Ready', exact: true }).click({ timeout: 60_000 })
    await startable(c)
    check(true, 'both back, the match over by itself: d readies again and c can start again')
  }

  // a reload in the waiting room: straight back in (the tab remembers its lobby)
  await c.page.reload()
  await c.page.getByText('Leave lobby', { exact: true }).waitFor({ timeout: 180_000 })
  say(`screenshot: ${await shot(c, 'reloaded-waiting')}`)
  check(true, 'c reloaded in the waiting room and is back in it')

  // the invite link, opened signed out: a guest of its own, straight into the lobby (waiting again: the empty match ended)
  await c.page.getByRole('button', { name: 'Start match' }).waitFor({ timeout: 60_000 })
  const e = await newPage('e', WIDE, `/?join=${code.toLowerCase().slice(0, 4)}-${code.toLowerCase().slice(4)}`)
  await e.page.getByText('Leave lobby', { exact: true }).waitFor({ timeout: 180_000 })
  const joined = await e.page.getByText('3 / 12', { exact: true }).isVisible()
  say(`screenshot: ${await shot(e, 'joined-by-link')}`)
  check(joined && !new URL(e.page.url()).searchParams.has('join'), 'e opened the invite link signed out: in the lobby as a guest (3 of 12), the link gone from the address bar')
  await Promise.all([c, d, e].map((p) => p.context.close()))

  const text = JSON.stringify(logs)
  check(logs.some((line) => line.msg === 'lobby created') && logs.filter((line) => line.msg === 'room opened' && line.kind === 'custom').length === 2 && !text.includes(code) && minted.every((token) => !text.includes(token)), 'the server logged the lobby and its two rooms; no invite code or token in its logs')
}

// --- Classic: two searchers, one match ------------------------------------------------------------------------

async function classicMatch() {
  const [a, b] = await Promise.all([open('a'), open('b')])
  await b.page.waitForFunction(() => /2 people/.test(window.match.debug().find((text) => text.startsWith('ROOM'))), null, { timeout: 30_000 }).catch(() => {})
  const [ra, rb] = [await room(a), await room(b)]
  check(!!ra.id && ra.id === rb.id && ra.people === 2 && rb.people === 2 && ra.seat !== rb.seat, `both pages in one room: ${ra.line.trim()} | ${rb.line.trim()}`)
  say(`screenshots: ${await shot(a, 'joined')}, ${await shot(b, 'joined')}`)

  // a's car, driven by a's keys, as b's page shows it
  await a.page.waitForFunction(() => window.match.mode.rules.phase === 'active', null, { timeout: 60_000 })
  // how far a's car went on b's screen: 1 s samples, alive at both ends, and under 20 m (a jump is a respawn, not driving)
  const view = () => b.page.evaluate((seat) => ({ at: window.match.combatants[seat].position.toArray(), alive: window.match.combatants[seat].alive }), ra.seat)
  const travel = async (seconds) => {
    let [path, jumps, last] = [0, 0, await view()]
    for (let n = 0; n < seconds; n++) {
      await b.page.waitForTimeout(1000)
      const next = await view()
      const step = Math.hypot(next.at[0] - last.at[0], next.at[2] - last.at[2])
      if (step >= 20) jumps++
      else if (last.alive && next.alive) path += step
      last = next
    }
    return { path, jumps }
  }
  const idle = await travel(5)
  const clock = await a.page.evaluate(() => window.match.elapsed)
  const wall = performance.now()
  const hold = async (key) => {
    await a.page.keyboard.down(key)
    const moved = await travel(12)
    await a.page.keyboard.up(key)
    return moved
  }
  const held = await hold('KeyW')
  // the seat's bot may have parked the car nose to a wall, where W alone doesn't move it: then S backs it out, and that counts too
  const backed = held.path > 3 ? null : await hold('KeyS')
  const driven = held.path + (backed?.path ?? 0)
  const pace = (((await a.page.evaluate(() => window.match.elapsed)) - clock) / ((performance.now() - wall) / 1000)) * 100
  const [corrections, fps] = await a.page.evaluate(() => [window.match.debug().find((text) => text.startsWith('CORR')) ?? '', /FPS\s+(\d+)/.exec(document.body.innerText)?.[1] ?? '?'])
  const keys = backed ? `W for 12 s, then S for 12 s: on b's screen a's car drove ${held.path.toFixed(1)} m forward and ${backed.path.toFixed(1)} m back` : `W for 12 s: on b's screen a's car drove ${held.path.toFixed(1)} m`
  check(driven > 3 && driven > idle.path * 3, `a held ${keys} (${idle.path.toFixed(1)} m in 5 s with no key; respawn jumps left out: ${held.jumps}${backed ? ` + ${backed.jumps}` : ''} + ${idle.jumps}). a drew ${fps} frames a second and its match clock ran at ${pace.toFixed(0)} % of real time; ${corrections.trim().replace(/\s+/g, ' ') || 'no CORR line'}`)
  say(`screenshots: ${await shot(a, 'driven')}, ${await shot(b, 'sees-a-driven')}`)

  // a leaves: its seat goes back to a bot, on b's page too
  const name = await b.page.evaluate((seat) => window.match.combatants[seat].name, ra.seat)
  await a.context.close()
  await b.page.waitForFunction(() => /1 people/.test(window.match.debug().find((text) => text.startsWith('ROOM'))), null, { timeout: 30_000 }).catch(() => {})
  const [rb2, bot] = [await room(b), await b.page.evaluate((seat) => window.match.combatants[seat].name, ra.seat)]
  check(rb2.people === 1 && bot !== name, `a left: b's page counts ${rb2.people} person, and a's seat is "${bot}" again (was "${name}")`)
  say(`screenshot: ${await shot(b, 'after-a-left')}`)
  const lines = logs.filter((line) => line.msg === 'joined' || line.msg === 'left')
  check(lines.filter((line) => line.msg === 'joined').length === 2 && lines.some((line) => line.msg === 'left') && minted.every((token) => !JSON.stringify(logs).includes(token)), `the server logged ${lines.map((line) => `${line.msg} ${line.name ?? line.uid.slice(0, 8)} seat ${line.seat}${line.queue ? ` queue p95 ${line.queue.p95}` : ''}`).join(', ')}; no token in its logs`)
}

try {
  await (process.argv[2] === 'custom' ? customLobby() : classicMatch())
} catch (error) {
  failures++
  say(`!!  ${error.message.split('\n')[0]}`)
} finally {
  await browser.close()
  server.kill()
  site.close()
  rmSync(out, { recursive: true, force: true })
}
say(failures ? `${failures} failed; screenshots in ${shots}` : `browser match ok; screenshots in ${shots}`)
process.exit(failures ? 1 : 0)
