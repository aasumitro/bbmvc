import { useEffect, useState } from 'react'
import { saveLoadout, savedLoadout, type Loadout } from './game/loadout'
import { MAPS, type MapId } from './game/maps'
import { MODES, type Mode } from './game/modes'
import type { Link } from './net/connection'
import { findMatch, onSearch, resumeSearch, takeSeat } from './net/matchmaking'
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
// wherever it is — a practice match ends there.
type Screen = 'loading' | 'menu' | 'garage' | 'map-select' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [loadout, setLoadout] = useState<Loadout>(savedLoadout) // the garage's last pick in this browser
  const [pick, setPick] = useState<Pick>({ mode: 'tdm', map: 'scrapyard', difficulty: 'normal', online: false })
  const [seat, setSeat] = useState<Link | null>(null) // online: the seat being played; null in practice
  const [run, setRun] = useState(0) // each match gets a fresh gameplay screen

  // The server has seated the player: into its match, on its mode and arena.
  useEffect(
    () =>
      onSearch(() => {
        const found = takeSeat()
        if (!found) return
        const { mode, map } = found.welcome
        setSeat(found)
        setPick((last) => ({ ...last, online: true, mode: Object.hasOwn(MODES, mode) ? (mode as Mode) : last.mode, map: Object.hasOwn(MAPS, map) ? (map as MapId) : last.map }))
        setRun((n) => n + 1)
        setScreen('game')
      }),
    [],
  )

  function changeLoadout(next: Loadout) {
    setLoadout(next)
    saveLoadout(next) // the next visit starts with it
  }

  let content
  if (screen === 'loading')
    content = (
      <Loading
        onDone={() => {
          setScreen('menu')
          resumeSearch(loadout) // a reload with a search on: it goes on
        }}
      />
    )
  else if (screen === 'garage') content = <Garage loadout={loadout} onLoadout={changeLoadout} onBack={() => setScreen('menu')} onSelect={() => setScreen('map-select')} />
  else if (screen === 'map-select')
    content = (
      <MapSelect
        pick={pick}
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
