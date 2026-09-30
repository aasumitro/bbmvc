// Smoke test for the nightly guest cleanup on the local Nakama (the prune_guests
// RPC, nakama/data/modules/guests.lua; scripts/backup.sh calls it on the server):
//   - A player's session can't call it; the runtime HTTP key can.
//   - Deleted: a guest made 4 days ago, and 250 more (pages of the RPC's walk).
//   - Kept: a guest made just under 3 days ago; an old guest online right now;
//     old guests who linked an email or another login; an old device account
//     that also signs in through an auth provider; an email account.
//   - The same browser comes back as a new guest.
// Local only: it backdates the accounts it makes with psql in the stack's
// Postgres (a test's own rows; nothing else writes Nakama's tables with SQL),
// and the RPC deletes every guest there older than 3 days, as each night on
// the server. Deletes the accounts it made that are left.
//   node scripts/guests-smoke.mjs
//   NAKAMA_POSTGRES=<container> NAKAMA_HTTP_KEY=... for another stack
// Node 22+ (global fetch and WebSocket). Exits non-zero on the first failure.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const url = 'http://127.0.0.1:7350'
const basic = 'Basic ' + Buffer.from('defaultkey:').toString('base64')
const bearer = (session) => 'Bearer ' + session.token
const httpKey = process.env.NAKAMA_HTTP_KEY ?? 'defaulthttpkey'
const postgres = process.env.NAKAMA_POSTGRES ?? 'nakama_postgres_1'

async function call(method, path, { auth = basic, body } = {}) {
  const res = await fetch(url + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}
const sql = (query) => execFileSync('podman', ['exec', postgres, 'psql', '-U', 'postgres', '-d', 'nakama', '-tAc', query]).toString().trim()
const uid = (session) => JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url')).uid
const ids = (sessions) => sessions.map((s) => `'${uid(s)}'`).join(',')
const alive = (session) => sql(`SELECT count(*) FROM users WHERE id = '${uid(session)}'`) === '1'
const prune = async (auth) => call('POST', `/v2/rpc/prune_guests?unwrap${auth ? '' : `&http_key=${httpKey}`}`, auth && { auth })

const made = []
async function guest(id = crypto.randomUUID()) {
  const session = (await call('POST', '/v2/account/authenticate/device?create=true', { body: { id } })).body
  assert.ok(session.token, 'guest sign-in')
  made.push(session)
  return session
}

let online
try {
  const device = crypto.randomUUID()
  const old = await guest(device)
  const young = await guest()
  const playing = await guest()
  const withEmail = await guest()
  assert.equal((await call('POST', '/v2/account/link/email', { auth: bearer(withEmail), body: { email: `${crypto.randomUUID()}@example.com`, password: 'guests-smoke-1' } })).status, 200, 'link an email')
  const withCustom = await guest()
  assert.equal((await call('POST', '/v2/account/link/custom', { auth: bearer(withCustom), body: { id: crypto.randomUUID() } })).status, 200, 'link a custom ID')
  const withProvider = await guest()
  sql(`INSERT INTO user_device (id, user_id, provider) VALUES ('${crypto.randomUUID()}', '${uid(withProvider)}', 'smoke')`) // as Nakama 3.41 keeps an auth provider's login
  const account = (await call('POST', '/v2/account/authenticate/email?create=true', { body: { email: `${crypto.randomUUID()}@example.com`, password: 'guests-smoke-1' } })).body
  assert.ok(account.token, 'email sign-up')
  made.push(account)

  // the guest whose game is open holds a socket on the online stream, as the game does (stats.lua)
  online = new WebSocket(`${url.replace(/^http/, 'ws')}/ws?lang=en&status=false&token=${playing.token}`)
  await new Promise((resolve, reject) => {
    online.onopen = resolve
    online.onerror = () => reject(new Error('socket: connection failed'))
  })
  const joined = new Promise((resolve) => (online.onmessage = (e) => JSON.parse(e.data).cid === '1' && resolve()))
  online.send(JSON.stringify({ cid: '1', rpc: { id: 'join_online', payload: '{}' } }))
  await joined

  sql(`UPDATE users SET create_time = now() - interval '4 days' WHERE id IN (${ids([old, playing, withEmail, withCustom, withProvider, account])})`)
  sql(`UPDATE users SET create_time = now() - interval '2 days 23 hours' WHERE id = '${uid(young)}'`)

  assert.equal((await prune(bearer(young))).status, 403, "a player's session is refused")
  const first = await prune()
  assert.equal(first.status, 200, `the HTTP key calls it: ${JSON.stringify(first.body)}`)
  assert.ok(!alive(old) && sql(`SELECT count(*) FROM user_device WHERE id = '${device}'`) === '0', 'a guest made 4 days ago is deleted, with its device')
  assert.ok(alive(young), 'a guest made 2 days 23 hours ago stays')
  assert.ok(alive(playing), 'an old guest online right now stays')
  assert.ok(alive(withEmail) && alive(withCustom) && alive(withProvider), 'old guests with another way in stay')
  assert.ok(alive(account), 'an email account stays')
  console.log(`ok  who goes: ${JSON.stringify(first.body)}`)

  const again = await guest(device)
  assert.notEqual(uid(again), uid(old), 'the same browser comes back as a new guest')
  console.log('ok  the same browser comes back as a new guest')

  const bulk = []
  for (let n = 0; n < 250; n += 25) bulk.push(...(await Promise.all(Array.from({ length: 25 }, () => guest()))))
  sql(`UPDATE users SET create_time = now() - interval '5 days' WHERE id IN (${ids(bulk)})`)
  const started = Date.now()
  const second = await prune()
  assert.ok(second.body.deleted >= 250 && second.body.more === false, `250 old guests in one call: ${JSON.stringify(second.body)}`)
  assert.equal(sql(`SELECT count(*) FROM users WHERE id IN (${ids(bulk)})`), '0', 'none of them is left')
  assert.ok(alive(playing), 'the online guest still stays')
  console.log(`ok  ${second.body.deleted} old guests in ${Date.now() - started} ms`)
} finally {
  online?.close()
  const kept = new Set(made.length ? sql(`SELECT id FROM users WHERE id IN (${ids(made)})`).split('\n') : [])
  const left = made.filter((session) => kept.has(uid(session)))
  const gone = await Promise.all(left.map(async (session) => (await call('DELETE', '/v2/account', { auth: bearer(session) })).status))
  console.log(gone.every((status) => status === 200) ? `ok  cleanup: ${gone.length} accounts deleted` : `!!  cleanup statuses: ${gone.join(', ')}`)
}
