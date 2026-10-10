import * as THREE from 'three'

// Combat effects: muzzle flashes, tracers, impacts, explosions, fire, smoke
// and wheel dust. Every particle is a soft round point in one of two pooled
// draw calls — glowing (additive, bloom picks up its >1 colours) and haze
// (smoke and dust). Points are skipped by the ambient-occlusion pass.

interface Kind {
  life: [number, number] // seconds
  size: [number, number] // metres
  grow: number // metres per second
  color: [number, number, number] // linear; above 1 blooms
  alpha: number
  drag: number // velocity damping per second
  lift: number // vertical acceleration; negative falls
}

const SPARK: Kind = { life: [0.15, 0.4], size: [0.02, 0.045], grow: 0, color: [7, 3, 0.9], alpha: 1, drag: 1.2, lift: -14 }
const FLASH: Kind = { life: [0.04, 0.06], size: [0.25, 0.45], grow: 2, color: [8, 4.5, 1.6], alpha: 1, drag: 0, lift: 0 }
const TRACER: Kind = { life: [1, 1], size: [0.1, 0.1], grow: 0, color: [9, 4.5, 1.6], alpha: 1, drag: 0, lift: 0 }
const FIRE: Kind = { life: [0.3, 0.65], size: [0.4, 0.9], grow: 1.2, color: [4.5, 1.6, 0.35], alpha: 0.6, drag: 2, lift: 5 }
const FIREBALL: Kind = { life: [0.4, 0.9], size: [1, 2.2], grow: 2.4, color: [4, 1.4, 0.3], alpha: 0.5, drag: 3, lift: 3 }
const SMOKE: Kind = { life: [2.5, 4.5], size: [1.2, 2.2], grow: 2.2, color: [0.035, 0.03, 0.028], alpha: 0.75, drag: 1, lift: 2.4 }
const DAMAGE_SMOKE: Kind = { life: [1, 1.8], size: [0.5, 0.9], grow: 1.4, color: [0.1, 0.095, 0.09], alpha: 0.45, drag: 1.5, lift: 2.2 }
const DUST: Kind = { life: [0.7, 1.5], size: [0.6, 1.1], grow: 2.4, color: [0.22, 0.16, 0.11], alpha: 0.28, drag: 2.2, lift: 0.4 }
const SHOCK_DUST: Kind = { life: [0.8, 1.6], size: [1, 1.8], grow: 3, color: [0.2, 0.15, 0.1], alpha: 0.35, drag: 2.8, lift: 0.3 }
const DEBRIS: Kind = { life: [0.9, 1.8], size: [0.1, 0.28], grow: 0, color: [0.02, 0.018, 0.016], alpha: 0.95, drag: 0.4, lift: -14 }
const GUN_SMOKE: Kind = { life: [0.4, 0.8], size: [0.15, 0.3], grow: 1.6, color: [0.14, 0.13, 0.12], alpha: 0.22, drag: 3, lift: 0.8 }
const MOTOR: Kind = { life: [0.05, 0.08], size: [0.35, 0.55], grow: 0, color: [9, 4.2, 1.3], alpha: 1, drag: 0, lift: 0 }
const TRAIL: Kind = { life: [0.9, 1.6], size: [0.3, 0.5], grow: 1.4, color: [0.2, 0.19, 0.18], alpha: 0.5, drag: 2.5, lift: 0.5 }
const TYRE_SMOKE: Kind = { life: [0.9, 1.8], size: [0.6, 1.1], grow: 2.8, color: [0.18, 0.17, 0.16], alpha: 0.45, drag: 2, lift: 0.6 }
const EMBER: Kind = { life: [1.2, 2.6], size: [0.03, 0.06], grow: 0, color: [6, 2.2, 0.5], alpha: 1, drag: 0.8, lift: 2.2 }
const STEAM: Kind = { life: [1.6, 2.8], size: [0.4, 0.8], grow: 1.5, color: [0.13, 0.128, 0.125], alpha: 0.12, drag: 1.2, lift: 1.8 }
const PLUME: Kind = { life: [10, 15], size: [4, 7], grow: 2.6, color: [0.022, 0.02, 0.019], alpha: 0.55, drag: 0.25, lift: 1.1 } // smoke column over a burning building

const TRACER_SPEED = 320 // m/s; purely visual, rounds are hitscan
const BLAST_INTENSITY = 1600

const VERTEX = /* glsl */ `
  attribute vec4 tint;
  attribute float size;
  uniform float uScale;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(-view.z, 0.1);
    gl_Position = projectionMatrix * view;
  }
`

const FRAGMENT = /* glsl */ `
  varying vec4 vTint;
  void main() {
    float alpha = vTint.a * (1.0 - smoothstep(0.15, 1.0, length(gl_PointCoord - 0.5) * 2.0));
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vTint.rgb, alpha);
  }
`

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const direction = new THREE.Vector3()
// Uniform random unit vector (shared scratch).
function scatter() {
  const y = Math.random() * 2 - 1
  const angle = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - y * y)
  return direction.set(Math.cos(angle) * r, y, Math.sin(angle) * r)
}

// Per particle: x y z, vx vy vz, r g b a, age life, size grow, drag lift.
const STRIDE = 16

function createPool(capacity: number, blending: THREE.Blending, fadeIn: boolean, scale: THREE.IUniform<number>) {
  const data = new Float32Array(capacity * STRIDE)
  const positions = new Float32Array(capacity * 3)
  const tints = new Float32Array(capacity * 4)
  const sizes = new Float32Array(capacity)
  const attributes = [
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    new THREE.BufferAttribute(tints, 4).setUsage(THREE.DynamicDrawUsage),
    new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage),
  ]
  const geometry = new THREE.BufferGeometry().setAttribute('position', attributes[0]).setAttribute('tint', attributes[1]).setAttribute('size', attributes[2])
  geometry.setDrawRange(0, 0)
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: scale },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  let count = 0

  return {
    points,
    spawn(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life = rand(kind.life[0], kind.life[1]), taper = 1) {
      if (count === capacity) return
      const o = count++ * STRIDE
      data[o] = x
      data[o + 1] = y
      data[o + 2] = z
      data[o + 3] = vx
      data[o + 4] = vy
      data[o + 5] = vz
      data[o + 6] = kind.color[0]
      data[o + 7] = kind.color[1]
      data[o + 8] = kind.color[2]
      data[o + 9] = kind.alpha * taper
      data[o + 10] = 0
      data[o + 11] = life
      data[o + 12] = rand(kind.size[0], kind.size[1]) * taper
      data[o + 13] = kind.grow
      data[o + 14] = kind.drag
      data[o + 15] = kind.lift
    },
    update(dt: number) {
      let live = 0
      for (let i = 0; i < count; i++) {
        let o = i * STRIDE
        const age = data[o + 10] + dt
        if (age >= data[o + 11]) continue
        if (live !== i) {
          data.copyWithin(live * STRIDE, o, o + STRIDE) // keep the live particles packed
          o = live * STRIDE
        }
        const damping = Math.exp(-data[o + 14] * dt)
        data[o + 3] *= damping
        data[o + 4] = data[o + 4] * damping + data[o + 15] * dt
        data[o + 5] *= damping
        data[o] += data[o + 3] * dt
        data[o + 1] += data[o + 4] * dt
        data[o + 2] += data[o + 5] * dt
        data[o + 10] = age
        const t = age / data[o + 11]
        const fade = fadeIn ? Math.min(1, t * 5) * (1 - t) : 1 - t * t * t * t // glow holds, then drops out
        const cool = fadeIn ? 1 : 1 - t * 0.6 // glowing particles cool from yellow toward red
        positions[live * 3] = data[o]
        positions[live * 3 + 1] = data[o + 1]
        positions[live * 3 + 2] = data[o + 2]
        tints[live * 4] = data[o + 6]
        tints[live * 4 + 1] = data[o + 7] * cool
        tints[live * 4 + 2] = data[o + 8] * cool * cool
        tints[live * 4 + 3] = data[o + 9] * fade
        sizes[live] = data[o + 12] + data[o + 13] * age
        live++
      }
      count = live
      geometry.setDrawRange(0, live)
      for (const attribute of attributes) {
        attribute.clearUpdateRanges()
        attribute.addUpdateRange(0, live * attribute.itemSize)
        attribute.needsUpdate = true
      }
    },
    clear() {
      count = 0
      geometry.setDrawRange(0, 0)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

export function createEffects(scene: THREE.Scene) {
  const scale = { value: 1 } // pixels per metre at unit depth
  const glow = createPool(3000, THREE.AdditiveBlending, false, scale)
  const haze = createPool(2000, THREE.NormalBlending, true, scale)
  haze.points.renderOrder = 1 // smoke first, so fire glows over it
  glow.points.renderOrder = 2
  const blast = new THREE.PointLight('#ff9448', 0, 45, 2) // always in the scene: adding lights recompiles shaders
  let blastLevel = 0
  scene.add(haze.points, glow.points, blast)

  // Particles to emit this frame for `rate` per second on average.
  const quota = (rate: number, dt: number) => Math.floor(rate * dt) + (Math.random() < (rate * dt) % 1 ? 1 : 0)

  return {
    muzzle(at: THREE.Vector3, aim: THREE.Vector3) {
      glow.spawn(FLASH, at.x, at.y, at.z, aim.x * 2, aim.y * 2, aim.z * 2)
      glow.spawn(FLASH, at.x + aim.x * 0.4, at.y + aim.y * 0.4, at.z + aim.z * 0.4, aim.x * 4, aim.y * 4, aim.z * 4)
      haze.spawn(GUN_SMOKE, at.x, at.y, at.z, aim.x * 2, aim.y * 2, aim.z * 2)
    },
    // A glowing streak flying from the muzzle to the impact point: overlapping
    // points, thinning and dimming toward the tail.
    tracer(from: THREE.Vector3, to: THREE.Vector3) {
      direction.subVectors(to, from)
      const length = direction.length()
      if (length < 2) return
      direction.divideScalar(length)
      const { x, y, z } = direction
      for (let k = 0; k < 30; k++) {
        const back = k * 0.06 // spaced under a point's width, so even a streak crossing close by stays solid
        glow.spawn(
          TRACER,
          from.x - x * back,
          from.y - y * back,
          from.z - z * back,
          x * TRACER_SPEED,
          y * TRACER_SPEED,
          z * TRACER_SPEED,
          (length + back) / TRACER_SPEED,
          1 - k / 36,
        )
      }
    },
    impact(at: THREE.Vector3, normal: THREE.Vector3, onVehicle: boolean) {
      for (let i = 0; i < (onVehicle ? 7 : 4); i++) {
        const d = scatter().multiplyScalar(0.8).add(normal).normalize().multiplyScalar(rand(4, 12))
        glow.spawn(SPARK, at.x, at.y, at.z, d.x, d.y, d.z)
      }
      if (onVehicle) glow.spawn(FLASH, at.x, at.y, at.z, 0, 0, 0, 0.05)
      else for (let i = 0; i < 2; i++) haze.spawn(DUST, at.x, at.y, at.z, normal.x + rand(-0.5, 0.5), normal.y + 0.5, normal.z + rand(-0.5, 0.5))
    },
    explosion(at: THREE.Vector3) {
      blast.position.set(at.x, at.y + 2, at.z)
      blastLevel = 1
      for (let i = 0; i < 30; i++) {
        const d = scatter()
        d.y = Math.abs(d.y) * 0.8 + 0.2
        const speed = rand(2, 8)
        glow.spawn(FIREBALL, at.x + d.x * 0.6, at.y + d.y * 0.6, at.z + d.z * 0.6, d.x * speed, d.y * speed, d.z * speed)
      }
      for (let i = 0; i < 34; i++) {
        const d = scatter()
        haze.spawn(SMOKE, at.x + d.x * 1.5, at.y + Math.abs(d.y), at.z + d.z * 1.5, d.x * 3, rand(1.5, 5), d.z * 3)
      }
      for (let i = 0; i < 70; i++) {
        const d = scatter().multiplyScalar(rand(8, 22))
        glow.spawn(SPARK, at.x, at.y, at.z, d.x, Math.abs(d.y), d.z)
      }
      // torn panels flung out, and a ring of dust rolling away along the ground
      for (let i = 0; i < 26; i++) {
        const d = scatter().multiplyScalar(rand(5, 13))
        haze.spawn(DEBRIS, at.x, at.y, at.z, d.x, Math.abs(d.y) + 3, d.z)
      }
      for (let i = 0; i < 22; i++) {
        const angle = (i / 22) * Math.PI * 2
        const speed = rand(7, 11)
        haze.spawn(SHOCK_DUST, at.x, 0.3, at.z, Math.cos(angle) * speed, 0.2, Math.sin(angle) * speed)
      }
    },
    // A car slamming into something: sparks off the struck side, a puff of dirt.
    crash(at: THREE.Vector3, away: THREE.Vector3, force: number) {
      for (let i = 0; i < 6 + force * 18; i++) {
        const d = scatter().multiplyScalar(0.7).add(away).normalize().multiplyScalar(rand(3, 10))
        glow.spawn(SPARK, at.x, at.y, at.z, d.x, d.y, d.z)
      }
      haze.spawn(DUST, at.x, at.y, at.z, away.x, 0.6, away.z)
    },
    // A rocket's motor flaring at `at`, smoke puffed along its path back to `from`.
    rocket(from: THREE.Vector3, at: THREE.Vector3) {
      glow.spawn(MOTOR, at.x, at.y, at.z, 0, 0, 0)
      direction.subVectors(at, from)
      const puffs = Math.ceil(direction.length() / 0.5)
      for (let i = 0; i < puffs; i++) {
        const t = i / puffs
        haze.spawn(TRAIL, from.x + direction.x * t, from.y + direction.y * t, from.z + direction.z * t, rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3))
      }
    },
    // Continuous emitters, called every frame with the frame's dt.
    burn(at: THREE.Vector3, dt: number) {
      for (let i = quota(32, dt); i > 0; i--)
        glow.spawn(FIRE, at.x + rand(-0.8, 0.8), at.y + rand(-0.2, 0.3), at.z + rand(-0.8, 0.8), rand(-0.3, 0.3), rand(0.5, 2.5), rand(-0.3, 0.3))
      for (let i = quota(9, dt); i > 0; i--)
        haze.spawn(SMOKE, at.x + rand(-0.4, 0.4), at.y + 1.2, at.z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(2, 3.5), rand(-0.3, 0.3))
      for (let i = quota(5, dt); i > 0; i--)
        glow.spawn(EMBER, at.x + rand(-0.6, 0.6), at.y + 0.8, at.z + rand(-0.6, 0.6), rand(-0.8, 0.8), rand(1, 3), rand(-0.8, 0.8))
    },
    steam(at: THREE.Vector3, dt: number) {
      for (let i = quota(10, dt); i > 0; i--)
        haze.spawn(STEAM, at.x + rand(-0.25, 0.25), at.y, at.z + rand(-0.25, 0.25), rand(-0.2, 0.2), rand(0.8, 1.6), rand(-0.2, 0.2))
    },
    // A tall column drifting a little downwind; seen from across the map.
    plume(at: THREE.Vector3, dt: number) {
      for (let i = quota(3, dt); i > 0; i--) haze.spawn(PLUME, at.x + rand(-2, 2), at.y, at.z + rand(-2, 2), rand(0.8, 1.6), rand(1, 3), rand(0.2, 0.8))
    },
    smoke(at: THREE.Vector3, amount: number, dt: number) {
      for (let i = quota(4 + 14 * amount, dt); i > 0; i--) {
        haze.spawn(DAMAGE_SMOKE, at.x + rand(-0.3, 0.3), at.y, at.z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.5, 1.5), rand(-0.3, 0.3))
      }
    },
    dust(at: THREE.Vector3, amount: number, dt: number) {
      for (let i = quota(22 * amount, dt); i > 0; i--) haze.spawn(DUST, at.x, at.y, at.z, rand(-1, 1), rand(0.3, 1.2), rand(-1, 1))
    },
    tyreSmoke(at: THREE.Vector3, amount: number, dt: number) {
      for (let i = quota(26 * amount, dt); i > 0; i--) haze.spawn(TYRE_SMOKE, at.x, at.y, at.z, rand(-0.6, 0.6), rand(0.2, 0.8), rand(-0.6, 0.6))
    },
    update(camera: THREE.PerspectiveCamera, viewportHeight: number, dt: number) {
      scale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      glow.update(dt)
      haze.update(dt)
      blast.intensity = BLAST_INTENSITY * blastLevel * blastLevel
      blastLevel = Math.max(0, blastLevel - dt * 2.2)
    },
    clear() {
      glow.clear()
      haze.clear()
      blastLevel = 0
    },
    dispose() {
      scene.remove(haze.points, glow.points, blast)
      glow.dispose()
      haze.dispose()
    },
  }
}
