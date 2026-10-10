import { createHmac, timingSafeEqual } from 'node:crypto'

// Who is on the other end of a socket: the Nakama session token from the
// player's hello, checked here without asking Nakama. Nakama signs session
// tokens as JWTs, HS256 with its session.encryption_key; the claims name the
// user (uid, usn) and when the token dies (exp, seconds). A valid signature
// and a live token are all it takes — which also means a logout isn't seen
// here until the token runs out (two hours: a known limit).

interface Identity {
  uid: string
  username: string
  expires: number // seconds since the epoch
}

interface Claims {
  uid?: unknown
  usn?: unknown
  exp?: unknown
}

const sign = (body: string, key: string) => createHmac('sha256', key).update(body).digest()

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// The player the token names, or null: malformed, not HS256, a signature
// that isn't Nakama's, or expired. `now` in seconds.
export function verifyToken(token: string, key: string, now = Date.now() / 1000): Identity | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const head = decode(header) as { alg?: unknown } | null
  if (head?.alg !== 'HS256') return null // never 'none', never another algorithm
  const given = Buffer.from(signature, 'base64url')
  const expected = sign(`${header}.${payload}`, key)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const claims = decode(payload) as Claims | null
  if (!claims || typeof claims.uid !== 'string' || !claims.uid || typeof claims.usn !== 'string' || typeof claims.exp !== 'number') return null
  if (claims.exp <= now) return null
  return { uid: claims.uid, username: claims.usn, expires: claims.exp }
}

// The name a player goes by in a match: an account's username; a guest (the
// hello says so) as Guest and the end of its user id.
export const playerName = ({ uid, username }: Identity, guest: boolean) => (guest ? `Guest ${uid.slice(-4)}` : username.slice(0, 20))

// A token as Nakama would sign it — for the tests, which run with no Nakama.
export function mintToken(claims: { uid: string; usn: string; exp: number }, key: string, alg = 'HS256') {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = part({ alg, typ: 'JWT' })
  const payload = part({ tid: crypto.randomUUID(), vrs: {}, iat: Math.floor(Date.now() / 1000), ...claims })
  return `${header}.${payload}.${sign(`${header}.${payload}`, key).toString('base64url')}`
}
