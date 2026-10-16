import type { Arena, SpawnPoint } from './arena.ts'

// A short fingerprint of what an arena is to play on: its colliders, starts,
// team bases, hot zones and road graph, numbers rounded to millimetres
// (FNV-1a, 32 bits, as 8 hex digits). The game server and the browser each
// build the arena from the same code; equal digests say they built the same
// ground to fight on (the F3 overlay shows it; the server sends its own when
// a player joins). Meshes and materials play no part. Pure: it runs in
// the game server and the tests too.

type ArenaLayout = Pick<Arena, 'colliders' | 'spawns' | 'bases' | 'zones' | 'nav'>

export function arenaDigest({ colliders, spawns, bases, zones, nav }: ArenaLayout) {
  let hash = 0x811c9dc5
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  const mm = (...numbers: number[]) => text(numbers.map((n) => Math.round(n * 1000)).join(',') + ';')
  const starts = (list: readonly SpawnPoint[]) => list.forEach(({ position: p, heading }) => mm(p.x, p.y, p.z, heading))

  text(`colliders ${colliders.length}:`)
  for (const shape of colliders) {
    if ('box' in shape) {
      const { box: b, position: p, rotation: q } = shape
      text('box')
      mm(b.x, b.y, b.z, p.x, p.y, p.z, q.x, q.y, q.z, q.w)
    } else if ('cylinder' in shape) {
      const {
        cylinder: [radius, half],
        position: p,
      } = shape
      text('cylinder')
      mm(radius, half, p.x, p.y, p.z)
    } else {
      text(`hull ${shape.hull.length}`)
      for (const p of shape.hull) mm(p.x, p.y, p.z)
    }
  }
  text(`spawns ${spawns.length}:`)
  starts(spawns)
  text(`bases ${bases?.length ?? 0}:`)
  bases?.forEach((base) => {
    text(`base ${base.length}`)
    starts(base)
  })
  text(`zones ${zones?.length ?? 0}:`)
  zones?.forEach(({ name, x, z, radius }) => {
    text(name)
    mm(x, z, radius)
  })
  text(`nav ${nav.nodes.length}:`)
  nav.nodes.forEach((node, i) => {
    mm(node.x, node.y, node.z)
    text(nav.links[i].join(',') + ';')
  })
  return (hash >>> 0).toString(16).padStart(8, '0')
}
