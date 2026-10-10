import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Notice } from './screens/Notice.tsx'

// Game-style pointer: menus are driven from the keyboard, so the cursor stays
// hidden until the mouse actually moves, and hides again after a short idle
// or any key press.
const hideCursor = () => document.documentElement.classList.add('cursor-hidden')
let cursorIdle = 0
hideCursor()
window.addEventListener('mousemove', () => {
  document.documentElement.classList.remove('cursor-hidden')
  clearTimeout(cursorIdle)
  cursorIdle = window.setTimeout(hideCursor, 1500)
})
window.addEventListener('keydown', hideCursor)

const root = createRoot(document.getElementById('root')!)
const show = (screen: ReactNode) => root.render(<StrictMode>{screen}</StrictMode>)

// The game drives with keys and aims with a mouse. A device with no mouse or
// trackpad at all (a phone, a tablet on its own) gets a notice instead, and
// never downloads the game: App and everything it loads come in a chunk of
// their own. A tablet with a trackpad passes.
if (matchMedia('(any-pointer: fine)').matches)
  import('./App.tsx').then(
    ({ default: App }) => show(<App />),
    (error: unknown) => {
      console.error('The game failed to load:', error)
      show(<Notice title="The game didn't load" line="Check your connection, then reload the page." />)
    },
  )
else show(<Notice title="Desktop only, for now" line="Scrapyard needs a keyboard and a mouse. Open this page on a computer to play." />)
