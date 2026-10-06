import type { Arena } from '../game/arena/arena'
import type { Zone } from '../game/ffa/rules'
import { ITEMS, type Item } from '../game/items/items'

// Tactical minimap drawn from the arena's own floor plan (Arena.paintMap) and
// collider footprints — no image. The layout is painted once; each frame the
// canvas is rotated so the view direction points up, and the cars are drawn on top.

const LAYOUT_PX = 1024
const LOW = 0.5 // metres: footprints no taller than this (kerbs, sidewalks) are floor, not obstacles

interface Blip {
  id: number
  alive: boolean
  team: number
  position: { x: number; z: number }
}

// The mode's extras: items within `range` of the player — what a bot knows
// too — and, in free for all, the hot zone (always, with a rim arrow when
// it's off the map) and a ring round the sole leader.
export interface MapMarks {
  zone: Zone | null
  items: readonly Item[]
  range: number
  leader: { x: number; z: number } | null
}

// Canvas x = world x (east), canvas y = world z (south): north up.
function paintLayout(arena: Arena) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LAYOUT_PX
  const ctx = canvas.getContext('2d')!
  const scale = LAYOUT_PX / (2 * arena.extent)
  ctx.setTransform(scale, 0, 0, scale, LAYOUT_PX / 2, LAYOUT_PX / 2)
  arena.paintMap(ctx)

  // every footprint in one path, filled once, so overlaps don't darken
  const circle = (x: number, z: number, radius: number) => {
    ctx.moveTo(x + radius, z)
    ctx.arc(x, z, radius, 0, Math.PI * 2)
  }
  ctx.beginPath()
  for (const shape of arena.colliders) {
    if ('box' in shape) {
      if (shape.position.y + shape.box.y < LOW) continue
      const { x, y, z, w } = shape.rotation
      ctx.save()
      ctx.translate(shape.position.x, shape.position.z)
      ctx.rotate(Math.atan2(2 * (x * z - w * y), 1 - 2 * (y * y + z * z))) // the box's x axis, seen from above
      ctx.rect(-shape.box.x, -shape.box.z, shape.box.x * 2, shape.box.z * 2)
      ctx.restore()
    } else if ('cylinder' in shape) {
      if (shape.position.y + shape.cylinder[1] < LOW) continue
      circle(shape.position.x, shape.position.z, shape.cylinder[0])
    } else {
      // convex hulls (the crest platform) as their enclosing circle
      const cx = shape.hull.reduce((sum, p) => sum + p.x, 0) / shape.hull.length
      const cz = shape.hull.reduce((sum, p) => sum + p.z, 0) / shape.hull.length
      circle(cx, cz, Math.max(...shape.hull.map((p) => Math.hypot(p.x - cx, p.z - cz))))
    }
  }
  ctx.fillStyle = 'rgba(226, 214, 196, 0.7)'
  ctx.fill()
  return canvas
}

export function createMinimap(canvas: HTMLCanvasElement, arena: Arena) {
  const layout = paintLayout(arena)
  const ctx = canvas.getContext('2d')!
  const extent = 2 * arena.extent
  const range = arena.mapRange

  // `viewYaw` / `heading` are rotation.y angles (0 faces +Z, south). Blips on
  // `team` are friendly; `people` (by id, online) are ringed.
  return function draw(centre: { x: number; z: number }, viewYaw: number, heading: number, blips: Blip[], team: number, marks?: MapMarks, people?: readonly boolean[]) {
    const size = Math.round(canvas.clientWidth * window.devicePixelRatio)
    if (canvas.width !== size) canvas.width = canvas.height = size
    const r = size / 2
    const turn = viewYaw - Math.PI // rotates the view direction to the top
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(r, r, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = 'rgba(10, 8, 7, 0.6)'
    ctx.fillRect(0, 0, size, size)

    ctx.translate(r, r)
    ctx.rotate(turn)
    ctx.scale(r / range, r / range)
    ctx.translate(-centre.x, -centre.z)
    ctx.drawImage(layout, -extent / 2, -extent / 2, extent, extent)
    const zone = marks?.zone
    if (zone) {
      ctx.beginPath()
      ctx.arc(zone.x, zone.z, zone.radius, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 90, 31, 0.18)'
      ctx.fill()
      ctx.lineWidth = range * 0.018
      ctx.strokeStyle = 'rgba(255, 120, 60, 0.9)'
      ctx.stroke()
    }
    const half = range * 0.028 // item squares
    for (const item of marks ? marks.items : []) {
      if (Math.hypot(item.x - centre.x, item.z - centre.z) > marks!.range) continue
      ctx.fillStyle = ITEMS[item.type].color
      ctx.fillRect(item.x - half, item.z - half, half * 2, half * 2)
    }
    ctx.shadowBlur = size * 0.03
    for (const { id, alive, team: side, position } of blips) {
      if (!alive) continue
      const friend = side === team
      ctx.fillStyle = friend ? '#7dd3fc' : '#ef4444'
      ctx.shadowColor = friend ? 'rgba(125, 211, 252, 0.9)' : 'rgba(239, 68, 68, 0.9)'
      ctx.beginPath()
      ctx.arc(position.x, position.z, range * 0.042, 0, Math.PI * 2)
      ctx.fill()
      if (!people?.[id]) continue
      // a person, not a bot: ringed in white
      ctx.lineWidth = range * 0.012
      ctx.strokeStyle = '#f2ece0'
      ctx.beginPath()
      ctx.arc(position.x, position.z, range * 0.062, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (marks?.leader) {
      ctx.beginPath()
      ctx.arc(marks.leader.x, marks.leader.z, range * 0.075, 0, Math.PI * 2)
      ctx.lineWidth = range * 0.016
      ctx.strokeStyle = '#fcd34d'
      ctx.shadowColor = 'rgba(252, 211, 77, 0.9)'
      ctx.stroke()
    }
    ctx.restore()

    // the player: an arrow at the centre, turned by its heading relative to the view
    const unit = size / 100
    ctx.save()
    ctx.translate(r, r)
    ctx.rotate(viewYaw - heading)
    ctx.beginPath()
    ctx.moveTo(0, -5 * unit)
    ctx.lineTo(3.6 * unit, 4 * unit)
    ctx.lineTo(0, 2 * unit)
    ctx.lineTo(-3.6 * unit, 4 * unit)
    ctx.closePath()
    ctx.fillStyle = '#f2ece0'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 3 * unit
    ctx.fill()
    ctx.restore()

    // the hot zone off the map: an arrowhead on the rim points the way
    if (zone) {
      const dx = zone.x - centre.x
      const dz = zone.z - centre.z
      if (Math.hypot(dx, dz) - zone.radius > range) {
        const angle = Math.atan2(dx * Math.sin(turn) + dz * Math.cos(turn), dx * Math.cos(turn) - dz * Math.sin(turn))
        ctx.save()
        ctx.translate(r + Math.cos(angle) * (r - 5 * unit), r + Math.sin(angle) * (r - 5 * unit))
        ctx.rotate(angle)
        ctx.beginPath()
        ctx.moveTo(4 * unit, 0)
        ctx.lineTo(-2.5 * unit, 3.2 * unit)
        ctx.lineTo(-2.5 * unit, -3.2 * unit)
        ctx.closePath()
        ctx.fillStyle = '#ff7a3c'
        ctx.fill()
        ctx.restore()
      }
    }

    // north on the rim
    ctx.font = `800 ${Math.round(8 * unit)}px Manrope, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ef4444'
    ctx.fillText('N', r + Math.sin(turn) * (r - 7 * unit), r - Math.cos(turn) * (r - 7 * unit))
  }
}
