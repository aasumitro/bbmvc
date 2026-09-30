import { SITE } from './site'

// Google Analytics (gtag.js), started only for a visitor who said yes
// (lib/consent.ts); components/head/Analytics.astro decides.
let started = false

export function startAnalytics() {
  if (started) return
  started = true
  const w = window as unknown as { dataLayer?: unknown[] }
  const dataLayer = (w.dataLayer ??= [])
  const gtag: (...args: unknown[]) => void = function () {
    // eslint-disable-next-line prefer-rest-params -- gtag.js reads Arguments objects, not arrays
    dataLayer.push(arguments)
  }
  gtag('js', new Date())
  gtag('config', SITE.analytics)
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${SITE.analytics}`
  document.head.append(script)
}

// A no: GA's cookies go (set on the page's host or any domain above it), and
// a page already running gtag.js reloads without it.
export function stopAnalytics() {
  const names = document.cookie.split('; ').map((cookie) => cookie.split('=')[0]!)
  const parts = location.hostname.split('.')
  const domains = parts.map((_, i) => parts.slice(i).join('.'))
  for (const name of names.filter((n) => n.startsWith('_ga'))) {
    document.cookie = `${name}=; Max-Age=0; path=/`
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`
  }
  if (started) location.reload()
}
