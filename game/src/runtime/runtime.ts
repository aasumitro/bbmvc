import * as THREE from 'three'
import { NetError, REASONS, type Link } from '../net/connection.ts'
import type { Difficulty } from '../sim/difficulty.ts'
import { arenaDigest } from '../content/arenas/digest.ts'
import { prepareSounds } from '../view/audio.ts'
import { addSunsetLighting, addSunsetSky, followShadow } from '../render/environment.ts'
import { runTasks, type Progress } from './loading.ts'
import type { Loadout } from '../sim/loadout.ts'
import type { Arena } from '../content/arenas/arena.ts'
import { MAPS, type MapId } from '../content/arenas/maps.ts'
import type { Match, MatchPhase } from './match.ts'
import { createMatch } from './practice.ts'
import type { Mode } from '../modes/ids.ts'
import { createOnlineMatch } from './online.ts'
import { initPhysics } from '../sim/physics.ts'
import { createComposer, disposeComposer, QUALITY } from '../render/postprocessing.ts'
import { getRenderer, mountRenderer } from '../render/renderer.ts'
import { onSettingsChange, renderScale, settings } from '../view/settings.ts'

// One gameplay session in the browser, from loading to teardown: the match's
// own loading steps, then the shared renderer set up for the arena, a scene
// with the sky, the sun and the (session-cached) arena, one match, the
// post-processing chain kept in step with the graphics settings, and the
// render loop. Online, the seat is already taken (matchmaking found it:
// net/matchmaking.ts): the loading builds the arena the server named, and
// the match is the server's (online.ts). Plain TypeScript: the gameplay
// screen (screens/GameCanvas.tsx) starts it, hears back through the
// callbacks and disposes it; the match is handed over once it runs.

// Arenas are deterministic and expensive to build, so each is built on first
// use and kept for the session; matches borrow it and give it back.
const built = new Map<MapId, Arena>()
function loadArena(id: MapId) {
  let arena = built.get(id)
  if (!arena) built.set(id, (arena = MAPS[id].build()))
  return arena
}

export interface GameOptions {
  container: HTMLElement // gets the shared canvas
  loadout: Loadout
  difficulty: Difficulty
  mode: Mode
  map: MapId
  link: Link | null // online: the seat matchmaking found; the room's arena is the one played. Null: practice against bots
  onPhase: (phase: MatchPhase) => void
  onFrame: (match: Match, camera: THREE.PerspectiveCamera) => void // every frame, after the match and before the render: the HUD
  onProgress: (progress: Progress) => void // the loading, step by step (loading.ts)
}

export function startGame({ container, loadout, mode, difficulty, map, link, onPhase, onFrame, onProgress }: GameOptions) {
  let disposed = false
  let session: ReturnType<typeof assemble> | undefined
  const arenaId = (link?.welcome.map ?? map) as MapId // online, the arena of the room the server seated the player in
  let unmount = () => {}
  let dev: { match: Match; camera: THREE.PerspectiveCamera; tick: (time: number) => void } | null = null

  // Everything the match runs on, made in one go once its arena and the
  // sounds are ready; `release` gives it back.
  function assemble() {
    const renderer = getRenderer()
    renderer.toneMappingExposure = 1
    renderer.setPixelRatio(renderScale()) // the arena is fill-rate bound (MSAA + GTAO + bloom): 1x unless the settings say otherwise; the garage renders crisper
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 1500)
    addSunsetSky(scene)
    const sun = addSunsetLighting(scene, renderer, 80) // shadows follow the view (followShadow)
    const arena = loadArena(arenaId)
    scene.add(arena.root)

    const surface = renderer.domElement
    const match = link
      ? createOnlineMatch({ scene, camera, arena, surface, link, onPhase })
      : createMatch({ scene, camera, arena, map, mode, difficulty, surface, loadout, onPhase })
    let quality = settings.quality
    sun.shadow.mapSize.setScalar(QUALITY[quality].shadowMap)
    let composer = createComposer(renderer, scene, camera, quality)
    // Graphics settings apply live, from the pause menu's settings drawer.
    const unwatch = onSettingsChange(() => {
      const scale = renderScale()
      if (scale !== renderer.getPixelRatio()) {
        renderer.setPixelRatio(scale)
        composer.setPixelRatio(scale)
      }
      if (settings.quality !== quality) {
        quality = settings.quality
        sun.shadow.mapSize.setScalar(QUALITY[quality].shadowMap) // three resizes the map on the next render
        disposeComposer(composer)
        composer = createComposer(renderer, scene, camera, quality)
      }
    })

    const shadowFocus = new THREE.Vector3()
    return {
      match,
      camera,
      compile: () => renderer.compileAsync(scene, camera), // shaders now, not on the first shot fired
      frame(time: number) {
        arena.update(time / 1000)
        match.frame(time)
        // shadows cover what's in view: centred ahead of the car, along the camera's heading
        shadowFocus.copy(match.chase.forward).setY(0).normalize().multiplyScalar(45).add(match.cars[match.player.id].model.position)
        followShadow(sun, shadowFocus)
        onFrame(match, camera)
        composer.render()
      },
      resize(width: number, height: number) {
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        composer.setSize(width, height)
      },
      release() {
        unwatch()
        match.dispose()
        disposeComposer(composer)
        sun.dispose()
        scene.clear() // lets the scene go: the arena and the sky dome live on in their session caches
      },
    }
  }

  // The match's loading, after the startup's (loading.ts). Every step is real
  // work; the arena (per map) and the sounds are kept for the session, so a
  // later match on the same arena gets through those two at once.
  async function start() {
    const finished = await runTasks(
      [
        { label: 'Starting physics', run: initPhysics }, // begun on the loading screen: normally done already
        { label: 'Synthesizing sounds', run: prepareSounds },
        { label: 'Building the arena', run: () => arrive() },
        { label: 'Setting up the match', run: () => (session = assemble()) },
        { label: 'Compiling shaders', run: () => session?.compile() },
      ],
      onProgress,
      () => disposed,
    )
    if (!finished || disposed || !session) return null
    const { match, camera, frame, resize } = session
    unmount = mountRenderer(container, frame, resize)
    // Console access in dev: inspect state, step frames by hand (rAF stops in hidden tabs).
    if (import.meta.env.DEV) Object.assign(window, (dev = { match, camera, tick: frame }))
    return match
  }

  // The arena built; online, on the same ground as the server's (an arena
  // this page knows, and the digests agree: a page from before a deploy doesn't).
  function arrive() {
    if (link && !Object.hasOwn(MAPS, link.welcome.map)) lose(REASONS.arena)
    const arena = loadArena(arenaId)
    if (link && link.welcome.digest !== arenaDigest(arena)) lose(REASONS.arena)
  }

  // Online, a seat this page can't play: let it go, and say why.
  function lose(reason: string): never {
    link?.close()
    throw new NetError(reason)
  }

  return {
    ready: start(), // the match once it's running; null if disposed first; rejects with a failed step (a NetError says why, in the player's words)
    // Releases whatever the start has made so far: all of it once running,
    // part of it after a failed or abandoned start. An online match closes
    // its link; a link whose match never ran is the caller's (a start that
    // React runs twice in development must not close the seat under the second).
    dispose() {
      if (disposed) return
      disposed = true
      unmount()
      session?.release()
      if (dev && Reflect.get(window, 'match') === dev.match) for (const key of Object.keys(dev)) Reflect.deleteProperty(window, key)
    },
  }
}
