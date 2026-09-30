// The visitor's answer to the cookie banner (components/site/ConsentBanner.astro):
// may Google Analytics count them? Kept in localStorage, shared with the game
// at /play (same origin), which only reads it. Keep in step with
// game/src/analytics.ts.
export const KEY = 'scrapyard.consent' // 'granted' | 'denied'; absent: not asked yet
const CHANGED = 'scrapyard:consent' // this tab's own writes

export type Consent = 'granted' | 'denied'

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null // storage blocked: asked again on every page
  }
}

// Stores the answer and tells this tab's listeners.
export function writeConsent(consent: Consent) {
  try {
    localStorage.setItem(KEY, consent)
  } catch {
    // storage blocked: the answer holds for this page only
  }
  dispatchEvent(new Event(CHANGED))
}

export function onConsent(onChange: () => void) {
  addEventListener(CHANGED, onChange)
}
