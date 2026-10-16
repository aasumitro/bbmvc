import { useEffect, useMemo, useState } from 'react'
import { startAnalytics } from '../analytics.ts'
import { MENU_BACKDROP } from '../runtime/loading.ts'
import { player, type Player } from '../net/session.ts'
import { Drawer } from './Drawer.tsx'
import { Menu } from './Menu.tsx'
import { LATEST_VERSION, PatchNotesPanel } from './PatchNotesPanel.tsx'
import { RestoreDefaults, SettingsPanel } from './SettingsPanel.tsx'

const REPO = 'https://github.com/aasumitro/bbmvc' // the source, the corner's second button

// The corner's buttons: the patch notes and the source, one look.
const CORNER_BUTTON =
  'flex h-10 items-center rounded-md border border-white/15 bg-black/45 text-xs font-bold tracking-[0.15em] text-neutral-200 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white focus-visible:bg-black/70 focus-visible:text-white'

interface MainMenuProps {
  onPlay: () => void
  onGarage: () => void
}

interface NavItem {
  label: string
  hint: string
  action?: () => void
}

type DrawerKind = 'settings' | 'patchnotes' | null

export function MainMenu({ onPlay, onGarage }: MainMenuProps) {
  const [drawer, setDrawer] = useState<DrawerKind>(null)

  const items: NavItem[] = useMemo(
    () => [
      { label: 'Play', hint: 'drop into the arena', action: onPlay },
      { label: 'Garage', hint: 'check your machine', action: onGarage },
      { label: 'Settings', hint: 'tune your rig, know your keys', action: () => setDrawer('settings') },
      { label: 'Exit', hint: 'leave the yard', action: () => location.assign('/') }, // the site's home (in dev: the game again)
    ],
    [onPlay, onGarage],
  )

  const [selected, setSelected] = useState(0)

  useEffect(startAnalytics, []) // one page view, on the first menu, if the site's banner got a yes

  // Who is playing: signed in on the site, a guest, or no server (practice still works).
  const [who, setWho] = useState<Player | 'offline'>()
  useEffect(() => {
    let live = true
    player().then(
      (p) => live && setWho(p),
      () => live && setWho('offline'),
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (drawer) return
      if (e.key === 'ArrowDown') setSelected((i) => (i + 1) % items.length)
      if (e.key === 'ArrowUp') setSelected((i) => (i - 1 + items.length) % items.length)
      if (e.key === 'Enter') {
        e.preventDefault() // no second press through a focused button
        items[selected].action?.()
      }
      if (e.code === 'KeyN') setDrawer('patchnotes')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, selected, drawer])

  return (
    <div
      className="fixed inset-0 bg-cover bg-center text-[#f2ece0] before:absolute before:inset-0 before:bg-linear-to-r before:from-black/75 before:via-black/35 before:to-black/10 before:content-['']"
      style={{ backgroundImage: `url('${MENU_BACKDROP}')` }}
    >
      <div className="relative flex h-full max-w-xl flex-col justify-center gap-6 pl-[6vw]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-red-500">
          <path d="M12 2 L14 9 L21 9 L15.5 13.5 L17.5 21 L12 16.5 L6.5 21 L8.5 13.5 L3 9 L10 9 Z" stroke="currentColor" strokeWidth="1" />
        </svg>

        <div>
          <h1 className="m-0 font-display text-6xl font-semibold tracking-wider drop-shadow-[0_0_32px_rgba(220,38,38,0.5)] sm:text-7xl">Scrapyard</h1>
          <div className="mt-3 flex items-center gap-4">
            <p className="font-display text-lg text-red-400/90 italic">Car Battle</p>
            <div className="h-px flex-1 bg-linear-to-r from-red-500/80 to-transparent" />
          </div>
        </div>

        <Menu items={items} selected={selected} onSelect={setSelected} onActivate={(i) => items[i].action?.()} />
      </div>

      <div className="absolute bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-widest text-neutral-400 uppercase">
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">&uarr;&darr;</span>
        <span>Choose</span>
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">Enter</span>
        <span>Select</span>
      </div>

      {who && (
        <div className="absolute top-8 right-[4vw] text-right">
          {who === 'offline' ? (
            <p
              className="font-sans text-xs font-bold tracking-[0.15em] text-neutral-500 uppercase"
              title="Can't reach the game server. Practice works without it."
            >
              Offline
            </p>
          ) : (
            <>
              <p className="font-sans text-[0.65rem] font-bold tracking-[0.25em] text-neutral-500 uppercase">Playing as</p>
              <a
                href={who.guest ? '/register' : '/account'}
                title={who.guest ? 'Guests are deleted after 3 days: create an account to keep your name' : 'Your account'}
                className="mt-1 block font-display text-lg text-neutral-200 hover:text-white"
              >
                {who.name}
              </a>
              {who.guest && (
                <a href="/register" className="mt-1 block font-sans text-xs text-red-400 underline decoration-red-500/50 underline-offset-4 hover:text-red-300">
                  Create an account
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* patch notes: out of the list, over the quote; N opens them too (Enter stays the menu's) */}
      <div className="absolute right-[4vw] bottom-8 flex max-w-sm flex-col items-end gap-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawer('patchnotes')}
            aria-label={`Patch notes, v${LATEST_VERSION}`}
            title="Patch notes (N)"
            className={`gap-2.5 px-3.5 ${CORNER_BUTTON}`}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M6 8h4M6 11h4" />
            </svg>
            v{LATEST_VERSION}
          </button>
          <a
            href={REPO}
            target="_blank" // a new tab: the game (and a search, a match) stays open here
            rel="noopener noreferrer"
            aria-label="Scrapyard on GitHub (opens in a new tab)"
            title="Source on GitHub"
            className={`w-10 justify-center px-0 ${CORNER_BUTTON}`}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
        <div className="text-right font-display text-neutral-300/90 italic">
          <p className="text-sm">&ldquo;What you scrap, you keep. What you keep, keeps you alive.&rdquo;</p>
          <p className="mt-1 font-sans text-[0.65rem] tracking-[0.25em] text-neutral-500 uppercase not-italic">Yard Law, First Rule</p>
        </div>
      </div>

      {drawer === 'settings' && (
        <Drawer kicker="Scrapyard" title="Settings" onClose={() => setDrawer(null)} footer={<RestoreDefaults />}>
          <SettingsPanel />
        </Drawer>
      )}
      {drawer === 'patchnotes' && (
        <Drawer kicker="Scrapyard" title="Patch Notes" onClose={() => setDrawer(null)}>
          <PatchNotesPanel />
        </Drawer>
      )}
    </div>
  )
}
