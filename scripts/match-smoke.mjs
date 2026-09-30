// Smoke test for online matches: a Nakama guest takes a seat on the game
// server — at <site>/match, as the game at /play does — on every arena, and
// the arena the server plays must be the one game/server/digests.json expects
// (the file the server's own arena check and the browser parity script hold
// to: a server that drifted fails the deploy, not every player). Then leaves.
// Deletes the guest it made.
//   local:  node scripts/match-smoke.mjs   (the game server straight on :7360; SITE_URL=http://localhost:8000 goes through the site's dev server)
//   server: SITE_URL=https://example.com NAKAMA_URL=https://api.example.com NAKAMA_CLIENT_KEY=... node scripts/match-smoke.mjs
// Node 22+ (global fetch and WebSocket). Exits non-zero on failure.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildId } from '../game/build-id.ts'

const site = (process.env.SITE_URL ?? 'http://127.0.0.1:7360').replace(/\/$/, '')
const nakama = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350'
const basic = 'Basic ' + Buffer.from(`${process.env.NAKAMA_CLIENT_KEY ?? 'defaultkey'}:`).toString('base64')
// The version the game server speaks, from the game's own protocol (the page reloads on a mismatch; so would this)
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(readFileSync(new URL('../game/src/net/protocol.ts', import.meta.url), 'utf8'))?.[1])
assert.ok(protocol > 0, 'PROTOCOL in game/src/net/protocol.ts')
// and the build this checkout makes, as the deployed page and server were built from it
const build = buildId()
const digests = JSON.parse(readFileSync(new URL('../game/server/digests.json', import.meta.url), 'utf8'))

async function call(method, path, auth, body) {
  const res = await fetch(nakama + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

const guest = (await call('POST', '/v2/account/authenticate/device?create=true', basic, { id: crypto.randomUUID() })).body
assert.ok(guest.token, 'guest sign-in')
try {
  for (const [map, expected] of Object.entries(digests)) {
    // a browser sends its page's origin: the site's own
    const socket = new WebSocket(`${site.replace(/^http/, 'ws')}/match`, { headers: { Origin: site } })
    const welcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('match: no welcome in 5 s')), 5000)
      socket.onerror = () => reject(new Error(`match: can't connect to ${site}/match`))
      socket.onopen = () => socket.send(JSON.stringify({ t: 'hello', v: protocol, build, token: guest.token, guest: true, mode: 'ffa', map, loadout: { vehicle: 'razor', weapon: 'minigun' } }))
      socket.onmessage = (e) => {
        if (typeof e.data !== 'string') return // a binary frame: a snapshot, once seated
        const message = JSON.parse(e.data)
        if (message.t === 'err') reject(new Error(`match: refused (${message.code}): ${message.text}`))
        if (message.t !== 'welcome') return
        clearTimeout(timer)
        resolve(message)
      }
    })
    assert.equal(welcome.lineUp.length, 8, 'a full line-up')
    assert.ok(welcome.lineUp[welcome.seat].human, 'seated as a person')
    assert.equal(welcome.digest, expected, `the server's ${map} is the one game/server/digests.json expects`)
    socket.send(JSON.stringify({ t: 'bye' }))
    socket.close()
    await new Promise((resolve) => (socket.onclose = resolve))
    console.log(`ok  ${map}: seated in room ${welcome.room}, seat ${welcome.seat} of ${welcome.lineUp.length}, arena ${welcome.digest} as expected, build ${build}`)
  }
} finally {
  const gone = (await call('DELETE', '/v2/account', `Bearer ${guest.token}`)).status
  console.log(gone === 200 ? 'ok  cleanup: the guest deleted' : `!!  cleanup status: ${gone}`)
}
