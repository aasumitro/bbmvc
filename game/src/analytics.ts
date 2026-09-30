// Google Analytics: one page view when the main menu first shows, only for a
// player who said yes to the site's cookie banner. The answer lives in
// localStorage (same origin once the game is at /play); the game never asks
// and never writes it. Keep in step with www/src/lib/consent.ts. Nothing is
// sent from a match.
const ID = 'G-HN01PJVCB2' // the site's measurement id (www/src/lib/site.ts)
const CONSENT = 'scrapyard.consent' // 'granted' | 'denied'; absent: not asked

let started = false

export function startAnalytics() {
  if (started) return
  try {
    if (localStorage.getItem(CONSENT) !== 'granted') return
  } catch {
    return // storage blocked: no answer to follow
  }
  started = true
  const w = window as unknown as { dataLayer?: unknown[] }
  const dataLayer = (w.dataLayer ??= [])
  const gtag: (...args: unknown[]) => void = function () {
    // gtag.js reads Arguments objects, not arrays
    // oxlint-disable-next-line prefer-rest-params
    dataLayer.push(arguments)
  }
  gtag('js', new Date())
  gtag('config', ID)
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`
  document.head.append(script)
}
