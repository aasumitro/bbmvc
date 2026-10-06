import { useEffect, useState } from 'react'
import { saveLoadout, savedLoadout, type Loadout } from './game/loadout'
import { MAPS, type MapId } from './game/maps'
import { MODES, type Mode } from './game/modes'
import type { Link } from './net/connection'
import { currentCustom, leaveMatch, onCustom, openInvite, resumeLobby } from './net/custom'
import { currentSearch, findMatch, onSearch, resumeSearch, takeSeat } from './net/matchmaking'
import { INVITE, readCode } from './net/protocol'
import { GameCanvas } from './screens/GameCanvas'
import { Garage } from './screens/Garage'
import { Loading } from './screens/Loading'
import { MainMenu } from './screens/MainMenu'
import { MapSelect, type Pick } from './screens/MapSelect'
import { Matchmaking } from './screens/Matchmaking'

// Menu -> garage (pick the loadout) -> map select (mode and arena) -> match; the match exits back to the garage.
// Classic's Find Match searches from the map select and keeps searching on
// every screen; the match found shows over whatever is up (Matchmaking), and
// once the server has seated the player, the game goes into that match from
// wherever it is — a practice match ends there. A custom lobby's match
// (net/custom.ts) goes the same way, and once it's over for the player they
// are back on the arena screen's Custom entry: its waiting room (the list,
// if they were kicked; the way back in, after a drop). An invite link
// (?join=CODE) opens that entry and joins; a reload in a lobby goes back in.
type Screen = 'loading' | 'menu' | 'garage' | 'map-select' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [loadout, setLoadout] = useState<Loadout>(savedLoadout) // the garage's last pick in this browser
  const [pick, setPick] = useState<Pick>({ mode: 'tdm', map: 'scrapyard', difficulty: 'normal', online: false })
  const [seat, setSeat] = useState<Link | null>(null) // online: the seat being played; null in practice
  const [run, setRun] = useState(0) // each match gets a fresh gameplay screen

  // The server has seated the player: into its match, on its mode and arena.
  function play(found: Link) {
    const { mode, map } = found.welcome
    setSeat(found)
    setPick((last) => ({ ...last, online: true, mode: Object.hasOwn(MODES, mode) ? (mode as Mode) : last.mode, map: Object.hasOwn(MAPS, map) ? (map as MapId) : last.map }))
    setRun((n) => n + 1)
    setScreen('game')
  }
  useEffect(
    () =>
      onSearch(() => {
        const found = takeSeat()
        if (found) play(found)
      }),
    [],
  )
  // A custom lobby's match: in when it seats the player, back to the Custom entry when it lets them go.
  useEffect(() => {
    let playing: Link | null = null
    return onCustom(() => {
      const now = currentCustom()
      const found = now.phase === 'seated' ? now.link : null
      if (found === playing) return
      playing = found
      if (found) return play(found)
      if (now.phase === 'off') return // the match's screen says why the link ended; its exit leaves
      setSeat(null) // never a seatless match screen: that would start a practice match
      setScreen('map-select')
    })
  }, [])

  function changeLoadout(next: Loadout) {
    setLoadout(next)
    saveLoadout(next) // the next visit starts with it
  }

  let content
  if (screen === 'loading')
    content = (
      <Loading
        onDone={() => {
          resumeSearch(loadout) // a reload with a search on: it goes on
          const url = new URL(location.href)
          const invite = readCode(url.searchParams.get('join') ?? '')
          if (url.searchParams.has('join')) {
            url.searchParams.delete('join')
            history.replaceState(null, '', url) // a reload doesn't join again: it goes back to the lobby (resumeLobby)
          }
          const joining = INVITE.test(invite) && currentSearch().phase === 'idle' // a search on: the Custom entry offers to cancel it first
          if (joining) openInvite(loadout, invite)
          setScreen(joining || resumeLobby(loadout) ? 'map-select' : 'menu')
        }}
      />
    )
  else if (screen === 'garage') content = <Garage loadout={loadout} onLoadout={changeLoadout} onBack={() => setScreen('menu')} onSelect={() => setScreen('map-select')} />
  else if (screen === 'map-select')
    content = (
      <MapSelect
        pick={pick}
        loadout={loadout}
        onStart={(next) => {
          setPick(next)
          if (next.online) return void findMatch(next.mode, next.map, loadout) // the search runs on; the seat comes when it's found
          setRun((n) => n + 1)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
      />
    )
  else if (screen === 'game')
    content = (
      <GameCanvas
        key={run}
        loadout={loadout}
        mode={pick.mode}
        map={pick.map}
        difficulty={pick.difficulty}
        link={seat}
        onExit={() => {
          if (seat?.welcome.lobby && currentCustom().phase === 'seated') return leaveMatch() // the lobby's socket: back in the waiting room on the server's word
          seat?.close() // the match has let it go already, unless it never ran
          setSeat(null)
          setScreen('garage')
        }}
      />
    )
  else content = <MainMenu onPlay={() => setScreen('map-select')} onGarage={() => setScreen('garage')} />

  return (
    <>
      {content}
      {screen !== 'loading' && <Matchmaking arena={screen === 'map-select'} inGame={screen === 'game'} />}
    </>
  )
}

export default App
