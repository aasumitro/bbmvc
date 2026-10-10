import { gameServerUrl, NetError, openSocket, REASONS } from './connection.ts'
import { freshSession } from './session.ts'

// What the page's two session stores share (matchmaking.ts, Classic's;
// lobbies.ts, the custom lobbies'): a socket opened with the player's
// session, getting it back after a drop or a reload within the server's
// grace, and the tab's mark of what to get back to. Two stores remain:
// Classic hands its socket to the match; custom keeps it and takes it back.

// A socket and the session to say hello with. The tests dial their own.
export type Dial = () => Promise<{ open: WebSocket; token: string; guest: boolean }>
export const dial: Dial = async () => {
  const { token, guest } = await freshSession().catch(() => Promise.reject(new NetError(REASONS.offline)))
  return { open: await openSocket(gameServerUrl()), token, guest }
}

export const RETRY = [0, 1000, 2000, 4000, 7000] // ms before each try to get the socket back: well inside the server's grace (15 s a ticket, 20 s a slot)

// Tries `again` after each wait in RETRY while `wanted` still holds (a stale
// try, or a store that moved on, just stops); `giveUp` once every try failed.
export async function comeBack(wanted: () => boolean, again: () => Promise<unknown>, giveUp: () => void, tries = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RETRY[tries]))
  if (!wanted()) return
  try {
    await again()
  } catch {
    if (!wanted()) return
    if (tries + 1 < RETRY.length) return comeBack(wanted, again, giveUp, tries + 1)
    giveUp()
  }
}

// The tab's mark (sessionStorage): `value` kept, or removed (null). No
// storage: nothing kept, and a reload starts over (the server's grace ends it).
export function mark(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {}
}
export function readMark(key: string) {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
